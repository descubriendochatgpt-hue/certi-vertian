// Envolvente e instalaciones en el .cex, copiando soluciones del catálogo.
//
// Cada cerramiento, hueco o instalación de la toma de datos se escribe como
// COPIA de una solución que CE3X ya guardó en un proyecto real (ver
// catalogo.ts). En la copia solo cambian el nombre, las medidas, la
// orientación (si es una que ya ha aparecido) y la potencia. Lo que no tiene
// una solución en el catálogo no se escribe: queda en «pendientes».
//
// Los puentes térmicos se generan con las mismas reglas que aplica CE3X al
// añadirlos por defecto (comprobadas con el proyecto de ejemplo): por cada
// fachada, pilares integrados, pilar en esquina y frente de forjado; por cada
// hueco, su contorno y, si tiene persiana, la caja.

import { type Py, PyDict, PyFloat, PyObject, leerPickles, texto } from './pickle';
import {
  type Solucion, mismoTipo, nuevoUuid, orientacionesVistas, serviciosDeInstalacion,
} from './catalogo';
import type { Fila, TomaDatos, Valor } from '../tomaDatos';
import { normalizar } from '../importarDatos';

const lista = (v: Py | undefined): Py[] => (Array.isArray(v) ? v : []);
const numero = (v: Valor | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const cadena = (v: Valor | undefined): string => (typeof v === 'string' ? v.trim() : '');
const redondear = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
/** Como Python escribe un real: «25.0», «12.5». */
const realPy = (n: number) => { const r = redondear(n); return Number.isInteger(r) ? `${r}.0` : String(r); };
/** Como lo teclea el técnico: «10», «2.5». */
const medida = (n: number) => String(redondear(n));

export const NOMBRE_ORIENTACION: Record<string, string> = {
  N: 'Norte', NE: 'Noreste', E: 'Este', SE: 'Sureste', S: 'Sur', SO: 'Suroeste', O: 'Oeste', NO: 'Noroeste',
};

// Solo para EMPAREJAR la toma de datos con soluciones del catálogo: nunca se
// escriben en el .cex (lo que se escribe es el texto de la solución).
const TIPO_CERRAMIENTO: Record<string, string[]> = {
  fachada: ['Fachada'], cubierta: ['Cubierta'], suelo: ['Suelo'], medianeria: ['Medianería', 'Medianeria'],
  particion_nh: ['Partición Interior', 'Particion Interior'],
};
const MARCO: Record<string, string[]> = {
  aluminio: ['Metálico sin RPT'], metalico: ['Metálico sin RPT'], aluminio_rpt: ['Metálico con RPT'], pvc: ['PVC'], madera: ['Madera'],
};
const VIDRIO: Record<string, string[]> = {
  simple: ['Simple'], doble: ['Doble'], doble_be: ['Doble bajo emisivo'], triple: ['Triple'],
};
const SERVICIOS: Record<string, number[]> = {
  acs: [0], calefaccion: [1], refrigeracion: [2], calefaccion_acs: [0, 1], calefaccion_refrigeracion: [1, 2], mixto_3: [0, 1, 2],
};
const GENERADOR: Record<string, string[]> = {
  efecto_joule: ['efecto joule'], caldera_estandar: ['caldera estandar'], caldera_baja_temp: ['caldera de baja temperatura'],
  caldera_condensacion: ['caldera de condensacion'], bomba_calor: ['bomba de calor'], caldera_biomasa: ['caldera de biomasa', 'biomasa'],
  equipo_split: ['equipo de expansion directa', 'expansion directa'], red_distrito: ['red de distrito'],
};
const COMBUSTIBLE: Record<string, string[]> = {
  electricidad: ['electricidad'], gas_natural: ['gas natural'], glp: ['glp'], gasoleo: ['gasoleo', 'gasoleo-c'], biomasa: ['biomasa'], carbon: ['carbon'],
};

const igual = (a: string, b: string) => normalizar(a) === normalizar(b);
const entre = (v: string, opciones: string[] | undefined) => !!opciones?.some((o) => igual(o, v));

/** La solución elegida para una fila: la indicada a mano o, si no, la única que encaja. */
export function solucionPara(seccion: 'cerramientos' | 'huecos' | 'instalaciones', fila: Fila, catalogo: Solucion[]): Solucion | undefined {
  const elegida = cadena(fila.solucionCe3x);
  if (elegida) return catalogo.find((s) => s.clave === elegida);
  const tipo = seccion === 'cerramientos' ? 'cerramiento' : seccion === 'huecos' ? 'hueco' : 'instalacion';
  let candidatas = catalogo.filter((s) => s.tipo === tipo);
  if (seccion === 'cerramientos') {
    candidatas = candidatas.filter((s) => entre(String(s.ce3x.tipo), TIPO_CERRAMIENTO[cadena(fila.tipo)]));
    const u = numero(fila.u);
    if (u !== undefined) candidatas = candidatas.filter((s) => Math.abs(Number(s.ce3x.u) - u) < 0.006);
    else candidatas = candidatas.filter((s) => s.ce3x.modo === 'Por defecto');
  } else if (seccion === 'huecos') {
    if (!fila.tipoMarco || !fila.tipoVidrio) return undefined;
    candidatas = candidatas.filter((s) => entre(String(s.ce3x.tipoMarco), MARCO[cadena(fila.tipoMarco)])
      && entre(String(s.ce3x.tipoVidrio), VIDRIO[cadena(fila.tipoVidrio)]));
    if (fila.proteccionSolar) candidatas = candidatas.filter((s) => (s.ce3x.proteccion === 1) === (fila.proteccionSolar !== 'ninguna'));
  } else {
    const servicios = SERVICIOS[cadena(fila.servicio)];
    if (!servicios || !fila.generador || !fila.combustible) return undefined;
    candidatas = candidatas.filter((s) => s.ce3x.servicios === servicios.join(',')
      && entre(String(s.ce3x.generador), GENERADOR[cadena(fila.generador)])
      && entre(String(s.ce3x.combustible), COMBUSTIBLE[cadena(fila.combustible)]));
  }
  return candidatas.length === 1 ? candidatas[0] : undefined;
}

export interface Colocado {
  etiqueta: string;
  valor: string;
}

interface Contexto {
  catalogo: Solucion[];
  pendientes: string[];
  colocados: Colocado[];
  superficieUtil: number | undefined;
  alturaLibre: number | undefined;
}

const atributos = (o: PyObject) => o.state as PyDict;
const ponerAtr = (o: PyObject, k: string, v: string) => atributos(o).set(k, mismoTipo(atributos(o).get(k), v));

interface CerramientoEscrito { nombre: string; orientacion: string; tipo: string; longitud?: number; altura?: number; multiplicador: number }

/**
 * Escribe la envolvente y las instalaciones en los bloques de la plantilla
 * (que deben estar vacíos). Devuelve lo colocado; lo demás va a pendientes.
 */
export function ponerElementos(bloques: Py[], toma: TomaDatos, catalogo: Solucion[], pendientes: string[]): Colocado[] {
  const g = toma.generales;
  const ctx: Contexto = {
    catalogo, pendientes, colocados: [],
    superficieUtil: numero(g.superficieUtil), alturaLibre: numero(g.alturaLibre),
  };
  const env = lista(bloques[3]);
  const inst = lista(bloques[4]);
  if (!Array.isArray(env[0]) || !Array.isArray(env[1]) || !Array.isArray(env[2]) || inst.length < 2) {
    if (toma.cerramientos.length || toma.huecos.length || toma.instalaciones.length) {
      pendientes.push('Envolvente e instalaciones: la plantilla no tiene la estructura esperada; introdúcelas en CE3X con la ficha.');
    }
    return [];
  }
  const vistas = orientacionesVistas(catalogo);
  const escritos = ponerCerramientos(env[0] as Py[], bloques, toma.cerramientos, vistas, ctx);
  const huecos = ponerHuecos(env[1] as Py[], toma.huecos, escritos, ctx);
  ponerPuentes(env[2] as Py[], escritos, huecos, ctx);
  if (toma.puentesTermicos.length) {
    pendientes.push(`Puentes térmicos anotados en la visita (${toma.puentesTermicos.length}): compáralos con los generados en CE3X.`);
  }
  ponerInstalaciones(inst, toma.instalaciones, ctx);
  return ctx.colocados;
}

function ponerCerramientos(destino: Py[], bloques: Py[], filas: Fila[], vistas: Set<string>, ctx: Contexto): CerramientoEscrito[] {
  const escritos: CerramientoEscrito[] = [];
  const usados = new Set<string>();
  filas.forEach((f, i) => {
    const nombreTipo = cadena(f.tipo) || 'cerramiento';
    let nombre = cadena(f.nombre) || `${nombreTipo.charAt(0).toUpperCase()}${nombreTipo.slice(1)} ${f.orientacion ? String(f.orientacion) : i + 1}`;
    while (usados.has(normalizar(nombre))) nombre += ' bis';
    const sol = solucionPara('cerramientos', f, ctx.catalogo);
    if (!sol) {
      ctx.pendientes.push(`Cerramiento «${nombre}»: no hay en el catálogo una solución de CE3X que encaje${numero(f.u) ? ` (U ${numero(f.u)})` : ''}; introdúcelo en CE3X.`);
      return;
    }
    const el = leerPickles(sol.datos)[0] as Py[];
    // Medidas: longitud × altura (× multiplicador) = superficie
    const mult = Number(texto(el[12]) || 1) || 1;
    let altura = numero(f.altura) ?? numero(texto(el[11]) ? Number(texto(el[11])) : undefined) ?? ctx.alturaLibre;
    let longitud = numero(f.longitud);
    let superficie = numero(f.superficie);
    if (superficie === undefined && longitud !== undefined && altura !== undefined) superficie = longitud * altura * mult;
    if (superficie === undefined) {
      ctx.pendientes.push(`Cerramiento «${nombre}»: falta la superficie (o largo y alto); introdúcelo en CE3X.`);
      return;
    }
    if (longitud === undefined && altura !== undefined) longitud = superficie / (altura * mult);
    if (longitud === undefined || altura === undefined) { longitud = superficie; altura = 1; }
    // Composición de la librería: se copia al proyecto si aún no está
    if (sol.composicion) {
      const lib = bloques[8];
      if (!Array.isArray(lib)) {
        ctx.pendientes.push(`Cerramiento «${nombre}»: la plantilla no tiene librería de cerramientos; introdúcelo en CE3X.`);
        return;
      }
      const comp = leerPickles(sol.composicion)[0] as PyObject;
      const nombreComp = texto((comp.state as PyDict).get('nombre'));
      if (!lib.some((c) => c instanceof PyObject && texto((c.state as PyDict | undefined)?.get('nombre')) === nombreComp)) lib.push(comp);
    }
    usados.add(normalizar(nombre));
    el[0] = mismoTipo(el[0], nombre);
    el[2] = mismoTipo(el[2], realPy(superficie));
    let orientacion = texto(el[5]) ?? '';
    if (orientacion) {
      const pedida = NOMBRE_ORIENTACION[cadena(f.orientacion)];
      if (pedida && vistas.has(pedida)) orientacion = pedida;
      else ctx.pendientes.push(`Cerramiento «${nombre}»: pon la orientación${pedida ? ` ${pedida}` : ''} en CE3X (se ha escrito ${orientacion} provisionalmente)`);
      el[5] = mismoTipo(el[5], orientacion);
    }
    if (texto(el[7]) !== undefined) el[7] = mismoTipo(el[7], 'Sin patrón');
    el[10] = mismoTipo(el[10], medida(longitud));
    el[11] = mismoTipo(el[11], medida(altura));
    destino.push(el);
    const tipo = texto(el[1]) ?? '';
    escritos.push({ nombre, orientacion, tipo, longitud, altura, multiplicador: mult });
    ctx.colocados.push({ etiqueta: `Cerramiento «${nombre}»`, valor: `${realPy(superficie)} m² · ${sol.etiqueta}` });
  });
  return escritos;
}

interface HuecoEscrito { nombre: string; muro: string; alto: number; ancho: number; cantidad: number; persiana: boolean }

function ponerHuecos(destino: Py[], filas: Fila[], muros: CerramientoEscrito[], ctx: Contexto): HuecoEscrito[] {
  const escritos: HuecoEscrito[] = [];
  let avisoSombras = false;
  filas.forEach((f, i) => {
    const nombre = cadena(f.nombre) || `Hueco ${i + 1}`;
    const sol = solucionPara('huecos', f, ctx.catalogo);
    if (!sol) {
      ctx.pendientes.push(`Hueco «${nombre}»: no hay en el catálogo una ventana de CE3X que encaje; introdúcelo en CE3X.`);
      return;
    }
    // Cerramiento en el que está: por nombre o, si no, el único de esa orientación
    const pedido = cadena(f.cerramiento);
    let muro = pedido ? muros.find((m) => igual(m.nombre, pedido)) : undefined;
    if (!muro && f.orientacion) {
      const deEsa = muros.filter((m) => m.orientacion === NOMBRE_ORIENTACION[cadena(f.orientacion)]);
      if (deEsa.length === 1) muro = deEsa[0];
    }
    if (!muro) {
      ctx.pendientes.push(`Hueco «${nombre}»: no se sabe en qué cerramiento está${pedido ? ` («${pedido}» no se ha escrito)` : ''}; introdúcelo en CE3X.`);
      return;
    }
    const cantidad = Math.max(1, Math.round(numero(f.cantidad) ?? 1));
    let alto = numero(f.alto), ancho = numero(f.ancho);
    if (alto === undefined || ancho === undefined) {
      const s = numero(f.superficie);
      if (s === undefined) {
        ctx.pendientes.push(`Hueco «${nombre}»: faltan sus medidas; introdúcelo en CE3X.`);
        return;
      }
      alto = ancho = redondear(Math.sqrt(s), 2);
      ctx.pendientes.push(`Hueco «${nombre}»: solo se tenía la superficie (${s} m²); pon el alto y el ancho reales en CE3X.`);
    }
    const h = leerPickles(sol.datos)[0] as PyObject;
    const at = atributos(h);
    ponerAtr(h, 'descripcion', nombre);
    ponerAtr(h, 'altura', medida(alto));
    ponerAtr(h, 'longitud', medida(ancho));
    ponerAtr(h, 'multiplicador', String(cantidad));
    ponerAtr(h, 'superficie', medida(alto * ancho * cantidad));
    ponerAtr(h, 'orientacion', muro.orientacion);
    ponerAtr(h, 'cerramientoAsociado', muro.nombre);
    ponerAtr(h, 'patronSombras', 'Sin patrón');
    // CE3X guarda «correctorSolar» con la orientación salvo en los huecos a norte
    if (muro.orientacion === 'Norte') at.entries = at.entries.filter(([k]) => texto(k) !== 'correctorSolar');
    else if (at.get('correctorSolar') !== undefined) ponerAtr(h, 'correctorSolar', muro.orientacion);
    else at.set('correctorSolar', muro.orientacion);
    const prot = at.get('elementosProteccionSolar');
    if (Array.isArray(prot)) {
      if (texto(prot[3]) !== undefined) prot[3] = mismoTipo(prot[3], medida(alto));
      if (texto(prot[4]) !== undefined) prot[4] = mismoTipo(prot[4], medida(ancho));
    }
    const id = at.get('id');
    if (id instanceof PyObject && id.state instanceof PyDict) id.state.set('int', nuevoUuid());
    destino.push(h);
    avisoSombras = true;
    const persiana = f.proteccionSolar ? f.proteccionSolar === 'persiana' : sol.ce3x.proteccion === 1;
    escritos.push({ nombre, muro: muro.nombre, alto, ancho, cantidad, persiana });
    ctx.colocados.push({ etiqueta: `Hueco «${nombre}»`, valor: `${cantidad} × ${medida(alto)} × ${medida(ancho)} m en ${muro.nombre} · ${sol.etiqueta}` });
  });
  if (avisoSombras) {
    ctx.pendientes.push('Huecos: abre cada uno en CE3X, asigna el patrón de sombras si lo hay y pulsa «Modificar» para que recalcule sus factores solares.');
  }
  return escritos;
}

function ponerPuentes(destino: Py[], muros: CerramientoEscrito[], huecos: HuecoEscrito[], ctx: Contexto) {
  const puente = (tipo: string) => ctx.catalogo.find((s) => s.tipo === 'puente' && s.ce3x.tipo === tipo);
  const faltan = new Set<string>();
  const anadir = (tipo: string, nombre: string, longitud: number, muro: string) => {
    const sol = puente(tipo);
    if (!sol) { faltan.add(tipo); return; }
    const el = leerPickles(sol.datos)[0] as Py[];
    el[0] = mismoTipo(el[0], `PT ${tipo}-${nombre}`);
    el[4] = new PyFloat(redondear(longitud));
    el[7] = mismoTipo(el[7], muro);
    destino.push(el);
  };
  let n = 0;
  for (const m of muros) {
    if (m.tipo !== 'Fachada' || m.longitud === undefined || m.altura === undefined) continue;
    anadir('Pilar integrado en fachada', m.nombre, (Math.ceil(m.longitud / 5 - 1e-9) + 1) * m.altura * m.multiplicador, m.nombre);
    anadir('Pilar en Esquina', m.nombre, m.altura * m.multiplicador, m.nombre);
    anadir('Encuentro de fachada con forjado', m.nombre, m.longitud * m.multiplicador, m.nombre);
    n += 3;
  }
  for (const h of huecos) {
    anadir('Contorno de hueco', h.nombre, 2 * (h.alto + h.ancho) * h.cantidad, h.muro);
    n += 1;
    if (h.persiana) { anadir('Caja de Persiana', h.nombre, h.ancho * h.cantidad, h.muro); n += 1; }
  }
  if (n) {
    ctx.colocados.push({ etiqueta: 'Puentes térmicos', valor: `${destino.length} generados con los valores por defecto de CE3X (pilares, esquinas, forjados, contornos y cajas de persiana)` });
    ctx.pendientes.push('Puentes térmicos: comprueba en CE3X que los valores por defecto (ψ) corresponden a estos cerramientos.');
  }
  for (const t of faltan) ctx.pendientes.push(`Puentes térmicos «${t}»: no están en el catálogo; añádelos en CE3X.`);
}

function ponerInstalaciones(inst: Py[], filas: Fila[], ctx: Contexto) {
  filas.forEach((f, i) => {
    const sol = solucionPara('instalaciones', f, ctx.catalogo);
    const descripcion = [f.servicio, f.generador, f.combustible].filter(Boolean).join(' · ') || `instalación ${i + 1}`;
    if (!sol) {
      ctx.pendientes.push(`Instalación (${descripcion}): no hay en el catálogo un equipo de CE3X que encaje; introdúcela en CE3X.`);
      return;
    }
    const parte = Number(sol.ce3x.parte);
    if (!Array.isArray(inst[parte])) {
      ctx.pendientes.push(`Instalación (${descripcion}): la plantilla no tiene ese apartado; introdúcela en CE3X.`);
      return;
    }
    if (ctx.superficieUtil === undefined) {
      ctx.pendientes.push(`Instalación (${descripcion}): falta la superficie útil (cálculo CTE DB-HE) para la cobertura; introdúcela en CE3X.`);
      return;
    }
    const el = leerPickles(sol.datos)[0] as Py[];
    const cobertura = numero(f.cobertura) ?? 100;
    const potenciaLista = el[el.length - 2];
    let potencia = false;
    for (const k of serviciosDeInstalacion(el)) {
      const cob = lista(el[2]);
      cob[k] = new PyFloat(cobertura);
      const sup = lista(lista(el[5])[k]);
      if (sup.length >= 2) {
        sup[0] = mismoTipo(sup[0], medida(ctx.superficieUtil));
        sup[1] = mismoTipo(sup[1], medida(cobertura));
      }
      const kw = numero(f.potencia);
      if (kw !== undefined && Array.isArray(potenciaLista) && texto(potenciaLista[k]) !== undefined) {
        potenciaLista[k] = mismoTipo(potenciaLista[k], medida(kw));
        potencia = true;
      }
      const rend = numero(f.rendimiento);
      const rendimientos = lista(lista(el[7])[0]);
      if (rend !== undefined && (f.unidadRendimiento ?? 'porcentaje') === 'porcentaje' && texto(rendimientos[k]) !== undefined) {
        rendimientos[k] = mismoTipo(rendimientos[k], realPy(rend));
      }
    }
    (inst[parte] as Py[]).push(el);
    if (!potencia) ctx.pendientes.push(`Instalación «${texto(el[0])}»: pon la potencia en CE3X (no se tomó en la visita).`);
    ctx.colocados.push({ etiqueta: `Instalación «${texto(el[0])}»`, valor: `${sol.etiqueta}${numero(f.potencia) ? ` · ${numero(f.potencia)} kW` : ''} · cobertura ${cobertura} %` });
  });
}
