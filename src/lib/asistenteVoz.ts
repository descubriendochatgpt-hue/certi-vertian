// Asistente guiado por voz para la toma de datos.
//
// Recorre las cuatro pantallas de CE3X en su orden (Datos administrativos,
// Datos generales, Envolvente térmica, Instalaciones) y pregunta SOLO lo que
// falta: no pregunta lo que ya está en el expediente o en la toma de datos ni
// los valores que CE3X trae por defecto (altura libre 2,7 m, ventilación
// 0,63 ren/h, masa media, «Sin patrón», rendimientos estimados…).
//
// Aquí está la parte que no depende del navegador (qué preguntar y cómo
// entender la respuesta); la voz y la pantalla están en
// componentes/AsistenteVoz.tsx.

import type { Expediente } from './estados';
import { esResidencial } from './estados';
import {
  CAMPOS_ADMINISTRATIVOS, CAMPOS_CERRAMIENTO, CAMPOS_GENERALES, CAMPOS_HUECO, CAMPOS_INSTALACION, CAMPOS_PUENTE_TERMICO,
  type DefCampo, type Opcion, type TomaDatos, type Valor,
} from './tomaDatos';
import { type Destino, type Elemento, interpretarFrase, normalizar } from './importarDatos';
import { formatearNumero } from './validaciones';

export type Pantalla = 'Datos administrativos' | 'Datos generales' | 'Envolvente térmica' | 'Instalaciones';
export const PANTALLAS: Pantalla[] = ['Datos administrativos', 'Datos generales', 'Envolvente térmica', 'Instalaciones'];

/** Un paso del guion: o un dato concreto, o «describe elementos hasta que digas terminado». */
export type Paso =
  | { tipo: 'campo'; pantalla: Pantalla; def: DefCampo; pregunta: string }
  | { tipo: 'lista'; pantalla: 'Envolvente térmica' | 'Instalaciones'; pregunta: string };

// ─────────────────────────────── Preguntas ────────────────────────────────

/** Cómo se pregunta cada dato en voz alta (corto y con ejemplos de respuesta). */
const PREGUNTAS: Record<string, string> = {
  nombreEdificio: 'Nombre del edificio. Si quieres usar la dirección, di «saltar».',
  gradoProteccion: '¿Tiene el edificio algún grado de protección? Di «ninguno» o «protegido».',
  usoEdificio: 'Uso del edificio: ¿residencial privado, residencial público u otro?',
  clienteDireccion: 'Dirección del cliente.',
  clienteLocalidad: 'Localidad del cliente.',
  clienteCodigoPostal: 'Código postal del cliente.',
  clienteProvincia: 'Provincia del cliente.',
  normativa: 'Normativa vigente en la construcción: ¿anterior a la CT 79, CT 79, CTE 2006, CTE 2013 o CTE 2019?',
  anioConstruccion: 'Año de construcción.',
  zonaClimatica: 'Zona climática. Por ejemplo, C 1, D 1 o E 1.',
  superficieUtilRd390: 'Superficie útil según el Real Decreto 390, en metros cuadrados.',
  superficieUtil: 'Superficie útil habitable para el cálculo, en metros cuadrados.',
  numeroViviendas: 'Número de viviendas o unidades de uso.',
  numeroPlantas: 'Número de plantas habitables.',
  plantasSobreRasante: 'Número de plantas sobre rasante del edificio.',
  plantasBajoRasante: 'Número de plantas bajo rasante.',
  demandaAcs: 'Demanda diaria de agua caliente, en litros al día. Si no la sabes, di «saltar».',
  // Detalles de un elemento (envolvente e instalaciones)
  superficie: '¿Qué superficie tiene, en metros cuadrados? Puedes decir largo por alto.',
  orientacion: '¿Orientación? Norte, sur, este, oeste…',
  tipoVidrio: '¿Tipo de vidrio? Simple, doble, doble bajo emisivo o triple.',
  tipoMarco: '¿Tipo de marco? Aluminio, aluminio con rotura de puente térmico, PVC, madera o metálico.',
  cantidad: '¿Cuántos huecos iguales hay?',
  longitud: '¿Qué longitud tiene, en metros?',
  servicio: '¿Para qué servicio? Calefacción, agua caliente, refrigeración o varios.',
  generador: '¿Qué generador? Caldera estándar, de condensación, bomba de calor, termo eléctrico…',
  combustible: '¿Qué combustible? Gas natural, gasóleo, electricidad, propano, biomasa…',
  potencia: '¿Potencia nominal en kilovatios? Si no la sabes, di «saltar».',
};

