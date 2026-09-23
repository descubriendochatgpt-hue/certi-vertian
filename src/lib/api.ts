// Acceso a los datos. Todas las consultas van con la sesión del técnico, así
// que las políticas RLS deciden qué se puede leer y escribir.

import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AnotacionHistorial, Calificacion, Estado, Expediente } from './estados';
import { type TomaDatos, VERSION_ESQUEMA, normalizarTomaDatos } from './tomaDatos';
import { type Resultados, resultadosVacios } from './resultados';

export class ErrorDatos extends Error {}

function traducir(e: PostgrestError | Error): ErrorDatos {
  const m = e.message ?? String(e);
  if (/row-level security|permission denied/i.test(m)) {
    return new ErrorDatos('No tienes permiso para esta operación. Vuelve a entrar con la verificación en dos pasos.');
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return new ErrorDatos('Sin conexión con el servidor. Comprueba la conexión a internet.');
  }
  if (/JWT expired/i.test(m)) return new ErrorDatos('La sesión ha caducado. Vuelve a entrar.');
  // Los mensajes de los triggers y de cambiar_estado ya vienen en español.
  return new ErrorDatos(m);
}

function comprobar<T>(r: { data: T; error: PostgrestError | null }): T {
  if (r.error) throw traducir(r.error);
  return r.data;
}

// ─────────────────────────────── Expedientes ──────────────────────────────

export interface FiltrosExpedientes {
  estado?: Estado | '';
  municipio?: string;
  desde?: string;   // fecha de visita
  hasta?: string;
  texto?: string;
}

export async function listarExpedientes(f: FiltrosExpedientes = {}): Promise<Expediente[]> {
  let q = supabase.from('expedientes').select('*').order('creado_en', { ascending: false }).limit(1000);
  if (f.estado) q = q.eq('estado', f.estado);
  if (f.municipio) q = q.ilike('municipio', f.municipio);
  if (f.desde) q = q.gte('fecha_visita', f.desde);
  if (f.hasta) q = q.lte('fecha_visita', f.hasta);
  if (f.texto?.trim()) {
    // Se quitan los caracteres que tienen significado en el filtro de PostgREST.
    const t = f.texto.trim().replace(/[,()*%\\]/g, ' ');
    q = q.or(`codigo.ilike.*${t}*,direccion.ilike.*${t}*,propietario_nombre.ilike.*${t}*,referencia_catastral.ilike.*${t}*`);
  }
  return comprobar(await q) as Expediente[];
}

/** Expedientes con fecha de vencimiento, para las alertas. */
export async function listarVencimientos(hasta: string): Promise<Expediente[]> {
  return comprobar(
    await supabase.from('expedientes').select('*').not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', hasta).order('fecha_vencimiento'),
  ) as Expediente[];
}

export async function listarMunicipios(): Promise<string[]> {
  const filas = comprobar(await supabase.from('expedientes').select('municipio')) as { municipio: string }[];
  return [...new Set(filas.map((f) => f.municipio))].sort((a, b) => a.localeCompare(b, 'es'));
}

export async function obtenerExpediente(id: string): Promise<Expediente | null> {
  return comprobar(await supabase.from('expedientes').select('*').eq('id', id).maybeSingle()) as Expediente | null;
}

export type DatosExpediente = Pick<
  Expediente,
  | 'direccion' | 'municipio' | 'codigo_postal' | 'referencia_catastral' | 'tipo_edificio'
  | 'superficie_util' | 'anio_construccion' | 'propietario_nombre' | 'propietario_nif'
  | 'propietario_telefono' | 'propietario_email' | 'fecha_visita' | 'notas' | 'avisos_confirmados'
>;

export async function crearExpediente(d: DatosExpediente): Promise<Expediente> {
  return comprobar(await supabase.from('expedientes').insert(d).select().single()) as Expediente;
}

export async function actualizarExpediente(id: string, d: DatosExpediente): Promise<Expediente> {
  return comprobar(await supabase.from('expedientes').update(d).eq('id', id).select().single()) as Expediente;
}

export async function borrarExpediente(id: string): Promise<void> {
  const r = await supabase.from('expedientes').delete().eq('id', id).select('id');
  const filas = comprobar(r) as { id: string }[];
  if (filas.length === 0) throw new ErrorDatos('Solo se pueden borrar expedientes en «Visita pendiente».');
}

