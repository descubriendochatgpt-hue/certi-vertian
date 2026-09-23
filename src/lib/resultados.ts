// Resultados del cálculo y checklist previo a la firma (módulo 4).
//
// Las «comprobaciones de apoyo» comparan el certificado con el expediente y
// la toma de datos para ayudar en la revisión. NUNCA marcan un punto del
// checklist: cada punto lo marca el técnico a mano.

import type { DatosCertificado, Letra, Parciales } from './certificadoPdf';
import { letraCoherente } from './certificadoPdf';
import { type Expediente, NOMBRE_TIPO_EDIFICIO } from './estados';
import { fecha } from './fechas';
import type { TomaDatos } from './tomaDatos';
import { type Aviso, comprobarNif, formatearNumero, normalizarCodigo } from './validaciones';

export interface Recomendacion {
  id: string;
  descripcion: string;
  calificacion_consumo: Letra | null;
  calificacion_emisiones: Letra | null;
  ahorro: number | null;   // % de ahorro estimado
}

export interface DetalleResultados {
  /** Lo leído del certificado tal cual, para las comprobaciones. */
  certificado?: DatosCertificado;
  parcialesConsumo?: Parciales;
  parcialesEmisiones?: Parciales;
  emisionesElectricas?: number | null;
  emisionesOtrosCombustibles?: number | null;
}

export interface Resultados {
  origen: 'manual' | 'pdf' | 'xml';
  fichero_origen: string | null;
  programa: string | null;
  fecha_certificado: string | null;
  consumo_ep_nr: number | null;
  calificacion_consumo: Letra | null;
  emisiones_co2: number | null;
  calificacion_emisiones: Letra | null;
  demanda_calefaccion: number | null;
  calificacion_demanda_calefaccion: Letra | null;
  demanda_refrigeracion: number | null;
  calificacion_demanda_refrigeracion: Letra | null;
  detalle: DetalleResultados;
  recomendaciones: Recomendacion[];
  justificacion_sin_recomendaciones: string | null;
  avisos_confirmados: string[];
  confirmado_en?: string | null;
  actualizado_en?: string | null;
}

export function resultadosVacios(): Resultados {
  return {
    origen: 'manual', fichero_origen: null, programa: null, fecha_certificado: null,
    consumo_ep_nr: null, calificacion_consumo: null, emisiones_co2: null, calificacion_emisiones: null,
    demanda_calefaccion: null, calificacion_demanda_calefaccion: null,
    demanda_refrigeracion: null, calificacion_demanda_refrigeracion: null,
    detalle: {}, recomendaciones: [], justificacion_sin_recomendaciones: null, avisos_confirmados: [],
  };
}

/** Rellena los resultados con lo leído del PDF. Lo que no se leyó se deja como estaba. */
export function aplicarCertificado(r: Resultados, c: DatosCertificado, nombreFichero: string): Resultados {
  const o = <T,>(nuevo: T | null, viejo: T | null) => (nuevo ?? viejo);
  return {
    ...r,
    origen: 'pdf',
    fichero_origen: nombreFichero,
    programa: o(c.programa, r.programa),
    fecha_certificado: o(c.fechaCertificado, r.fecha_certificado),
    consumo_ep_nr: o(c.consumo.valor, r.consumo_ep_nr),
    calificacion_consumo: o(c.consumo.letra, r.calificacion_consumo),
    emisiones_co2: o(c.emisiones.valor, r.emisiones_co2),
    calificacion_emisiones: o(c.emisiones.letra, r.calificacion_emisiones),
    demanda_calefaccion: o(c.demandaCalefaccion.valor, r.demanda_calefaccion),
    calificacion_demanda_calefaccion: o(c.demandaCalefaccion.letra, r.calificacion_demanda_calefaccion),
    demanda_refrigeracion: o(c.demandaRefrigeracion.valor, r.demanda_refrigeracion),
    calificacion_demanda_refrigeracion: o(c.demandaRefrigeracion.letra, r.calificacion_demanda_refrigeracion),
    detalle: {
      certificado: c,
      parcialesConsumo: c.parcialesConsumo,
      parcialesEmisiones: c.parcialesEmisiones,
      emisionesElectricas: c.emisionesElectricas,
      emisionesOtrosCombustibles: c.emisionesOtrosCombustibles,
    },
  };
}

