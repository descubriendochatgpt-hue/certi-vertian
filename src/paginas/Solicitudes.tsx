import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listarSolicitudes, resolverSolicitud } from '../lib/api';
import { fechaHora } from '../lib/fechas';
import { type EstadoSolicitud, type SolicitudCrm, leerDatosCrm, propuestaDesdeCrm, resumenSolicitud } from '../lib/solicitudesCrm';

/**
 * Bandeja de solicitudes que llegan del CRM. Ninguna se convierte sola en
 * expediente: «Crear expediente» abre el formulario ya relleno para revisarlo.
 */
export function Solicitudes() {
  const [filtro, setFiltro] = useState<EstadoSolicitud | 'todas'>('pendiente');
  const [lista, setLista] = useState<SolicitudCrm[] | null>(null);
  const [error, setError] = useState('');

  const cargar = () => {
    setError('');
    listarSolicitudes(filtro).then(setLista).catch((e: Error) => {
      setLista([]);
      setError(/solicitudes_crm/.test(e.message)
        ? 'Falta preparar la base de datos: ejecuta la migración 05 (ver README, «Conexión con el CRM»).'
        : e.message);
    });
  };
  useEffect(cargar, [filtro]);

  async function cambiar(s: SolicitudCrm, estado: EstadoSolicitud) {
    try { await resolverSolicitud(s.id, estado); cargar(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <main className="pagina">
      <h1>Solicitudes del CRM</h1>
      <p className="subtitulo">
        Encargos de certificado que los clientes han rellenado en la web. Al crear el expediente revisas los datos
        antes de guardarlos.
      </p>
      <div className="acciones">
        <label className="campo-casilla">Mostrar:
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoSolicitud | 'todas')}>
            <option value="pendiente">Pendientes</option>
            <option value="importada">Con expediente</option>
            <option value="descartada">Descartadas</option>
            <option value="todas">Todas</option>
          </select>
        </label>
      </div>
      {error && <div className="caja error">{error}</div>}
      {lista === null && <p className="cargando">Cargando…</p>}
      {lista?.length === 0 && !error && <p className="vacio">No hay solicitudes {filtro === 'pendiente' ? 'pendientes' : 'aquí'}.</p>}
      <ul className="tarjetas">
        {lista?.map((s) => {
          const d = leerDatosCrm(s.datos);
          const p = propuestaDesdeCrm(d);
          return (
            <li key={s.id} className="tarjeta">
              <div className="tarjeta-cabecera">
                <strong>{resumenSolicitud(d)}</strong>
                <span className="suave">{d.referencia_crm || s.referencia}</span>
              </div>
              <div className="tarjeta-pie suave">
                {d.servicio && <span>{d.servicio}</span>}
                <span>Recibida {fechaHora(s.recibida_en)}</span>
                {s.actualizada_en !== s.recibida_en && <span>Actualizada {fechaHora(s.actualizada_en)}</span>}
                {d.visita && <span>Visita {fechaHora(d.visita)}</span>}
                {p.referencia_catastral && <span>RC {p.referencia_catastral}</span>}
              </div>
              {s.estado === 'pendiente' && s.expediente_id && (
                <p className="nota-aviso">El cliente ha cambiado datos después de crear el expediente: revísalos.</p>
              )}
              <div className="acciones">
                {s.estado === 'pendiente' && !s.expediente_id && (
                  <Link className="boton principal" to={`/expedientes/nuevo?solicitud=${s.id}`}>Crear expediente</Link>
                )}
                {s.expediente_id && <Link className="boton" to={`/expedientes/${s.expediente_id}`}>Ver expediente</Link>}
                {s.estado === 'pendiente' && s.expediente_id && (
                  <>
                    <Link className="boton principal" to={`/expedientes/${s.expediente_id}/editar?solicitud=${s.id}`}>Revisar los cambios</Link>
                    <button type="button" onClick={() => cambiar(s, 'importada')}>Sin cambios que aplicar</button>
                  </>
                )}
                {s.estado === 'pendiente' && !s.expediente_id && (
                  <button type="button" onClick={() => { if (confirm('¿Descartar esta solicitud? Podrás recuperarla desde «Descartadas».')) cambiar(s, 'descartada'); }}>
                    Descartar
                  </button>
                )}
                {s.estado === 'descartada' && <button type="button" onClick={() => cambiar(s, 'pendiente')}>Recuperar</button>}
                {d.enlace_crm && <a className="boton" href={d.enlace_crm} target="_blank" rel="noopener noreferrer">Abrir en el CRM</a>}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
