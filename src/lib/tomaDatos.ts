// Estructura de la toma de datos en campo (módulo 2).
//
// Se describe con «definiciones de campo» (etiqueta, tipo, rango…) para que
// el formulario y las validaciones salgan de la misma fuente: añadir un campo
// aquí lo añade al formulario y a las comprobaciones a la vez.
//
// Los rangos de aviso son orientativos: marcan valores poco habituales para
// que el técnico los revise, nunca impiden guardar un dato real.

import { type Aviso, type Rango, comprobarRango, formatearNumero } from './validaciones';
import { type TipoEdificio, esResidencial } from './estados';

export const VERSION_ESQUEMA = 1;

export type Valor = string | number | boolean | null;
export type Fila = { id: string } & Record<string, Valor>;

export interface Opcion {
  valor: string;
  etiqueta: string;
}

export interface DefCampo {
  campo: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'opcion' | 'si_no' | 'texto_largo';
  opciones?: Opcion[];
  rango?: Rango;
  /** Rango distinto según el valor de otro campo de la misma fila (p. ej. U según tipo de cerramiento). */
  rangoSegun?: (fila: Record<string, Valor>, tipoEdificio: TipoEdificio) => Rango | undefined;
  ayuda?: string;
  /** Solo se muestra si se cumple (p. ej. litros de acumulación solo para ACS). */
  visibleSi?: (fila: Record<string, Valor>) => boolean;
}

const op = (...pares: [string, string][]): Opcion[] => pares.map(([valor, etiqueta]) => ({ valor, etiqueta }));

export const ORIENTACIONES = op(
  ['N', 'Norte'], ['NE', 'Noreste'], ['E', 'Este'], ['SE', 'Sureste'],
  ['S', 'Sur'], ['SO', 'Suroeste'], ['O', 'Oeste'], ['NO', 'Noroeste'], ['H', 'Horizontal'],
);

// ───────────────────────────── Datos generales ────────────────────────────

export const CAMPOS_GENERALES: DefCampo[] = [
  {
    campo: 'zonaClimatica', etiqueta: 'Zona climática (CTE DB-HE)', tipo: 'opcion',
    opciones: op(['C1', 'C1'], ['D1', 'D1'], ['E1', 'E1'], ['C2', 'C2'], ['D2', 'D2'], ['otra', 'Otra']),
    ayuda: 'Según provincia y altitud (CTE DB-HE, anejo B). En Asturias suele ser C1, D1 o E1.',
  },
  {
    campo: 'normativa', etiqueta: 'Normativa vigente en la construcción', tipo: 'opcion',
    opciones: op(['anterior_ct79', 'Anterior a la NBE-CT-79'], ['ct79', 'NBE-CT-79'], ['cte2006', 'CTE 2006'], ['cte2013', 'CTE 2013'], ['cte2019', 'CTE 2019']),
  },
  { campo: 'superficieUtil', etiqueta: 'Superficie útil habitable', tipo: 'numero', rango: { min: 1, max: 100000, unidad: 'm²' },
    rangoSegun: (_f, t) => (esResidencial(t) && t !== 'bloque_viviendas' ? { min: 1, max: 100000, avisoMin: 20, avisoMax: 600, unidad: 'm²' } : undefined) },
  { campo: 'alturaLibre', etiqueta: 'Altura libre de planta', tipo: 'numero', rango: { min: 1.5, max: 20, avisoMin: 2.2, avisoMax: 4.5, unidad: 'm' } },
  { campo: 'numeroPlantas', etiqueta: 'Número de plantas habitables', tipo: 'numero', rango: { min: 1, max: 100, avisoMax: 20 } },
  {
    campo: 'masaParticiones', etiqueta: 'Masa de las particiones interiores', tipo: 'opcion',
    opciones: op(['ligera', 'Ligera'], ['media', 'Media'], ['pesada', 'Pesada']),
  },
  { campo: 'ventilacion', etiqueta: 'Ventilación', tipo: 'numero', rango: { min: 0, max: 10, avisoMin: 0.3, avisoMax: 1.5, unidad: 'ren/h' },
    ayuda: 'Renovaciones por hora. En residencial el valor de referencia es 0,63 ren/h.' },
  { campo: 'demandaAcs', etiqueta: 'Demanda diaria de ACS', tipo: 'numero', rango: { min: 0, max: 100000, avisoMin: 20, unidad: 'l/día' },
    rangoSegun: (_f, t) => (t === 'vivienda_unifamiliar' || t === 'vivienda_en_bloque' ? { min: 0, max: 100000, avisoMin: 20, avisoMax: 400, unidad: 'l/día' } : undefined) },
];

