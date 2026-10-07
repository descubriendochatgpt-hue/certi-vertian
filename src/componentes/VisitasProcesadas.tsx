import { useEffect, useState } from 'react';
import { type VisitaProcesada, listarVisitas, marcarVisitaAplicada } from '../lib/api';
import { type Elemento, TITULO_DESTINO, describirValor } from '../lib/importarDatos';
import type { Solucion } from '../lib/cex/catalogo';
import type { TomaDatos } from '../lib/tomaDatos';
import { fechaHora } from '../lib/fechas';

const minutos = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');

/**
 * Propuestas de las visitas grabadas: cada dato con la frase de la que sale.
 * Solo se añade lo que el técnico deja marcado.
 */
export function VisitasProcesadas({ expedienteId, datos, catalogo, editable, onAplicar }: {
  expedienteId: string;
  datos: TomaDatos;
  catalogo: Solucion[];
  editable: boolean;
  onAplicar: (elementos: Elemento[], observaciones: string) => void;
}) {
  const [visitas, setVisitas] = useState<VisitaProcesada[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [conObservaciones, setConObservaciones] = useState(true);
  const [hecho, setHecho] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listarVisitas(expedienteId).then((v) => {
      setVisitas(v);
      const pendiente = v.find((x) => !x.aplicada_en);
      if (pendiente) abrir(pendiente);
    }).catch(() => setVisitas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expedienteId]);

  function abrir(v: VisitaProcesada) {
    setAbierta(v.id);
    setMarcados(new Set(v.propuesta.elementos.map((_, i) => i)));
    setConObservaciones(true);
    setHecho('');
  }

  if (!visitas || visitas.length === 0) return null;
  const v = visitas.find((x) => x.id === abierta);
  const etiquetaSolucion = (clave: string) => catalogo.find((s) => s.clave === clave)?.etiqueta ?? 'solución del catálogo';

  async function aplicar() {
    if (!v) return;
    setError('');
    const elegidos = v.propuesta.elementos.filter((_, i) => marcados.has(i));
    onAplicar(elegidos, conObservaciones ? v.propuesta.observaciones : '');
    try {
      await marcarVisitaAplicada(v.id);
      setVisitas((l) => l?.map((x) => (x.id === v.id ? { ...x, aplicada_en: new Date().toISOString() } : x)) ?? l);
    } catch (e) {
      setError((e as Error).message);
    }
    setAbierta(null);
    setHecho(`Añadidos ${elegidos.length} dato(s) de la visita. Revísalos abajo: los valores poco habituales aparecen en amarillo.`);
  }

  return (
    <section className="caja visitas" id="visitas">
      <h2>Visitas grabadas</h2>
      <ul className="lista-simple">
        {visitas.map((x) => (
          <li key={x.id}>
            {fechaHora(x.grabada_en)} · {minutos(x.duracion_s)}{x.fotos ? ` · ${x.fotos} foto(s)` : ''} · {x.propuesta.elementos.length} dato(s)
            {x.aplicada_en ? <> · <span className="suave">añadida {fechaHora(x.aplicada_en)}</span></> : <strong> · pendiente de revisar</strong>}
            {abierta !== x.id && <> <button type="button" className="enlace" onClick={() => abrir(x)}>Ver</button></>}
          </li>
        ))}
      </ul>
      {hecho && <div className="caja info" role="status">{hecho}</div>}
      {error && <div className="caja error">{error}</div>}

      {v && (
        <div className="propuesta">
          {v.propuesta.dudas.length > 0 && (
            <div className="caja aviso">
              <strong>Dudas que conviene revisar</strong>
              <ul className="lista-simple">{v.propuesta.dudas.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {v.propuesta.elementos.length === 0 && <p>No se ha sacado ningún dato de esta visita.</p>}
          <ul className="lista-propuesta">
            {v.propuesta.elementos.map((e, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" disabled={!editable} checked={marcados.has(i)} onChange={(ev) => {
                    const s = new Set(marcados);
                    if (ev.target.checked) s.add(i); else s.delete(i);
                    setMarcados(s);
                  }} />
                  <span>
                    <strong>{TITULO_DESTINO[e.destino]}</strong> <small className="suave">— «{e.origen}»</small>
                    <ul className="valores">
                      {Object.entries(e.valores).map(([campo, valor]) => {
                        const antes = e.destino === 'generales' ? datos.generales[campo] : undefined;
                        const sustituye = antes !== undefined && antes !== null && antes !== '' && antes !== valor;
                        return (
                          <li key={campo}>
                            {campo === 'solucionCe3x' ? `Solución de CE3X: ${etiquetaSolucion(String(valor))}` : describirValor(e.destino, campo, valor)}
                            {sustituye && <em className="nota-aviso"> (sustituye a {describirValor(e.destino, campo, antes).split(': ').slice(1).join(': ')})</em>}
                          </li>
                        );
                      })}
                    </ul>
                    {e.notas.map((n) => <div key={n} className="nota-aviso">⚠ {n}</div>)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {v.propuesta.observaciones && (
            <label className="declaracion">
              <input type="checkbox" disabled={!editable} checked={conObservaciones} onChange={(e) => setConObservaciones(e.target.checked)} />
              Añadir a las observaciones: «{v.propuesta.observaciones}»
            </label>
          )}
          {v.propuesta.fotos.length > 0 && (
            <details>
              <summary>Lo que se ha visto en las fotos</summary>
              <ul className="lista-simple">{v.propuesta.fotos.map((f) => <li key={f.foto}>Foto {f.foto}: {f.contenido}</li>)}</ul>
            </details>
          )}
          <details>
            <summary>Transcripción de la grabación</summary>
            <pre className="transcripcion">{v.transcripcion || '(sin audio)'}</pre>
          </details>
          {editable ? (
            <div className="acciones">
              <button type="button" className="principal" disabled={marcados.size === 0 && !(conObservaciones && v.propuesta.observaciones)} onClick={aplicar}>
                Añadir {marcados.size} a la toma de datos
              </button>
              <button type="button" onClick={() => setAbierta(null)}>Cerrar</button>
            </div>
          ) : <p className="suave">La toma de datos está en solo lectura.</p>}
        </div>
      )}
    </section>
  );
}
