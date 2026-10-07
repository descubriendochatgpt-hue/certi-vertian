import { useEffect, useState } from 'react';
import type { Expediente } from '../lib/estados';
import type { TomaDatos } from '../lib/tomaDatos';
import { type PlantillaCex, borrarSolucion, guardarPlantillaCex, guardarSoluciones, listarCatalogo, obtenerPlantillaCex } from '../lib/api';
import { type Solucion, aprenderDeCex, catalogoDePartida, unirCatalogos } from '../lib/cex/catalogo';
import { fechaHora } from '../lib/fechas';
import { type ResultadoCex, escribirCex, leerCex, nombreCex, rellenarPlantilla } from '../lib/cex/proyecto';

/**
 * Genera el proyecto .cex de CE3X con los datos del expediente y de la toma
 * de datos, a partir de la plantilla vacía del técnico (que se guarda la
 * primera vez). Todo se hace en el navegador.
 */
export function GenerarCex({ exp, toma, enTomaDatos = false }: { exp: Expediente; toma: TomaDatos | null; enTomaDatos?: boolean }) {
  const [plantilla, setPlantilla] = useState<PlantillaCex | null | undefined>(undefined);
  const [resultado, setResultado] = useState<ResultadoCex | null>(null);
  const [error, setError] = useState('');
  const [cambiando, setCambiando] = useState(false);

  const [propias, setPropias] = useState<Solucion[]>([]);
  const [aprendido, setAprendido] = useState('');

  useEffect(() => {
    obtenerPlantillaCex().then(setPlantilla).catch(() => setPlantilla(null));
    listarCatalogo().then(setPropias).catch(() => undefined);
  }, []);

  const catalogo = unirCatalogos(propias, catalogoDePartida());

  async function aprender(ficheros: FileList | null) {
    if (!ficheros?.length) return;
    setError('');
    setAprendido('');
    try {
      let nuevas = 0, vistas = 0;
      for (const f of Array.from(ficheros)) {
        const soluciones = aprenderDeCex(new Uint8Array(await f.arrayBuffer()), f.name.slice(0, 300));
        vistas += soluciones.length;
        nuevas += await guardarSoluciones(soluciones);
      }
      setPropias(await listarCatalogo());
      setAprendido(`${vistas} solución(es) encontradas, ${nuevas} nuevas en tu catálogo.`);
    } catch (e) {
      setError(`${(e as Error).message}${/catalogo_ce3x|relation|schema cache/i.test((e as Error).message) ? ' (¿falta ejecutar la migración 07?)' : ''}`);
    }
  }

  function descargar(r: ResultadoCex) {
    const url = URL.createObjectURL(new Blob([escribirCex(r.proyecto) as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreCex(exp);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function generar(bytes: Uint8Array) {
    setError('');
    if (!toma) { setError('Este expediente aún no tiene toma de datos.'); return; }
    try {
      const r = rellenarPlantilla(bytes, exp, toma, catalogo);
      setResultado(r);
      descargar(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function elegirPlantilla(f: File | undefined) {
    if (!f) return;
    setError('');
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const p = leerCex(bytes);   // comprueba que es un .cex
      rellenarPlantilla(bytes, exp, toma ?? { generales: {}, cerramientos: [], huecos: [], puentesTermicos: [], instalaciones: [], renovables: [], iluminacion: [], observaciones: '' }); // y que está vacía
      try {
        await guardarPlantillaCex(f.name, p.version, bytes);
        setPlantilla({ nombre: f.name, version: p.version, subida_en: new Date().toISOString(), bytes });
      } catch {
        // Sin la migración 06 no se puede guardar: se usa solo esta vez
        setPlantilla({ nombre: `${f.name} (sin guardar)`, version: p.version, subida_en: new Date().toISOString(), bytes });
      }
      setCambiando(false);
      generar(bytes);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const elegir = (
    <div className="campo">
      <label htmlFor={`plantilla-cex-${enTomaDatos ? 't' : 'f'}`}>
        {plantilla ? 'Nueva plantilla' : 'Tu plantilla de CE3X'} (proyecto vacío con tus datos de técnico)
      </label>
      <input id={`plantilla-cex-${enTomaDatos ? 't' : 'f'}`} type="file" accept=".cex"
             onChange={(e) => { void elegirPlantilla(e.target.files?.[0]); e.target.value = ''; }} />
      <small className="ayuda">
        En CE3X: proyecto nuevo, rellena solo «Datos del técnico certificador» y guárdalo. Se guarda aquí para las
        próximas veces (solo tú puedes verla).
      </small>
    </div>
  );

  return (
    <section className={`caja generar-cex no-imprimir${enTomaDatos ? ' en-toma' : ''}`}>
      <div className="titulo-con-accion">
        <h2>Fichero para CE3X <span className="etiqueta experimental">experimental</span></h2>
        {plantilla && !cambiando && (
          <button type="button" className="principal" disabled={!toma} onClick={() => generar(plantilla.bytes)}>⬇ Generar .cex</button>
        )}
      </div>
      {plantilla === undefined && <p className="cargando">Buscando tu plantilla…</p>}
      {plantilla && !cambiando && (
        <p className="suave">
          Plantilla: {plantilla.nombre} · {plantilla.version} · {fechaHora(plantilla.subida_en)}{' '}
          <button type="button" className="enlace" onClick={() => setCambiando(true)}>Cambiar</button>
        </p>
      )}
      {(plantilla === null || cambiando) && elegir}
      <details className="catalogo-ce3x">
        <summary>Catálogo de soluciones de CE3X ({catalogo.filter((c) => c.tipo !== 'puente').length})</summary>
        <p className="suave">
          Los muros, ventanas y equipos se copian al .cex desde proyectos reales de CE3X: así nunca llega a CE3X un valor que no
          reconozca. Sube proyectos tuyos ya terminados (.cex) para enseñarle más soluciones; de ellos solo se guardan la
          envolvente y las instalaciones, nunca los datos del cliente.
        </p>
        <div className="campo">
          <label htmlFor={`aprender-cex-${enTomaDatos ? 't' : 'f'}`}>Añadir proyectos de CE3X</label>
          <input id={`aprender-cex-${enTomaDatos ? 't' : 'f'}`} type="file" accept=".cex" multiple
                 onChange={(e) => { void aprender(e.target.files); e.target.value = ''; }} />
        </div>
        {aprendido && <div className="caja info" role="status">{aprendido}</div>}
        {(['cerramiento', 'hueco', 'instalacion'] as const).map((t) => (
          <div key={t}>
            <h3>{t === 'cerramiento' ? 'Cerramientos' : t === 'hueco' ? 'Huecos' : 'Instalaciones'}</h3>
            <ul className="lista-simple">
              {catalogo.filter((c) => c.tipo === t).map((c) => (
                <li key={c.clave}>
                  {c.etiqueta} <small className="suave">· {c.origen}</small>
                  {propias.some((x) => x.clave === c.clave) && (
                    <> <button type="button" className="enlace peligro" onClick={async () => {
                      if (!confirm('¿Quitar esta solución del catálogo?')) return;
                      try { await borrarSolucion(c.clave); setPropias(await listarCatalogo()); } catch (e) { setError((e as Error).message); }
                    }}>Quitar</button></>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
      {error && <div className="caja error">{error}</div>}
      {resultado && (
        <details className="resultado-cex" open>
          <summary>Descargado {nombreCex(exp)}: {resultado.rellenados.length} datos puestos, {resultado.pendientes.length} por completar en CE3X</summary>
          {resultado.avisos.map((a) => <div key={a} className="caja aviso">{a}</div>)}
          <div className="tabla-desplazable">
            <table className="tabla">
              <thead><tr><th>Dato</th><th>En el .cex</th></tr></thead>
              <tbody>{resultado.rellenados.map((r) => <tr key={r.etiqueta}><td>{r.etiqueta}</td><td>{r.valor}</td></tr>)}</tbody>
            </table>
          </div>
          {resultado.pendientes.length > 0 && (
            <div className="caja aviso">
              <strong>Completa en CE3X</strong> (la «Ficha para CE3X» los tiene ordenados):
              <ul className="lista-simple">{resultado.pendientes.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <p className="suave">Ábrelo en CE3X, revisa todas las pantallas y califica: el cálculo y la comprobación son tuyos.</p>
        </details>
      )}
    </section>
  );
}
