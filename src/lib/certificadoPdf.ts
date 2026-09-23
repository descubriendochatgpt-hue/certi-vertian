// Lectura del certificado de eficiencia energética en PDF que genera el
// programa oficial (probado con CE3X v2.3).
//
// El PDF se lee en el propio navegador: no se envía a ningún sitio. Lo leído
// es solo una PROPUESTA: la app lo muestra y el técnico revisa y confirma
// cada valor antes de guardarlo. Si algo no se encuentra, se queda vacío y
// se dice; nunca se inventa un valor.

import type { TipoEdificio } from './estados';

export interface ItemPdf {
  x: number;
  y: number;
  texto: string;
}
/** Elementos de texto de una página, con su posición (origen abajo a la izquierda). */
export type PaginaPdf = ItemPdf[];

export type Letra = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface Indicador {
  valor: number | null;
  letra: Letra | null;
}

export interface Parciales {
  calefaccion: Indicador;
  refrigeracion: Indicador;
  acs: Indicador;
  iluminacion: Indicador;
}

/** Tramo de la escala de calificación: la letra y sus límites. */
export interface TramoEscala {
  letra: Letra;
  desde: number | null;
  hasta: number | null;
}

export interface DatosCertificado {
  programa: string | null;
  fechaCertificado: string | null;          // AAAA-MM-DD
  nombreEdificio: string | null;
  direccion: string | null;
  municipio: string | null;
  codigoPostal: string | null;
  zonaClimatica: string | null;
  anioConstruccion: number | null;
  normativa: string | null;
  referenciaCatastral: string | null;
  tipoEdificio: TipoEdificio | null;
  tipoEdificioTexto: string | null;
  tecnicoNombre: string | null;
  tecnicoNif: string | null;
  tecnicoTitulacion: string | null;
  superficieHabitable: number | null;
  consumo: Indicador;                        // energía primaria no renovable, kWh/m²·año
  emisiones: Indicador;                      // kgCO2/m²·año
  escalaConsumo: TramoEscala[];
  escalaEmisiones: TramoEscala[];
  parcialesConsumo: Parciales;
  parcialesEmisiones: Parciales;
  demandaCalefaccion: Indicador;
  demandaRefrigeracion: Indicador;
  demandaRefrigeracionNoCalificable: boolean;
  emisionesElectricas: number | null;        // kgCO2/m²·año
  emisionesOtrosCombustibles: number | null; // kgCO2/m²·año
  fechaVisita: string | null;                // Anexo IV
  sinRecomendaciones: boolean;               // Anexo III «Apartado no definido»
  textoRecomendaciones: string | null;
  /** Qué datos no se han podido leer. */
  noEncontrado: string[];
}

// ─────────────────────────────── utilidades ────────────────────────────────

const LETRA = /^[A-G]$/;
const NUMERO = /^-?\d+(?:[.,]\d+)?$/;
const VALOR_LETRA = /^(\d+(?:[.,]\d+)?)\s+([A-G])$/;
const FECHA = /(\d{2})\/(\d{2})\/(\d{4})/;

const num = (s: string) => Number(s.replace(',', '.'));
const indicadorVacio = (): Indicador => ({ valor: null, letra: null });
const parcialesVacios = (): Parciales => ({
  calefaccion: indicadorVacio(), refrigeracion: indicadorVacio(), acs: indicadorVacio(), iluminacion: indicadorVacio(),
});

