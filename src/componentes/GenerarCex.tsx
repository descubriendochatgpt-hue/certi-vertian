import { useState } from 'react';
import type { Expediente } from '../lib/estados';
import type { TomaDatos } from '../lib/tomaDatos';
import { type ResultadoCex, escribirCex, nombreCex, rellenarPlantilla } from '../lib/cex/proyecto';

/**
 * Módulo 3, fase 2 (experimental): rellena una plantilla .cex vacía con los
 * datos del expediente. Todo ocurre en el navegador; nada se sube.
 */
export function GenerarCex({ exp, toma }: { exp: Expediente; toma: TomaDatos | null }) {
  const [resultado, setResultado] = useState<ResultadoCex | null>(null);
  const [error, setError] = useState('');

  async function elegir(f: File | undefined) {
    if (!f) return;
    setError('');
    setResultado(null);
    if (!toma) { setError('Este expediente aún no tiene toma de datos.'); return; }
    try {
      setResultado(rellenarPlantilla(new Uint8Array(await f.arrayBuffer()), exp, toma));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function descargar() {
    if (!resultado) return;
    const url = URL.createObjectURL(new Blob([escribirCex(resultado.proyecto) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreCex(exp);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <details className="seccion no-imprimir">
      <summary>Generar el proyecto .cex <span className="etiqueta experimental">experimental</span></summary>
      <p>
        Crea un fichero <code>.cex</code> que se abre en CE3X con los datos administrativos y generales ya puestos.
        Necesita una <strong>plantilla</strong>: en CE3X, crea un proyecto nuevo, rellena solo tus datos de técnico y
        guárdalo. Elige ese fichero aquí (se lee en tu dispositivo, no se sube).
      </p>
      <div className="campo">
        <label htmlFor="plantilla-cex">Plantilla .cex</label>
        <input id="plantilla-cex" type="file" accept=".cex" onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error && <div className="caja error">{error}</div>}
      {resultado && (
        <>
          {resultado.avisos.map((a) => <div key={a} className="caja aviso">{a}</div>)}
          <h3>Se rellenará</h3>
          <div className="tabla-desplazable">
            <table className="tabla">
              <thead><tr><th>Campo</th><th>En la plantilla</th><th>En el .cex</th></tr></thead>
              <tbody>{resultado.rellenados.map((r) => <tr key={r.etiqueta}><td>{r.etiqueta}</td><td>{r.antes || '—'}</td><td>{r.valor}</td></tr>)}</tbody>
            </table>
          </div>
          {resultado.pendientes.length > 0 && (
            <div className="caja aviso">
              <strong>Tendrás que completarlo en CE3X</strong> (usa la ficha de abajo):
              <ul className="lista-simple">{resultado.pendientes.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <p className="suave">
            Al abrirlo en CE3X revisa todas las pantallas antes de calificar. El cálculo y la comprobación son tuyos.
          </p>
          <div className="acciones">
            <button type="button" className="principal" onClick={descargar}>Descargar {nombreCex(exp)}</button>
          </div>
        </>
      )}
    </details>
  );
}
