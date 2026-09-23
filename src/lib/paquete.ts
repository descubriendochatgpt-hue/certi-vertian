// Paquete de documentación para el Registro de certificados de eficiencia
// energética del Principado de Asturias (módulo 5).
//
// La app PREPARA el paquete (un ZIP que se descarga en el dispositivo) y NO
// lo envía a ningún sitio: la presentación en la sede electrónica la hace el
// técnico, con su certificado digital, a mano.
//
// Requisitos según la ficha del trámite RECE0016T01 de la sede electrónica
// del Principado (consultada en septiembre de 2026). Si el Principado los
// cambia, basta con actualizar REQUISITOS.

import type { Adjunto, TipoAdjunto } from './api';
import type { Expediente } from './estados';
import { fecha } from './fechas';

export const URL_TRAMITE = 'https://sede.asturias.es/-/dboid-6269000005286094207573';

export interface Requisito {
  clave: string;
  tipo: TipoAdjunto;
  titulo: string;
  explicacion: string;
  /** Nombre del fichero dentro del ZIP (sin extensión). */
  nombreEnZip: string;
  obligatorio: (o: OpcionesPaquete) => boolean;
}

export interface OpcionesPaquete {
  /** Inscrito en el Registro de técnicos del Principado: entonces no hace falta la declaración responsable. */
  inscritoRegistroTecnicos: boolean;
  /** Si el certificado ha pasado control externo, se adjunta el informe de conformidad. */
  controlExterno: boolean;
}

export const REQUISITOS: Requisito[] = [
  {
    clave: 'certificado_firmado', tipo: 'certificado_firmado', nombreEnZip: '01_certificado_firmado',
    titulo: 'Certificado de eficiencia energética firmado (PDF)',
    explicacion: 'Firmado digitalmente por el técnico competente.',
    obligatorio: () => true,
  },
  {
    clave: 'certificado_xml', tipo: 'certificado_xml', nombreEnZip: '02_certificado',
    titulo: 'Fichero XML del programa de certificación',
    explicacion: 'El fichero de salida en XML que genera el programa oficial (en CE3X, botón «XML» tras calificar).',
    obligatorio: () => true,
  },
  {
    clave: 'justificante_tasa', tipo: 'justificante_tasa', nombreEnZip: '03_justificante_tasa_046',
    titulo: 'Justificante de pago de la tasa (modelo 046)',
    explicacion: 'Autoliquidación con el modelo 046; según la ficha del trámite, dato específico 329005.',
    obligatorio: () => true,
  },
  {
    clave: 'declaracion_responsable', tipo: 'declaracion_responsable', nombreEnZip: '04_declaracion_responsable',
    titulo: 'Declaración responsable del técnico',
    explicacion: 'Solo si no estás inscrito en el Registro de técnicos cualificados del Principado.',
    obligatorio: (o) => !o.inscritoRegistroTecnicos,
  },
  {
    clave: 'informe_conformidad', tipo: 'informe_conformidad', nombreEnZip: '05_informe_conformidad',
    titulo: 'Informe de conformidad (control externo)',
    explicacion: 'Solo si el certificado ha pasado control externo.',
    obligatorio: (o) => o.controlExterno,
  },
];

/** Además, para el archivo del técnico: los ficheros del programa en un único comprimido. */
export const TIPOS_FICHEROS_PROGRAMA: TipoAdjunto[] = ['fichero_calculo', 'certificado_xml'];

export function extension(nombre: string): string {
  const m = nombre.match(/\.([a-z0-9]{1,10})$/i);
  return m ? `.${m[1]!.toLowerCase()}` : '';
}

/** El documento más reciente de cada tipo es el que se propone. */
export function propuestaPorTipo(adjuntos: Adjunto[]): Partial<Record<TipoAdjunto, Adjunto>> {
  const r: Partial<Record<TipoAdjunto, Adjunto>> = {};
  for (const a of [...adjuntos].sort((x, y) => x.subido_en.localeCompare(y.subido_en))) r[a.tipo] = a;
  return r;
}