const PREGUNTA_ENVOLVENTE =
  'Describe un elemento de la envolvente. Por ejemplo: «fachada norte de 25 metros cuadrados», «ventana sur de 1,20 por 1,50» ' +
  'o «frente de forjado de 12 metros». Cuando acabes, di «terminado».';
const PREGUNTA_INSTALACIONES =
  'Describe un equipo. Por ejemplo: «caldera de gas natural para calefacción y agua caliente de 24 kilovatios» ' +
  'o «termo eléctrico de 80 litros». Cuando acabes, di «terminado».';

const vacio = (v: Valor | undefined) => v === undefined || v === null || v === '';

/**
 * Guion de preguntas para esta toma de datos: lo que ya se sabe no se
 * pregunta. Los valores por defecto de CE3X (altura libre, ventilación,
 * masa de las particiones) no se preguntan nunca.
 */
export function guion(toma: TomaDatos, exp: Pick<Expediente, 'tipo_edificio' | 'anio_construccion' | 'codigo_postal'>): Paso[] {
  const g = toma.generales;
  const pasos: Paso[] = [];
  const campo = (pantalla: Pantalla, defs: DefCampo[], nombre: string) => {
    const def = defs.find((d) => d.campo === nombre)!;
    if (vacio(g[nombre])) pasos.push({ tipo: 'campo', pantalla, def, pregunta: PREGUNTAS[nombre] ?? `${def.etiqueta}.` });
  };
  const vivienda = exp.tipo_edificio === 'vivienda_unifamiliar' || exp.tipo_edificio === 'vivienda_en_bloque';

  // 1. Datos administrativos (dirección, catastro y propietario ya están en el expediente)
  for (const c of ['nombreEdificio', 'gradoProteccion']) campo('Datos administrativos', CAMPOS_ADMINISTRATIVOS, c);
  if (!esResidencial(exp.tipo_edificio)) campo('Datos administrativos', CAMPOS_ADMINISTRATIVOS, 'usoEdificio');
  for (const c of ['clienteDireccion', 'clienteLocalidad', 'clienteCodigoPostal']) campo('Datos administrativos', CAMPOS_ADMINISTRATIVOS, c);
  // La provincia sale del código postal; solo se pregunta si no hay forma de saberla.
  if (!/^\d{5}$/.test(String(g.clienteCodigoPostal ?? ''))) campo('Datos administrativos', CAMPOS_ADMINISTRATIVOS, 'clienteProvincia');

  // 2. Datos generales (tipo de edificio, provincia y localidad: del expediente)
  campo('Datos generales', CAMPOS_GENERALES, 'normativa');
  if (!exp.anio_construccion) campo('Datos generales', CAMPOS_GENERALES, 'anioConstruccion');
  campo('Datos generales', CAMPOS_GENERALES, 'zonaClimatica');
  for (const c of ['superficieUtilRd390', 'superficieUtil']) campo('Datos generales', CAMPOS_GENERALES, c);
  if (!vivienda) campo('Datos generales', CAMPOS_GENERALES, 'numeroViviendas');
  for (const c of ['numeroPlantas', 'plantasSobreRasante', 'plantasBajoRasante', 'demandaAcs']) campo('Datos generales', CAMPOS_GENERALES, c);

  // 3 y 4. Elementos: se describen uno a uno hasta decir «terminado»
  pasos.push({ tipo: 'lista', pantalla: 'Envolvente térmica', pregunta: PREGUNTA_ENVOLVENTE });
  pasos.push({ tipo: 'lista', pantalla: 'Instalaciones', pregunta: PREGUNTA_INSTALACIONES });
  return pasos;
}

/**
 * ¿Sigue haciendo falta esta pregunta? Se comprueba justo antes de hacerla:
 * una respuesta anterior puede haberla resuelto (p. ej. la provincia sale del
 * código postal que se acaba de dictar).
 */
export function hayQuePreguntar(paso: Paso, toma: TomaDatos): boolean {
  if (paso.tipo === 'lista') return true;
  const g = toma.generales;
  if (!vacio(g[paso.def.campo])) return false;
  if (paso.def.campo === 'clienteProvincia' && /^\d{5}$/.test(String(g.clienteCodigoPostal ?? ''))) return false;
  return true;
}

