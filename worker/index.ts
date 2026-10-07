// Worker de CertiVertian. Sirve la web (dist/) y, en /api/…, las tres
// funciones que no pueden hacerse en el navegador:
//
//   POST /api/transcribir      audio de la visita → texto (Workers AI, Whisper)
//   POST /api/visita/extraer   transcripción + fotos → datos (Claude)
//   GET  /api/catastro?rc=…    ficha del Catastro (su servicio no admite CORS)
//
// Solo atiende a técnicos con sesión y doble factor: lo comprueba el propio
// Supabase con la función es_tecnico_verificado() y el token del técnico.
// La clave de Claude está en los secretos del Worker, nunca en la web.
//
// Configuración (Cloudflare → Workers → certi-vertian → Settings →
// Variables and Secrets, tipo «Secret»): ANTHROPIC_API_KEY, SUPABASE_URL,
// SUPABASE_CLAVE_PUBLICA. Opcional: ANTHROPIC_MODEL. Ver README.

import Anthropic from '@anthropic-ai/sdk';
import { PISTA_TRANSCRIPCION, esquemaExtraccion, instruccionesExtraccion, mensajeVisita, type ContextoVisita } from '../src/lib/visita';
import { URL_CATASTRO, leerRespuestaCatastro, normalizarReferencia } from './catastro';

export interface Env {
  AI?: { run(modelo: string, entrada: Record<string, unknown>): Promise<unknown> };
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_CLAVE_PUBLICA?: string;
}

export const MODELO_POR_DEFECTO = 'claude-opus-5-5';
const MODELO_VOZ = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO = 25 * 1024 * 1024;
const MAX_PETICION_VISITA = 30 * 1024 * 1024;
const MAX_FOTOS = 30;