export async function historial(id: string): Promise<AnotacionHistorial[]> {
  return comprobar(
    await supabase.from('historial_estados').select('*').eq('expediente_id', id).order('creado_en').order('id'),
  ) as AnotacionHistorial[];
}

export interface CambioEstado {
  destino: Estado;
  nota?: string;
  fecha?: string;
  calificacionConsumo?: Calificacion;
  calificacionEmisiones?: Calificacion;
  numeroRegistro?: string;
}

export async function cambiarEstado(id: string, c: CambioEstado): Promise<Expediente> {
  return comprobar(
    await supabase.rpc('cambiar_estado', {
      p_expediente: id,
      p_destino: c.destino,
      p_nota: c.nota ?? null,
      p_fecha: c.fecha ?? null,
      p_calificacion_consumo: c.calificacionConsumo ?? null,
      p_calificacion_emisiones: c.calificacionEmisiones ?? null,
      p_numero_registro: c.numeroRegistro ?? null,
    }),
  ) as Expediente;
}

// ────────────────────────────── Toma de datos ─────────────────────────────

export interface RegistroTomaDatos {
  datos: TomaDatos;
  avisos_confirmados: string[];
  verificado_en: string | null;
  actualizado_en: string | null;
}

export async function obtenerTomaDatos(expedienteId: string): Promise<RegistroTomaDatos | null> {
  const r = comprobar(
    await supabase.from('toma_datos').select('datos, avisos_confirmados, verificado_en, actualizado_en')
      .eq('expediente_id', expedienteId).maybeSingle(),
  ) as { datos: unknown; avisos_confirmados: string[]; verificado_en: string | null; actualizado_en: string } | null;
  return r && { ...r, datos: normalizarTomaDatos(r.datos) };
}

export async function guardarTomaDatos(expedienteId: string, datos: TomaDatos, avisosConfirmados: string[]): Promise<string> {
  const r = comprobar(
    await supabase.from('toma_datos')
      .upsert({ expediente_id: expedienteId, datos, avisos_confirmados: avisosConfirmados, version_esquema: VERSION_ESQUEMA })
      .select('actualizado_en').single(),
  ) as { actualizado_en: string };
  return r.actualizado_en;
}

// ──────────────────────────── Resultados (módulo 4) ───────────────────────

export async function obtenerResultados(expedienteId: string): Promise<Resultados | null> {
  const r = comprobar(await supabase.from('resultados').select('*').eq('expediente_id', expedienteId).maybeSingle()) as
    (Resultados & { expediente_id: string }) | null;
  if (!r) return null;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...resultadosVacios(), ...r,
    consumo_ep_nr: n(r.consumo_ep_nr), emisiones_co2: n(r.emisiones_co2),
    demanda_calefaccion: n(r.demanda_calefaccion), demanda_refrigeracion: n(r.demanda_refrigeracion),
    recomendaciones: Array.isArray(r.recomendaciones) ? r.recomendaciones : [],
    detalle: r.detalle && typeof r.detalle === 'object' ? r.detalle : {},
  };
}

export async function guardarResultados(expedienteId: string, r: Resultados): Promise<void> {
  const { confirmado_en: _c, actualizado_en: _a, ...datos } = r;
  comprobar(await supabase.from('resultados').upsert({ ...datos, expediente_id: expedienteId }).select('expediente_id'));
}

export interface PuntoChecklist {
  clave: string;
  orden: number;
  texto: string;
  marcado_en: string | null;
  nota: string | null;
}

export async function obtenerChecklist(expedienteId: string): Promise<PuntoChecklist[]> {
  const [items, marcas] = await Promise.all([
    supabase.from('checklist_items').select('clave, orden, texto').order('orden'),
    supabase.from('checklist_revision').select('clave, marcado_en, nota').eq('expediente_id', expedienteId),
  ]);
  const its = comprobar(items) as { clave: string; orden: number; texto: string }[];
  const ms = comprobar(marcas) as { clave: string; marcado_en: string; nota: string | null }[];
  return its.map((i) => {
    const m = ms.find((x) => x.clave === i.clave);
    return { ...i, marcado_en: m?.marcado_en ?? null, nota: m?.nota ?? null };
  });
}

