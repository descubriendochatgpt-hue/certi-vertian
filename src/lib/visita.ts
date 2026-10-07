// Visita grabada: lo que se pide a la IA y cómo se convierte su respuesta en
// una propuesta para la toma de datos. Lo usan la web y el Worker (/api).
//
// La respuesta de la IA nunca entra directamente en la toma de datos: se
// convierte en una propuesta (con la frase de la que sale cada dato), pasa
// por las mismas comprobaciones que lo importado de un fichero y el técnico
// elige qué añadir.

import {
  CAMPOS_ADMINISTRATIVOS, CAMPOS_GENERALES, type DefCampo, SECCIONES, type SeccionLista, type TomaDatos, type Valor,
} from './tomaDatos';
import { type Elemento, describirValor, leerNumeroEs, limpiarValores } from './importarDatos';

/** Lo que se envía del catálogo: la IA elige por la etiqueta y devuelve la clave. */
export interface SolucionResumida { clave: string; tipo: string; etiqueta: string }

export interface PropuestaVisita {
  elementos: Elemento[];
  /** Lo que se oyó pero no estaba claro, contradicciones, preguntas para el técnico. */
  dudas: string[];
  /** Qué se ha visto en cada foto (para que el técnico sepa de dónde sale cada dato). */
  fotos: { foto: number; contenido: string }[];
  observaciones: string;
}

/** Campos generales que puede proponer la IA (la normativa sale del año, no se pregunta). */
export const CAMPOS_GENERALES_VISITA: DefCampo[] = [...CAMPOS_ADMINISTRATIVOS, ...CAMPOS_GENERALES]
  .filter((d) => d.campo !== 'normativa');

const SECCIONES_VISITA = SECCIONES;

type Esquema = Record<string, unknown>;
const nulo = (s: Esquema): Esquema => ({ anyOf: [s, { type: 'null' }] });

function esquemaCampo(def: DefCampo, catalogo: SolucionResumida[]): Esquema {
  switch (def.tipo) {
    case 'numero': return nulo({ type: 'number' });
    case 'si_no': return nulo({ type: 'boolean' });
    case 'opcion': return nulo({ type: 'string', enum: (def.opciones ?? []).map((o) => o.valor) });
    case 'solucion': {
      const claves = catalogo.filter((s) => s.tipo === def.solucion).map((s) => s.clave);
      return claves.length ? nulo({ type: 'string', enum: claves }) : { type: 'null' };
    }
    default: return nulo({ type: 'string' });
  }
}

const objeto = (propiedades: Record<string, Esquema>): Esquema => ({
  type: 'object', properties: propiedades, required: Object.keys(propiedades), additionalProperties: false,
});

/** Esquema JSON de la respuesta (salida estructurada: la IA no puede salirse de él). */
export function esquemaExtraccion(catalogo: SolucionResumida[]): Esquema {
  const secciones: Record<string, Esquema> = {};
  for (const s of SECCIONES_VISITA) {
    const props: Record<string, Esquema> = {};
    for (const d of s.campos) props[d.campo] = esquemaCampo(d, catalogo);
    props.cita = { type: 'string', description: 'Frase literal de la transcripción (o «Foto N») de la que sale este elemento.' };
    secciones[s.clave] = { type: 'array', items: objeto(props) };
  }
  return objeto({
    generales: {
      type: 'array',
      items: objeto({
        campo: { type: 'string', enum: CAMPOS_GENERALES_VISITA.map((d) => d.campo) },
        valor: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] },
        cita: { type: 'string' },
      }),
    },
    ...secciones,
    observaciones: { type: 'string', description: 'Observaciones útiles para el certificado que no encajan en ningún campo. Vacío si no hay.' },
    dudas: { type: 'array', items: { type: 'string' } },
    fotos: { type: 'array', items: objeto({ foto: { type: 'integer' }, contenido: { type: 'string' } }) },
  });
}

function describirCampos(defs: DefCampo[]): string {
  return defs.map((d) => {
    const unidad = d.rango?.unidad ? ` [${d.rango.unidad}]` : '';
    const opciones = d.tipo === 'opcion' ? ` (${(d.opciones ?? []).map((o) => `${o.valor} = ${o.etiqueta}`).join('; ')})` : '';
    return `- ${d.campo}: ${d.etiqueta}${unidad}${opciones}${d.ayuda ? `. ${d.ayuda}` : ''}`;
  }).join('\n');
}