// ─────────────────────────── Envolvente térmica ───────────────────────────

const TIPOS_CERRAMIENTO = op(
  ['fachada', 'Muro de fachada'],
  ['cubierta', 'Cubierta'],
  ['suelo', 'Suelo'],
  ['medianeria', 'Medianería'],
  ['particion_nh', 'Partición con espacio no habitable'],
);

const RANGO_U: Record<string, Rango> = {
  fachada: { min: 0.01, max: 10, avisoMin: 0.15, avisoMax: 3.0, unidad: 'W/m²K' },
  cubierta: { min: 0.01, max: 10, avisoMin: 0.1, avisoMax: 3.5, unidad: 'W/m²K' },
  suelo: { min: 0.01, max: 10, avisoMin: 0.1, avisoMax: 3.5, unidad: 'W/m²K' },
  medianeria: { min: 0.01, max: 10, avisoMin: 0.15, avisoMax: 3.5, unidad: 'W/m²K' },
  particion_nh: { min: 0.01, max: 10, avisoMin: 0.2, avisoMax: 3.5, unidad: 'W/m²K' },
};

export const ORIGEN_DATO = op(
  ['defecto', 'Por defecto (según año/normativa)'],
  ['estimado', 'Estimado'],
  ['conocido', 'Conocido (ensayado / justificado)'],
);

export const CAMPOS_CERRAMIENTO: DefCampo[] = [
  { campo: 'nombre', etiqueta: 'Nombre', tipo: 'texto', ayuda: 'Por ejemplo «Fachada norte salón».' },
  { campo: 'tipo', etiqueta: 'Tipo', tipo: 'opcion', opciones: TIPOS_CERRAMIENTO },
  { campo: 'orientacion', etiqueta: 'Orientación', tipo: 'opcion', opciones: ORIENTACIONES },
  { campo: 'superficie', etiqueta: 'Superficie', tipo: 'numero', rango: { min: 0.01, max: 100000, avisoMin: 0.5, avisoMax: 5000, unidad: 'm²' } },
  { campo: 'u', etiqueta: 'Transmitancia U', tipo: 'numero', rango: { min: 0.01, max: 10, unidad: 'W/m²K' },
    rangoSegun: (f) => RANGO_U[String(f.tipo ?? '')] },
  { campo: 'origenU', etiqueta: 'Origen del valor de U', tipo: 'opcion', opciones: ORIGEN_DATO },
  { campo: 'notas', etiqueta: 'Notas (composición, aislamiento…)', tipo: 'texto_largo' },
];

