import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  type Adjunto, type PuntoChecklist, desmarcarPunto, listarAdjuntos, marcarPunto, obtenerChecklist, obtenerExpediente,
  obtenerResultados, obtenerTomaDatos,
} from '../lib/api';
import { type Expediente, NOMBRE_ESTADO } from '../lib/estados';
import { fechaHora } from '../lib/fechas';
import { type Apoyo, type Resultados, comprobacionesDeApoyo } from '../lib/resultados';
import type { TomaDatos } from '../lib/tomaDatos';
import { Documentos } from '../componentes/Documentos';

const ICONO: Record<Apoyo['estado'], string> = { coincide: '✓', revisar: '⚠', sin_datos: '·', info: 'ℹ' };

/** Checklist de revisión previa a la firma. Cada punto se marca a mano. */
export function Revision() {
  const { id = '' } = useParams();
  const [exp, setExp] = useState<Expediente | null>(null);
  const [toma, setToma] = useState<TomaDatos | null>(null);
  const [res, setRes] = useState<Resultados | null>(null);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [puntos, setPuntos] = useState<PuntoChecklist[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [e, t, r, a, p] = await Promise.all([
        obtenerExpediente(id), obtenerTomaDatos(id), obtenerResultados(id), listarAdjuntos(id), obtenerChecklist(id),
      ]);
      if (!e) { setError('Expediente no encontrado.'); return; }
      setExp(e); setToma(t?.datos ?? null); setRes(r); setAdjuntos(a); setPuntos(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;
  if (!exp) return <main className="pagina"><div className="caja error">{error}</div><Link to="/expedientes">← Volver</Link></main>;

  const editable = exp.estado === 'calculo_revisado';
  const apoyo = comprobacionesDeApoyo({ expediente: exp, toma, resultados: res, tiposAdjuntos: adjuntos.map((a) => a.tipo) });
  const hechos = puntos.filter((p) => p.marcado_en).length;

  async function alternar(p: PuntoChecklist) {
    setError('');
    const a = apoyo[p.clave];
    if (!p.marcado_en && a?.estado === 'revisar'
        && !confirm(`La comprobación automática señala una diferencia:\n\n${a.texto}\n\n¿Lo has revisado y quieres marcar este punto igualmente?`)) return;
    setOcupado(p.clave);
    try {
      if (p.marcado_en) await desmarcarPunto(id, p.clave);
      else await marcarPunto(id, p.clave, a?.estado === 'revisar' ? `Marcado pese al aviso: ${a.texto}` : null);
      setPuntos(await obtenerChecklist(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <main className="pagina">
      <p><Link to={`/expedientes/${id}`}>← {exp.codigo}</Link></p>
      <h1>Revisión previa a la firma</h1>
      <p className="subtitulo">{exp.direccion} · {exp.municipio}</p>

      {!editable && (
        <div className="caja info">
          {exp.estado === 'visita_pendiente' || exp.estado === 'datos_introducidos'
            ? 'El checklist se rellena cuando los resultados del cálculo están confirmados («Cálculo revisado»).'
            : `Solo lectura (el expediente está en «${NOMBRE_ESTADO[exp.estado]}»).`}
        </div>
      )}

      <p><strong>{hechos} de {puntos.length}</strong> puntos revisados.
        {' '}<span className="suave">Las comprobaciones automáticas son solo una ayuda: cada punto lo marcas tú.</span></p>
      {error && <div className="caja error">{error}</div>}

      <ol className="checklist">
        {puntos.map((p) => {
          const a = apoyo[p.clave];
          return (
            <li key={p.clave} className={p.marcado_en ? 'marcado' : ''}>
              <label>
                <input type="checkbox" checked={Boolean(p.marcado_en)} disabled={!editable || ocupado === p.clave} onChange={() => alternar(p)} />
                <span>{p.texto}</span>
              </label>
              {a && <div className={`apoyo apoyo-${a.estado}`}><span aria-hidden>{ICONO[a.estado]}</span> {a.texto}</div>}
              {p.marcado_en && <div className="suave pequeno">Revisado el {fechaHora(p.marcado_en)}{p.nota ? ` · ${p.nota}` : ''}</div>}
            </li>
          );
        })}
      </ol>

      {editable && hechos === puntos.length && puntos.length > 0 && (
        <div className="caja info">
          Checklist completo. Ya puedes firmar el certificado y, después, marcarlo como firmado desde la <Link to={`/expedientes/${id}`}>ficha del expediente</Link>.
        </div>
      )}

      <Documentos expedienteId={id} adjuntos={adjuntos} soloLectura={exp.estado === 'registrado'}
                  onCambio={() => listarAdjuntos(id).then(setAdjuntos).catch((e: Error) => setError(e.message))} />
    </main>
  );
}
