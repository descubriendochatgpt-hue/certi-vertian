// Lectura de la ficha descriptiva del Catastro (servicio público, sin clave):
// Consulta_DNPRC del callejero de la Sede Electrónica del Catastro, en JSON.
// Solo se usa para PROPONER datos (año, superficie construida, uso, planta):
// el técnico los revisa antes de usarlos.

export const URL_CATASTRO = 'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC';

export interface DatosCatastro {
  referencia: string;
  direccion: string | null;
  uso: string | null;
  superficieConstruida: number | null;
  anioConstruccion: number | null;
  planta: string | null;
  /** Desglose: «VIVIENDA 75 m²», «ELEMENTOS COMUNES 10 m²»… */
  construcciones: string[];
}

/** Referencia catastral de un inmueble: 20 caracteres (14 de la parcela + 4 + 2 de control). */
export function normalizarReferencia(rc: string): string | null {
  const r = rc.toUpperCase().replace(/[\s-]/g, '');
  return /^[0-9A-Z]{20}$/.test(r) ? r : null;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown) => { const t = txt(v); if (!t) return null; const n = Number(t.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** Interpreta la respuesta del Catastro. Lanza un error con el mensaje del Catastro si no hay inmueble. */
export function leerRespuestaCatastro(json: unknown, referencia: string): DatosCatastro {
  const res = obj(obj(json)?.consulta_dnprcResult) ?? obj(json);
  const errores = arr(obj(res?.lerr)?.err ?? res?.lerr).map((e) => txt(obj(e)?.des)).filter(Boolean);
  if (errores.length) throw new Error(`El Catastro dice: ${errores.join('; ')}`);
  const bico = obj(res?.bico);
  if (!bico) {
    if (obj(res?.lrcdnp)) throw new Error('Esa referencia corresponde a varios inmuebles: usa la de 20 caracteres de la vivienda o local.');
    throw new Error('El Catastro no ha devuelto ningún inmueble con esa referencia.');
  }
  const bi = obj(bico.bi);
  const debi = obj(bi?.debi);
  const loint = obj(obj(obj(obj(obj(bi?.dt)?.locs)?.lous)?.lourb)?.loint);
  const construcciones = arr(bico.lcons).map((c) => {
    const o = obj(c);
    const sup = num(obj(o?.dfcons)?.stl);
    const nombre = txt(o?.lcd);
    return nombre ? `${nombre}${sup !== null ? ` ${sup} m²` : ''}` : null;
  }).filter((x): x is string => !!x);
  const anio = num(debi?.ant);
  return {
    referencia,
    direccion: txt(bi?.ldt),
    uso: txt(debi?.luso),
    superficieConstruida: num(debi?.sfc),
    anioConstruccion: anio && anio > 1000 && anio < 3000 ? anio : null,
    planta: txt(loint?.pt),
    construcciones,
  };
}
