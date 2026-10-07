// Catálogo de «soluciones» de CE3X aprendido de proyectos reales.
//
// CE3X se queda colgado al abrir un .cex si un desplegable tiene un texto que
// no es exactamente una de sus opciones. Por eso los cerramientos, huecos e
// instalaciones NO se construyen desde cero: se copian de un proyecto real
// guardado por CE3X (una «solución»: fachada estimada de doble hoja, ventana
// metálica sin RPT con doble vidrio, termo eléctrico…) y en la copia solo se
// cambian el nombre, las medidas y la potencia. Así, todo texto que llega al
// .cex lo escribió antes el propio CE3X.
//
// El técnico puede subir más proyectos suyos para ampliar el catálogo. De
// cada proyecto solo se guardan la envolvente, las instalaciones y la
// librería de cerramientos (nunca los datos administrativos ni del cliente).

import { type Py, PyBytes, PyDict, PyFloat, PyLong, PyObject, escribirPickle, latin1ABytes, leerPickles, texto } from './pickle';
import { CEX_BASE, ORIGEN_BASE } from './catalogoBase';

export type TipoSolucion = 'cerramiento' | 'hueco' | 'instalacion' | 'puente';

export interface Solucion {
  /** Identifica la solución: lo que la distingue de otras del mismo tipo. */
  clave: string;
  tipo: TipoSolucion;
  /** Texto para el técnico (y para la IA): «Fachada · Estimadas · Doble hoja con cámara… · U 1,69». */
  etiqueta: string;
  /** Textos de CE3X que sirven para emparejar con la toma de datos. */
  ce3x: Record<string, string | number>;
  /** El elemento tal cual lo guardó CE3X (pickle de texto). */
  datos: string;
  /** Composición de la librería de cerramientos que usa (pickle), si la usa. */
  composicion?: string;
  /** Proyecto del que se aprendió. */
  origen: string;
}

const lista = (v: Py | undefined): Py[] => (Array.isArray(v) ? v : []);
const real = (v: Py | undefined): number | undefined =>
  v instanceof PyFloat ? v.v : typeof v === 'number' ? v : typeof texto(v) === 'string' && texto(v) !== '' && Number.isFinite(Number(texto(v))) ? Number(texto(v)) : undefined;
const fmt = (n: number | undefined) => (n === undefined ? '?' : String(Math.round(n * 1000) / 1000).replace('.', ','));
const atr = (o: Py | undefined, k: string): Py | undefined => (o instanceof PyObject && o.state instanceof PyDict ? o.state.get(k) : undefined);
/** Para comparar soluciones: «str» y «unicode» con el mismo texto cuentan igual. */
const sinTipoTexto = (v: Py | undefined): Py => {
  if (v === undefined) return null;
  if (v instanceof PyBytes) return v.s;
  return Array.isArray(v) ? v.map(sinTipoTexto) : v;
};
/** Resumen corto (cyrb53, en hexadecimal) de lo que distingue a una solución. */
const firmaDe = (valores: (Py | undefined)[]) => {
  const t = escribirPickle(valores.map(sinTipoTexto));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
};

/** Copia independiente de un valor (lo compartido dentro de él se mantiene compartido). */
export function copiar<T extends Py>(v: T): T {
  return leerPickles(escribirPickle(v))[0] as T;
}

/** Servicios de las instalaciones de CE3X, por posición en sus listas. */
export const SERVICIOS_CE3X = ['ACS', 'Calefacción', 'Refrigeración'] as const;

/** Qué servicios (posiciones 0 ACS, 1 calefacción, 2 refrigeración) cubre una instalación. */
export function serviciosDeInstalacion(el: Py[]): number[] {
  return lista(el[2]).flatMap((v, i) => (real(v) !== undefined ? [i] : []));
}

