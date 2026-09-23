// Acceso a los datos. Todas las consultas van con la sesión del técnico, así
// que las políticas RLS deciden qué se puede leer y escribir.

import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AnotacionHistorial, Calificacion, Estado, Expediente } from './estados';
import { type TomaDatos, VERSION_ESQUEMA, normalizarTomaDatos } from './tomaDatos';

export class ErrorDatos extends Error {}

function traducir(e: PostgrestError | Error): ErrorDatos {
  const m = e.message ?? String(e);
  if (/row-level security|permission denied/i.test(m)) {
    return new ErrorDatos('No tienes permiso para esta operación. Vuelve a entrar con la verificación en dos pasos.');
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return new ErrorDatos('Sin conexión con el servidor. Comprueba la conexión a internet.');
  }
  if (/JWT expired/i.test(m)) return new ErrorDatos('La sesión ha caducado. Vuelve a entrar.');
  // Los mensajes de los triggers y de cambiar_estado ya vienen en español.
  return new ErrorDatos(m);
}

function comprobar<T>(r: { data: T; error: PostgrestError | null }): T {
  if (r.error) throw traducir(r.error);
  return r.data;
}

// ─────────────────────────────── Expedientes ──────────────────────────────

export interface FiltrosExpedientes {
  estado?: Estado | '';
  municipio?: string;
  desde?: string;   // fecha de visita
  hasta?: string;
  texto?: string;
}

export async function listarExpedientes(f: FiltrosExpedientes = {}): Promise<Expediente[]> {
  let q = supabase.from('expedientes').select('*').order('creado_en', { ascending: false }).limit(1000);
  if (f.estado) q = q.eq('estado', f.estado);
  if (f.municipio) q = q.ilike('municipio', f.municipio);
  if (f.desde) q = q.gte('fecha_visita', f.desde);
  if (f.hasta) q = q.lte('fecha_visita', f.hasta);
  if (f.texto?.trim()) {
    // Se quitan los caracteres que tienen significado en el filtro de PostgREST.
    const t = f.texto.trim().replace(/[,()*%\\]/g, ' ');
    q = q.or(`codigo.ilike.*${t}*,direccion.ilike.*${t}*,propietario_nombre.ilike.*${t}*,referencia_catastral.ilike.*${t}*`);
  }
  return comprobar(await q) as Expediente[];
}

/** Expedientes con fecha de vencimiento, para las alertas. */
export async function listarVencimientos(hasta: string): Promise<Expediente[]> {
  return comprobar(
    await supabase.from('expedientes').select('*').not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', hasta).order('fecha_vencimiento'),
  ) as Expediente[];
}

export async function listarMunicipios(): Promise<string[]> {
  const filas = comprobar(await supabase.from('expedientes').select('municipio')) as { municipio: string }[];
  return [...new Set(filas.map((f) => f.municipio))].sort((a, b) => a.localeCompare(b, 'es'));
}

export async function obtenerExpediente(id: string): Promise<Expediente | null> {
  return comprobar(await supabase.from('expedientes').select('*').eq('id', id).maybeSingle()) as Expediente | null;
}

export type DatosExpediente = Pick<
  Expediente,
  | 'direccion' | 'municipio' | 'codigo_postal' | 'referencia_catastral' | 'tipo_edificio'
  | 'superficie_util' | 'anio_construccion' | 'propietario_nombre' | 'propietario_nif'
  | 'propietario_telefono' | 'propietario_email' | 'fecha_visita' | 'notas' | 'avisos_confirmados'
>;

export async function crearExpediente(d: DatosExpediente): Promise<Expediente> {
  return comprobar(await supabase.from('expedientes').insert(d).select().single()) as Expediente;
}

export async function actualizarExpediente(id: string, d: DatosExpediente): Promise<Expediente> {
  return comprobar(await supabase.from('expedientes').update(d).eq('id', id).select().single()) as Expediente;
}

export async function borrarExpediente(id: string): Promise<void> {
  const r = await supabase.from('expedientes').delete().eq('id', id).select('id');
  const filas = comprobar(r) as { id: string }[];
  if (filas.length === 0) throw new ErrorDatos('Solo se pueden borrar expedientes en «Visita pendiente».');
}

export async function historial(id: string): Promise<AnotacionHistorial[]> {
  return comprobar(
    await supabase.from('historial_estados').select('*').eq('expediente_id', id).order('creado_en').order('id'),
  ) as AnotacionHistorial[];
}

export interface CambioEstado {
  destino: Estado;
  nota?: string;
  fecha?: string;
  calificacionConsumo?: Calificacion;
  calificacionEmisiones?: Calificacion;
  numeroRegistro?: string;
}

export async function cambiarEstado(id: string, c: CambioEstado): Promise<Expediente> {
  return comprobar(
    await supabase.rpc('cambiar_estado', {
      p_expediente: id,
      p_destino: c.destino,
      p_nota: c.nota ?? null,
      p_fecha: c.fecha ?? null,
      p_calificacion_consumo: c.calificacionConsumo ?? null,
      p_calificacion_emisiones: c.calificacionEmisiones ?? null,
      p_numero_registro: c.numeroRegistro ?? null,
    }),
  ) as Expediente;
}

// ────────────────────────────── Toma de datos ─────────────────────────────

export interface RegistroTomaDatos {
  datos: TomaDatos;
  avisos_confirmados: string[];
  verificado_en: string | null;
  actualizado_en: string | null;
}

export async function obtenerTomaDatos(expedienteId: string): Promise<RegistroTomaDatos | null> {
  const r = comprobar(
    await supabase.from('toma_datos').select('datos, avisos_confirmados, verificado_en, actualizado_en')
      .eq('expediente_id', expedienteId).maybeSingle(),
  ) as { datos: unknown; avisos_confirmados: string[]; verificado_en: string | null; actualizado_en: string } | null;
  return r && { ...r, datos: normalizarTomaDatos(r.datos) };
}

export async function guardarTomaDatos(expedienteId: string, datos: TomaDatos, avisosConfirmados: string[]): Promise<string> {
  const r = comprobar(
    await supabase.from('toma_datos')
      .upsert({ expediente_id: expedienteId, datos, avisos_confirmados: avisosConfirmados, version_esquema: VERSION_ESQUEMA })
      .select('actualizado_en').single(),
  ) as { actualizado_en: string };
  return r.actualizado_en;
}