const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), {
  status: estado,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const fallo = (mensaje: string, estado: number) => json({ error: mensaje }, estado);

/** null si es un técnico verificado (sesión + 2FA); si no, la respuesta de error. */
export async function comprobarTecnico(req: Request, env: Env, f: typeof fetch = fetch): Promise<Response | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_CLAVE_PUBLICA) {
    return fallo('Falta configurar SUPABASE_URL y SUPABASE_CLAVE_PUBLICA en los secretos del Worker (ver README).', 500);
  }
  const token = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return fallo('Falta la sesión. Vuelve a entrar.', 401);
  let r: Response;
  try {
    r = await f(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/es_tecnico_verificado`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_CLAVE_PUBLICA, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    return fallo('No se ha podido comprobar la sesión (sin conexión con la base de datos).', 502);
  }
  if (r.status === 401) return fallo('La sesión ha caducado. Vuelve a entrar.', 401);
  if (!r.ok) return fallo('No se ha podido comprobar la sesión.', 502);
  if ((await r.json()) !== true) return fallo('Solo para técnicos verificados con la verificación en dos pasos.', 403);
  return null;
}

function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function transcribir(req: Request, env: Env): Promise<Response> {
  if (!env.AI) return fallo('Falta la conexión con Workers AI (binding «AI» en wrangler.jsonc).', 500);
  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.length === 0) return fallo('No ha llegado audio.', 400);
  if (audio.length > MAX_AUDIO) return fallo('El tramo de audio es demasiado grande.', 413);
  try {
    const r = await env.AI.run(MODELO_VOZ, {
      audio: aBase64(audio), task: 'transcribe', language: 'es', vad_filter: true,
      initial_prompt: PISTA_TRANSCRIPCION, condition_on_previous_text: false,
    }) as { text?: string; transcription_info?: { duration?: number } };
    return json({ texto: (r.text ?? '').trim(), duracion: r.transcription_info?.duration ?? null });
  } catch (e) {
    return fallo(`No se ha podido pasar el audio a texto (${(e as Error).message}).`, 502);
  }
}

interface PeticionVisita extends ContextoVisita {
  fotos: { hora: string; tipo: string; datos: string }[];
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;
const TIPO_PDF = 'application/pdf';

function mensajeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'La clave ANTHROPIC_API_KEY no es válida. Ponla de nuevo en los secretos del Worker.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Anthropic ha denegado el acceso con esta clave.';
  if (e instanceof Anthropic.RateLimitError) return 'Se ha superado el límite de uso de la cuenta de Anthropic. Espera un minuto y vuelve a procesar.';
  if (e instanceof Anthropic.BadRequestError) {
    return /credit balance/i.test(e.message)
      ? 'La cuenta de Anthropic no tiene saldo (console.anthropic.com → Billing).'
      : `La petición no es válida: ${e.message.slice(0, 300)}`;
  }
  if (e instanceof Anthropic.APIError) return `Error del servicio de IA (${e.status ?? '?'}). Vuelve a intentarlo en unos minutos.`;
  return `No se ha podido procesar la visita (${(e as Error).message}).`;
}

export async function extraer(req: Request, env: Env, cliente?: Anthropic): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY && !cliente) return fallo('Falta la clave ANTHROPIC_API_KEY en los secretos del Worker (ver README).', 500);
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_PETICION_VISITA) return fallo('La visita ocupa demasiado (reduce el número de fotos).', 413);
  let p: PeticionVisita;
  try {
    p = await req.json() as PeticionVisita;
  } catch {
    return fallo('Petición no válida.', 400);
  }
  if (typeof p.transcripcion !== 'string' || !Array.isArray(p.fotos) || !Array.isArray(p.catalogo)) return fallo('Petición no válida.', 400);
  if (p.fotos.length > MAX_FOTOS) return fallo(`Como mucho ${MAX_FOTOS} fotos por visita.`, 400);
  if (!p.transcripcion.trim() && p.fotos.length === 0) return fallo('La visita no tiene ni audio ni fotos.', 400);
  // Fotos y PDF (p. ej. la ficha del Catastro): los PDF los lee Claude directamente
  const fotos = p.fotos.filter((f) => ([...TIPOS_FOTO, TIPO_PDF] as string[]).includes(f.tipo) && typeof f.datos === 'string');
  const catalogo = p.catalogo.filter((s) => s && typeof s.clave === 'string' && typeof s.etiqueta === 'string')
    .map((s) => ({ clave: s.clave.slice(0, 100), tipo: String(s.tipo), etiqueta: s.etiqueta.slice(0, 500) })).slice(0, 500);

  const contenido: Anthropic.Beta.BetaContentBlockParam[] = [];
  fotos.forEach((f, i) => {
    if (f.tipo === TIPO_PDF) {
      contenido.push({ type: 'text', text: `Foto ${i + 1} (documento PDF adjunto, ${String(f.hora).slice(0, 20)}):` });
      contenido.push({ type: 'document', source: { type: 'base64', media_type: TIPO_PDF, data: f.datos } });
    } else {
      contenido.push({ type: 'text', text: `Foto ${i + 1} (${String(f.hora).slice(0, 20)}):` });
      contenido.push({ type: 'image', source: { type: 'base64', media_type: f.tipo as (typeof TIPOS_FOTO)[number], data: f.datos } });
    }
  });
  contenido.push({
    type: 'text',
    text: mensajeVisita({
      expediente: String(p.expediente ?? '').slice(0, 2000), conocido: String(p.conocido ?? '').slice(0, 5000),
      catalogo, transcripcion: p.transcripcion.slice(0, 400_000), fotos: fotos.map((f) => ({ hora: String(f.hora).slice(0, 20) })),
    }),
  });

  const ia = cliente ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const mensaje = await ia.beta.messages.stream({
      model: env.ANTHROPIC_MODEL?.trim() || MODELO_POR_DEFECTO,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: esquemaExtraccion(catalogo) } },
      system: [{ type: 'text', text: instruccionesExtraccion(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: contenido }],
    }).finalMessage();
    if (mensaje.stop_reason === 'refusal') return fallo('El servicio de IA no ha procesado esta visita. Revisa que no haya contenido ajeno al inmueble.', 422);
    if (mensaje.stop_reason === 'max_tokens') return fallo('La visita es demasiado larga para procesarla de una vez. Pártela en dos.', 422);
    const texto = mensaje.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let extraccion: unknown;
    try {
      extraccion = JSON.parse(texto);
    } catch {
      return fallo('La respuesta del servicio de IA no se ha podido leer. Vuelve a procesar.', 502);
    }
    return json({ extraccion, modelo: mensaje.model, uso: { entrada: mensaje.usage.input_tokens, salida: mensaje.usage.output_tokens } });
  } catch (e) {
    const estado = e instanceof Anthropic.APIError && e.status ? (e.status >= 500 ? 502 : e.status === 429 ? 429 : 400) : 502;
    return fallo(mensajeError(e), estado);
  }
}

export async function catastro(url: URL, f: typeof fetch = fetch): Promise<Response> {
  const rc = normalizarReferencia(url.searchParams.get('rc') ?? '');
  if (!rc) return fallo('La referencia catastral debe tener 20 caracteres.', 400);
  let r: Response;
  try {
    r = await f(`${URL_CATASTRO}?RefCat=${rc}`, { headers: { Accept: 'application/json' } });
  } catch {
    return fallo('No se ha podido conectar con el Catastro. Inténtalo más tarde.', 502);
  }
  if (!r.ok) return fallo(`El Catastro no responde (${r.status}). Inténtalo más tarde.`, 502);
  try {
    return json(leerRespuestaCatastro(await r.json(), rc));
  } catch (e) {
    return fallo((e as Error).message, 404);
  }
}

export async function atender(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname;
  const rutas: Record<string, string> = { '/api/transcribir': 'POST', '/api/visita/extraer': 'POST', '/api/catastro': 'GET' };
  if (!rutas[ruta]) return fallo('No existe.', 404);
  if (req.method !== rutas[ruta]) return fallo('Método no permitido.', 405);
  // Solo desde la propia web (las cookies no se usan, pero se evita el uso desde otras páginas)
  const origen = req.headers.get('Origin');
  if (origen && origen !== url.origin) return fallo('Origen no permitido.', 403);
  const denegado = await comprobarTecnico(req, env);
  if (denegado) return denegado;
  if (ruta === '/api/transcribir') return transcribir(req, env);
  if (ruta === '/api/visita/extraer') return extraer(req, env);
  return catastro(url);
}

export default {
  fetch: (req: Request, env: Env) => atender(req, env),
};