function solucionCerramiento(el: Py[], libreria: Map<string, PyObject>, origen: string): Solucion | null {
  const [, tipoV, , u, peso, , composicionV, , modoV, parametros] = el;
  const tipo = texto(tipoV), modo = texto(modoV), composicion = texto(composicionV) ?? '';
  if (!tipo || !modo) return null;
  const comp = composicion ? libreria.get(composicion) : undefined;
  if (composicion && !comp) return null; // la composición no está en el proyecto: no se puede copiar entera
  const detalle = modo === 'Conocidas' && composicion ? composicion
    : lista(parametros).map(texto).filter((t): t is string => !!t && t !== '').join(', ');
  const firma = firmaDe([tipoV, modoV, composicionV, parametros, u, peso]);
  return {
    clave: `cerramiento:${firma}`,
    tipo: 'cerramiento',
    etiqueta: `${tipo} · ${modo}${detalle ? ` · ${detalle}` : ''} · U ${fmt(real(u))} W/m²K`,
    ce3x: { tipo, modo, u: real(u) ?? 0 },
    datos: escribirPickle(el),
    composicion: comp ? escribirPickle(comp) : undefined,
    origen,
  };
}

const CAMPOS_FIRMA_HUECO = ['tipo', 'tipoMarco', 'tipoVidrio', 'Uvidrio', 'Gvidrio', 'Umarco', 'porcMarco', 'permeabilidadChoice',
  'permeabilidadValor', 'absortividadValor', 'dobleVentana', 'tieneProteccionSolar'];

function solucionHueco(h: Py, origen: string): Solucion | null {
  if (!(h instanceof PyObject) || !(h.state instanceof PyDict)) return null;
  const tipoMarco = texto(atr(h, 'tipoMarco')), tipoVidrio = texto(atr(h, 'tipoVidrio'));
  if (!tipoMarco || !tipoVidrio) return null;
  // Las protecciones solares sin las medidas del hueco (posiciones 3 y 4)
  const prot = lista(atr(h, 'elementosProteccionSolar')).map((v, i) => (i === 3 || i === 4 ? null : v));
  const firma = firmaDe([h.cls.name, ...CAMPOS_FIRMA_HUECO.map((k) => atr(h, k)), prot]);
  const conProteccion = atr(h, 'tieneProteccionSolar') === true;
  return {
    clave: `hueco:${firma}`,
    tipo: 'hueco',
    etiqueta: `${texto(atr(h, 'tipo')) ?? 'Hueco'} · marco ${tipoMarco} (U ${fmt(real(atr(h, 'Umarco')))}, ${fmt(real(atr(h, 'porcMarco')))} %)` +
      ` · vidrio ${tipoVidrio} (U ${fmt(real(atr(h, 'Uvidrio')))}, g ${fmt(real(atr(h, 'Gvidrio')))})` +
      ` · permeabilidad ${texto(atr(h, 'permeabilidadChoice')) ?? '?'}${conProteccion ? ' · con protección solar' : ''}`,
    ce3x: { tipoMarco, tipoVidrio, proteccion: conProteccion ? 1 : 0 },
    datos: escribirPickle(h),
    origen,
  };
}

function solucionInstalacion(el: Py[], parte: number, origen: string): Solucion | null {
  const nombre = texto(el[0]), servicio = texto(el[1]), generador = texto(el[3]), combustible = texto(el[4]), modo = texto(el[6]);
  if (!nombre || !servicio || !generador || !combustible) return null;
  const servicios = serviciosDeInstalacion(el);
  const rend = lista(lista(el[7])[0]).map(real).filter((n): n is number => n !== undefined);
  const firma = firmaDe([parte, el[1], el[3], el[4], el[6], lista(el[7])[0]]);
  return {
    clave: `instalacion:${firma}`,
    tipo: 'instalacion',
    etiqueta: `${servicios.map((i) => SERVICIOS_CE3X[i]).join(' + ') || servicio} · ${generador} · ${combustible}` +
      `${modo ? ` · ${modo}` : ''}${rend.length ? ` · rendimiento ${rend.map(fmt).join('/')} %` : ''}`,
    ce3x: { parte, servicio, generador, combustible, servicios: servicios.join(',') },
    datos: escribirPickle(el),
    origen,
  };
}

