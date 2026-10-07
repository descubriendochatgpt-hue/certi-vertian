// Grabación de la visita en el propio dispositivo (funciona sin cobertura).
//
// El audio se graba en tramos de unos minutos y cada tramo y cada foto se
// guardan al momento en IndexedDB: si se cierra la página o se acaba la
// batería, lo grabado hasta entonces no se pierde. Nada sale del dispositivo
// hasta que el técnico pulsa «Procesar»; después puede borrarlo.

import { type PropuestaVisita, type SolucionResumida, propuestaDesdeExtraccion } from './visita';
import { tokenSesion } from './api';
import type { DatosCatastro } from '../../worker/catastro';

export interface Tramo {
  id: string;
  expedienteId: string;
  inicio: string;        // ISO
  duracion: number;      // segundos
  audio: Blob;
  /** Texto ya transcrito (para no repetirlo si se procesa dos veces). */
  texto?: string;
}

export interface Foto {
  id: string;
  expedienteId: string;
  hora: string;          // ISO
  imagen: Blob;          // ya reducida (JPEG)
}

const BD = 'certi-visitas';
const VERSION = 1;

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(BD, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const almacen of ['tramos', 'fotos']) {
        if (!db.objectStoreNames.contains(almacen)) db.createObjectStore(almacen, { keyPath: 'id' }).createIndex('expediente', 'expedienteId');
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(new Error('Este navegador no deja guardar la grabación en el dispositivo (¿modo privado?).'));
  });
}

async function operar<T>(almacen: 'tramos' | 'fotos', modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  try {
    return await new Promise<T>((ok, mal) => {
      const tx = db.transaction(almacen, modo);
      const r = f(tx.objectStore(almacen));
      tx.oncomplete = () => ok(r.result);
      tx.onerror = () => mal(tx.error ?? new Error('No se ha podido guardar en el dispositivo.'));
      tx.onabort = () => mal(tx.error ?? new Error('No se ha podido guardar en el dispositivo (¿sin espacio?).'));
    });
  } finally {
    db.close();
  }
}

export const guardarTramo = (t: Tramo) => operar('tramos', 'readwrite', (s) => s.put(t));
export const guardarFoto = (f: Foto) => operar('fotos', 'readwrite', (s) => s.put(f));
export const borrarTramo = (id: string) => operar('tramos', 'readwrite', (s) => s.delete(id));
export const borrarFoto = (id: string) => operar('fotos', 'readwrite', (s) => s.delete(id));

export async function tramosDe(expedienteId: string): Promise<Tramo[]> {
  const t = await operar('tramos', 'readonly', (s) => s.index('expediente').getAll(expedienteId)) as Tramo[];
  return t.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

export async function fotosDe(expedienteId: string): Promise<Foto[]> {
  const f = await operar('fotos', 'readonly', (s) => s.index('expediente').getAll(expedienteId)) as Foto[];
  return f.sort((a, b) => a.hora.localeCompare(b.hora));
}

export async function borrarVisitaLocal(expedienteId: string): Promise<void> {
  for (const t of await tramosDe(expedienteId)) await borrarTramo(t.id);
  for (const f of await fotosDe(expedienteId)) await borrarFoto(f.id);
}

export const nuevoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ─────────────────────────────── Grabadora ────────────────────────────────

/** Duración de cada tramo: si algo falla, como mucho se pierde un tramo. */
export const SEGUNDOS_TRAMO = 120;

export function formatoGrabacion(): string {
  const candidatos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidatos.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

// ─────────────────────────── Preparar para enviar ─────────────────────────

/** Reduce una foto a 1568 px de lado mayor en JPEG (lo que aprovecha la IA; ocupa poco). */
export async function reducirFoto(f: Blob, lado = 1568): Promise<Blob> {
  const img = await createImageBitmap(f);
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = w;
  lienzo.height = h;
  lienzo.getContext('2d')!.drawImage(img, 0, 0, w, h);
  img.close();
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se ha podido preparar la foto.'))), 'image/jpeg', 0.82));
}

/** WAV mono de 16 kHz (lo que espera el reconocimiento de voz), a partir de lo grabado. */
export async function aWav16k(audio: Blob): Promise<Uint8Array> {
  const ctx = new AudioContext();
  let original: AudioBuffer;
  try {
    original = await ctx.decodeAudioData(await audio.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const muestras = Math.ceil(original.duration * 16000);
  const off = new OfflineAudioContext(1, Math.max(1, muestras), 16000);
  const src = off.createBufferSource();
  src.buffer = original;
  src.connect(off.destination);
  src.start();
  return codificarWav((await off.startRendering()).getChannelData(0), 16000);
}

/** PCM de 16 bits con cabecera WAV. */
export function codificarWav(pcm: Float32Array, frecuencia: number): Uint8Array {
  const b = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(b);
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, frecuencia, true); v.setUint32(28, frecuencia * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]!));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(b);
}

async function aBase64(b: Blob): Promise<string> {
  const datos = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < datos.length; i += 0x8000) s += String.fromCharCode(...datos.subarray(i, i + 0x8000));
  return btoa(s);
}

