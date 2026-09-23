import { useRef, useState } from 'react';
import {
  type Adjunto, NOMBRE_TIPO_ADJUNTO, TAMANO_MAXIMO, type TipoAdjunto, borrarAdjunto, descargarAdjunto, subirAdjunto,
} from '../lib/api';
import { fechaHora } from '../lib/fechas';

function tamano(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

/** Propone el tipo según la extensión; el técnico puede cambiarlo antes de subir. */
function tipoPorNombre(nombre: string): TipoAdjunto {
  const n = nombre.toLowerCase();
  if (/\.(cex|ce3|cte|ctehexml|cerma|xml\.cex)$/.test(n)) return 'fichero_calculo';
  if (n.endsWith('.xml')) return 'certificado_xml';
  if (n.endsWith('.pdf')) return /firmad|signed|_firma/.test(n) ? 'certificado_firmado' : 'certificado_pdf';
  if (/\.(jpe?g|png|heic|webp)$/.test(n)) return 'foto';
  return 'otro';
}

export function Documentos({ expedienteId, adjuntos, onCambio, soloLectura }: {
  expedienteId: string;
  adjuntos: Adjunto[];
  onCambio: () => void;
  soloLectura?: boolean;
}) {
  const [fichero, setFichero] = useState<File | null>(null);
  const [tipo, setTipo] = useState<TipoAdjunto>('fichero_calculo');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const entrada = useRef<HTMLInputElement>(null);

  async function subir() {
    if (!fichero) return;
    setError('');
    setSubiendo(true);
    try {
      await subirAdjunto(expedienteId, tipo, fichero);
      setFichero(null);
      if (entrada.current) entrada.current.value = '';
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function descargar(a: Adjunto) {
    setError('');
    try {
      const blob = await descargarAdjunto(a);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = a.nombre;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function borrar(a: Adjunto) {
    if (!confirm(`¿Borrar «${a.nombre}»? No se puede deshacer.`)) return;
    setError('');
    try {
      await borrarAdjunto(a);
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="documentos">
      <h2>Documentos</h2>
      {adjuntos.length === 0 && <p className="vacio">Ningún documento todavía.</p>}
      {adjuntos.length > 0 && (
        <ul className="lista-documentos">
          {adjuntos.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.nombre}</strong>
                <div className="suave">{NOMBRE_TIPO_ADJUNTO[a.tipo]} · {tamano(a.tamano)} · {fechaHora(a.subido_en)}</div>
              </div>
              <div className="acciones">
                <button type="button" onClick={() => descargar(a)}>Descargar</button>
                {!soloLectura && <button type="button" className="peligro" onClick={() => borrar(a)}>Borrar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!soloLectura && (
        <div className="subir-documento">
          <label>Añadir documento
            <input ref={entrada} type="file" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFichero(f);
              if (f) setTipo(tipoPorNombre(f.name));
              if (f && f.size > TAMANO_MAXIMO) setError('El fichero supera los 25 MB.');
              else setError('');
            }} />
          </label>
          {fichero && (
            <>
              <label>Tipo de documento
                <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAdjunto)}>
                  {Object.entries(NOMBRE_TIPO_ADJUNTO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <button type="button" className="principal" disabled={subiendo || fichero.size > TAMANO_MAXIMO} onClick={subir}>
                {subiendo ? 'Subiendo…' : 'Subir'}
              </button>
            </>
          )}
        </div>
      )}
      {error && <div className="caja error">{error}</div>}
    </section>
  );
}