function solucionPuente(el: Py[], origen: string): Solucion | null {
  const tipo = texto(el[2]);
  if (texto(el[1]) !== 'PT' || !tipo) return null;
  const firma = firmaDe([el[2], el[3], el[5], el[6]]);
  return {
    clave: `puente:${firma}`,
    tipo: 'puente',
    etiqueta: `${tipo} · ψ ${fmt(real(el[3]))} W/mK (${texto(el[6]) ?? ''})`,
    ce3x: { tipo, psi: real(el[3]) ?? 0 },
    datos: escribirPickle(el),
    origen,
  };
}

/**
 * Saca las soluciones de un proyecto de CE3X (sus bloques ya leídos). Las
 * repetidas (misma solución en varios muros) salen una sola vez.
 */
export function aprenderSoluciones(bloques: Py[], origen: string): Solucion[] {
  const env = lista(bloques[3]);
  const inst = lista(bloques[4]);
  const libreria = new Map<string, PyObject>();
  for (const c of lista(bloques[8])) {
    const n = texto(atr(c, 'nombre'));
    if (n && c instanceof PyObject) libreria.set(n, c);
  }
  const todas: (Solucion | null)[] = [
    ...lista(env[0]).map((el) => (Array.isArray(el) ? solucionCerramiento(el, libreria, origen) : null)),
    ...lista(env[1]).map((h) => solucionHueco(h, origen)),
    ...lista(env[2]).map((el) => (Array.isArray(el) ? solucionPuente(el, origen) : null)),
    ...inst.flatMap((parte, i) => lista(parte).map((el) => (Array.isArray(el) ? solucionInstalacion(el, i, origen) : null))),
  ];
  const vistas = new Map<string, Solucion>();
  for (const s of todas) if (s && !vistas.has(s.clave)) vistas.set(s.clave, s);
  return [...vistas.values()];
}

/** Lee un .cex entero y saca sus soluciones. */
export function aprenderDeCex(bytes: Uint8Array, origen: string): Solucion[] {
  let bloques: Py[];
  try {
    bloques = leerPickles(bytes);
  } catch (e) {
    throw new Error(`No parece un proyecto de CE3X (${(e as Error).message})`);
  }
  if (!texto(bloques[0])?.startsWith('CE3X')) throw new Error('No parece un proyecto .cex de CE3X.');
  return aprenderSoluciones(bloques, origen);
}

/** Orientaciones que aparecen en el catálogo (las únicas que se escriben). */
export function orientacionesVistas(catalogo: Solucion[]): Set<string> {
  const vistas = new Set<string>();
  for (const s of catalogo) {
    const v = leerPickles(s.datos)[0];
    const o = s.tipo === 'cerramiento' ? texto(lista(v)[5]) : s.tipo === 'hueco' ? texto(atr(v, 'orientacion')) : undefined;
    if (o) vistas.add(o);
  }
  return vistas;
}

/** UUID nuevo (versión 4) como entero, igual que lo guarda Python. */
export function nuevoUuid(aleatorio: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): PyLong {
  const b = aleatorio(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return new PyLong(v);
}

/** Sustituye un texto conservando si era str (bytes) o unicode. */
export function mismoTipo(antes: Py | undefined, valor: string): Py {
  return antes instanceof PyBytes ? new PyBytes(valor) : valor;
}

let base: Solucion[] | undefined;
/** Catálogo de partida (proyecto de ejemplo incluido en la aplicación). */
export function catalogoDePartida(): Solucion[] {
  base ??= aprenderDeCex(latin1ABytes(atob(CEX_BASE)), ORIGEN_BASE);
  return base;
}

/** Une catálogos sin repetir soluciones (gana la primera que aparece). */
export function unirCatalogos(...catalogos: Solucion[][]): Solucion[] {
  const vistas = new Map<string, Solucion>();
  for (const c of catalogos) for (const s of c) if (!vistas.has(s.clave)) vistas.set(s.clave, s);
  return [...vistas.values()];
}