/** Datos que se rellenan solos al empezar (sin preguntar), con su explicación. */
export function valoresAutomaticos(toma: TomaDatos, exp: Pick<Expediente, 'tipo_edificio'>): { campo: string; valor: Valor; motivo: string }[] {
  const g = toma.generales;
  const r: { campo: string; valor: Valor; motivo: string }[] = [];
  if (esResidencial(exp.tipo_edificio) && vacio(g.usoEdificio)) {
    r.push({ campo: 'usoEdificio', valor: 'residencial_privado', motivo: 'Uso: residencial privado (es una vivienda).' });
  }
  if ((exp.tipo_edificio === 'vivienda_unifamiliar' || exp.tipo_edificio === 'vivienda_en_bloque') && vacio(g.numeroViviendas)) {
    r.push({ campo: 'numeroViviendas', valor: 1, motivo: 'Unidades de uso: 1 (una vivienda).' });
  }
  return r;
}

/** Detalles que se preguntan después de describir un elemento, si no se han dicho. */
export function detallesQueFaltan(destino: Destino, v: Record<string, Valor>): DefCampo[] {
  const de = (defs: DefCampo[], nombres: string[]) =>
    nombres.map((n) => defs.find((d) => d.campo === n)!).filter((d) => vacio(v[d.campo]) && (!d.visibleSi || d.visibleSi(v)));
  switch (destino) {
    case 'cerramientos':
      // Particiones y medianerías no llevan orientación en CE3X
      return de(CAMPOS_CERRAMIENTO, v.tipo === 'fachada' || v.tipo === 'cubierta' ? ['superficie', 'orientacion'] : ['superficie']);
    case 'huecos': return de(CAMPOS_HUECO, ['superficie', 'orientacion', 'tipoVidrio', 'tipoMarco']);
    case 'puentesTermicos': return de(CAMPOS_PUENTE_TERMICO, ['longitud']);
    case 'instalaciones': return de(CAMPOS_INSTALACION, ['servicio', 'generador', 'combustible', 'potencia']);
    default: return [];
  }
}

export function preguntaDe(def: DefCampo): string {
  return PREGUNTAS[def.campo] ?? `${def.etiqueta}.`;
}

// ───────────────────────────── Entender respuestas ─────────────────────────

export type Comando = 'saltar' | 'atras' | 'repetir' | 'parar' | 'terminado';

/** Órdenes que valen en cualquier pregunta. */
export function comando(texto: string): Comando | null {
  const n = normalizar(texto).replace(/[.,;:!¡?¿]/g, '').trim();
  if (/^(saltar|salta|siguiente|paso|no se|no lo se|ni idea|omitir|no lo tengo)$/.test(n)) return 'saltar';
  if (/^(atras|anterior|volver|vuelve)$/.test(n)) return 'atras';
  if (/^(repetir|repite|otra vez|como|que)$/.test(n)) return 'repetir';
  if (/^(parar|para|stop|salir|cancelar|detener)$/.test(n)) return 'parar';
  if (/^(terminado|termine|ya esta|ya|fin|listo|nada mas|ninguno mas|he terminado)$/.test(n)) return 'terminado';
  return null;
}

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

/** «dos mil cuatro» → 2004; null si alguna palabra no es un número. */
function enteroEnPalabras(palabras: string[]): number | null {
  if (palabras.length === 0) return null;
  let total = 0, actual = 0;
  for (const p of palabras) {
    if (p === 'y') continue;
    if (p === 'mil') { total += (actual || 1) * 1000; actual = 0; continue; }
    if (/^\d+$/.test(p)) { actual += Number(p); continue; }
    const v = UNIDADES[p];
    if (v === undefined) return null;
    actual += v;
  }
  return total + actual;
}

/**
 * Lee un número dicho en voz alta: «85,5», «85 coma 5», «ochenta y cinco
 * coma cinco», «dos mil cuatro», «cero coma cuatro cinco». Si hay medidas
 * («1,20 por 1,50») devuelve el producto. null si no hay número.
 */