const igualTexto = (a: string, b: string) =>
  a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  === b.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ─────────────────────── avisos al registrar resultados ──────────────────────

export function avisosResultados(r: Resultados, e: Expediente): { errores: string[]; avisos: Aviso[] } {
  const errores: string[] = [];
  const avisos: Aviso[] = [];
  const c = r.detalle.certificado;

  if (r.consumo_ep_nr === null || !r.calificacion_consumo) errores.push('Falta el consumo de energía primaria no renovable y su calificación.');
  if (r.emisiones_co2 === null || !r.calificacion_emisiones) errores.push('Faltan las emisiones de CO₂ y su calificación.');

  if (r.consumo_ep_nr !== null && r.emisiones_co2 !== null && r.consumo_ep_nr < r.emisiones_co2) {
    avisos.push({ clave: `consumo<emisiones=${r.consumo_ep_nr}/${r.emisiones_co2}`, mensaje: `El consumo (${formatearNumero(r.consumo_ep_nr)} kWh/m²·año) es menor que las emisiones (${formatearNumero(r.emisiones_co2)} kgCO₂/m²·año); lo habitual es lo contrario. ¿Están intercambiados?` });
  }
  if (c) {
    const coh = letraCoherente({ valor: r.consumo_ep_nr, letra: r.calificacion_consumo }, c.escalaConsumo);
    if (coh === false) avisos.push({ clave: `escala.consumo=${r.consumo_ep_nr}${r.calificacion_consumo}`, mensaje: `Según la escala del propio certificado, ${formatearNumero(r.consumo_ep_nr!)} kWh/m²·año no corresponde a la letra ${r.calificacion_consumo}.` });
    const cohE = letraCoherente({ valor: r.emisiones_co2, letra: r.calificacion_emisiones }, c.escalaEmisiones);
    if (cohE === false) avisos.push({ clave: `escala.emisiones=${r.emisiones_co2}${r.calificacion_emisiones}`, mensaje: `Según la escala del propio certificado, ${formatearNumero(r.emisiones_co2!)} kgCO₂/m²·año no corresponde a la letra ${r.calificacion_emisiones}.` });

    const cambiado: string[] = [];
    if (c.consumo.valor !== null && r.consumo_ep_nr !== c.consumo.valor) cambiado.push('consumo');
    if (c.consumo.letra && r.calificacion_consumo !== c.consumo.letra) cambiado.push('calificación de consumo');
    if (c.emisiones.valor !== null && r.emisiones_co2 !== c.emisiones.valor) cambiado.push('emisiones');
    if (c.emisiones.letra && r.calificacion_emisiones !== c.emisiones.letra) cambiado.push('calificación de emisiones');
    if (cambiado.length) avisos.push({ clave: `difiere_pdf=${cambiado.join(',')}/${r.consumo_ep_nr}${r.calificacion_consumo}${r.emisiones_co2}${r.calificacion_emisiones}`, mensaje: `Has cambiado ${cambiado.join(', ')} respecto a lo que dice el PDF del certificado.` });

    if (c.referenciaCatastral && e.referencia_catastral && normalizarCodigo(c.referenciaCatastral) !== normalizarCodigo(e.referencia_catastral)) {
      avisos.push({ clave: `rc=${c.referenciaCatastral}`, mensaje: `La referencia catastral del certificado (${c.referenciaCatastral}) no coincide con la del expediente (${e.referencia_catastral}).` });
    }
    if (c.fechaVisita && e.fecha_visita && c.fechaVisita !== e.fecha_visita) {
      avisos.push({ clave: `fecha_visita=${c.fechaVisita}`, mensaje: `La fecha de visita del certificado (${fecha(c.fechaVisita)}) no coincide con la del expediente (${fecha(e.fecha_visita)}).` });
    }
  }
  if (r.fecha_certificado && e.fecha_visita && r.fecha_certificado < e.fecha_visita) {
    avisos.push({ clave: `fecha_certificado<visita=${r.fecha_certificado}`, mensaje: `La fecha del certificado (${fecha(r.fecha_certificado)}) es anterior a la de la visita (${fecha(e.fecha_visita)}).` });
  }
  if (r.recomendaciones.length === 0 && !r.justificacion_sin_recomendaciones?.trim()) {
    avisos.push({ clave: 'sin_recomendaciones', mensaje: 'No hay recomendaciones de mejora ni justificación de que no existan medidas viables (el RD 390/2021 las exige en el certificado).' });
  }
  for (const rec of r.recomendaciones) {
    if (!rec.descripcion.trim()) errores.push('Hay una recomendación sin descripción.');
  }
  return { errores: [...new Set(errores)], avisos };
}