// ───────────────────────── comprobaciones de contenido ───────────────────────

function contiene(bytes: Uint8Array, texto: string): boolean {
  const aguja = new TextEncoder().encode(texto);
  outer: for (let i = 0; i <= bytes.length - aguja.length; i++) {
    for (let j = 0; j < aguja.length; j++) if (bytes[i + j] !== aguja[j]) continue outer;
    return true;
  }
  return false;
}

export function esPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

/**
 * ¿El PDF contiene una firma electrónica? Solo se comprueba que exista un
 * campo de firma (/ByteRange + /Sig o un formato de firma conocido); NO se
 * valida la firma ni el certificado del firmante. Eso lo hace la sede.
 */
export function pdfTieneFirma(bytes: Uint8Array): boolean {
  if (!contiene(bytes, '/ByteRange')) return false;
  return ['/Sig', 'adbe.pkcs7', 'ETSI.CAdES', 'ETSI.RFC3161'].some((t) => contiene(bytes, t));
}

/** Raíz del XML oficial del informe de evaluación energética. */
export const RAIZ_XML_OFICIAL = 'DatosEnergeticosDelEdificio';

export function analizarXml(bytes: Uint8Array): { esXml: boolean; oficial: boolean } {
  const texto = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))).replace(/^\uFEFF/, '').trimStart();
  const esXml = texto.startsWith('<?xml') || texto.startsWith('<');
  return { esXml, oficial: esXml && contiene(bytes, `<${RAIZ_XML_OFICIAL}`) };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────── índice ─────────────────────────────────────

export interface EntradaZip {
  nombreEnZip: string;
  original: string;
  tamano: number;
  sha256: string;
  descripcion: string;
}

export function nombreZip(e: Expediente): string {
  const rc = e.referencia_catastral ? `_${e.referencia_catastral}` : '';
  return `CEE_${e.codigo}${rc}.zip`.replace(/[^\w.-]+/g, '_');
}

export function textoLeeme(e: Expediente, entradas: EntradaZip[], opciones: OpcionesPaquete, generadoEn: Date): string {
  const l: string[] = [];
  l.push('PAQUETE PARA EL REGISTRO DE CERTIFICADOS DE EFICIENCIA ENERGÉTICA');
  l.push('Principado de Asturias · trámite RECE0016T01');
  l.push('');
  l.push(`Expediente: ${e.codigo}`);
  l.push(`Inmueble: ${e.direccion}, ${e.municipio}${e.codigo_postal ? ` (${e.codigo_postal})` : ''}`);
  l.push(`Referencia catastral: ${e.referencia_catastral ?? '—'}`);
  l.push(`Calificación: consumo ${e.calificacion_consumo ?? '—'} · emisiones ${e.calificacion_emisiones ?? '—'}`);
  l.push(`Fecha de firma: ${fecha(e.fecha_firma)} · válido hasta: ${fecha(e.fecha_vencimiento)}`);
  l.push(`Paquete preparado: ${generadoEn.toLocaleString('es-ES')}`);
  l.push('');
  l.push('ESTE PAQUETE NO SE HA ENVIADO A NINGÚN SITIO.');
  l.push('La presentación la hace el técnico, con su certificado digital, en la sede electrónica:');
  l.push(URL_TRAMITE);
  l.push('');
  l.push(`Inscrito en el Registro de técnicos: ${opciones.inscritoRegistroTecnicos ? 'sí' : 'no'}`);
  l.push(`Control externo: ${opciones.controlExterno ? 'sí' : 'no'}`);
  l.push('');
  l.push('CONTENIDO (con huella SHA-256 para comprobar que no ha cambiado)');
  for (const x of entradas) {
    l.push('');
    l.push(`- ${x.nombreEnZip}`);
    l.push(`  ${x.descripcion}`);
    l.push(`  Original: ${x.original} · ${x.tamano} bytes`);
    l.push(`  SHA-256: ${x.sha256}`);
  }
  l.push('');
  return l.join('\r\n');
}
