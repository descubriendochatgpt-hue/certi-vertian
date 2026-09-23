/** Fecha de hoy en formato AAAA-MM-DD, en hora local (no UTC). */
export function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «2026-09-23» → «23/09/2026». */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

/** Días desde hoy hasta la fecha (negativo si ya pasó). */
export function diasHasta(iso: string): number {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const objetivo = new Date(a!, m! - 1, d!);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((objetivo.getTime() - hoy.getTime()) / 86_400_000);
}

/** Suma meses a hoy y devuelve AAAA-MM-DD. */
export function dentroDeMeses(meses: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
