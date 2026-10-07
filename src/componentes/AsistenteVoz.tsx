import { useEffect, useRef, useState } from 'react';
import type { Expediente } from '../lib/estados';
import type { DefCampo, Fila, SeccionLista, TomaDatos, Valor } from '../lib/tomaDatos';
import { type Elemento, TITULO_DESTINO, describirValor } from '../lib/importarDatos';
import { listarEncargos } from '../lib/api';
import {
  type ClienteCrm, PANTALLAS, type Paso, comando, normativaAutomatica, hayQuePreguntar, decirValor, detallesQueFaltan, guion, preguntaDe, respuestaCampo, respuestaElemento,
  valoresAutomaticos,
} from '../lib/asistenteVoz';

// Dictado del navegador (Web Speech API). TypeScript no trae sus tipos.
interface Reconocedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type ConstructorReconocedor = new () => Reconocedor;
const Dictado = (): ConstructorReconocedor | undefined => {
  const w = window as unknown as { SpeechRecognition?: ConstructorReconocedor; webkitSpeechRecognition?: ConstructorReconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** Dice un texto en voz alta (si el navegador puede) y avisa al terminar. */
function hablar(texto: string): Promise<void> {
  return new Promise((resolver) => {
    const s = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!s) { resolver(); return; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-ES';
    const voz = s.getVoices().find((v) => v.lang === 'es-ES') ?? s.getVoices().find((v) => v.lang.startsWith('es'));
    if (voz) u.voice = voz;
    u.rate = 1.05;
    let hecho = false;
    const fin = () => { if (!hecho) { hecho = true; resolver(); } };
    u.onend = fin;
    u.onerror = fin;
    // Algunos navegadores no avisan del final: plazo de seguridad según la longitud
    setTimeout(fin, 1500 + texto.length * 90);
    s.speak(u);
  });
}

/** Lo que se está preguntando ahora dentro de un paso de lista: un detalle de un elemento recién añadido. */
interface Detalle {
  destino: SeccionLista;
  filaId: string;
  nombre: string;
  faltan: DefCampo[];
  i: number;
}

interface Apunte { pregunta: string; respuesta: string; ok: boolean }

const nuevoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Asistente guiado: pregunta en voz alta, en el orden de las pantallas de
 * CE3X, solo lo que falta, y apunta lo que respondes. También se puede
 * responder escribiendo.
 */
export function AsistenteVoz({ exp, datos, onCambio }: {
  exp: Expediente;
  datos: TomaDatos;
  onCambio: (d: TomaDatos) => void;
}) {
  const [activo, setActivo] = useState(false);
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [indice, setIndice] = useState(0);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [estado, setEstado] = useState<'hablando' | 'escuchando' | 'esperando'>('esperando');
  const [provisional, setProvisional] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [escrito, setEscrito] = useState('');
  const [apuntes, setApuntes] = useState<Apunte[]>([]);
  const [manosLibres, setManosLibres] = useState(true);

  // Refs para que los avisos del dictado vean siempre lo último
  const datosRef = useRef(datos);
  datosRef.current = datos;
  const reconocedor = useRef<Reconocedor | null>(null);
  const vivo = useRef(false);
  const estadoRef = useRef({ pasos, indice, detalle, manosLibres });
  estadoRef.current = { pasos, indice, detalle, manosLibres };

  const hayDictado = typeof window !== 'undefined' && Boolean(Dictado());

  useEffect(() => () => { vivo.current = false; reconocedor.current?.abort(); window.speechSynthesis?.cancel(); }, []);

  const cambiar = (d: TomaDatos) => { datosRef.current = d; onCambio(d); };

  const pasoActual = pasos[indice];
  const preguntaActual = !pasoActual ? '' : detalle ? preguntaDe(detalle.faltan[detalle.i]!) : pasoActual.pregunta;

  function escuchar() {
    const C = Dictado();
    if (!C || !vivo.current) { setEstado('esperando'); return; }
    reconocedor.current?.abort();
    const r = new C();
    r.lang = 'es-ES';
    r.continuous = false;
    r.interimResults = true;
    let entendido = false;
    r.onresult = (ev) => {
      let prov = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]!;
        if (res.isFinal) { entendido = true; setProvisional(''); void procesar(res[0].transcript); }
        else prov += res[0].transcript;
      }
      setProvisional(prov);
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setMensaje('El navegador no deja usar el micrófono. Puedes responder escribiendo.');
      }
    };
    r.onend = () => {
      if (!entendido && vivo.current) { setEstado('esperando'); setMensaje((m) => m || 'No te he oído. Pulsa «Escuchar» o escribe la respuesta.'); }
    };
    reconocedor.current = r;
    setEstado('escuchando');
    try { r.start(); } catch { setEstado('esperando'); }
  }

  /** Dice algo y, si está en manos libres, vuelve a escuchar. */
  async function decirYEscuchar(texto: string) {
    if (!vivo.current) return;
    setEstado('hablando');
    await hablar(texto);
    if (!vivo.current) return;
    if (estadoRef.current.manosLibres && hayDictado) escuchar(); else setEstado('esperando');
  }

  /** Pregunta lo que toque en el paso i (anunciando la pantalla si cambia). */
  async function preguntar(lista: Paso[], i: number, previo?: string, anunciarPantalla = true) {
    setDetalle(null);
    setMensaje('');
    // Salta lo que ya se ha resuelto con respuestas anteriores
    while (lista[i] && !hayQuePreguntar(lista[i]!, datosRef.current)) i++;
    setIndice(i);
    const p = lista[i];
    if (!p) { terminar(previo); return; }
    const cambiaPantalla = anunciarPantalla && (i === 0 || lista[i - 1]?.pantalla !== p.pantalla);
    const intro = cambiaPantalla ? `Pantalla ${PANTALLAS.indexOf(p.pantalla) + 1}: ${p.pantalla}. ` : '';
    await decirYEscuchar([previo, intro + p.pregunta].filter(Boolean).join(' '));
  }

  function terminar(previo?: string) {
    vivo.current = false;
    reconocedor.current?.abort();
    setActivo(false);
    setEstado('esperando');
    void hablar([previo, 'He terminado. Revisa los datos y genera el fichero de CE3X.'].filter(Boolean).join(' '));
  }

  async function empezar() {
    // Dirección del cliente: la de su ficha del CRM, si el expediente viene de un encargo
    let clienteCrm: ClienteCrm | null = null;
    if (exp.crm_pedido_id || exp.crm_presupuesto_id) {
      try {
        const e = (await listarEncargos()).find((x) => x.expediente_id === exp.id);
        if (e?.cliente && typeof e.cliente === 'object') clienteCrm = e.cliente as ClienteCrm;
      } catch { /* sin CRM: se usa la dirección del inmueble */ }
    }
    let d = datosRef.current;
    const auto = valoresAutomaticos(d, exp, clienteCrm);
    if (auto.length) {
      d = { ...d, generales: { ...d.generales, ...Object.fromEntries(auto.map((a) => [a.campo, a.valor])) } };
      cambiar(d);
    }
    const lista = guion(d, exp);
    vivo.current = true;
    setActivo(true);
    setPasos(lista);
    setApuntes(auto.map((a) => ({ pregunta: 'Automático', respuesta: a.motivo, ok: true })));
    const n = lista.filter((p) => p.tipo === 'campo' && hayQuePreguntar(p, d)).length;
    const yaPuestos = auto.length ? `He rellenado ${auto.length} datos que ya conocía; los tienes en la lista. ` : '';
    void preguntar(lista, 0, `${yaPuestos}Te haré ${n} preguntas y después describirás la envolvente y las instalaciones. Puedes decir «saltar», «atrás», «repetir» o «parar».`);
  }

  const apuntar = (pregunta: string, respuesta: string, ok: boolean) =>
    setApuntes((a) => [{ pregunta, respuesta, ok }, ...a].slice(0, 40));

  /** Siguiente detalle del elemento, o vuelve a pedir otro elemento. */
  async function siguienteDetalle(d: Detalle, previo: string) {
    if (d.i + 1 < d.faltan.length) {
      const sig = { ...d, i: d.i + 1 };
      setDetalle(sig);
      await decirYEscuchar(`${previo} ${preguntaDe(sig.faltan[sig.i]!)}`);
    } else {
      setDetalle(null);
      const { pasos: ps, indice: i } = estadoRef.current;
      await decirYEscuchar(`${previo} ${d.nombre} completado. ${ps[i]?.tipo === 'lista' ? 'Describe otro, o di «terminado».' : ''}`);
    }
  }

  function actualizarFila(destino: SeccionLista, filaId: string, campo: string, valor: Valor) {
    const d = datosRef.current;
    cambiar({ ...d, [destino]: d[destino].map((f: Fila) => (f.id === filaId ? { ...f, [campo]: valor } : f)) });
  }

  async function procesar(texto: string) {
    const t = texto.trim();
    if (!t || !vivo.current) return;
    setMensaje('');
    const { pasos: ps, indice: i, detalle: det } = estadoRef.current;
    const p = ps[i];
    if (!p) return;
    const orden = comando(t);

    if (orden === 'parar') { apuntar(preguntaActualDe(p, det), t, true); terminar('De acuerdo, paro aquí.'); return; }
    if (orden === 'repetir') { await decirYEscuchar(det ? preguntaDe(det.faltan[det.i]!) : p.pregunta); return; }
    if (orden === 'atras') {
      if (det) { setDetalle(null); await decirYEscuchar(p.pregunta); return; }
      await preguntar(ps, Math.max(0, i - 1), undefined, false);
      return;
    }

    // Detalle de un elemento recién añadido
    if (det) {
      const def = det.faltan[det.i]!;
      if (orden === 'saltar' || orden === 'terminado') { apuntar(def.etiqueta, '(saltado)', true); await siguienteDetalle(det, ''); return; }
      const r = respuestaCampo(def, t);
      if ('error' in r) { apuntar(def.etiqueta, t, false); setMensaje(r.error); await decirYEscuchar(r.error); return; }
      actualizarFila(det.destino, det.filaId, def.campo, r.valor);
      apuntar(`${det.nombre} · ${def.etiqueta}`, decirValor(def, r.valor), true);
      await siguienteDetalle(det, `${decirValor(def, r.valor)}.`);
      return;
    }

    if (p.tipo === 'campo') {
      if (orden === 'saltar' || orden === 'terminado') { apuntar(p.def.etiqueta, '(saltado)', true); await preguntar(ps, i + 1); return; }
      const r = respuestaCampo(p.def, t);
      if ('error' in r) { apuntar(p.def.etiqueta, t, false); setMensaje(r.error); await decirYEscuchar(r.error); return; }
      const d = datosRef.current;
      let nuevos: TomaDatos = { ...d, generales: { ...d.generales, [p.def.campo]: r.valor } };
      // Con el año, la normativa sale sola
      const derivados = normativaAutomatica(nuevos, exp);
      if (derivados.length) nuevos = { ...nuevos, generales: { ...nuevos.generales, ...Object.fromEntries(derivados.map((a) => [a.campo, a.valor])) } };
      cambiar(nuevos);
      apuntar(p.def.etiqueta, decirValor(p.def, r.valor), true);
      derivados.forEach((a) => apuntar('Automático', a.motivo, true));
      await preguntar(ps, i + 1, `Anotado: ${decirValor(p.def, r.valor)}.${derivados.length ? ` ${derivados[0]!.motivo}` : ''}`);
      return;
    }

    // Paso de lista: describir un elemento
    if (orden === 'saltar' || orden === 'terminado') { await preguntar(ps, i + 1, `${p.pantalla} terminada.`); return; }
    const r = respuestaElemento(p.pantalla, t);
    if ('error' in r) { apuntar(p.pantalla, t, false); setMensaje(r.error); await decirYEscuchar(r.error); return; }
    await anadirElemento(r.elemento);
  }

  async function anadirElemento(e: Elemento) {
    const d = datosRef.current;
    if (e.destino === 'generales') {
      cambiar({ ...d, generales: { ...d.generales, ...e.valores } });
      apuntar('Datos generales', Object.entries(e.valores).map(([k, v]) => describirValor('generales', k, v)).join(' · '), true);
      await decirYEscuchar('Anotado en datos generales. Describe otro elemento, o di «terminado».');
      return;
    }
    const filaId = nuevoId();
    cambiar({ ...d, [e.destino]: [...d[e.destino], { ...e.valores, id: filaId } as Fila] });
    const nombre = String(e.valores.nombre ?? TITULO_DESTINO[e.destino]);
    apuntar(TITULO_DESTINO[e.destino], Object.entries(e.valores).map(([k, v]) => describirValor(e.destino, k, v)).join(' · '), true);
    const faltan = detallesQueFaltan(e.destino, e.valores);
    const dicho = `Añadido: ${nombre}.${e.notas.length ? ` Ojo: ${e.notas[0]}` : ''}`;
    if (faltan.length === 0) { await decirYEscuchar(`${dicho} Describe otro, o di «terminado».`); return; }
    const det: Detalle = { destino: e.destino, filaId, nombre, faltan, i: 0 };
    setDetalle(det);
    await decirYEscuchar(`${dicho} ${preguntaDe(faltan[0]!)}`);
  }

  function preguntaActualDe(p: Paso, det: Detalle | null) {
    return det ? det.faltan[det.i]!.etiqueta : p.tipo === 'campo' ? p.def.etiqueta : p.pantalla;
  }

  function enviarEscrito() {
    const t = escrito;
    setEscrito('');
    reconocedor.current?.abort();
    void procesar(t);
  }

  const orden = (o: string) => { reconocedor.current?.abort(); void procesar(o); };

  if (!activo) {
    return (
      <section className="caja asistente">
        <h2>Asistente por voz para CE3X</h2>
        <p>
          Te pregunta en voz alta, pantalla a pantalla como en CE3X, <strong>solo lo que falta</strong>: no pregunta lo
          que ya está en el expediente o en la toma de datos ni los valores que CE3X pone por defecto (altura libre,
          ventilación, masa…). Contestas hablando o escribiendo.
        </p>
        <div className="acciones">
          <button type="button" className="principal" onClick={() => void empezar()}>🎙 Empezar el asistente</button>
          <label className="campo-casilla"><input type="checkbox" checked={manosLibres} onChange={(e) => setManosLibres(e.target.checked)} /> Manos libres (escucha sola tras cada pregunta)</label>
        </div>
        {!hayDictado && <small className="ayuda">Este navegador no tiene dictado: el asistente te preguntará y responderás escribiendo.</small>}
        {hayDictado && <small className="ayuda">En Chrome y Edge la voz se envía a Google o Microsoft para pasarla a texto: dicta solo datos técnicos.</small>}
        {apuntes.length > 0 && <Apuntes apuntes={apuntes} />}
      </section>
    );
  }

  return (
    <section className="caja asistente activo" aria-live="polite">
      <ol className="pantallas-ce3x">
        {PANTALLAS.map((n) => <li key={n} className={pasoActual?.pantalla === n ? 'actual' : ''}>{n}</li>)}
      </ol>
      <p className="pregunta-asistente">{preguntaActual}</p>
      <p className="estado-asistente">
        {estado === 'hablando' ? '🔊 Hablando…' : estado === 'escuchando' ? `🎙 Te escucho… ${provisional}` : 'Esperando tu respuesta'}
      </p>
      {mensaje && <div className="nota-aviso">{mensaje}</div>}
      <form className="fila-respuesta" onSubmit={(e) => { e.preventDefault(); enviarEscrito(); }}>
        <input value={escrito} onChange={(e) => setEscrito(e.target.value)} placeholder="O escribe la respuesta…" aria-label="Respuesta" />
        <button type="submit" disabled={!escrito.trim()}>Enviar</button>
      </form>
      <div className="acciones">
        {hayDictado && <button type="button" onClick={() => escuchar()} disabled={estado === 'escuchando'}>🎙 Escuchar</button>}
        <button type="button" onClick={() => orden('saltar')}>Saltar</button>
        <button type="button" onClick={() => orden('atrás')}>Atrás</button>
        <button type="button" onClick={() => orden('repetir')}>Repetir</button>
        {pasoActual?.tipo === 'lista' && !detalle && <button type="button" onClick={() => orden('terminado')}>Terminado</button>}
        <button type="button" className="peligro" onClick={() => orden('parar')}>Parar</button>
      </div>
      <Apuntes apuntes={apuntes} />
    </section>
  );
}

function Apuntes({ apuntes }: { apuntes: Apunte[] }) {
  if (apuntes.length === 0) return null;
  return (
    <details className="apuntes" open>
      <summary>Lo que he apuntado</summary>
      <ul className="lista-simple">
        {apuntes.map((a, i) => <li key={i} className={a.ok ? '' : 'nota-aviso'}><strong>{a.pregunta}:</strong> {a.respuesta}{a.ok ? '' : ' (no entendido)'}</li>)}
      </ul>
    </details>
  );
}