export const CAMPOS_HUECO: DefCampo[] = [
  { campo: 'nombre', etiqueta: 'Nombre', tipo: 'texto', ayuda: 'Por ejemplo «Ventana dormitorio 1».' },
  { campo: 'cerramiento', etiqueta: 'Cerramiento en el que está', tipo: 'texto', ayuda: 'Nombre del muro o cubierta.' },
  { campo: 'orientacion', etiqueta: 'Orientación', tipo: 'opcion', opciones: ORIENTACIONES },
  { campo: 'cantidad', etiqueta: 'Número de huecos iguales', tipo: 'numero', rango: { min: 1, max: 1000, avisoMax: 50 } },
  { campo: 'superficie', etiqueta: 'Superficie de cada hueco', tipo: 'numero', rango: { min: 0.01, max: 500, avisoMin: 0.1, avisoMax: 50, unidad: 'm²' } },
  {
    campo: 'tipoVidrio', etiqueta: 'Vidrio', tipo: 'opcion',
    opciones: op(['simple', 'Simple'], ['doble', 'Doble'], ['doble_be', 'Doble bajo emisivo'], ['triple', 'Triple'], ['otro', 'Otro']),
  },
  { campo: 'uVidrio', etiqueta: 'U del vidrio', tipo: 'numero', rango: { min: 0.1, max: 10, avisoMin: 0.5, avisoMax: 6.0, unidad: 'W/m²K' } },
  {
    campo: 'tipoMarco', etiqueta: 'Marco', tipo: 'opcion',
    opciones: op(['aluminio', 'Aluminio sin RPT'], ['aluminio_rpt', 'Aluminio con RPT'], ['pvc', 'PVC'], ['madera', 'Madera'], ['metalico', 'Metálico'], ['otro', 'Otro']),
  },
  { campo: 'uMarco', etiqueta: 'U del marco', tipo: 'numero', rango: { min: 0.1, max: 10, avisoMin: 0.8, avisoMax: 7.0, unidad: 'W/m²K' } },
  { campo: 'porcentajeMarco', etiqueta: 'Porcentaje de marco', tipo: 'numero', rango: { min: 0, max: 100, avisoMin: 5, avisoMax: 50, unidad: '%' } },
  { campo: 'factorSolar', etiqueta: 'Factor solar del vidrio (g)', tipo: 'numero', rango: { min: 0, max: 1, avisoMin: 0.1, avisoMax: 0.9 } },
  { campo: 'permeabilidad', etiqueta: 'Permeabilidad al aire', tipo: 'numero', rango: { min: 0, max: 200, avisoMin: 3, avisoMax: 100, unidad: 'm³/h·m² a 100 Pa' } },
  {
    campo: 'proteccionSolar', etiqueta: 'Protección solar', tipo: 'opcion',
    opciones: op(['ninguna', 'Ninguna'], ['persiana', 'Persiana / contraventana'], ['toldo', 'Toldo'], ['voladizo', 'Voladizo / retranqueo'], ['lamas', 'Lamas'], ['otra', 'Otra']),
  },
  { campo: 'notas', etiqueta: 'Notas', tipo: 'texto_largo' },
];

export const CAMPOS_PUENTE_TERMICO: DefCampo[] = [
  {
    campo: 'tipo', etiqueta: 'Tipo', tipo: 'opcion',
    opciones: op(['pilar', 'Pilar integrado en fachada'], ['frente_forjado', 'Frente de forjado'], ['contorno_hueco', 'Contorno de hueco'], ['caja_persiana', 'Caja de persiana'], ['encuentro_cubierta', 'Encuentro fachada-cubierta'], ['encuentro_suelo', 'Encuentro fachada-suelo'], ['esquina', 'Esquina'], ['otro', 'Otro']),
  },
  { campo: 'longitud', etiqueta: 'Longitud', tipo: 'numero', rango: { min: 0, max: 100000, avisoMax: 2000, unidad: 'm' } },
  { campo: 'psi', etiqueta: 'Transmitancia lineal ψ', tipo: 'numero', rango: { min: 0, max: 5, avisoMax: 1.5, unidad: 'W/mK' },
    ayuda: 'Déjalo vacío si vas a usar el valor por defecto del programa.' },
  { campo: 'notas', etiqueta: 'Notas', tipo: 'texto_largo' },
];

// ───────────────────────────── Instalaciones ──────────────────────────────

const RANGO_RENDIMIENTO: Record<string, Rango> = {
  porcentaje: { min: 1, max: 150, avisoMin: 50, avisoMax: 110, unidad: '%' },
  cop: { min: 0.5, max: 12, avisoMin: 1.5, avisoMax: 6, unidad: '' },
  eer: { min: 0.5, max: 15, avisoMin: 1.5, avisoMax: 8, unidad: '' },
};