/** Instrucciones fijas (no cambian entre visitas: se pueden reutilizar en caché). */
export function instruccionesExtraccion(): string {
  return `Eres el asistente de un técnico que hace certificados de eficiencia energética de edificios en España con el programa CE3X.
Durante la visita al inmueble el técnico ha ido hablando en voz alta (transcripción automática, puede tener errores de reconocimiento) y ha hecho fotos.
Tu trabajo es pasar a datos estructurados lo que DIJO o lo que SE VE en las fotos, para rellenar su toma de datos.

Reglas:
1. No inventes nada. Si un dato no se dijo ni se ve con claridad, déjalo en null. Nunca rellenes un valor «típico» o «por defecto».
2. Cada elemento lleva en «cita» la frase literal de la transcripción de la que sale (o «Foto N»), para que el técnico lo compruebe.
3. Si algo es ambiguo, contradictorio o el técnico se corrige, usa lo último que dijo y explícalo en «dudas». Si no se entiende, va a «dudas» y no a los datos.
4. Unidades: metros, m², kW, litros, años con cuatro cifras. Los números van como números (2.5, no «2,5»).
5. Corrige errores evidentes de la transcripción por el contexto técnico (p. ej. «rotura de puente térmico», «caldera de condensación»), pero no cambies números.
6. Cerramientos: tipo, orientación (N, NE, E, SE, S, SO, O, NO, H), largo y alto o superficie. La transmitancia U solo si la dijo.
   Pon a cada cerramiento un nombre corto y único (p. ej. «Fachada norte», «Medianería escalera»).
7. Huecos (ventanas, puertas, balcones): en «cerramiento» el nombre EXACTO del cerramiento en el que están, tal como lo has llamado.
   Las medidas de carpintería suelen dictarse «ancho por alto»; si no queda claro cuál es cada una, pon la primera como ancho y la segunda como alto y añádelo a «dudas».
   «cantidad» es el número de huecos iguales.
8. Instalaciones: servicio, generador, combustible, potencia, año. Lee en las fotos las placas de características (marca, modelo, potencia, año) y ponlo en «notas».
9. «solucionCe3x»: elige una solución del catálogo SOLO si la descripción del técnico encaja claramente con su etiqueta (mismo tipo de muro, marco, vidrio o equipo). Si dudas, null.
10. En «generales», usa «descripcionVisita» para redactar, en tercera persona y con estilo de informe, las pruebas, comprobaciones e inspecciones realizadas en la visita (3 a 6 frases, solo hechos de la grabación y las fotos).
11. No incluyas datos personales (nombres, teléfonos, DNI) aunque se oigan.
12. En «fotos», describe brevemente qué se ve en cada foto que hayas usado (número de foto empezando en 1).
13. Algunas «fotos» pueden ser documentos PDF (por ejemplo la consulta descriptiva y gráfica del Catastro). De la ficha del Catastro saca el año de construcción (anioConstruccion), la superficie construida y el uso (en «observaciones», no como superficie útil) y el número de plantas si aparece. Cita «Foto N (Catastro)».

Datos generales posibles (campo: significado):
${describirCampos(CAMPOS_GENERALES_VISITA)}

${SECCIONES_VISITA.map((s) => `${s.titulo} («${s.clave}»):\n${describirCampos(s.campos.filter((d) => d.tipo !== 'solucion'))}`).join('\n\n')}`;
}

export interface ContextoVisita {
  expediente: string;
  /** Lo que ya se sabe (del expediente, del CRM o del Catastro): no hace falta repetirlo. */
  conocido: string;
  catalogo: SolucionResumida[];
  transcripcion: string;
  fotos: { hora: string }[];
}

/** Texto del mensaje con los datos de esta visita (lo variable va aquí, después de lo fijo). */
export function mensajeVisita(c: ContextoVisita): string {
  const cat = c.catalogo.length
    ? c.catalogo.map((s) => `- [${s.tipo}] ${s.clave}: ${s.etiqueta}`).join('\n')
    : '(vacío: deja «solucionCe3x» en null)';
  return `EXPEDIENTE: ${c.expediente}

YA SE SABE (no lo repitas salvo que el técnico lo corrija):
${c.conocido || '(nada)'}

CATÁLOGO DE SOLUCIONES DE CE3X DEL TÉCNICO:
${cat}

FOTOS: ${c.fotos.length ? c.fotos.map((f, i) => `Foto ${i + 1} (${f.hora})`).join(', ') : 'ninguna'}

TRANSCRIPCIÓN DE LA VISITA:
"""
${c.transcripcion.trim() || '(sin audio)'}
"""`;
}

/** Pista para el reconocimiento de voz (vocabulario técnico). */
export const PISTA_TRANSCRIPCION = 'Visita para el certificado energético. Fachada, medianería, cubierta, forjado, cámara de aire, ' +
  'aislamiento, carpintería de aluminio con rotura de puente térmico, PVC, doble acristalamiento, persiana, caldera de condensación, ' +
  'termo eléctrico, bomba de calor, aerotermia, radiadores, splits, kilovatios, metros cuadrados.';

