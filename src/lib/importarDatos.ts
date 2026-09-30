// Rellenar la toma de datos a partir de un dictado, un texto libre o un
// fichero (CSV, Excel .xlsx, texto o JSON de la propia app).
//
// Todo se lee en el navegador y el resultado es solo una PROPUESTA: el técnico
// la revisa, marca lo que quiere añadir y después los datos pasan por las
// mismas comprobaciones que si los hubiera tecleado. Nada se añade solo y
// nada se «corrige»: lo que no se entiende se deja fuera y se dice.

import { unzipSync, strFromU8 } from 'fflate';
import {
  CAMPOS_GENERALES, type DefCampo, type Fila, SECCIONES, type SeccionLista, type TomaDatos, type Valor,
  normalizarTomaDatos,
} from './tomaDatos';
import { formatearNumero, leerNumero } from './validaciones';

export type Destino = 'generales' | SeccionLista;

export interface Elemento {
  destino: Destino;
  valores: Record<string, Valor>;
  /** De dónde sale: la frase dictada o «fila 3» del fichero. */
  origen: string;
  /** Lo que se ha dejado fuera o se ha calculado, para que el técnico lo revise. */
  notas: string[];
}

export interface Propuesta {
  elementos: Elemento[];
  /** Frases o filas en las que no se ha reconocido nada. */
  sinEntender: string[];
}

export const TITULO_DESTINO: Record<Destino, string> = {
  generales: 'Datos generales',
  cerramientos: 'Cerramiento opaco',
  huecos: 'Hueco',
  puentesTermicos: 'Puente térmico',
  instalaciones: 'Instalación',
  renovables: 'Energía renovable',
  iluminacion: 'Iluminación',
};

export function camposDe(destino: Destino): DefCampo[] {
  return destino === 'generales' ? CAMPOS_GENERALES : SECCIONES.find((s) => s.clave === destino)!.campos;
}

/** Minúsculas y sin tildes, solo para comparar. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ───────────────────────────────── Números ────────────────────────────────

/**
 * Lee un número escrito a la española. «1.200» (punto seguido de tres
 * cifras) es un millar, como en castellano; como puede ser un despiste,
 * quien llama recibe una nota para que lo revise.
 */
export function leerNumeroEs(texto: string): { valor: number | null; nota?: string } {
  const t = texto.trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    const valor = Number(t.replace(/\./g, '').replace(',', '.'));
    return { valor, nota: `«${t}» se ha leído como ${formatearNumero(valor)} (el punto se ha tomado como separador de millares).` };
  }
  const n = leerNumero(t);
  return { valor: n === null || Number.isNaN(n) ? null : n };
}

const NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`;

const PALABRAS_NUMERO: Record<string, string> = {
  un: '1', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8',
  nueve: '9', diez: '10', once: '11', doce: '12',
};

/** Deja el texto dictado en una forma fácil de leer: «0 coma 45» → «0,45», «metros cuadrados» → «m2»… */
function prepararDictado(n: string): string {
  return n
    .replace(/(\d)\s+coma\s+(\d)/g, '$1,$2')
    .replace(/(\d)\s+punto\s+(\d)/g, '$1.$2')
    .replace(/m²/g, 'm2')
    .replace(/\bmetros? cuadrados?\b/g, 'm2')
    .replace(/\bm 2\b/g, 'm2')
    .replace(/\bpor ?ciento\b/g, '%')
    .replace(/\bkilovatios? pico\b|\bkw pico\b/g, 'kwp')
    .replace(/\bkilovatios?[ -]hora\b|\bkw ?h\b/g, 'kwh')
    .replace(/\bkilovatios?\b/g, 'kw')
    .replace(/\bvatios?\b/g, 'w')
    .replace(/\bmetros? lineales?\b|\bmetros?\b/g, 'm')
    .replace(/\blitros?\b/g, 'l')
    .replace(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(ventanas?|puertas?|huecos?|balconeras?|ventanales?|lucernarios?|claraboyas?|plantas?)\b/g,
      (_m, p: string, s: string) => `${PALABRAS_NUMERO[p]} ${s}`);
}

// ─────────────────────────────── Texto libre ──────────────────────────────

type Regla = [RegExp, string];

/** Palabras que indican a qué parte de la toma de datos se refiere una frase. */
const PALABRAS_DESTINO: [Destino, RegExp][] = [
  ['generales', /\bzona climatica\b|\bsuperficie (util|habitable)\b|\baltura (libre|de planta)\b|\bnumero de plantas\b|\b\d+ plantas\b|\bplantas habitables\b|\bmasa de (las )?particiones\b|\bparticiones interiores\b|\bventilacion\b|\brenovaciones\b|\bdemanda (diaria )?(de )?acs\b|\bnormativa\b|\bcte (de )?20(06|13|19)\b|\b(nbe[- ]?)?ct[- ]?79\b/],
  ['puentesTermicos', /\bpuentes? termicos?\b|\bpilar(es)?\b|\bfrentes? de forjado\b|\bcontorno de hueco\b|\bcajas? de persiana\b|\bencuentro\b/],
  ['huecos', /\bventan(a|as|al|ales)\b|\bpuertas?\b|\bhuecos?\b|\bbalconeras?\b|\blucernarios?\b|\bclaraboyas?\b/],
  ['renovables', /\bplacas solares\b|\bpaneles solares\b|\bfotovoltaic[ao]s?\b|\bsolar termica\b|\bcaptadores\b|\bgeotermi[ac]\b|\bminieolica\b|\baerogenerador\b|\bautoconsumo\b/],
  ['instalaciones', /\bcalderas?\b|\bbombas? de calor\b|\baerotermia\b|\btermos?\b|\bcalentador\b|\baire acondicionado\b|\bsplits?\b|\bradiadores electricos\b|\bacumuladores\b|\bsuelo radiante\b|\bcalefaccion\b|\bagua caliente\b|\bacs\b|\bred de calor\b/],
  ['iluminacion', /\biluminacion\b|\blamparas\b|\bluminarias\b|\bfluorescentes\b/],
  ['cerramientos', /\bfachadas?\b|\bmuros?\b|\bpared(es)? exterior(es)?\b|\bcubiertas?\b|\btejados?\b|\bazoteas?\b|\bsuelos?\b|\bsoleras?\b|\bforjados?\b|\bmedianer[ia]a?s?\b|\bparticion(es)?\b/],
];

function detectarDestino(n: string): { destino: Destino; palabra: string } | null {
  let mejor: { destino: Destino; palabra: string; pos: number } | null = null;
  for (const [destino, re] of PALABRAS_DESTINO) {
    const m = re.exec(n);
    if (!m) continue;
    if (!mejor || m.index < mejor.pos || (m.index === mejor.pos && m[0].length > mejor.palabra.length)) {
      mejor = { destino, palabra: m[0], pos: m.index };
    }
  }
  return mejor && { destino: mejor.destino, palabra: mejor.palabra };
}

const ORIENTACION: Regla[] = [
  [/\b(noreste|nordeste|nor este)\b/, 'NE'],
  [/\b(noroeste|nor oeste)\b/, 'NO'],
  [/\b(sureste|sudeste|sur este)\b/, 'SE'],
  [/\b(suroeste|sudoeste|sur oeste)\b/, 'SO'],
  [/\bnorte\b/, 'N'],
  [/\bsur\b/, 'S'],
  [/\boeste\b/, 'O'],
  // «este» también es un demostrativo («este muro»): solo cuenta detrás de una palabra de orientación.
  [/\b(orientacion|orientad[oa]|al|a|hacia|fachada|cara|muro|ventana|hueco|puerta)\s+este\b/, 'E'],
  [/\bhorizontal\b/, 'H'],
];

const NOMBRE_ORIENTACION: Record<string, string> = {
  N: 'norte', NE: 'noreste', E: 'este', SE: 'sureste', S: 'sur', SO: 'suroeste', O: 'oeste', NO: 'noroeste', H: 'horizontal',
};

function primeraRegla(n: string, reglas: Regla[]): string | undefined {
  return reglas.find(([re]) => re.test(n))?.[1];
}

/** Busca un número detrás de alguna de las palabras dadas («u de 0,45», «potencia: 24»…). */
function numeroTras(n: string, palabras: string, notas: string[], sufijo = ''): number | undefined {
  const m = new RegExp(String.raw`\b(?:${palabras})\s*(?:de|del|es|=|:|igual a)?\s*${NUM}\s*${sufijo}`).exec(n);
  return m ? numero(m[1]!, notas) : undefined;
}

/** Busca un número seguido de una unidad («24 kw», «1,2 m2»…). */
function numeroCon(n: string, unidad: string, notas: string[]): number | undefined {
  const m = new RegExp(String.raw`${NUM}\s*(?:${unidad})(?![\w²])`).exec(n);
  return m ? numero(m[1]!, notas) : undefined;
}

function numero(t: string, notas: string[]): number | undefined {
  const { valor, nota } = leerNumeroEs(t);
  if (nota) notas.push(nota);
  return valor ?? undefined;
}

const redondear = (x: number) => Math.round(x * 1000) / 1000;

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function superficie(n: string, notas: string[], conPalabra = false): number | undefined {
  const dim = new RegExp(String.raw`${NUM}\s*(?:m\s*)?(?:x|por)\s*${NUM}`).exec(n);
  if (dim && !conPalabra) {
    const a = numero(dim[1]!, notas), b = numero(dim[2]!, notas);
    if (a !== undefined && b !== undefined) {
      const s = redondear(a * b);
      notas.push(`Superficie calculada: ${formatearNumero(a)} × ${formatearNumero(b)} = ${formatearNumero(s)} m².`);
      return s;
    }
  }
  return numeroTras(n, 'superficie|area', notas) ?? (conPalabra ? undefined : numeroCon(n, 'm2', notas));
}

function interpretarCerramiento(n: string, palabra: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  v.tipo = primeraRegla(palabra, [
    [/fachada|muro|pared/, 'fachada'], [/cubierta|tejado|azotea/, 'cubierta'], [/suelo|solera|forjado/, 'suelo'],
    [/medianer/, 'medianeria'], [/particion/, 'particion_nh'],
  ]) ?? null;
  if (v.tipo === 'fachada' && /\b(no habitable|garaje|trastero|caja de escalera|local)\b/.test(n)) v.tipo = 'particion_nh';
  const orientacion = primeraRegla(n, ORIENTACION);
  if (orientacion) v.orientacion = orientacion;
  v.nombre = capitalizar(palabra) + (orientacion ? ` ${NOMBRE_ORIENTACION[orientacion]}` : '');
  const s = superficie(n, notas);
  if (s !== undefined) v.superficie = s;
  const u = numeroTras(n, 'u|transmitancia', notas);
  if (u !== undefined) v.u = u;
  const origen = primeraRegla(n, [[/por defecto/, 'defecto'], [/estimad/, 'estimado'], [/conocid|ensayad|justificad/, 'conocido']]);
  if (origen) v.origenU = origen;
  return v;
}

function interpretarHueco(n: string, palabra: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  const orientacion = primeraRegla(n, ORIENTACION);
  if (orientacion) v.orientacion = orientacion;
  const base = palabra.replace(/ales$/, 'al').replace(/([aeo])s$/, '$1');
  v.nombre = capitalizar(base) + (orientacion ? ` ${NOMBRE_ORIENTACION[orientacion]}` : '');
  const en = /\ben (?:la |el )?(fachada|muro|cubierta|tejado)(?: (norte|sur|este|oeste|noreste|noroeste|sureste|suroeste))?\b/.exec(n);
  if (en) v.cerramiento = capitalizar(en[1]!) + (en[2] ? ` ${en[2]}` : '');
  const cantidad = /\b(\d+)\s*(?:ventan|puert|huec|balconer|lucernari|claraboy|iguales)/.exec(n);
  if (cantidad) v.cantidad = Number(cantidad[1]);
  const s = superficie(n.replace(/\b(\d+)\s*(ventan\w*|puert\w*|huec\w*|balconer\w*|lucernari\w*|claraboy\w*)/, '$2'), notas);
  if (s !== undefined) v.superficie = s;

  const vidrio = primeraRegla(n, [
    [/bajo emisiv|baja emisiv/, 'doble_be'], [/triple/, 'triple'], [/doble|climalit|camara/, 'doble'], [/(vidrio|cristal) simple|monolitico/, 'simple'],
  ]);
  if (vidrio) v.tipoVidrio = vidrio;
  const marco = primeraRegla(n, [
    [/aluminio (con )?(rotura|rpt)|con rotura de puente/, 'aluminio_rpt'], [/aluminio/, 'aluminio'], [/pvc/, 'pvc'],
    [/madera/, 'madera'], [/metalic|hierro|acero/, 'metalico'],
  ]);
  if (marco) v.tipoMarco = marco;

  const reVidrio = new RegExp(String.raw`\b(?:u|transmitancia)\s*(?:de|del)?\s*(?:vidrio|cristal)\s*(?:de|es|=|:)?\s*${NUM}`);
  const reMarco = new RegExp(String.raw`\b(?:u|transmitancia)\s*(?:de|del)?\s*marco\s*(?:de|es|=|:)?\s*${NUM}`);
  const mv = reVidrio.exec(n), mm = reMarco.exec(n);
  if (mv) v.uVidrio = numero(mv[1]!, notas) ?? null;
  if (mm) v.uMarco = numero(mm[1]!, notas) ?? null;
  const resto = n.replace(reVidrio, '').replace(reMarco, '');
  if (new RegExp(String.raw`\b(?:u|transmitancia)\s*(?:de|es|=|:)?\s*${NUM}`).test(resto)) {
    notas.push('Hay una U sin decir si es del vidrio o del marco: no se ha usado. Di «U del vidrio …» o «U del marco …».');
  }
  const pm = new RegExp(String.raw`(?:marco\s*(?:de|del|es|=|:)?\s*${NUM}\s*%|${NUM}\s*%\s*(?:de\s*)?marco)`).exec(n);
  if (pm) v.porcentajeMarco = numero(pm[1] ?? pm[2]!, notas) ?? null;
  const g = numeroTras(n, 'factor solar|g', notas);
  if (g !== undefined) v.factorSolar = g;
  const perm = numeroTras(n, 'permeabilidad', notas);
  if (perm !== undefined) v.permeabilidad = perm;
  const prot = primeraRegla(n, [
    [/persiana|contraventana/, 'persiana'], [/toldo/, 'toldo'], [/voladizo|retranqueo/, 'voladizo'], [/lamas/, 'lamas'],
    [/sin proteccion/, 'ninguna'],
  ]);
  if (prot) v.proteccionSolar = prot;
  return v;
}

function interpretarPuente(n: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  const tipo = primeraRegla(n, [
    [/pilar/, 'pilar'], [/frentes? de forjado/, 'frente_forjado'], [/contorno de hueco/, 'contorno_hueco'],
    [/caja de persiana/, 'caja_persiana'], [/encuentro.*cubierta/, 'encuentro_cubierta'], [/encuentro.*(suelo|solera)/, 'encuentro_suelo'],
    [/esquina/, 'esquina'],
  ]);
  if (tipo) v.tipo = tipo;
  const l = numeroTras(n, 'longitud|mide|miden', notas, '(?:m|ml)?') ?? numeroCon(n, 'm|ml', notas);
  if (l !== undefined) v.longitud = l;
  const psi = numeroTras(n, 'psi|ψ', notas);
  if (psi !== undefined) v.psi = psi;
  return v;
}

function interpretarInstalacion(n: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  const cal = /\bcalefaccion|radiador|suelo radiante|calefactor/.test(n);
  const acs = /\bacs\b|agua caliente|\btermo\b|calentador/.test(n);
  const ref = /refrigeracion|\bfrio\b|aire acondicionado|\bsplit/.test(n);
  const servicio = cal && ref && acs ? 'mixto_3' : cal && acs ? 'calefaccion_acs' : cal && ref ? 'calefaccion_refrigeracion'
    : cal ? 'calefaccion' : acs ? 'acs' : ref ? 'refrigeracion' : undefined;
  if (servicio) v.servicio = servicio;
  const generador = primeraRegla(n, [
    [/caldera.*condensacion|condensacion/, 'caldera_condensacion'], [/caldera.*baja temperatura/, 'caldera_baja_temp'],
    [/caldera.*(biomasa|pellet|lena)/, 'caldera_biomasa'], [/caldera/, 'caldera_estandar'],
    [/bomba de calor|aerotermia/, 'bomba_calor'], [/split|aire acondicionado|autonomo/, 'equipo_split'],
    [/efecto joule|termo electrico|radiadores electricos|acumuladores|calefactor electrico|emisores termicos/, 'efecto_joule'],
    [/red de (calor|frio)|district/, 'red_distrito'],
  ]);
  if (generador) v.generador = generador;
  const combustible = primeraRegla(n, [
    [/gas natural/, 'gas_natural'], [/propano|butano|glp/, 'glp'], [/gasoleo|gasoil|gas oil/, 'gasoleo'],
    [/electric/, 'electricidad'], [/biomasa|pellet|lena|astilla|hueso de aceituna/, 'biomasa'], [/carbon/, 'carbon'],
  ]);
  if (combustible) v.combustible = combustible;
  if (/\b(centralizad[oa]|comunitari[oa]|colectiv[oa])\b/.test(n)) v.centralizada = true;
  else if (/\bindividual\b/.test(n)) v.centralizada = false;
  const p = numeroCon(n, 'kw', notas);
  if (p !== undefined) v.potencia = p;
  const cop = numeroTras(n, 's?cop', notas);
  const eer = numeroTras(n, 's?eer', notas);
  const rend = new RegExp(String.raw`(?:rendimiento|eficiencia)\s*(?:estacional)?\s*(?:de|del|es|=|:)?\s*${NUM}|${NUM}\s*%\s*de\s*rendimiento`).exec(n);
  if (cop !== undefined) { v.unidadRendimiento = 'cop'; v.rendimiento = cop; }
  else if (eer !== undefined) { v.unidadRendimiento = 'eer'; v.rendimiento = eer; }
  else if (rend) { v.unidadRendimiento = 'porcentaje'; v.rendimiento = numero(rend[1] ?? rend[2]!, notas) ?? null; }
  const anio = /\b(?:ano|instalad[oa] en|de|del|en)\s*(?:de\s*)?((?:19|20)\d{2})\b/.exec(n);
  if (anio) v.anioInstalacion = Number(anio[1]);
  const cob = new RegExp(String.raw`(?:cubre|cobertura|da servicio a)\s*(?:el|al|de|del|un)?\s*${NUM}\s*%|${NUM}\s*%\s*de\s*(?:la\s*)?(?:cobertura|superficie|demanda)`).exec(n);
  if (cob) v.cobertura = numero(cob[1] ?? cob[2]!, notas) ?? null;
  const acu = numeroTras(n, 'acumulacion|deposito|acumulador', notas, 'l?') ?? numeroCon(n, 'l', notas);
  if (acu !== undefined) v.acumulacion = acu;
  return v;
}

function interpretarRenovable(n: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  const tipo = primeraRegla(n, [
    [/solar termica|captadores|paneles termicos/, 'solar_termica'], [/fotovoltaic|placas solares|paneles solares|autoconsumo/, 'fotovoltaica'],
    [/geotermi/, 'geotermia'], [/minieolica|aerogenerador/, 'minieolica'], [/biomasa/, 'biomasa'],
  ]);
  if (tipo) v.tipo = tipo;
  if (tipo === 'solar_termica') {
    const s = numeroTras(n, 'superficie', notas) ?? numeroCon(n, 'm2', notas);
    if (s !== undefined) v.superficieCaptadores = s;
    const c = numeroCon(n, '%', notas);
    if (c !== undefined) v.coberturaAcs = c;
  }
  if (tipo === 'fotovoltaica') {
    const p = numeroCon(n, 'kwp', notas);
    const pkw = p === undefined ? numeroCon(n, 'kw', notas) : undefined;
    if (p !== undefined) v.potenciaPico = p;
    else if (pkw !== undefined) { v.potenciaPico = pkw; notas.push('Se ha tomado la potencia en kW como potencia pico (kWp).'); }
  }
  const prod = numeroCon(n, 'kwh', notas);
  if (prod !== undefined) v.produccionAnual = prod;
  return v;
}

function interpretarIluminacion(n: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  const s = numeroTras(n, 'superficie', notas) ?? numeroCon(n, 'm2', notas);
  if (s !== undefined) v.superficie = s;
  const p = numeroCon(n, 'w', notas);
  if (p !== undefined) v.potencia = p;
  const lux = numeroCon(n, 'lux|lx', notas);
  if (lux !== undefined) v.iluminancia = lux;
  const lampara = primeraRegla(n, [
    [/\bled\b/, 'led'], [/fluorescent/, 'fluorescente'], [/halogen/, 'halogena'], [/incandescen/, 'incandescente'],
    [/descarga|halogenuro|sodio|vapor/, 'descarga'],
  ]);
  if (lampara) v.tipoLampara = lampara;
  return v;
}

function interpretarGenerales(n: string, notas: string[]): Record<string, Valor> {
  const v: Record<string, Valor> = {};
  const zona = /\bzona(?: climatica)?\s*(?:es|:)?\s*(alfa\s?[1-4]|[a-e]\s?[1-4])\b/.exec(n);
  if (zona) {
    const z = zona[1]!.replace(/\s/g, '').toUpperCase();
    if (CAMPOS_GENERALES[0]!.opciones!.some((o) => o.valor === z)) v.zonaClimatica = z;
    else { v.zonaClimatica = 'otra'; notas.push(`Zona climática «${z}»: no está en la lista, se ha marcado «Otra».`); }
  }
  const normativa = primeraRegla(n, [
    [/anterior (a )?(la )?(nbe[- ]?)?ct[- ]?79|anterior a 1979|antes de (la )?(ct|1979)/, 'anterior_ct79'],
    [/\bcte (de )?2006\b/, 'cte2006'], [/\bcte (de )?2013\b/, 'cte2013'], [/\bcte (de )?2019\b/, 'cte2019'],
    [/\b(nbe[- ]?)?ct[- ]?79\b/, 'ct79'],
  ]);
  if (normativa) v.normativa = normativa;
  const sup = numeroTras(n, 'superficie(?: util)?(?: habitable)?', notas);
  if (sup !== undefined) v.superficieUtil = sup;
  const alt = numeroTras(n, 'altura(?: libre)?(?: de planta)?', notas);
  if (alt !== undefined) v.alturaLibre = alt;
  const pl = /\b(\d+)\s*plantas?\b/.exec(n) ?? /\bplantas(?: habitables)?\s*(?:es|=|:)?\s*(\d+)\b/.exec(n);
  if (pl) v.numeroPlantas = Number(pl[1]);
  const masa = /\b(?:masa|particiones)\b.*?\b(ligera|media|pesada)\b/.exec(n);
  if (masa) v.masaParticiones = masa[1]!;
  const vent = new RegExp(String.raw`\b(?:ventilacion|renovaciones)\b[^\d]{0,30}${NUM}`).exec(n);
  if (vent) v.ventilacion = numero(vent[1]!, notas) ?? null;
  const acs = numeroTras(n, 'demanda (?:diaria )?(?:de )?acs', notas);
  if (acs !== undefined) v.demandaAcs = acs;
  return v;
}

/** Parte un dictado o texto en frases: una por línea, por «;», por punto y seguido o por la palabra «siguiente». */
export function partirFrases(texto: string): string[] {
  return texto
    .split(/\r?\n|;|\.\s+|\.$|\bsiguiente\b|\bpunto y (?:aparte|seguido)\b/i)
    .map((s) => s.replace(/^[\s,.:-]+|[\s,.:-]+$/g, ''))
    .filter(Boolean);
}

export function interpretarFrase(frase: string): Elemento | null {
  const n = prepararDictado(normalizar(frase));
  const det = detectarDestino(n);
  if (!det) return null;
  const notas: string[] = [];
  const valores =
    det.destino === 'generales' ? interpretarGenerales(n, notas)
    : det.destino === 'cerramientos' ? interpretarCerramiento(n, det.palabra, notas)
    : det.destino === 'huecos' ? interpretarHueco(n, det.palabra, notas)
    : det.destino === 'puentesTermicos' ? interpretarPuente(n, notas)
    : det.destino === 'instalaciones' ? interpretarInstalacion(n, notas)
    : det.destino === 'renovables' ? interpretarRenovable(n, notas)
    : interpretarIluminacion(n, notas);
  return { destino: det.destino, valores: limpiarValores(det.destino, valores, notas), origen: frase, notas };
}

export function interpretarTexto(texto: string): Propuesta {
  const elementos: Elemento[] = [];
  const sinEntender: string[] = [];
  for (const frase of partirFrases(texto)) {
    const e = interpretarFrase(frase);
    if (e && Object.keys(e.valores).length > 0) elementos.push(e);
    else sinEntender.push(frase);
  }
  return { elementos, sinEntender };
}

// ─────────────────────────── Comprobación de tipos ────────────────────────

/** Deja solo campos que existen en esa parte del formulario y con el tipo correcto. */
export function limpiarValores(destino: Destino, valores: Record<string, Valor>, notas: string[]): Record<string, Valor> {
  const defs = camposDe(destino);
  const limpio: Record<string, Valor> = {};
  for (const [campo, valor] of Object.entries(valores)) {
    if (valor === null || valor === undefined || valor === '') continue;
    const def = defs.find((d) => d.campo === campo);
    if (!def) { notas.push(`«${campo}» no es un dato de ${TITULO_DESTINO[destino].toLowerCase()}: no se ha usado.`); continue; }
    switch (def.tipo) {
      case 'numero':
        if (typeof valor === 'number' && Number.isFinite(valor)) limpio[campo] = valor;
        else notas.push(`${def.etiqueta}: «${String(valor)}» no es un número.`);
        break;
      case 'opcion':
        if (typeof valor === 'string' && def.opciones?.some((o) => o.valor === valor)) limpio[campo] = valor;
        else notas.push(`${def.etiqueta}: «${String(valor)}» no es una de las opciones.`);
        break;
      case 'si_no':
        if (typeof valor === 'boolean') limpio[campo] = valor;
        else notas.push(`${def.etiqueta}: «${String(valor)}» no es sí o no.`);
        break;
      default:
        limpio[campo] = String(valor);
    }
  }
  return limpio;
}

// ──────────────────────────── Ficheros (tablas) ───────────────────────────

/** Lee un CSV (separado por «;», «,» o tabulador; con comillas). */
export function leerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (c: string) => primera.split(c).length - 1;
  const sep = [';', '\t', ','].reduce((a, b) => (cuenta(b) > cuenta(a) ? b : a));
  const filas: string[][] = [];
  let fila: string[] = [], celda = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"' && celda === '') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

const decodificarXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const textosDe = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodificarXml(m[1]!)).join('');

/** Lee la primera hoja de un Excel (.xlsx). Los números se devuelven con coma decimal. */
export function leerXlsx(bytes: Uint8Array): string[][] {
  let ficheros: Record<string, Uint8Array>;
  try {
    ficheros = unzipSync(bytes, { filter: (f) => f.name === 'xl/sharedStrings.xml' || f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name.startsWith('xl/worksheets/sheet') });
  } catch {
    throw new Error('No se ha podido abrir el Excel. Guárdalo como .xlsx (o como CSV) y vuelve a intentarlo.');
  }
  const compartidos = ficheros['xl/sharedStrings.xml']
    ? [...strFromU8(ficheros['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textosDe(m[1]!))
    : [];
  // Primera hoja según el libro; si algo falla, sheet1.
  let ruta = 'xl/worksheets/sheet1.xml';
  const libro = ficheros['xl/workbook.xml'] && strFromU8(ficheros['xl/workbook.xml']);
  const rels = ficheros['xl/_rels/workbook.xml.rels'] && strFromU8(ficheros['xl/_rels/workbook.xml.rels']);
  const rid = libro && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro)?.[1];
  const destino = rid && rels && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  if (destino) ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
  const hoja = ficheros[ruta] ?? ficheros['xl/worksheets/sheet1.xml'];
  if (!hoja) throw new Error('El Excel no tiene ninguna hoja con datos.');

  const filas: string[][] = [];
  for (const mf of strFromU8(hoja).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila: string[] = [];
    for (const mc of mf[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = mc[1]!, cuerpo = mc[2] ?? '';
      const col = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const idx = col ? [...col].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : fila.length;
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      let valor = '';
      if (tipo === 's') valor = compartidos[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textosDe(cuerpo);
      else if (tipo === 'b') valor = v === '1' ? 'sí' : 'no';
      else if (tipo === 'str' || tipo === 'e') valor = v ? decodificarXml(v) : '';
      else if (v !== undefined) valor = String(Number(v)).replace('.', ',');
      while (fila.length < idx) fila.push('');
      fila[idx] = valor;
    }
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

const NOMBRES_DESTINO: [RegExp, Destino][] = [
  [/^(datos )?generales?$/, 'generales'],
  [/^cerramientos?( opacos?)?$|^envolvente$/, 'cerramientos'],
  [/^huecos?$|^ventanas?$/, 'huecos'],
  [/^puentes? termicos?$/, 'puentesTermicos'],
  [/^instalacion(es)?$/, 'instalaciones'],
  [/^renovables?$|^energias? renovables?$/, 'renovables'],
  [/^iluminacion$/, 'iluminacion'],
];

const quitarUnidad = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '');

/** Nombre de columna → campo. Admite la etiqueta del formulario (con o sin unidad) o el nombre interno. */
export function mapaColumnas(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const d of [...CAMPOS_GENERALES, ...SECCIONES.flatMap((s) => s.campos)]) {
    mapa.set(normalizar(d.etiqueta), d.campo);
    mapa.set(normalizar(quitarUnidad(d.etiqueta)), d.campo);
    mapa.set(normalizar(d.campo), d.campo);
  }
  return mapa;
}

function valorDeCelda(def: DefCampo, celda: string, notas: string[]): Valor | undefined {
  const t = celda.trim();
  if (!t) return undefined;
  switch (def.tipo) {
    case 'numero': {
      const { valor, nota } = leerNumeroEs(t.replace(/\s*%$/, ''));
      if (nota) notas.push(`${def.etiqueta}: ${nota}`);
      if (valor === null) { notas.push(`${def.etiqueta}: «${t}» no es un número.`); return undefined; }
      return valor;
    }
    case 'opcion': {
      const n = normalizar(t);
      const o = def.opciones?.find((x) => normalizar(x.valor) === n || normalizar(x.etiqueta) === n);
      if (!o) { notas.push(`${def.etiqueta}: «${t}» no es una de las opciones (${def.opciones?.map((x) => x.etiqueta).join(', ')}).`); return undefined; }
      return o.valor;
    }
    case 'si_no': {
      const n = normalizar(t);
      if (/^(si|s|x|true|verdadero|1)$/.test(n)) return true;
      if (/^(no|n|false|falso|0)$/.test(n)) return false;
      notas.push(`${def.etiqueta}: «${t}» no es sí o no.`);
      return undefined;
    }
    default:
      return t;
  }
}

/**
 * Interpreta una tabla (CSV o Excel). La primera fila son los títulos. Una
 * columna «Sección» dice a qué parte va cada fila; el resto de columnas son
 * los datos (con el nombre que tienen en el formulario). Si no hay columna
 * «Sección», cada celda se lee como texto libre.
 */
export function interpretarTabla(filas: string[][]): Propuesta {
  const elementos: Elemento[] = [];
  const sinEntender: string[] = [];
  const [cabecera, ...cuerpo] = filas;
  if (!cabecera) return { elementos, sinEntender };
  const titulos = cabecera.map((c) => normalizar(quitarUnidad(c)));
  const colSeccion = titulos.findIndex((t) => t === 'seccion' || t === 'parte' || t === 'elemento');
  if (colSeccion < 0) {
    return interpretarTexto(filas.map((f) => f.filter((c) => c.trim()).join(' ')).join('\n'));
  }
  const mapa = mapaColumnas();
  const campos = titulos.map((t) => mapa.get(t));
  const ignoradas = cabecera.filter((c, i) => i !== colSeccion && c.trim() && !campos[i] && !/^(texto|descripcion|dictado)$/.test(titulos[i]!));
  if (ignoradas.length) sinEntender.push(`Columnas que no corresponden a ningún dato: ${ignoradas.join(', ')}.`);
  const colTexto = titulos.findIndex((t) => /^(texto|descripcion|dictado)$/.test(t));

  cuerpo.forEach((fila, i) => {
    const origen = `Fila ${i + 2}`;
    const nombre = normalizar(fila[colSeccion] ?? '');
    const destino = NOMBRES_DESTINO.find(([re]) => re.test(nombre))?.[1];
    if (!destino) {
      if (colTexto >= 0 && fila[colTexto]?.trim()) {
        const e = interpretarFrase(fila[colTexto]!);
        if (e && Object.keys(e.valores).length) { elementos.push({ ...e, origen: `${origen}: ${e.origen}` }); return; }
      }
      if (fila.some((c) => c.trim())) sinEntender.push(`${origen}: sección «${fila[colSeccion] ?? ''}» desconocida.`);
      return;
    }
    const defs = camposDe(destino);
    const notas: string[] = [];
    const valores: Record<string, Valor> = {};
    fila.forEach((celda, j) => {
      const campo = campos[j];
      if (j === colSeccion || !campo || !celda.trim()) return;
      const def = defs.find((d) => d.campo === campo);
      if (!def) { notas.push(`«${cabecera[j]}» no se usa en ${TITULO_DESTINO[destino].toLowerCase()}: no se ha usado.`); return; }
      const v = valorDeCelda(def, celda, notas);
      if (v !== undefined) valores[campo] = v;
    });
    if (colTexto >= 0 && fila[colTexto]?.trim()) {
      const e = interpretarFrase(fila[colTexto]!);
      if (e?.destino === destino) {
        for (const [k, v] of Object.entries(e.valores)) if (!(k in valores)) valores[k] = v;
        notas.push(...e.notas);
      }
    }
    if (Object.keys(valores).length) elementos.push({ destino, valores, origen, notas });
    else sinEntender.push(`${origen}: sin datos.`);
  });
  return { elementos, sinEntender };
}

/** JSON con la estructura de la toma de datos (por ejemplo, de la copia de seguridad de la app). */
export function interpretarJson(texto: string): Propuesta {
  let bruto: unknown;
  try { bruto = JSON.parse(texto); } catch { throw new Error('El fichero JSON no es válido.'); }
  if (Array.isArray(bruto) && bruto.length === 1) bruto = bruto[0];
  if (bruto && typeof bruto === 'object' && 'datos' in bruto) bruto = (bruto as { datos: unknown }).datos;
  const d = normalizarTomaDatos(bruto);
  const elementos: Elemento[] = [];
  const sinEntender: string[] = [];
  if (Object.keys(d.generales).length) {
    const notas: string[] = [];
    elementos.push({ destino: 'generales', valores: limpiarValores('generales', d.generales, notas), origen: 'Datos generales del fichero', notas });
  }
  for (const s of SECCIONES) {
    d[s.clave].forEach((f, i) => {
      const { id: _id, ...resto } = f;
      const notas: string[] = [];
      const valores = limpiarValores(s.clave, resto, notas);
      if (Object.keys(valores).length) elementos.push({ destino: s.clave, valores, origen: `${s.titulo_fila(f, i)} (fichero)`, notas });
    });
  }
  if (d.observaciones) sinEntender.push('Las observaciones generales del fichero no se importan: cópialas a mano si las necesitas.');
  if (!elementos.length) throw new Error('El JSON no tiene datos de una toma de datos.');
  return { elementos, sinEntender };
}

/** Elige el lector según la extensión del fichero. */
export async function interpretarFichero(f: File): Promise<Propuesta> {
  const nombre = f.name.toLowerCase();
  if (nombre.endsWith('.xlsx')) return interpretarTabla(leerXlsx(new Uint8Array(await f.arrayBuffer())));
  if (nombre.endsWith('.xls')) throw new Error('Los Excel antiguos (.xls) no se pueden leer: guárdalo como .xlsx o como CSV.');
  const texto = await f.text();
  if (nombre.endsWith('.json')) return interpretarJson(texto);
  if (nombre.endsWith('.csv') || nombre.endsWith('.tsv')) return interpretarTabla(leerCsv(texto));
  return interpretarTexto(texto);
}

// ────────────────────────────── Plantilla CSV ─────────────────────────────

/** Plantilla para Excel: una fila por elemento, con ejemplos. Separador «;» y coma decimal. */
export function plantillaCsv(): string {
  const columnas: DefCampo[] = [];
  for (const d of [...CAMPOS_GENERALES, ...SECCIONES.flatMap((s) => s.campos)]) {
    if (!columnas.some((c) => c.campo === d.campo)) columnas.push(d);
  }
  const ejemplos: [string, Record<string, string>][] = [
    ['Generales', { zonaClimatica: 'D1', normativa: 'NBE-CT-79', superficieUtil: '85,5', alturaLibre: '2,5', numeroPlantas: '1', masaParticiones: 'Media', ventilacion: '0,63', demandaAcs: '112' }],
    ['Cerramiento', { nombre: 'Fachada norte', tipo: 'Muro de fachada', orientacion: 'Norte', superficie: '24,3', u: '1,35', origenU: 'Estimado' }],
    ['Hueco', { nombre: 'Ventana salón', cerramiento: 'Fachada norte', orientacion: 'Norte', cantidad: '2', superficie: '1,8', tipoVidrio: 'Doble', tipoMarco: 'Aluminio con RPT', porcentajeMarco: '25', proteccionSolar: 'Persiana / contraventana' }],
    ['Puente térmico', { tipo: 'Frente de forjado', longitud: '12' }],
    ['Instalación', { servicio: 'Calefacción + ACS', generador: 'Caldera de condensación', combustible: 'Gas natural', centralizada: 'no', potencia: '24', unidadRendimiento: 'Rendimiento (%)', rendimiento: '98', anioInstalacion: '2018', cobertura: '100' }],
  ];
  const celda = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cab = ['Sección', ...columnas.map((c) => c.etiqueta)];
  const filas = ejemplos.map(([sec, v]) => [sec, ...columnas.map((c) => v[c.campo] ?? '')]);
  return '﻿' + [cab, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}

// ─────────────────────────────── Aplicación ───────────────────────────────

/**
 * Añade los elementos a la toma de datos: los datos generales sustituyen a
 * los que hubiera en esos mismos campos; el resto se añade como filas nuevas.
 */
export function aplicarPropuesta(datos: TomaDatos, elementos: Elemento[], nuevoId: () => string): TomaDatos {
  const r: TomaDatos = { ...datos, generales: { ...datos.generales } };
  for (const e of elementos) {
    if (e.destino === 'generales') Object.assign(r.generales, e.valores);
    else r[e.destino] = [...r[e.destino], { ...e.valores, id: nuevoId() } as Fila];
  }
  return r;
}

/** «Transmitancia U: 0,45 W/m²K», «Tipo: Muro de fachada»… */
export function describirValor(destino: Destino, campo: string, valor: Valor): string {
  const def = camposDe(destino).find((d) => d.campo === campo);
  if (!def) return `${campo}: ${String(valor)}`;
  let t: string;
  if (def.tipo === 'opcion') t = def.opciones?.find((o) => o.valor === valor)?.etiqueta ?? String(valor);
  else if (def.tipo === 'si_no') t = valor ? 'sí' : 'no';
  else if (typeof valor === 'number') t = `${formatearNumero(valor)}${def.rango?.unidad ? ` ${def.rango.unidad}` : ''}`;
  else t = String(valor);
  return `${def.etiqueta}: ${t}`;
}
