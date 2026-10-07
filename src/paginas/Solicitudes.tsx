import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { descartarEncargo, listarEncargos } from '../lib/api';
import { fechaHora } from '../lib/fechas';
import { type EncargoCrm, claveEncargo, enlaceCrm, leerEncargo, resumenEncargo } from '../lib/encargosCrm';

type Filtro = 'pendientes' | 'con_expediente' | 'descartados' | 'todos';

/**
 * Encargos de certificado del CRM (misma base de datos). Ninguno se convierte
 * solo en expediente: «Crear expediente» abre el formulario ya relleno.
 */
export function Solicitudes() {
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [lista, setLista] = useState<EncargoCrm[] | null>(null);
  const [error, setError] = useState('');

  const cargar = () => {
    setError('');
    listarEncargos().then(setLista).catch((e: Error) => {
      setLista([]);
      setError(/encargos_certificado|function|schema cache/i.test(e.message)
        ? 'Falta preparar la base de datos: ejecuta la migración 05 en el Supabase del CRM (ver README, «Conexión con el CRM»).'
        : e.message);
    });
  };
  useEffect(cargar, []);

  async function descartar(e: EncargoCrm, si: boolean) {
    try { await descartarEncargo(e, si); cargar(); } catch (err) { setError((err as Error).message); }
  }

  const visibles = (lista ?? []).filter((e) =>
    filtro === 'todos' ? true
    : filtro === 'descartados' ? e.descartado
    : filtro === 'con_expediente' ? Boolean(e.expediente_id)
    : !e.expediente_id && !e.descartado);

  return (
    <main className="pagina">
      <h1>Solicitudes del CRM</h1>
      <p className="subtitulo">
        Encargos de certificado del CRM con los datos que ha rellenado el cliente. Al crear el expediente revisas los
        datos antes de guardarlos.
      </p>
      <div className="acciones">
        <label className="campo-casilla">Mostrar:
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            <option value="pendientes">Pendientes</option>
            <option value="con_expediente">Con expediente</option>
            <option value="descartados">Descartadas</option>
            <option value="todos">Todas</option>
          </select>
        </label>
      </div>
      {error && <div className="caja error">{error}</div>}
      {lista === null && <p className="cargando">Cargando…</p>}
      {lista !== null && visibles.length === 0 && !error && <p className="vacio">No hay solicitudes {filtro === 'pendientes' ? 'pendientes' : 'aquí'}.</p>}
      <ul className="tarjetas">
        {visibles.map((e) => {
          const d = leerEncargo(e);
          const crm = enlaceCrm(e);
          return (
            <li key={claveEncargo(e)} className="tarjeta">
              <div className="tarjeta-cabecera">
                <strong>{resumenEncargo(d)}</strong>
                <span className="suave">{d.referencia}</span>
              </div>
              <div className="tarjeta-pie suave">
                {d.servicio && <span>{d.servicio}</span>}
                <span>Recibido {fechaHora(e.recibido_en)}</span>
                {d.visita && <span>Visita {fechaHora(d.visita)}</span>}
                {d.inmueble.ref_catastral && <span>RC {d.inmueble.ref_catastral}</span>}
                {e.estado_crm && <span>En el CRM: {e.estado_crm}</span>}
              </div>
              <div className="acciones">
                {!e.expediente_id && !e.descartado && (
                  <Link className="boton principal" to={`/expedientes/nuevo?encargo=${claveEncargo(e)}`}>Crear expediente</Link>
                )}
                {e.expediente_id && <Link className="boton" to={`/expedientes/${e.expediente_id}`}>Ver expediente</Link>}
                {!e.expediente_id && !e.descartado && (
                  <button type="button" onClick={() => { if (confirm('¿Quitar esta solicitud de pendientes? En el CRM no cambia nada; podrás recuperarla desde «Descartadas».')) descartar(e, true); }}>
                    Descartar
                  </button>
                )}
                {e.descartado && <button type="button" onClick={() => descartar(e, false)}>Recuperar</button>}
                {crm && <a className="boton" href={crm} target="_blank" rel="noopener noreferrer">Abrir en el CRM</a>}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