export async function marcarPunto(expedienteId: string, clave: string, nota: string | null): Promise<void> {
  comprobar(await supabase.from('checklist_revision').insert({ expediente_id: expedienteId, clave, nota }).select('clave'));
}

export async function desmarcarPunto(expedienteId: string, clave: string): Promise<void> {
  comprobar(await supabase.from('checklist_revision').delete().eq('expediente_id', expedienteId).eq('clave', clave).select('clave'));
}

// ─────────────────────────────── Documentos ───────────────────────────────

export type TipoAdjunto =
  | 'fichero_calculo' | 'certificado_pdf' | 'certificado_xml' | 'certificado_firmado'
  | 'informe_conformidad' | 'justificante_tasa' | 'declaracion_responsable' | 'foto' | 'otro';

export const NOMBRE_TIPO_ADJUNTO: Record<TipoAdjunto, string> = {
  fichero_calculo: 'Fichero de cálculo (.cex…)',
  certificado_pdf: 'Certificado en PDF (sin firmar)',
  certificado_xml: 'Certificado en XML',
  certificado_firmado: 'Certificado firmado',
  informe_conformidad: 'Informe de conformidad (control externo)',
  justificante_tasa: 'Justificante de la tasa (modelo 046)',
  declaracion_responsable: 'Declaración responsable del técnico',
  foto: 'Foto de la visita',
  otro: 'Otro documento',
};

export interface Adjunto {
  id: string;
  expediente_id: string;
  tipo: TipoAdjunto;
  nombre: string;
  ruta: string;
  tamano: number;
  tipo_mime: string | null;
  sha256: string | null;
  subido_en: string;
}

const CUBO = 'documentos';
/** Límite por fichero (el mismo que tiene el almacén). */
export const TAMANO_MAXIMO = 25 * 1024 * 1024;

export async function listarAdjuntos(expedienteId: string): Promise<Adjunto[]> {
  return comprobar(await supabase.from('adjuntos').select('*').eq('expediente_id', expedienteId).order('subido_en')) as Adjunto[];
}

async function huella(datos: ArrayBuffer): Promise<string | null> {
  try {
    const h = await crypto.subtle.digest('SHA-256', datos);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Nombre seguro para la ruta del almacén; el nombre original se guarda aparte. */
function nombreSeguro(nombre: string): string {
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-100) || 'fichero';
}

export async function subirAdjunto(expedienteId: string, tipo: TipoAdjunto, fichero: File): Promise<Adjunto> {
  if (fichero.size > TAMANO_MAXIMO) throw new ErrorDatos(`El fichero pesa ${(fichero.size / 1048576).toFixed(1)} MB; el máximo son 25 MB.`);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new ErrorDatos('La sesión ha caducado. Vuelve a entrar.');
  const id = crypto.randomUUID();
  const ruta = `${session.user.id}/${expedienteId}/${id}-${nombreSeguro(fichero.name)}`;
  const datos = await fichero.arrayBuffer();
  const subida = await supabase.storage.from(CUBO).upload(ruta, fichero, { contentType: fichero.type || 'application/octet-stream', upsert: false });
  if (subida.error) throw traducir(subida.error);
  try {
    return comprobar(await supabase.from('adjuntos').insert({
      id, expediente_id: expedienteId, tipo, nombre: fichero.name, ruta, tamano: fichero.size,
      tipo_mime: fichero.type || null, sha256: await huella(datos),
    }).select().single()) as Adjunto;
  } catch (e) {
    await supabase.storage.from(CUBO).remove([ruta]);   // no dejar ficheros huérfanos
    throw e;
  }
}

export async function descargarAdjunto(a: Adjunto): Promise<Blob> {
  const { data, error } = await supabase.storage.from(CUBO).download(a.ruta);
  if (error || !data) throw traducir(error ?? new Error('No se ha podido descargar.'));
  return data;
}

export async function borrarAdjunto(a: Adjunto): Promise<void> {
  const filas = comprobar(await supabase.from('adjuntos').delete().eq('id', a.id).select('id')) as { id: string }[];
  if (filas.length === 0) throw new ErrorDatos('Este documento ya no se puede borrar (el expediente está registrado).');
  await supabase.storage.from(CUBO).remove([a.ruta]);
}
