import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { catalogoCompleto, guardarVisita, obtenerExpediente, obtenerTomaDatos } from '../lib/api';
import type { Expediente } from '../lib/estados';
import {
  type Foto, type Tramo, SEGUNDOS_TRAMO, borrarFoto, borrarTramo, borrarVisitaLocal, formatoGrabacion, fotosDe, guardarFoto,
  guardarTramo, nuevoId, procesarVisita, reducirFoto, tramosDe,
} from '../lib/grabacion';
import { resumenConocido, resumenExpediente } from '../lib/visita';
import { tomaDatosVacia } from '../lib/tomaDatos';

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/**
 * Pantalla para la visita, pensada para el móvil: grabar hablando con
 * naturalidad y hacer fotos, sin tocar nada más. Todo se guarda en el
 * dispositivo; «Procesar» lo convierte en una propuesta para la toma de datos.
 */
export function Visita() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const [exp, setExp] = useState<Expediente | null>(null);
  const [tramos, setTramos] = useState<Tramo[]>([]);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState('');
  const [progreso, setProgreso] = useState('');
  const [enLinea, setEnLinea] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const flujo = useRef<MediaStream | null>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const corte = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contador = useRef<ReturnType<typeof setInterval> | null>(null);
  const bloqueoPantalla = useRef<{ release(): Promise<void> } | null>(null);
  const parando = useRef(false);

  const recargar = useCallback(async () => {
    const [t, f] = await Promise.all([tramosDe(id), fotosDe(id)]);
    setTramos(t);
    setFotos(f);
  }, [id]);

  useEffect(() => {
    obtenerExpediente(id).then(setExp).catch((e) => setError((e as Error).message));
    recargar().catch((e) => setError((e as Error).message));
    const cambio = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', cambio);
    window.addEventListener('offline', cambio);
    return () => { window.removeEventListener('online', cambio); window.removeEventListener('offline', cambio); };
  }, [id, recargar]);

  // Miniaturas y reproductores (URLs locales que se liberan al cambiar)
  useEffect(() => {
    const u: Record<string, string> = {};
    for (const f of fotos) u[f.id] = URL.createObjectURL(f.imagen);
    for (const t of tramos) u[t.id] = URL.createObjectURL(t.audio);
    setUrls(u);
    return () => Object.values(u).forEach((x) => URL.revokeObjectURL(x));
  }, [fotos, tramos]);

  // Al salir de la pantalla, se cierra el tramo en curso (y se guarda)
  useEffect(() => () => { parando.current = true; grabadora.current?.stop(); flujo.current?.getTracks().forEach((t) => t.stop()); }, []);

  /** Empieza un tramo nuevo con el mismo micrófono; al llegar a SEGUNDOS_TRAMO, lo cierra y abre otro. */
  function tramoNuevo() {
    if (!flujo.current) return;
    const tipo = formatoGrabacion();
    const r = new MediaRecorder(flujo.current, tipo ? { mimeType: tipo } : undefined);
    const trozos: Blob[] = [];
    const inicio = new Date();
    r.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
    r.onstop = async () => {
      const duracion = (Date.now() - inicio.getTime()) / 1000;
      if (trozos.length && duracion > 1) {
        try {
          await guardarTramo({ id: nuevoId(), expedienteId: id, inicio: inicio.toISOString(), duracion, audio: new Blob(trozos, { type: r.mimeType || tipo }) });
          await recargar();
        } catch (e) {
          setError((e as Error).message);
        }
      }
      if (!parando.current) tramoNuevo();
      else { flujo.current?.getTracks().forEach((t) => t.stop()); flujo.current = null; }
    };
    r.start(10_000); // entrega datos cada 10 s: si el navegador se cierra, se pierde poco
    grabadora.current = r;
    corte.current = setTimeout(() => r.state === 'recording' && r.stop(), SEGUNDOS_TRAMO * 1000);
  }

  async function empezar() {
    setError('');
    if (typeof MediaRecorder === 'undefined') { setError('Este navegador no puede grabar audio. Usa Chrome, Edge o Safari actualizados.'); return; }
    try {
      flujo.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError('No se ha podido usar el micrófono. Revisa el permiso del micrófono para esta página.');
      return;
    }
    parando.current = false;
    setGrabando(true);
    setSegundos(0);
    const t0 = Date.now();
    contador.current = setInterval(() => setSegundos((Date.now() - t0) / 1000), 500);
    try {
      bloqueoPantalla.current = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    } catch { /* sin bloqueo de pantalla: se graba igual mientras la pantalla esté encendida */ }
    tramoNuevo();
  }

  function parar() {
    parando.current = true;
    if (corte.current) clearTimeout(corte.current);
    if (contador.current) clearInterval(contador.current);
    // Al parar, la grabadora guarda el último tramo y después suelta el micrófono
    if (grabadora.current?.state === 'recording') grabadora.current.stop();
    else { flujo.current?.getTracks().forEach((t) => t.stop()); flujo.current = null; }
    void bloqueoPantalla.current?.release();
    bloqueoPantalla.current = null;
    setGrabando(false);
  }

  async function anadirFotos(lista: FileList | null) {
    if (!lista) return;
    setError('');
    try {
      for (const f of Array.from(lista)) {
        if (f.type === 'application/pdf') {
          if (f.size > 15 * 1024 * 1024) throw new Error(`«${f.name}» ocupa más de 15 MB.`);
          await guardarFoto({ id: nuevoId(), expedienteId: id, hora: new Date().toISOString(), imagen: f });
        } else {
          await guardarFoto({ id: nuevoId(), expedienteId: id, hora: new Date().toISOString(), imagen: await reducirFoto(f) });
        }
      }
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function procesar() {
    if (!exp || grabando) return;
    setError('');
    setProgreso('Preparando…');
    try {
      const [toma, catalogo] = await Promise.all([obtenerTomaDatos(id), catalogoCompleto()]);
      const datos = toma?.datos ?? tomaDatosVacia();
      const extra = exp.referencia_catastral ? [`Referencia catastral: ${exp.referencia_catastral}`] : [];
      const r = await procesarVisita(id, {
        expediente: resumenExpediente(exp),
        conocido: resumenConocido(datos, extra),
        catalogo: catalogo.filter((s) => s.tipo !== 'puente').map((s) => ({ clave: s.clave, tipo: s.tipo, etiqueta: s.etiqueta })),
      }, setProgreso);
      setProgreso('Guardando la propuesta…');
      const actuales = await tramosDe(id);
      await guardarVisita({
        expediente_id: id,
        grabada_en: actuales[0]?.inicio ?? fotos[0]?.hora ?? new Date().toISOString(),
        duracion_s: Math.round(actuales.reduce((n, t) => n + t.duracion, 0)),
        fotos: fotos.length,
        transcripcion: r.transcripcion,
        propuesta: r.propuesta,
      });
      setProgreso('');
      if (confirm('Visita procesada. La propuesta está en la toma de datos para revisarla.\n\n¿Borrar ya el audio y las fotos de este dispositivo? (Si dices que no, podrás volver a procesarla.)')) {
        await borrarVisitaLocal(id);
      }
      navegar(`/expedientes/${id}/toma-datos#visitas`);
    } catch (e) {
      setProgreso('');
      setError((e as Error).message);
      await recargar();
    }
  }

  const total = tramos.reduce((n, t) => n + t.duracion, 0);

  return (
    <main className="pagina visita">
      <p><Link to={`/expedientes/${id}`}>← {exp?.codigo ?? 'Expediente'}</Link></p>
      <h1>Visita</h1>
      {exp && <p className="subtitulo">{exp.direccion} · {exp.municipio}</p>}

      <section className="caja grabar">
        <p className="suave">
          Pulsa grabar y ve contando lo que ves, en el orden que quieras: muros y orientación, medidas, ventanas
          (marco, vidrio, persiana, ancho por alto), caldera o termo… Puedes corregirte («no, perdón, son catorce metros»).
          Haz fotos de las placas de los equipos, las ventanas y las fachadas. Si tienes el PDF de la consulta del Catastro, adjúntalo también.
        </p>
        {!grabando ? (
          <button type="button" className="boton-grabar" onClick={empezar}>● Grabar</button>
        ) : (
          <button type="button" className="boton-grabar grabando" onClick={parar} aria-live="polite">■ Parar · {reloj(segundos)}</button>
        )}
        <label className="boton boton-foto">
          📷 Foto
          <input type="file" accept="image/*" capture="environment" multiple hidden
                 onChange={(e) => { void anadirFotos(e.target.files); e.target.value = ''; }} />
        </label>
        <label className="boton boton-foto">
          📄 PDF (Catastro…)
          <input type="file" accept="application/pdf" multiple hidden
                 onChange={(e) => { void anadirFotos(e.target.files); e.target.value = ''; }} />
        </label>
        {grabando && <p className="suave">Deja la pantalla encendida mientras grabas. Cada {SEGUNDOS_TRAMO / 60} minutos se guarda un tramo en el móvil.</p>}
        {!enLinea && <div className="caja info">Sin conexión: todo se guarda en este dispositivo. Procesa la visita cuando tengas cobertura.</div>}
      </section>

      {error && <div className="caja error">{error}</div>}

      <section className="caja">
        <h2>Guardado en este dispositivo</h2>
        <p>{tramos.length} tramo(s) de audio ({reloj(total)}) · {fotos.length} foto(s)</p>
        {tramos.length > 0 && (
          <ul className="lista-tramos">
            {tramos.map((t, i) => (
              <li key={t.id}>
                <span>Tramo {i + 1} · {hora(t.inicio)} · {reloj(t.duracion)}{t.texto !== undefined ? ' · transcrito' : ''}</span>
                {urls[t.id] && <audio controls preload="none" src={urls[t.id]} />}
                <button type="button" className="enlace peligro" onClick={async () => { if (confirm('¿Borrar este tramo?')) { await borrarTramo(t.id); await recargar(); } }}>Borrar</button>
              </li>
            ))}
          </ul>
        )}
        {fotos.length > 0 && (
          <ul className="miniaturas">
            {fotos.map((f, i) => (
              <li key={f.id}>
                {f.imagen.type === 'application/pdf'
                  ? <span className="miniatura-pdf">📄 PDF {i + 1}</span>
                  : urls[f.id] && <img src={urls[f.id]} alt={`Foto ${i + 1}, ${hora(f.hora)}`} />}
                <button type="button" className="enlace peligro" onClick={async () => { await borrarFoto(f.id); await recargar(); }}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
        <div className="acciones">
          <button type="button" className="principal" disabled={!!progreso || grabando || (!tramos.length && !fotos.length) || !enLinea} onClick={procesar}>
            {progreso ? 'Procesando…' : 'Procesar la visita'}
          </button>
          {(tramos.length > 0 || fotos.length > 0) && !progreso && (
            <button type="button" className="peligro" onClick={async () => { if (confirm('¿Borrar todo lo grabado de esta visita en este dispositivo?')) { await borrarVisitaLocal(id); await recargar(); } }}>
              Borrar todo
            </button>
          )}
        </div>
        {progreso && <p role="status" className="cargando">{progreso}</p>}
        <small className="ayuda">
          Al procesar, el audio se pasa a texto en Cloudflare y el texto y las fotos los interpreta Claude (Anthropic).
          No se guardan en el servidor: solo la transcripción y la propuesta de datos. No grabes nombres, DNI ni teléfonos.
        </small>
      </section>
    </main>
  );
}
