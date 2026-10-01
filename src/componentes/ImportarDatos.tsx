import { useEffect, useRef, useState } from 'react';
import {
  type Elemento, type Propuesta, TITULO_DESTINO, camposDe, describirValor, interpretarFichero, interpretarTexto, plantillaCsv,
} from '../lib/importarDatos';
import type { TomaDatos } from '../lib/tomaDatos';

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
}
type ConstructorReconocedor = new () => Reconocedor;

function constructorDictado(): ConstructorReconocedor | undefined {
  const w = window as unknown as { SpeechRecognition?: ConstructorReconocedor; webkitSpeechRecognition?: ConstructorReconocedor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const EJEMPLO = `Zona climática D1, superficie útil 85,5, altura libre 2,5, 2 plantas, NBE-CT-79
Fachada norte 24 metros cuadrados U 1,35 estimada
Dos ventanas en fachada norte de 1,20 por 1,50, doble vidrio, aluminio con rotura de puente térmico, con persiana
Frente de forjado 12 metros
Caldera de condensación de gas natural para calefacción y agua caliente, 24 kilovatios, rendimiento 98 %, instalada en 2018`;

/**
 * Rellena la toma de datos por voz, texto libre o fichero. Lo leído se
 * muestra como propuesta; solo se añade lo que el técnico marca.
 */
export function ImportarDatos({ datos, onAplicar }: {
  datos: TomaDatos;
  onAplicar: (elementos: Elemento[]) => void;
}) {
  const [texto, setTexto] = useState('');
  const [provisional, setProvisional] = useState('');
  const [escuchando, setEscuchando] = useState(false);
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState('');
  const reconocedor = useRef<Reconocedor | null>(null);
  const Dictado = typeof window !== 'undefined' ? constructorDictado() : undefined;

  useEffect(() => () => reconocedor.current?.stop(), []);

  function dictar() {
    if (escuchando) { reconocedor.current?.stop(); return; }
    if (!Dictado) return;
    setError('');
    const r = new Dictado();
    r.lang = 'es-ES';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev) => {
      let prov = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]!;
        const t = res[0].transcript.trim();
        // Cada pausa del dictado es una línea: una línea, un elemento.
        if (res.isFinal) setTexto((x) => (x && !x.endsWith('\n') ? `${x}\n` : x) + t + '\n');
        else prov += t;
      }
      setProvisional(prov);
    };
    r.onerror = (ev) => {
      setError(ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
        ? 'El navegador no deja usar el micrófono. Revisa el permiso del micrófono para esta página.'
        : ev.error === 'no-speech' ? 'No se ha oído nada. Vuelve a pulsar «Dictar» y habla cerca del micrófono.'
        : `El dictado se ha detenido (${ev.error}).`);
    };
    r.onend = () => { setEscuchando(false); setProvisional(''); };
    reconocedor.current = r;
    r.start();
    setEscuchando(true);
  }

  function mostrar(p: Propuesta) {
    setPropuesta(p);
    setMarcados(new Set(p.elementos.map((_, i) => i)));
    setHecho('');
  }

  async function leerFichero(f: File | undefined) {
    if (!f) return;
    setError('');
    try {
      mostrar(await interpretarFichero(f));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function descargarPlantilla() {
    const url = URL.createObjectURL(new Blob([plantillaCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-toma-de-datos.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function aplicar() {
    if (!propuesta) return;
    const elegidos = propuesta.elementos.filter((_, i) => marcados.has(i));
    onAplicar(elegidos);
    setPropuesta(null);
    setTexto('');
    setHecho(`Añadidos ${elegidos.length} elemento(s). Revísalos abajo: los valores poco habituales aparecen en amarillo.`);
  }

  return (
    <details className="seccion importar">
      <summary>Rellenar por voz, texto o archivo</summary>
      <p className="suave">
        Di o escribe un elemento por línea (o di «siguiente» entre uno y otro). La app te enseña lo que ha entendido y
        tú eliges qué añadir. Nada se añade solo.
      </p>

      <div className="campo">
        <label htmlFor="importar-texto">Texto o dictado</label>
        <textarea id="importar-texto" rows={6} value={texto} placeholder={EJEMPLO} onChange={(e) => setTexto(e.target.value)} />
        {provisional && <small className="suave">🎙 {provisional}…</small>}
      </div>
      <div className="acciones">
        {Dictado ? (
          <button type="button" className={escuchando ? 'peligro' : ''} onClick={dictar} aria-pressed={escuchando}>
            {escuchando ? '■ Parar el dictado' : '🎙 Dictar'}
          </button>
        ) : null}
        <button type="button" className="principal" disabled={!texto.trim()} onClick={() => mostrar(interpretarTexto(texto))}>Interpretar</button>
        {texto && <button type="button" onClick={() => setTexto('')}>Borrar texto</button>}
      </div>
      <small className="ayuda">
        {Dictado
          ? 'Dictado: en Chrome y Edge la voz se envía a los servidores de Google o Microsoft para pasarla a texto. Dicta solo datos técnicos, no nombres, DNI ni teléfonos.'
          : 'Este navegador no tiene dictado. En el móvil puedes usar el micrófono del teclado dentro del cuadro de texto.'}
      </small>

      <div className="campo importar-fichero">
        <label htmlFor="importar-fichero">O elige un archivo (Excel .xlsx, CSV, texto o JSON)</label>
        <input id="importar-fichero" type="file" accept=".xlsx,.csv,.tsv,.txt,.json,text/plain,text/csv,application/json"
               onChange={(e) => { leerFichero(e.target.files?.[0]); e.target.value = ''; }} />
        <small className="ayuda">
          Para Excel: una fila por elemento y una columna «Sección». <button type="button" className="enlace" onClick={descargarPlantilla}>Descargar plantilla</button>
        </small>
      </div>

      {error && <div className="caja error">{error}</div>}
      {hecho && <div className="caja info" role="status">{hecho}</div>}

      {propuesta && (
        <section className="caja propuesta">
          <h3>Lo que se ha entendido</h3>
          {propuesta.elementos.length === 0 && <p>No se ha reconocido ningún dato.</p>}
          <ul className="lista-propuesta">
            {propuesta.elementos.map((e, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={marcados.has(i)} onChange={(ev) => {
                    const s = new Set(marcados);
                    if (ev.target.checked) s.add(i); else s.delete(i);
                    setMarcados(s);
                  }} />
                  <span>
                    <strong>{TITULO_DESTINO[e.destino]}</strong> <small className="suave">— «{e.origen}»</small>
                    <ul className="valores">
                      {Object.entries(e.valores).map(([campo, v]) => {
                        const antes = e.destino === 'generales' ? datos.generales[campo] : undefined;
                        const sustituye = antes !== undefined && antes !== null && antes !== v;
                        return (
                          <li key={campo}>
                            {describirValor(e.destino, campo, v)}
                            {sustituye && <em className="nota-aviso"> (sustituye a {describirValor(e.destino, campo, antes).split(': ')[1]})</em>}
                          </li>
                        );
                      })}
                    </ul>
                    {faltan(e) && <small className="suave">Sin rellenar: {faltan(e)}.</small>}
                    {e.notas.map((n) => <div key={n} className="nota-aviso">⚠ {n}</div>)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {propuesta.sinEntender.length > 0 && (
            <div className="caja aviso">
              <strong>No se ha entendido (no se añadirá):</strong>
              <ul className="lista-simple">{propuesta.sinEntender.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          <div className="acciones">
            <button type="button" className="principal" disabled={marcados.size === 0} onClick={aplicar}>
              Añadir {marcados.size} a la toma de datos
            </button>
            <button type="button" onClick={() => setPropuesta(null)}>Descartar</button>
          </div>
        </section>
      )}
    </details>
  );
}

/** Campos visibles del elemento que no se han dicho, para que se vea qué queda por rellenar. */
function faltan(e: Elemento): string {
  return camposDe(e.destino)
    .filter((d) => d.tipo !== 'texto_largo' && !(d.campo in e.valores) && (!d.visibleSi || d.visibleSi(e.valores)))
    .map((d) => d.etiqueta.toLowerCase())
    .join(', ');
}