// ─────────────────────── apoyo al checklist de revisión ─────────────────────

export type EstadoApoyo = 'coincide' | 'revisar' | 'sin_datos' | 'info';
export interface Apoyo {
  estado: EstadoApoyo;
  texto: string;
}

export interface Contexto {
  expediente: Expediente;
  toma: TomaDatos | null;
  resultados: Resultados | null;
  tiposAdjuntos: string[];
}

export function comprobacionesDeApoyo(ctx: Contexto): Record<string, Apoyo> {
  const e = ctx.expediente;
  const r = ctx.resultados;
  const c = r?.detalle.certificado;
  const sinCert: Apoyo = { estado: 'sin_datos', texto: 'No se ha importado el PDF del certificado: compruébalo a mano.' };
  const a: Record<string, Apoyo> = {};

  a.ref_catastral = !c?.referenciaCatastral ? sinCert
    : !e.referencia_catastral ? { estado: 'revisar', texto: `El certificado dice ${c.referenciaCatastral}, pero el expediente no tiene referencia catastral.` }
    : normalizarCodigo(c.referenciaCatastral) === normalizarCodigo(e.referencia_catastral)
      ? { estado: 'coincide', texto: `Certificado y expediente: ${c.referenciaCatastral}.` }
      : { estado: 'revisar', texto: `Certificado: ${c.referenciaCatastral} · Expediente: ${e.referencia_catastral}.` };

  if (!c) a.direccion = sinCert;
  else {
    const difs: string[] = [];
    if (c.municipio && !igualTexto(c.municipio, e.municipio)) difs.push(`municipio «${c.municipio}» / «${e.municipio}»`);
    if (c.codigoPostal && e.codigo_postal && c.codigoPostal !== e.codigo_postal) difs.push(`CP ${c.codigoPostal} / ${e.codigo_postal}`);
    a.direccion = difs.length
      ? { estado: 'revisar', texto: `No coincide: ${difs.join('; ')}. Dirección del certificado: «${c.direccion ?? '—'}».` }
      : { estado: 'coincide', texto: `Municipio y CP coinciden. Compara la dirección: certificado «${c.direccion ?? '—'}» · expediente «${e.direccion}».` };
  }

  a.tipo_edificio = !c ? sinCert
    : !c.tipoEdificio ? { estado: 'revisar', texto: `No se ha podido deducir el tipo del certificado (${c.tipoEdificioTexto ?? 'sin marcar'}).` }
    : c.tipoEdificio === e.tipo_edificio
      ? { estado: 'coincide', texto: `${NOMBRE_TIPO_EDIFICIO[e.tipo_edificio]}.` }
      : { estado: 'revisar', texto: `Certificado: ${NOMBRE_TIPO_EDIFICIO[c.tipoEdificio]} · Expediente: ${NOMBRE_TIPO_EDIFICIO[e.tipo_edificio]}.` };

  const supVisita = typeof ctx.toma?.generales.superficieUtil === 'number' ? ctx.toma.generales.superficieUtil : null;
  a.superficie = !c?.superficieHabitable ? sinCert
    : supVisita === null ? { estado: 'revisar', texto: `Certificado: ${formatearNumero(c.superficieHabitable)} m². La toma de datos no tiene superficie.` }
    : Math.abs(c.superficieHabitable - supVisita) <= Math.max(0.5, supVisita * 0.01)
      ? { estado: 'coincide', texto: `${formatearNumero(c.superficieHabitable)} m² en ambos.` }
      : { estado: 'revisar', texto: `Certificado: ${formatearNumero(c.superficieHabitable)} m² · Visita: ${formatearNumero(supVisita)} m².` };

  const t = ctx.toma;
  a.envolvente_instalaciones = {
    estado: 'info',
    texto: t ? `En la toma de datos: ${t.cerramientos.length} cerramiento(s), ${t.huecos.length} hueco(s), ${t.instalaciones.length} instalación(es). Compáralos con el Anexo I.` : 'No hay toma de datos.',
  };

  a.fecha_visita = !c?.fechaVisita ? sinCert
    : !e.fecha_visita ? { estado: 'revisar', texto: 'El expediente no tiene fecha de visita.' }
    : c.fechaVisita === e.fecha_visita
      ? { estado: 'coincide', texto: `${fecha(c.fechaVisita)}.` }
      : { estado: 'revisar', texto: `Certificado: ${fecha(c.fechaVisita)} · Expediente: ${fecha(e.fecha_visita)}.` };

  a.fecha_certificado = !r?.fecha_certificado ? { estado: 'sin_datos', texto: 'Los resultados no tienen fecha del certificado.' }
    : !e.fecha_visita ? { estado: 'revisar', texto: 'El expediente no tiene fecha de visita.' }
    : r.fecha_certificado >= e.fecha_visita
      ? { estado: 'coincide', texto: `Certificado ${fecha(r.fecha_certificado)} · visita ${fecha(e.fecha_visita)}.` }
      : { estado: 'revisar', texto: `El certificado (${fecha(r.fecha_certificado)}) es anterior a la visita (${fecha(e.fecha_visita)}).` };

  if (!c || !r) a.calificacion = sinCert;
  else {
    const iguales = c.consumo.valor === r.consumo_ep_nr && c.consumo.letra === r.calificacion_consumo
      && c.emisiones.valor === r.emisiones_co2 && c.emisiones.letra === r.calificacion_emisiones;
    const txt = `Certificado: ${c.consumo.valor ?? '—'} ${c.consumo.letra ?? ''} / ${c.emisiones.valor ?? '—'} ${c.emisiones.letra ?? ''} · Registrado: ${r.consumo_ep_nr ?? '—'} ${r.calificacion_consumo ?? ''} / ${r.emisiones_co2 ?? '—'} ${r.calificacion_emisiones ?? ''}.`;
    a.calificacion = { estado: iguales ? 'coincide' : 'revisar', texto: txt };
  }

  a.recomendaciones = c?.sinRecomendaciones
    ? { estado: 'revisar', texto: 'El Anexo III del PDF dice «Apartado no definido»: el certificado no incluye recomendaciones.' }
    : r && r.recomendaciones.length > 0 ? { estado: 'coincide', texto: `${r.recomendaciones.length} recomendación(es) registradas.` }
    : r?.justificacion_sin_recomendaciones?.trim() ? { estado: 'info', texto: `Justificación: «${r.justificacion_sin_recomendaciones.trim()}».` }
    : { estado: 'revisar', texto: 'No hay recomendaciones registradas.' };

  a.fichero_calculo = ctx.tiposAdjuntos.includes('fichero_calculo')
    ? { estado: 'coincide', texto: 'Hay un fichero de cálculo adjunto.' }
    : { estado: 'revisar', texto: 'No hay ningún fichero de cálculo adjunto (súbelo en «Documentos»).' };
  a.certificado_pdf = ctx.tiposAdjuntos.includes('certificado_pdf')
    ? { estado: 'coincide', texto: 'Hay un PDF del certificado adjunto.' }
    : { estado: 'revisar', texto: 'No hay ningún PDF del certificado adjunto (súbelo en «Documentos»).' };

  if (!c) a.datos_tecnico = sinCert;
  else {
    const nif = c.tecnicoNif ? comprobarNif(c.tecnicoNif) : null;
    a.datos_tecnico = {
      estado: nif && nif.tipo !== 'ok' ? 'revisar' : 'info',
      texto: `${c.tecnicoNombre ?? '—'} · NIF ${c.tecnicoNif ?? '—'} · ${c.tecnicoTitulacion ?? '—'}${nif && nif.tipo !== 'ok' ? ` (${nif.mensaje})` : ''}.`,
    };
  }
  return a;
}