const esAcs = (f: Record<string, Valor>) => String(f.servicio ?? '').includes('acs');

export const CAMPOS_INSTALACION: DefCampo[] = [
  {
    campo: 'servicio', etiqueta: 'Servicio', tipo: 'opcion',
    opciones: op(['calefaccion', 'Calefacción'], ['acs', 'ACS'], ['calefaccion_acs', 'Calefacción + ACS'], ['refrigeracion', 'Refrigeración'], ['calefaccion_refrigeracion', 'Calefacción + refrigeración'], ['mixto_3', 'Calefacción + refrigeración + ACS']),
  },
  {
    campo: 'generador', etiqueta: 'Generador', tipo: 'opcion',
    opciones: op(['caldera_estandar', 'Caldera estándar'], ['caldera_baja_temp', 'Caldera de baja temperatura'], ['caldera_condensacion', 'Caldera de condensación'], ['bomba_calor', 'Bomba de calor'], ['efecto_joule', 'Efecto Joule (radiadores/termo eléctrico)'], ['caldera_biomasa', 'Caldera de biomasa'], ['equipo_split', 'Equipo split / autónomo'], ['red_distrito', 'Red de calor / frío'], ['otro', 'Otro']),
  },
  {
    campo: 'combustible', etiqueta: 'Combustible / energía', tipo: 'opcion',
    opciones: op(['gas_natural', 'Gas natural'], ['glp', 'GLP (propano/butano)'], ['gasoleo', 'Gasóleo C'], ['electricidad', 'Electricidad'], ['biomasa', 'Biomasa'], ['carbon', 'Carbón'], ['otro', 'Otro']),
  },
  { campo: 'centralizada', etiqueta: 'Instalación centralizada del edificio', tipo: 'si_no' },
  { campo: 'potencia', etiqueta: 'Potencia nominal', tipo: 'numero', rango: { min: 0.1, max: 100000, unidad: 'kW' },
    rangoSegun: (f, t) => (t === 'vivienda_unifamiliar' || t === 'vivienda_en_bloque') && !f.centralizada
      ? { min: 0.1, max: 100000, avisoMin: 1, avisoMax: 60, unidad: 'kW' }
      : { min: 0.1, max: 100000, avisoMin: 1, avisoMax: 2000, unidad: 'kW' } },
  {
    campo: 'unidadRendimiento', etiqueta: 'Cómo se expresa el rendimiento', tipo: 'opcion',
    opciones: op(['porcentaje', 'Rendimiento (%)'], ['cop', 'COP / SCOP (calor)'], ['eer', 'EER / SEER (frío)']),
  },
  { campo: 'rendimiento', etiqueta: 'Rendimiento estacional', tipo: 'numero',
    rangoSegun: (f) => RANGO_RENDIMIENTO[String(f.unidadRendimiento ?? 'porcentaje')] ?? RANGO_RENDIMIENTO.porcentaje },
  { campo: 'anioInstalacion', etiqueta: 'Año de instalación', tipo: 'numero',
    rangoSegun: () => ({ min: 1900, max: new Date().getFullYear(), avisoMin: 1960 }) },
  { campo: 'cobertura', etiqueta: 'Superficie o demanda que cubre', tipo: 'numero', rango: { min: 0, max: 100, avisoMin: 1, unidad: '%' } },
  { campo: 'acumulacion', etiqueta: 'Volumen de acumulación de ACS', tipo: 'numero', rango: { min: 0, max: 100000, avisoMin: 30, avisoMax: 5000, unidad: 'l' }, visibleSi: esAcs },
  { campo: 'notas', etiqueta: 'Notas (marca, modelo, estado…)', tipo: 'texto_largo' },
];

