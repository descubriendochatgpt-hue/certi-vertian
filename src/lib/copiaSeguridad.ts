// Copia de seguridad completa: todos los datos (JSON y CSV para Excel) y
// todos los documentos, en un único ZIP que se descarga en el dispositivo.
// El plan gratuito de Supabase no incluye copias descargables, así que
// conviene hacerla con regularidad y guardarla en un sitio seguro.

import { zipSync } from 'fflate';
import { supabase } from './supabase';
import type { Adjunto } from './api';
import { descargarAdjunto } from './api';
import { NOMBRE_ESTADO, NOMBRE_TIPO_EDIFICIO, type Estado, type Expediente, type TipoEdificio } from './estados';

const TABLAS = ['expedientes', 'toma_datos', 'historial_estados', 'resultados', 'checklist_revision', 'adjuntos', 'edificios'] as const;
const CLAVE_ULTIMA = 'certi.ultimaCopia';
const PAGINA = 1000;

async function todas(tabla: string): Promise<Record<string, unknown>[]> {
  const filas: Record<string, unknown>[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase.from(tabla).select('*').range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`No se ha podido leer «${tabla}»: ${error.message}`);
    filas.push(...(data as Record<string, unknown>[]));
    if (!data || data.length < PAGINA) return filas;
  }
}

/** CSV con «;» y BOM, que es lo que abre bien Excel en español. */
export function aCsv(filas: Record<string, unknown>[], columnas: [string, string][]): string {
  const celda = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [columnas.map(([, t]) => celda(t)).join(';'), ...filas.map((f) => columnas.map(([c]) => celda(f[c])).join(';'))].join('\r\n');
}

const COLUMNAS_CSV: [string, string][] = [
  ['codigo', 'Código'], ['estado_texto', 'Estado'], ['direccion', 'Dirección'], ['municipio', 'Municipio'],
  ['codigo_postal', 'CP'], ['referencia_catastral', 'Referencia catastral'], ['tipo_texto', 'Tipo'],
  ['superficie_util', 'Superficie útil (m²)'], ['anio_construccion', 'Año construcción'],
  ['propietario_nombre', 'Propietario'], ['propietario_nif', 'NIF'], ['propietario_telefono', 'Teléfono'],
  ['propietario_email', 'Email'], ['fecha_visita', 'Fecha visita'], ['calificacion_consumo', 'Calif. consumo'],
  ['calificacion_emisiones', 'Calif. emisiones'], ['fecha_firma', 'Fecha firma'], ['fecha_vencimiento', 'Vencimiento'],
  ['fecha_registro', 'Fecha registro'], ['numero_registro', 'Nº registro'], ['notas', 'Notas'],
];

export function nombreArchivo(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(0, 120) || 'fichero';
}

export async function generarCopia(progreso: (texto: string) => void): Promise<{ zip: Uint8Array; resumen: string; fallidos: string[] }> {
  const ficheros: Record<string, Uint8Array> = {};
  const enc = new TextEncoder();
  const datos: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLAS) {
    progreso(`Leyendo ${t}…`);
    datos[t] = await todas(t);
    ficheros[`datos/${t}.json`] = enc.encode(JSON.stringify(datos[t], null, 2));
  }
  const exps = datos.expedientes as unknown as Expediente[];
  ficheros['expedientes.csv'] = enc.encode(aCsv(
    exps.map((e) => ({ ...e, estado_texto: NOMBRE_ESTADO[e.estado as Estado], tipo_texto: NOMBRE_TIPO_EDIFICIO[e.tipo_edificio as TipoEdificio] })) as unknown as Record<string, unknown>[],
    COLUMNAS_CSV,
  ));

  const codigo = new Map(exps.map((e) => [e.id, e.codigo]));
  const adjuntos = datos.adjuntos as unknown as Adjunto[];
  const fallidos: string[] = [];
  for (const [i, a] of adjuntos.entries()) {
    progreso(`Descargando documentos (${i + 1} de ${adjuntos.length})…`);
    try {
      const b = new Uint8Array(await (await descargarAdjunto(a)).arrayBuffer());
      ficheros[`documentos/${codigo.get(a.expediente_id) ?? a.expediente_id}/${a.id.slice(0, 8)}_${nombreArchivo(a.nombre)}`] = b;
    } catch {
      fallidos.push(a.nombre);
    }
  }
  const ahora = new Date();
  const resumen = [
    'COPIA DE SEGURIDAD · Certificados CEE',
    `Fecha: ${ahora.toLocaleString('es-ES')}`,
    '',
    `Expedientes: ${exps.length}`,
    `Documentos: ${adjuntos.length - fallidos.length} de ${adjuntos.length}${fallidos.length ? ` (no se pudieron descargar: ${fallidos.join(', ')})` : ''}`,
    '',
    'Contenido:',
    '- expedientes.csv: listado para abrir con Excel.',
    '- datos/*.json: todas las tablas completas (sirven para restaurar).',
    '- documentos/<código>/: los ficheros de cada expediente.',
    '',
    'CONTIENE DATOS PERSONALES (nombres, NIF, direcciones). Guárdala cifrada o en un sitio seguro.',
  ].join('\r\n');
  ficheros['LEEME.txt'] = enc.encode(resumen);
  progreso('Comprimiendo…');
  return { zip: zipSync(ficheros, { level: 6 }), resumen, fallidos };
}

export function registrarCopia(): void {
  try { localStorage.setItem(CLAVE_ULTIMA, new Date().toISOString()); } catch { /* sin almacenamiento */ }
}

/** Fecha de la última copia hecha desde ESTE dispositivo. */
export function ultimaCopia(): Date | null {
  try {
    const v = localStorage.getItem(CLAVE_ULTIMA);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}