export function leerNumeroHablado(texto: string): number | null {
  const n = normalizar(texto)
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')       // 1.200 → 1200
    .replace(/(\d),(\d)/g, '$1 coma $2')
    .replace(/(\d)\.(\d)/g, '$1 coma $2')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const por = n.split(/ (?:por|x) /);
  if (por.length === 2) {
    const a = leerNumeroHablado(por[0]!), b = leerNumeroHablado(por[1]!);
    if (a !== null && b !== null) return Math.round(a * b * 1000) / 1000;
  }
  const ps = n.split(' ').filter((p) => p in UNIDADES || p === 'y' || p === 'mil' || p === 'coma' || p === 'punto' || /^\d+$/.test(p));
  // Solo el primer número de la frase (palabras numéricas seguidas)
  const i = ps.findIndex((p) => p !== 'y' && p !== 'coma' && p !== 'punto');
  if (i < 0) return null;
  const resto = n.split(' ');
  const inicio = resto.indexOf(ps[i]!);
  const seguidas: string[] = [];
  for (const p of resto.slice(inicio)) {
    if (p in UNIDADES || p === 'y' || p === 'mil' || p === 'coma' || p === 'punto' || /^\d+$/.test(p)) seguidas.push(p);
    else break;
  }
  const k = seguidas.findIndex((p) => p === 'coma' || p === 'punto');
  const entera = enteroEnPalabras(k < 0 ? seguidas : seguidas.slice(0, k));
  if (entera === null) return null;
  if (k < 0) return entera;
  const dec = seguidas.slice(k + 1).filter((p) => p !== 'y');
  if (dec.length === 0) return entera;
  // «coma cuatro cinco» = ,45 (cifra a cifra); «coma cuarenta y cinco» = ,45
  const cifraACifra = dec.length > 1 && dec.every((p) => /^\d$/.test(p) || (UNIDADES[p] ?? 99) < 10);
  const digitos = cifraACifra
    ? dec.map((p) => (/^\d$/.test(p) ? p : String(UNIDADES[p]))).join('')
    : String(enteroEnPalabras(dec) ?? '');
  if (!/^\d+$/.test(digitos)) return entera;
  return Number(`${entera}.${digitos}`);
}

/** Sinónimos de las opciones (lo que la gente dice en vez de la etiqueta). */
const SINONIMOS: Record<string, Record<string, string[]>> = {
  normativa: {
    anterior_ct79: ['anterior', 'antes', 'antigua', 'anterior a la ct', 'anterior a 1979'],
    ct79: ['ct 79', 'ct79', 'nbe', 'setenta y nueve', '1979'],
    cte2006: ['2006', 'dos mil seis'], cte2013: ['2013', 'dos mil trece'], cte2019: ['2019', 'dos mil diecinueve'],
  },
  gradoProteccion: { ninguna: ['ninguno', 'ninguna', 'no', 'sin proteccion', 'nada'], protegido: ['protegido', 'si', 'catalogado'] },
  usoEdificio: { residencial_privado: ['privado'], residencial_publico: ['publico'], otro: ['otro', 'terciario'] },
  masaParticiones: { ligera: ['ligera'], media: ['media'], pesada: ['pesada'] },
  tipoVidrio: { doble_be: ['bajo emisivo', 'baja emisividad'], triple: ['triple'], doble: ['doble', 'climalit', 'camara'], simple: ['simple', 'sencillo'] },
  tipoMarco: { aluminio_rpt: ['rotura', 'rpt'], pvc: ['pvc'], madera: ['madera'], metalico: ['metalico', 'hierro', 'acero'], aluminio: ['aluminio'] },
  servicio: {
    mixto_3: ['todo', 'las tres', 'calefaccion refrigeracion y agua', 'calefaccion frio y agua'],
    calefaccion_acs: ['calefaccion y agua', 'calefaccion y acs', 'mixto', 'mixta'],
    calefaccion_refrigeracion: ['calefaccion y refrigeracion', 'calefaccion y frio', 'frio y calor'],
    acs: ['agua caliente', 'acs'], refrigeracion: ['refrigeracion', 'frio', 'aire acondicionado'], calefaccion: ['calefaccion'],
  },
  generador: {
    caldera_condensacion: ['condensacion'], caldera_baja_temp: ['baja temperatura'], caldera_biomasa: ['biomasa', 'pellet'],
    bomba_calor: ['bomba', 'aerotermia'], efecto_joule: ['termo', 'electrico', 'joule', 'radiadores', 'acumuladores'],
    equipo_split: ['split', 'aire acondicionado'], red_distrito: ['red', 'distrito'], caldera_estandar: ['estandar', 'caldera', 'normal'],
  },
  combustible: {
    gas_natural: ['gas natural', 'gas'], glp: ['propano', 'butano', 'glp'], gasoleo: ['gasoleo', 'gasoil'],
    electricidad: ['electricidad', 'electrico', 'luz'], biomasa: ['biomasa', 'pellet', 'lena'], carbon: ['carbon'],
  },
  zonaClimatica: {},
};