export const CAMPOS_RENOVABLE: DefCampo[] = [
  {
    campo: 'tipo', etiqueta: 'Sistema', tipo: 'opcion',
    opciones: op(['solar_termica', 'Solar térmica'], ['fotovoltaica', 'Solar fotovoltaica'], ['biomasa', 'Biomasa'], ['geotermia', 'Geotermia'], ['minieolica', 'Minieólica'], ['otra', 'Otra']),
  },
  { campo: 'superficieCaptadores', etiqueta: 'Superficie de captadores', tipo: 'numero', rango: { min: 0, max: 100000, avisoMax: 500, unidad: 'm²' },
    visibleSi: (f) => f.tipo === 'solar_termica' },
  { campo: 'coberturaAcs', etiqueta: 'Contribución a la demanda de ACS', tipo: 'numero', rango: { min: 0, max: 100, unidad: '%' },
    visibleSi: (f) => f.tipo === 'solar_termica' },
  { campo: 'potenciaPico', etiqueta: 'Potencia pico', tipo: 'numero', rango: { min: 0, max: 100000, avisoMax: 100, unidad: 'kWp' },
    visibleSi: (f) => f.tipo === 'fotovoltaica' },
  { campo: 'produccionAnual', etiqueta: 'Producción anual estimada', tipo: 'numero', rango: { min: 0, max: 100000000, unidad: 'kWh/año' } },
  { campo: 'notas', etiqueta: 'Notas', tipo: 'texto_largo' },
];

export const CAMPOS_ILUMINACION: DefCampo[] = [
  { campo: 'zona', etiqueta: 'Zona', tipo: 'texto', ayuda: 'Por ejemplo «Sala de ventas».' },
  { campo: 'superficie', etiqueta: 'Superficie iluminada', tipo: 'numero', rango: { min: 0.01, max: 100000, unidad: 'm²' } },
  { campo: 'potencia', etiqueta: 'Potencia instalada', tipo: 'numero', rango: { min: 0, max: 10000000, unidad: 'W' } },
  { campo: 'iluminancia', etiqueta: 'Iluminancia media', tipo: 'numero', rango: { min: 0, max: 10000, avisoMin: 50, avisoMax: 2000, unidad: 'lux' } },
  {
    campo: 'tipoLampara', etiqueta: 'Tipo de lámpara', tipo: 'opcion',
    opciones: op(['led', 'LED'], ['fluorescente', 'Fluorescente'], ['halogena', 'Halógena'], ['incandescente', 'Incandescente'], ['descarga', 'Descarga (HM, VSAP…)'], ['otra', 'Otra']),
  },
  { campo: 'notas', etiqueta: 'Notas', tipo: 'texto_largo' },
];

// ─────────────────────────────── Estructura ───────────────────────────────

export interface TomaDatos {
  generales: Record<string, Valor>;
  cerramientos: Fila[];
  huecos: Fila[];
  puentesTermicos: Fila[];
  instalaciones: Fila[];
  renovables: Fila[];
  iluminacion: Fila[];
  observaciones: string;
}

export type SeccionLista = 'cerramientos' | 'huecos' | 'puentesTermicos' | 'instalaciones' | 'renovables' | 'iluminacion';

export interface DefSeccion {
  clave: SeccionLista;
  titulo: string;
  elemento: string;       // «Añadir …»
  campos: DefCampo[];
  titulo_fila: (f: Fila, i: number) => string;
  soloTerciario?: boolean;
}

const nombreOpcion = (defs: DefCampo[], campo: string, valor: Valor | undefined) =>
  defs.find((d) => d.campo === campo)?.opciones?.find((o) => o.valor === valor)?.etiqueta;