function fechaIso(s: string | null | undefined): string | null {
  const m = s?.match(FECHA);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function normal(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Primer elemento cuyo texto (normalizado) es exactamente `texto`. */
function buscar(p: PaginaPdf, texto: string, desde?: { yMax?: number; yMin?: number }): ItemPdf | undefined {
  const t = normal(texto);
  return p.find((i) => normal(i.texto) === t && (desde?.yMax === undefined || i.y <= desde.yMax) && (desde?.yMin === undefined || i.y >= desde.yMin));
}

/** Primer elemento que empieza por `texto`. */
function buscarPrefijo(p: PaginaPdf, texto: string): ItemPdf | undefined {
  const t = normal(texto);
  return p.find((i) => normal(i.texto).startsWith(t));
}

/**
 * Valor a la derecha de una etiqueta, en la misma línea (con tolerancia
 * vertical, porque algunas etiquetas ocupan dos líneas). Si se indica
 * `hastaX`, no se busca más allá (hay dos columnas de etiquetas por línea).
 */
function valorDe(p: PaginaPdf, etiqueta: ItemPdf | undefined, opciones: { hastaX?: number; toleranciaY?: number } = {}): string | null {
  if (!etiqueta) return null;
  const tol = opciones.toleranciaY ?? 3;
  const candidatos = p
    .filter((i) => i !== etiqueta && Math.abs(i.y - etiqueta.y) <= tol && i.x > etiqueta.x + 20 && (opciones.hastaX === undefined || i.x < opciones.hastaX))
    .sort((a, b) => a.x - b.x);
  // Las palabras de un mismo valor pueden venir en varios elementos.
  const texto = candidatos.map((c) => c.texto).join(' ').replace(/\s+/g, ' ').trim();
  return texto || null;
}

function paginaCon(paginas: PaginaPdf[], texto: string): PaginaPdf | undefined {
  const t = normal(texto);
  return paginas.find((p) => p.some((i) => normal(i.texto).includes(t)));
}

/** Página cuyo título es exactamente ese («ANEXO II», no «Anexo II. Calificación…» del índice). */
function paginaTitulada(paginas: PaginaPdf[], titulo: string): PaginaPdf | undefined {
  const t = normal(titulo);
  return paginas.find((p) => p.some((i) => normal(i.texto) === t));
}

/** «< 24.2», «24.2-39.2», «≥ 226.0» → límites. */
function leerTramo(s: string): { desde: number | null; hasta: number | null } | null {
  const t = s.replace(/\s/g, '');
  let m = t.match(/^<(\d+(?:[.,]\d+)?)$/);
  if (m) return { desde: null, hasta: num(m[1]!) };
  m = t.match(/^(?:≥|>=|>)(\d+(?:[.,]\d+)?)$/);
  if (m) return { desde: num(m[1]!), hasta: null };
  m = t.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/);
  if (m) return { desde: num(m[1]!), hasta: num(m[2]!) };
  return null;
}

/**
 * Escala de calificación: una columna de tramos («< 24.2», «24.2-39.2»…)
 * con la letra de cada tramo a su derecha, en la misma línea.
 */
function leerEscala(p: PaginaPdf, xMin: number, xMax: number, yMin: number, yMax: number): TramoEscala[] {
  const tramos: TramoEscala[] = [];
  for (const i of p) {
    if (i.x < xMin || i.x > xMax || i.y < yMin || i.y > yMax) continue;
    const t = leerTramo(i.texto);
    if (!t) continue;
    const letra = p.find((l) => LETRA.test(l.texto.trim()) && Math.abs(l.y - i.y) <= 3 && l.x > i.x && l.x < i.x + 80);
    if (letra) tramos.push({ letra: letra.texto.trim() as Letra, ...t });
  }
  return tramos.sort((a, b) => a.letra.localeCompare(b.letra));
}

/** Indicador global («69.3 D») dentro de una zona de la página. */
function leerGlobal(p: PaginaPdf, xMin: number, xMax: number, yMin: number, yMax: number): Indicador {
  const i = p.find((it) => it.x >= xMin && it.x <= xMax && it.y >= yMin && it.y <= yMax && VALOR_LETRA.test(it.texto.trim()));
  if (!i) return indicadorVacio();
  const m = i.texto.trim().match(VALOR_LETRA)!;
  return { valor: num(m[1]!), letra: m[2] as Letra };
}

/**
 * Indicador parcial (calefacción, ACS…) del Anexo II: bajo el rótulo del
 * servicio aparece la letra a su derecha y el valor debajo. Un «-» indica
 * que el servicio no existe.
 */
function leerParcial(p: PaginaPdf, rotulo: ItemPdf | undefined): Indicador {
  if (!rotulo) return indicadorVacio();
  const letra = p.find((i) => /^[A-G-]$/.test(i.texto.trim()) && i.y < rotulo.y - 25 && i.y > rotulo.y - 42 && i.x > rotulo.x + 40 && i.x < rotulo.x + 110);
  const valor = p.find((i) => (NUMERO.test(i.texto.trim()) || i.texto.trim() === '-') && i.y < rotulo.y - 40 && i.y > rotulo.y - 62 && Math.abs(i.x - (rotulo.x + 5)) < 30);
  return {
    letra: letra && LETRA.test(letra.texto.trim()) ? (letra.texto.trim() as Letra) : null,
    valor: valor && NUMERO.test(valor.texto.trim()) ? num(valor.texto.trim()) : null,
  };
}

function leerParciales(p: PaginaPdf, yMin: number, yMax: number): Parciales {
  const en = (t: string) => buscar(p, t, { yMin, yMax });
  return {
    calefaccion: leerParcial(p, en('CALEFACCIÓN')),
    acs: leerParcial(p, en('ACS')),
    refrigeracion: leerParcial(p, en('REFRIGERACIÓN')),
    iluminacion: leerParcial(p, en('ILUMINACIÓN')),
  };
}

function marcado(p: PaginaPdf, texto: string): boolean {
  const t = normal(texto);
  return p.some((i) => normal(i.texto) === `● ${t}` || normal(i.texto) === `●${t}`);
}

function deducirTipo(p: PaginaPdf): { tipo: TipoEdificio | null; texto: string | null } {
  const partes = ['Vivienda', 'Terciario', 'Unifamiliar', 'Bloque', 'Bloque completo', 'Vivienda individual', 'Edificio completo', 'Local']
    .filter((t) => marcado(p, t));
  const texto = partes.length ? partes.join(' · ') : null;
  if (marcado(p, 'Vivienda')) {
    if (marcado(p, 'Unifamiliar')) return { tipo: 'vivienda_unifamiliar', texto };
    if (marcado(p, 'Vivienda individual')) return { tipo: 'vivienda_en_bloque', texto };
    if (marcado(p, 'Bloque completo')) return { tipo: 'bloque_viviendas', texto };
  }
  if (marcado(p, 'Terciario')) {
    if (marcado(p, 'Local')) return { tipo: 'local_terciario', texto };
    if (marcado(p, 'Edificio completo')) return { tipo: 'edificio_terciario', texto };
  }
  return { tipo: null, texto };
}

// ──────────────────────────────── lectura ──────────────────────────────────

export function interpretarCertificado(paginas: PaginaPdf[]): DatosCertificado {
  const p1 = paginas[0] ?? [];
  const d: DatosCertificado = {
    programa: null, fechaCertificado: null, nombreEdificio: null, direccion: null, municipio: null, codigoPostal: null,
    zonaClimatica: null, anioConstruccion: null, normativa: null, referenciaCatastral: null, tipoEdificio: null,
    tipoEdificioTexto: null, tecnicoNombre: null, tecnicoNif: null, tecnicoTitulacion: null, superficieHabitable: null,
    consumo: indicadorVacio(), emisiones: indicadorVacio(), escalaConsumo: [], escalaEmisiones: [],
    parcialesConsumo: parcialesVacios(), parcialesEmisiones: parcialesVacios(),
    demandaCalefaccion: indicadorVacio(), demandaRefrigeracion: indicadorVacio(), demandaRefrigeracionNoCalificable: false,
    emisionesElectricas: null, emisionesOtrosCombustibles: null, fechaVisita: null,
    sinRecomendaciones: false, textoRecomendaciones: null, noEncontrado: [],
  };

  // ── Página 1: identificación ──
  // La página 1 tiene dos bloques con las mismas etiquetas (edificio y
  // técnico). El del técnico empieza en «DATOS DEL TÉCNICO CERTIFICADOR».
  const cabTecnico = buscarPrefijo(p1, 'DATOS DEL TÉCNICO CERTIFICADOR');
  const yTecnico = cabTecnico?.y ?? -Infinity;
  const enEdificio = (t: string) => p1.find((i) => normal(i.texto) === normal(t) && i.y > yTecnico);
  const enTecnico = (t: string) => p1.find((i) => normal(i.texto) === normal(t) && i.y < yTecnico);
  const COLUMNA_DERECHA = 340;

  d.nombreEdificio = valorDe(p1, enEdificio('Nombre del edificio'));
  d.direccion = valorDe(p1, enEdificio('Dirección'));
  d.municipio = valorDe(p1, enEdificio('Municipio'), { hastaX: COLUMNA_DERECHA });
  d.codigoPostal = valorDe(p1, enEdificio('Código Postal'));
  d.zonaClimatica = valorDe(p1, enEdificio('Zona climática'), { hastaX: COLUMNA_DERECHA });
  const anio = valorDe(p1, enEdificio('Año construcción'));
  d.anioConstruccion = anio && /^\d{4}$/.test(anio) ? Number(anio) : null;
  // La etiqueta «Normativa vigente (construcción / rehabilitación)» ocupa
  // varios elementos; el valor está en la columna de valores (x ≈ 257).
  const normativa = p1.find((i) => i.x > 250 && i.x < COLUMNA_DERECHA && Math.abs(i.y - (enEdificio('Normativa')?.y ?? -999)) <= 8);
  d.normativa = normativa?.texto.trim() ?? null;
  d.referenciaCatastral = valorDe(p1, enEdificio('Referencia/s catastral/es'))?.replace(/\s/g, '') ?? null;
  const tipo = deducirTipo(p1);
  d.tipoEdificio = tipo.tipo;
  d.tipoEdificioTexto = tipo.texto;

  d.tecnicoNombre = valorDe(p1, enTecnico('Nombre y Apellidos'), { hastaX: COLUMNA_DERECHA + 60 });
  d.tecnicoNif = valorDe(p1, enTecnico('NIF(NIE)'));
  d.tecnicoTitulacion = valorDe(p1, enTecnico('Titulación habilitante según normativa vigente'));
  d.programa = p1.find((i) => /^(CEX|CE3X|CE3|CERMA|HULC|CYPETHERM|SG SAVE)/i.test(i.texto.trim()))?.texto.trim() ?? null;
  d.fechaCertificado = fechaIso(buscarPrefijo(p1, 'Fecha:')?.texto);

  // Calificación global (página 1): dos columnas, consumo a la izquierda.
  const cabCalif = buscarPrefijo(p1, 'CALIFICACIÓN ENERGÉTICA OBTENIDA');
  const cabDeclaracion = buscarPrefijo(p1, 'El técnico abajo firmante');
  if (cabCalif) {
    const yMax = cabCalif.y;
    const yMin = cabDeclaracion?.y ?? cabCalif.y - 140;
    const cabEmisiones = buscarPrefijo(p1, 'EMISIONES DE DIÓXIDO');
    const xCorte = cabEmisiones ? cabEmisiones.x - 40 : 300;
    // Dos valores «69.3 D»: el de consumo (columna izquierda) y el de emisiones.
    const globales = p1.filter((i) => i.y >= yMin && i.y <= yMax && VALOR_LETRA.test(i.texto.trim())).sort((a, b) => a.x - b.x);
    if (globales.length === 2) {
      d.consumo = leerGlobal([globales[0]!], -Infinity, Infinity, -Infinity, Infinity);
      d.emisiones = leerGlobal([globales[1]!], -Infinity, Infinity, -Infinity, Infinity);
    }
    d.escalaConsumo = leerEscala(p1, 0, xCorte, yMin, yMax);
    d.escalaEmisiones = leerEscala(p1, xCorte, 600, yMin, yMax);
  }

  // ── Anexo I: superficie ──
  const pSup = paginaCon(paginas, 'Superficie habitable');
  if (pSup) {
    const v = valorDe(pSup, buscarPrefijo(pSup, 'Superficie habitable'));
    d.superficieHabitable = v && NUMERO.test(v) ? num(v) : null;
  }

  // ── Anexo II: parciales y demanda ──
  const p2 = paginaTitulada(paginas, 'ANEXO II');
  if (p2) {
    const s1 = buscarPrefijo(p2, '1. CALIFICACIÓN ENERGÉTICA DEL EDIFICIO EN EMISIONES');
    const s2 = buscarPrefijo(p2, '2. CALIFICACIÓN ENERGÉTICA DEL EDIFICIO EN CONSUMO');
    const s3 = buscarPrefijo(p2, '3. CALIFICACIÓN PARCIAL DE LA DEMANDA');
    if (s1 && s2) {
      d.parcialesEmisiones = leerParciales(p2, s2.y, s1.y);
      if (d.emisiones.valor === null) d.emisiones = leerGlobal(p2, 0, 300, s2.y, s1.y);
    }
    if (s2 && s3) {
      d.parcialesConsumo = leerParciales(p2, s3.y, s2.y);
      if (d.consumo.valor === null) d.consumo = leerGlobal(p2, 0, 300, s3.y, s2.y);
    }
    if (s3) {
      d.demandaCalefaccion = leerGlobal(p2, 0, 300, 0, s3.y);
      d.demandaRefrigeracion = leerGlobal(p2, 300, 600, 0, s3.y);
      d.demandaRefrigeracionNoCalificable = p2.some((i) => i.y < s3.y && normal(i.texto) === 'no calificable');
    }
    const elec = valorDe(p2, buscar(p2, 'Emisiones CO2 por consumo eléctrico'));
    const otros = valorDe(p2, buscar(p2, 'Emisiones CO2 por otros combustibles'));
    const primero = (s: string | null) => { const t = s?.split(' ')[0]; return t && NUMERO.test(t) ? num(t) : null; };
    d.emisionesElectricas = primero(elec);
    d.emisionesOtrosCombustibles = primero(otros);
  }

  // ── Anexo III: recomendaciones ──
  const p3 = paginaTitulada(paginas, 'ANEXO III');
  if (p3) {
    d.sinRecomendaciones = p3.some((i) => normal(i.texto).includes('apartado no definido'));
    const cab = buscarPrefijo(p3, 'RECOMENDACIONES PARA LA MEJORA');
    const cuerpo = p3
      .filter((i) => cab && i.y < cab.y && i.y > 40)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((i) => i.texto.trim())
      .join(' ')
      .trim();
    d.textoRecomendaciones = d.sinRecomendaciones ? null : cuerpo || null;
  }

  // ── Anexo IV: fecha de la visita ──
  const p4 = paginaTitulada(paginas, 'ANEXO IV');
  if (p4) {
    const et = buscarPrefijo(p4, 'Fecha de realización de la visita');
    if (et) {
      const f = p4.filter((i) => i.y < et.y && i.y > et.y - 30 && FECHA.test(i.texto)).sort((a, b) => b.y - a.y)[0]
        ?? p4.find((i) => Math.abs(i.y - et.y) <= 3 && i.x > et.x && FECHA.test(i.texto));
      d.fechaVisita = fechaIso(f?.texto);
    }
  }

  const obligatorios: [string, unknown][] = [
    ['referencia catastral', d.referenciaCatastral], ['fecha del certificado', d.fechaCertificado],
    ['consumo de energía primaria no renovable', d.consumo.valor], ['calificación de consumo', d.consumo.letra],
    ['emisiones de CO₂', d.emisiones.valor], ['calificación de emisiones', d.emisiones.letra],
    ['superficie habitable', d.superficieHabitable], ['fecha de la visita (Anexo IV)', d.fechaVisita],
    ['programa de cálculo', d.programa],
  ];
  d.noEncontrado = obligatorios.filter(([, v]) => v === null || v === undefined).map(([n]) => n);
  return d;
}

/** ¿El valor cae dentro del tramo de su letra en la escala del propio certificado? */
export function letraCoherente(ind: Indicador, escala: TramoEscala[]): boolean | null {
  if (ind.valor === null || !ind.letra || escala.length === 0) return null;
  const t = escala.find((e) => e.letra === ind.letra);
  if (!t) return null;
  return (t.desde === null || ind.valor >= t.desde) && (t.hasta === null || ind.valor < t.hasta);
}

// ───────────────────────── extracción en el navegador ───────────────────────

/** Extrae el texto del PDF con su posición. Se carga bajo demanda (la librería pesa ~1 MB). */
export async function extraerPaginasPdf(datos: ArrayBuffer): Promise<PaginaPdf[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const trabajador = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = trabajador.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(datos), isEvalSupported: false }).promise;
  const paginas: PaginaPdf[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const contenido = await (await doc.getPage(n)).getTextContent();
    paginas.push(
      contenido.items
        .filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i && Boolean(i.str.trim()))
        .map((i) => ({ x: Math.round(i.transform[4]!), y: Math.round(i.transform[5]!), texto: i.str })),
    );
  }
  await doc.destroy();
  return paginas;
}