/** Elige la opción que corresponde a lo dicho; null si no queda claro. */
export function elegirOpcion(campo: string, texto: string, opciones: Opcion[]): string | null {
  const n = ` ${normalizar(texto).replace(/[.,;:!¡?¿]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (campo === 'zonaClimatica') {
    const z = /\b([a-e])\s*(\d)\b/.exec(n);
    if (!z) return null;
    const v = `${z[1]!.toUpperCase()}${z[2]}`;
    return opciones.some((o) => o.valor === v) ? v : 'otra';
  }
  if (campo === 'orientacion') {
    const orden: [RegExp, string][] = [
      [/\b(noreste|nordeste|nor este)\b/, 'NE'], [/\b(noroeste|nor oeste)\b/, 'NO'], [/\b(sureste|sudeste|sur este)\b/, 'SE'],
      [/\b(suroeste|sudoeste|sur oeste)\b/, 'SO'], [/\bnorte\b/, 'N'], [/\bsur\b/, 'S'], [/\boeste\b/, 'O'], [/\beste\b/, 'E'], [/\bhorizontal\b/, 'H'],
    ];
    return orden.find(([re]) => re.test(n))?.[1] ?? null;
  }
  // Primero sinónimos (en su orden: los más concretos antes), luego etiqueta y valor
  for (const [valor, palabras] of Object.entries(SINONIMOS[campo] ?? {})) {
    if (palabras.some((p) => n.includes(` ${p} `))) {
      if (opciones.some((o) => o.valor === valor)) return valor;
    }
  }
  const coincide = opciones.filter((o) => n.includes(` ${normalizar(o.etiqueta)} `) || n.includes(` ${normalizar(o.valor).replace(/_/g, ' ')} `));
  return coincide.length === 1 ? coincide[0]!.valor : null;
}

export function siNo(texto: string): boolean | null {
  const n = normalizar(texto).replace(/[.,;:!¡?¿]/g, '').trim();
  if (/^(si|vale|correcto|claro|afirmativo|exacto)\b/.test(n)) return true;
  if (/^(no|negativo)\b/.test(n)) return false;
  return null;
}

/** Interpreta la respuesta a un dato. */
export function respuestaCampo(def: DefCampo, texto: string): { valor: Valor } | { error: string } {
  const t = texto.trim();
  if (!t) return { error: 'No te he oído.' };
  switch (def.tipo) {
    case 'numero': {
      const v = leerNumeroHablado(t) ?? (/^(ninguna|ninguno|ningun|nada)\b/.test(normalizar(t)) ? 0 : null);
      return v === null ? { error: 'No he entendido el número.' } : { valor: v };
    }
    case 'opcion': {
      const v = elegirOpcion(def.campo, t, def.opciones ?? []);
      return v === null ? { error: `No he entendido la opción. Puedes decir: ${(def.opciones ?? []).map((o) => o.etiqueta).join(', ')}.` } : { valor: v };
    }
    case 'si_no': {
      const v = siNo(t);
      return v === null ? { error: 'Di «sí» o «no».' } : { valor: v };
    }
    default: {
      // Códigos postales: solo las cifras
      if (/codigopostal/i.test(def.campo)) {
        const cp = t.replace(/\D/g, '');
        return /^\d{5}$/.test(cp) ? { valor: cp } : { error: 'Un código postal tiene cinco cifras.' };
      }
      return { valor: t.charAt(0).toUpperCase() + t.slice(1) };
    }
  }
}

/** Interpreta la descripción de un elemento (envolvente o instalación). */
export function respuestaElemento(pantalla: 'Envolvente térmica' | 'Instalaciones', texto: string): { elemento: Elemento } | { error: string } {
  const e = interpretarFrase(texto);
  if (!e || Object.keys(e.valores).length === 0) {
    return { error: pantalla === 'Instalaciones'
      ? 'No he entendido el equipo. Prueba con «caldera de gas para calefacción» o «termo eléctrico».'
      : 'No he entendido el elemento. Prueba con «fachada norte de 20 metros cuadrados» o «ventana sur».' };
  }
  return { elemento: e };
}

/** «Superficie útil (RD 390/2021): 85,5 m²» para confirmar en voz alta. */
export function decirValor(def: DefCampo, v: Valor): string {
  if (def.tipo === 'opcion') return def.opciones?.find((o) => o.valor === v)?.etiqueta ?? String(v);
  if (def.tipo === 'si_no') return v ? 'sí' : 'no';
  if (typeof v === 'number') {
    const u = def.rango?.unidad;
    const hablada: Record<string, string> = { 'm²': 'metros cuadrados', m: 'metros', kW: 'kilovatios', 'l/día': 'litros al día', '%': 'por ciento' };
    return `${formatearNumero(v)}${u ? ` ${hablada[u] ?? u}` : ''}`;
  }
  return String(v);
}