export const SECCIONES: DefSeccion[] = [
  { clave: 'cerramientos', titulo: 'Envolvente: cerramientos opacos', elemento: 'cerramiento', campos: CAMPOS_CERRAMIENTO,
    titulo_fila: (f, i) => String(f.nombre || nombreOpcion(CAMPOS_CERRAMIENTO, 'tipo', f.tipo) || `Cerramiento ${i + 1}`) },
  { clave: 'huecos', titulo: 'Envolvente: huecos (ventanas, puertas, lucernarios)', elemento: 'hueco', campos: CAMPOS_HUECO,
    titulo_fila: (f, i) => String(f.nombre || `Hueco ${i + 1}`) },
  { clave: 'puentesTermicos', titulo: 'Puentes térmicos', elemento: 'puente térmico', campos: CAMPOS_PUENTE_TERMICO,
    titulo_fila: (f, i) => nombreOpcion(CAMPOS_PUENTE_TERMICO, 'tipo', f.tipo) ?? `Puente térmico ${i + 1}` },
  { clave: 'instalaciones', titulo: 'Instalaciones de calefacción, refrigeración y ACS', elemento: 'instalación', campos: CAMPOS_INSTALACION,
    titulo_fila: (f, i) => [nombreOpcion(CAMPOS_INSTALACION, 'servicio', f.servicio), nombreOpcion(CAMPOS_INSTALACION, 'generador', f.generador)].filter(Boolean).join(' · ') || `Instalación ${i + 1}` },
  { clave: 'renovables', titulo: 'Energías renovables', elemento: 'sistema renovable', campos: CAMPOS_RENOVABLE,
    titulo_fila: (f, i) => nombreOpcion(CAMPOS_RENOVABLE, 'tipo', f.tipo) ?? `Sistema ${i + 1}` },
  { clave: 'iluminacion', titulo: 'Iluminación', elemento: 'zona de iluminación', campos: CAMPOS_ILUMINACION, soloTerciario: true,
    titulo_fila: (f, i) => String(f.zona || `Zona ${i + 1}`) },
];

export function tomaDatosVacia(): TomaDatos {
  return {
    generales: {},
    cerramientos: [],
    huecos: [],
    puentesTermicos: [],
    instalaciones: [],
    renovables: [],
    iluminacion: [],
    observaciones: '',
  };
}

/** Completa lo que falte (datos guardados con una versión anterior del formulario). */
export function normalizarTomaDatos(bruto: unknown): TomaDatos {
  const base = tomaDatosVacia();
  if (!bruto || typeof bruto !== 'object') return base;
  const b = bruto as Partial<TomaDatos>;
  const lista = (v: unknown): Fila[] =>
    Array.isArray(v) ? v.filter((f) => f && typeof f === 'object' && typeof (f as Fila).id === 'string') as Fila[] : [];
  return {
    generales: b.generales && typeof b.generales === 'object' ? { ...b.generales } : {},
    cerramientos: lista(b.cerramientos),
    huecos: lista(b.huecos),
    puentesTermicos: lista(b.puentesTermicos),
    instalaciones: lista(b.instalaciones),
    renovables: lista(b.renovables),
    iluminacion: lista(b.iluminacion),
    observaciones: typeof b.observaciones === 'string' ? b.observaciones : '',
  };
}

// ────────────────────────────── Comprobaciones ────────────────────────────

export function rangoDe(def: DefCampo, fila: Record<string, Valor>, tipoEdificio: TipoEdificio): Rango | undefined {
  return def.rangoSegun?.(fila, tipoEdificio) ?? def.rango;
}

export interface ResultadoComprobacion {
  errores: { ruta: string; mensaje: string }[];
  avisos: Aviso[];
}

/**
 * Revisa toda la toma de datos. Los errores impiden verificarla; los avisos
 * se muestran y el técnico debe confirmarlos uno a uno.
 */
