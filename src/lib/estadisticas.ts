// Cálculos del panel (módulo 6). Funciones puras para poder probarlas.

import { CALIFICACIONES, ESTADOS, type Estado, type Expediente } from './estados';

export function contarPorEstado(exps: Expediente[]): Record<Estado, number> {
  const r = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<Estado, number>;
  for (const e of exps) r[e.estado]++;
  return r;
}

export interface Mes {
  clave: string;       // AAAA-MM
  etiqueta: string;    // «sep 26»
  total: number;
}

/** Certificados firmados por mes en los últimos `meses` meses (incluido el actual). */
export function firmadosPorMes(exps: Expediente[], meses: number, hoy = new Date()): Mes[] {
  const r: Mes[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const clave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const etiqueta = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }).replace('.', '');
    r.push({ clave, etiqueta, total: 0 });
  }
  for (const e of exps) {
    const m = r.find((x) => e.fecha_firma?.startsWith(x.clave));
    if (m) m.total++;
  }
  return r;
}

export function firmadosPorAnio(exps: Expediente[]): { anio: string; total: number }[] {
  const m = new Map<string, number>();
  for (const e of exps) if (e.fecha_firma) m.set(e.fecha_firma.slice(0, 4), (m.get(e.fecha_firma.slice(0, 4)) ?? 0) + 1);
  return [...m].sort((a, b) => b[0].localeCompare(a[0])).map(([anio, total]) => ({ anio, total }));
}

export function distribucionCalificaciones(exps: Expediente[], campo: 'calificacion_consumo' | 'calificacion_emisiones') {
  const r = CALIFICACIONES.map((letra) => ({ letra, total: 0 }));
  for (const e of exps) {
    const l = e[campo];
    if (l) r.find((x) => x.letra === l)!.total++;
  }
  const max = Math.max(...r.map((x) => x.total));
  return { tramos: r, masFrecuente: max > 0 ? r.filter((x) => x.total === max).map((x) => x.letra) : [] };
}