// ────────────────────────── Respuesta → propuesta ─────────────────────────

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const textoDe = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Convierte la respuesta de la IA en una propuesta revisable: cada valor pasa
 * por las comprobaciones de tipo y de opciones de la toma de datos.
 */
export function propuestaDesdeExtraccion(r: unknown, catalogo: SolucionResumida[] = []): PropuestaVisita {
  const p: PropuestaVisita = { elementos: [], dudas: [], fotos: [], observaciones: '' };
  if (!esObjeto(r)) { p.dudas.push('La respuesta del procesado no tiene el formato esperado.'); return p; }
  const claves = new Set(catalogo.map((s) => s.clave));

  for (const g of Array.isArray(r.generales) ? r.generales : []) {
    if (!esObjeto(g)) continue;
    const def = CAMPOS_GENERALES_VISITA.find((d) => d.campo === g.campo);
    if (!def) continue;
    let valor = g.valor as Valor;
    const notas: string[] = [];
    if (def.tipo === 'numero' && typeof valor === 'string') {
      const n = leerNumeroEs(valor);
      if (n.valor !== null) valor = n.valor;
    }
    const valores = limpiarValores('generales', { [def.campo]: valor }, notas);
    if (Object.keys(valores).length || notas.length) {
      p.elementos.push({ destino: 'generales', valores, origen: textoDe(g.cita) || 'visita', notas });
    }
  }

  for (const s of SECCIONES_VISITA) {
    const filas = r[s.clave];
    for (const f of Array.isArray(filas) ? filas : []) {
      if (!esObjeto(f)) continue;
      const notas: string[] = [];
      const brutos: Record<string, Valor> = {};
      for (const d of s.campos) {
        const v = f[d.campo];
        if (v === null || v === undefined || v === '') continue;
        if (d.tipo === 'solucion' && !claves.has(String(v))) { notas.push('La solución de CE3X propuesta no está en el catálogo: no se ha usado.'); continue; }
        brutos[d.campo] = v as Valor;
      }
      const valores = limpiarValores(s.clave as SeccionLista, brutos, notas);
      if (Object.keys(valores).length) p.elementos.push({ destino: s.clave, valores, origen: textoDe(f.cita) || 'visita', notas });
    }
  }

  p.dudas.push(...(Array.isArray(r.dudas) ? r.dudas.map(textoDe).filter(Boolean) : []));
  p.fotos = (Array.isArray(r.fotos) ? r.fotos : []).filter(esObjeto)
    .map((f) => ({ foto: Number(f.foto) || 0, contenido: textoDe(f.contenido) })).filter((f) => f.contenido);
  p.observaciones = textoDe(r.observaciones);
  return p;
}

// ───────────────────────── Contexto de cada visita ────────────────────────

const ETIQUETA_TIPO: Record<string, string> = {
  vivienda_unifamiliar: 'Vivienda unifamiliar', vivienda_en_bloque: 'Vivienda en bloque', bloque_viviendas: 'Bloque de viviendas completo',
};

/** Resumen del expediente para la IA (sin datos personales del cliente). */
export function resumenExpediente(e: {
  tipo_edificio: string; direccion: string; municipio: string; provincia?: string | null;
  anio_construccion?: number | null; superficie_util?: number | null; referencia_catastral?: string | null;
}): string {
  return [
    ETIQUETA_TIPO[e.tipo_edificio] ?? e.tipo_edificio,
    `${e.direccion}, ${e.municipio}${e.provincia ? ` (${e.provincia})` : ''}`,
    e.anio_construccion ? `año de construcción ${e.anio_construccion}` : null,
    e.superficie_util ? `superficie útil del expediente ${e.superficie_util} m²` : null,
  ].filter(Boolean).join(' · ');
}

/** Lo que ya está en la toma de datos (para que la IA no lo repita ni lo contradiga sin motivo). */
export function resumenConocido(toma: TomaDatos, extra: string[] = []): string {
  const lineas = [...extra];
  const g = Object.entries(toma.generales).filter(([, v]) => v !== null && v !== '' && v !== undefined);
  if (g.length) lineas.push(`Datos generales ya tomados: ${g.map(([k, v]) => describirValor('generales', k, v as Valor)).join('; ')}`);
  for (const s of SECCIONES) {
    const filas = toma[s.clave];
    if (filas.length) lineas.push(`${s.titulo} ya registrados: ${filas.map((f, i) => s.titulo_fila(f, i)).join('; ')}`);
  }
  return lineas.join('\n');
}