export function comprobarTomaDatos(
  d: TomaDatos,
  contexto: { tipoEdificio: TipoEdificio; superficieExpediente: number | null },
): ResultadoComprobacion {
  const errores: ResultadoComprobacion['errores'] = [];
  const avisos: Aviso[] = [];

  const revisarCampos = (defs: DefCampo[], fila: Record<string, Valor>, ruta: string, nombre: string) => {
    for (const def of defs) {
      if (def.tipo !== 'numero') continue;
      if (def.visibleSi && !def.visibleSi(fila)) continue;
      const valor = fila[def.campo];
      if (typeof valor !== 'number') continue;
      const r = comprobarRango(valor, rangoDe(def, fila, contexto.tipoEdificio) ?? {});
      const donde = `${nombre} · ${def.etiqueta}`;
      if (r.tipo === 'error') errores.push({ ruta: `${ruta}.${def.campo}`, mensaje: `${donde}: ${r.mensaje}` });
      if (r.tipo === 'aviso') avisos.push({ clave: `${ruta}.${def.campo}=${valor}`, mensaje: `${donde}: ${r.mensaje}` });
    }
  };

  revisarCampos(CAMPOS_GENERALES, d.generales, 'generales', 'Datos generales');

  for (const s of SECCIONES) {
    d[s.clave].forEach((fila, i) => revisarCampos(s.campos, fila, `${s.clave}.${fila.id}`, s.titulo_fila(fila, i)));
  }

  // Coherencias entre datos
  const sup = d.generales.superficieUtil;
  if (typeof sup === 'number' && contexto.superficieExpediente && Math.abs(sup - contexto.superficieExpediente) / contexto.superficieExpediente > 0.05) {
    avisos.push({
      clave: `coherencia.superficie=${sup}/${contexto.superficieExpediente}`,
      mensaje: `La superficie útil de la visita (${formatearNumero(sup)} m²) difiere más de un 5 % de la del expediente (${formatearNumero(contexto.superficieExpediente)} m²).`,
    });
  }

  for (const f of d.huecos) {
    const uV = f.uVidrio, uM = f.uMarco;
    if (f.tipoVidrio === 'simple' && typeof uV === 'number' && uV < 4) {
      avisos.push({ clave: `huecos.${f.id}.coherencia=${uV}`, mensaje: `${f.nombre || 'Hueco'}: vidrio simple con U = ${formatearNumero(uV)} W/m²K (lo habitual es ≈ 5,7).` });
    }
    if (typeof uM === 'number' && f.tipoMarco === 'aluminio' && uM < 4) {
      avisos.push({ clave: `huecos.${f.id}.coherenciaMarco=${uM}`, mensaje: `${f.nombre || 'Hueco'}: marco de aluminio sin RPT con U = ${formatearNumero(uM)} W/m²K (lo habitual es ≈ 5,7).` });
    }
  }

  const coberturaPorServicio: Record<string, number> = {};
  for (const f of d.instalaciones) {
    if (typeof f.cobertura !== 'number' || !f.servicio) continue;
    const servicios = String(f.servicio) === 'mixto_3' ? ['calefaccion', 'refrigeracion', 'acs'] : String(f.servicio).split('_');
    for (const s of servicios) coberturaPorServicio[s] = (coberturaPorServicio[s] ?? 0) + f.cobertura;
  }
  for (const [s, total] of Object.entries(coberturaPorServicio)) {
    if (total > 100) {
      avisos.push({ clave: `coherencia.cobertura.${s}=${total}`, mensaje: `Las instalaciones de ${s === 'acs' ? 'ACS' : s} suman una cobertura del ${formatearNumero(total)} % (más del 100 %).` });
    }
  }

  // Lo que falta
  if (d.cerramientos.length === 0) {
    avisos.push({ clave: 'faltan.cerramientos', mensaje: 'No hay ningún cerramiento opaco registrado.' });
  }
  if (d.huecos.length === 0) {
    avisos.push({ clave: 'faltan.huecos', mensaje: 'No hay ningún hueco registrado.' });
  }
  if (d.instalaciones.length === 0) {
    avisos.push({ clave: 'faltan.instalaciones', mensaje: 'No hay instalaciones registradas: el programa de certificación aplicará las de referencia.' });
  }
  if (!d.generales.zonaClimatica) {
    avisos.push({ clave: 'faltan.zonaClimatica', mensaje: 'No se ha indicado la zona climática.' });
  }

  return { errores, avisos };
}