// ────────────────────────────── Llamadas a /api ───────────────────────────

async function llamar<T>(ruta: string, init: RequestInit): Promise<T> {
  const token = await tokenSesion();
  let r: Response;
  try {
    r = await fetch(ruta, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Sin conexión. La grabación sigue guardada en este dispositivo: vuelve a procesar cuando tengas cobertura.');
  }
  const cuerpo = await r.json().catch(() => null) as (T & { error?: string }) | null;
  if (!r.ok || !cuerpo) {
    if (r.status === 404 && !cuerpo) throw new Error('El servidor aún no tiene esta función (falta desplegar el Worker de /api).');
    throw new Error(cuerpo?.error ?? `Error del servidor (${r.status}).`);
  }
  return cuerpo;
}

export async function transcribirTramo(t: Tramo): Promise<string> {
  const wav = await aWav16k(t.audio);
  const r = await llamar<{ texto: string }>('/api/transcribir', {
    method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav as Uint8Array<ArrayBuffer>,
  });
  return r.texto;
}

export interface ResultadoProcesado {
  transcripcion: string;
  propuesta: PropuestaVisita;
}

/**
 * Procesa la visita: transcribe los tramos que falten (y guarda cada texto en
 * el dispositivo) y pide a la IA la propuesta de datos.
 */
export async function procesarVisita(
  expedienteId: string,
  contexto: { expediente: string; conocido: string; catalogo: SolucionResumida[] },
  progreso: (mensaje: string) => void,
): Promise<ResultadoProcesado> {
  const tramos = await tramosDe(expedienteId);
  const fotos = await fotosDe(expedienteId);
  if (!tramos.length && !fotos.length) throw new Error('No hay nada grabado en este dispositivo para esta visita.');
  const textos: string[] = [];
  for (const [i, t] of tramos.entries()) {
    if (t.texto === undefined) {
      progreso(`Pasando a texto el tramo ${i + 1} de ${tramos.length}…`);
      t.texto = await transcribirTramo(t);
      await guardarTramo(t);
    }
    const hora = new Date(t.inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (t.texto) textos.push(`[${hora}] ${t.texto}`);
  }
  const transcripcion = textos.join('\n');
  progreso(`Interpretando la visita${fotos.length ? ` y ${fotos.length} foto(s)` : ''} (puede tardar un par de minutos)…`);
  const cuerpo = JSON.stringify({
    ...contexto,
    transcripcion,
    fotos: await Promise.all(fotos.map(async (f) => ({
      hora: new Date(f.hora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      tipo: f.imagen.type || 'image/jpeg',
      datos: await aBase64(f.imagen),
    }))),
  });
  const r = await llamar<{ extraccion: unknown }>('/api/visita/extraer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo,
  });
  return { transcripcion, propuesta: propuestaDesdeExtraccion(r.extraccion, contexto.catalogo) };
}

export type FichaCatastro = DatosCatastro;

export const consultarCatastro = (rc: string) =>
  llamar<FichaCatastro>(`/api/catastro?rc=${encodeURIComponent(rc)}`, { method: 'GET' });
