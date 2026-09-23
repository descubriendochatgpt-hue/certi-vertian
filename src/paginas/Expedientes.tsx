import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type FiltrosExpedientes, listarExpedientes, listarMunicipios, listarVencimientos } from '../lib/api';
import { ESTADOS, type Estado, type Expediente, NOMBRE_ESTADO } from '../lib/estados';
import { dentroDeMeses, diasHasta, fecha } from '../lib/fechas';
import { Calificacion, EtiquetaEstado } from '../componentes/EstadoExpediente';

/** Se avisa de los vencimientos con 6 meses de antelación. */
const MESES_ANTELACION = 6;

export function Expedientes() {
  const [params, setParams] = useSearchParams();
  const filtros: FiltrosExpedientes = {
    estado: (params.get('estado') ?? '') as Estado | '',
    municipio: params.get('municipio') ?? '',
    desde: params.get('desde') ?? '',
    hasta: params.get('hasta') ?? '',
    texto: params.get('texto') ?? '',
  };
  const [expedientes, setExpedientes] = useState<Expediente[] | null>(null);
  const [vencimientos, setVencimientos] = useState<Expediente[]>([]);
  const [municipios, setMunicipios] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState(filtros.texto ?? '');

  const clave = params.toString();
  useEffect(() => {
    let vivo = true;
    setError('');
    listarExpedientes(filtros)
      .then((e) => vivo && setExpedientes(e))
      .catch((e: Error) => vivo && setError(e.message));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  useEffect(() => {
    listarVencimientos(dentroDeMeses(MESES_ANTELACION)).then(setVencimientos).catch(() => {});
    listarMunicipios().then(setMunicipios).catch(() => {});
  }, []);

  function filtrar(campo: keyof FiltrosExpedientes, valor: string) {
    const p = new URLSearchParams(params);
    if (valor) p.set(campo, valor); else p.delete(campo);
    setParams(p, { replace: true });
  }

  const vencidos = vencimientos.filter((e) => diasHasta(e.fecha_vencimiento!) < 0);
  const proximos = vencimientos.filter((e) => diasHasta(e.fecha_vencimiento!) >= 0);
  const hayFiltros = [...params.keys()].length > 0;

  return (
    <main className="pagina">
      <div className="titulo-con-accion">
        <h1>Expedientes</h1>
        <Link to="/expedientes/nuevo" className="boton principal">+ Nuevo expediente</Link>
      </div>

      {(vencidos.length > 0 || proximos.length > 0) && (
        <section className="caja aviso">
          <strong>Vencimientos</strong>
          <ul className="lista-simple">
            {vencidos.map((e) => (
              <li key={e.id}><Link to={`/expedientes/${e.id}`}>{e.codigo} · {e.direccion}</Link> — <strong>venció el {fecha(e.fecha_vencimiento)}</strong></li>
            ))}
            {proximos.map((e) => (
              <li key={e.id}><Link to={`/expedientes/${e.id}`}>{e.codigo} · {e.direccion}</Link> — vence el {fecha(e.fecha_vencimiento)} (en {diasHasta(e.fecha_vencimiento!)} días)</li>
            ))}
          </ul>
          <small className="suave">Validez de 10 años desde la firma, o 5 si alguna calificación es G. Se avisa con {MESES_ANTELACION} meses de antelación.</small>
        </section>
      )}

      <form className="filtros" onSubmit={(e) => { e.preventDefault(); filtrar('texto', texto.trim()); }}>
        <label>Buscar
          <input type="search" placeholder="Código, dirección, propietario o ref. catastral" value={texto} onChange={(e) => setTexto(e.target.value)}
                 onBlur={() => texto.trim() !== (filtros.texto ?? '') && filtrar('texto', texto.trim())} />
        </label>
        <label>Estado
          <select value={filtros.estado} onChange={(e) => filtrar('estado', e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((s) => <option key={s} value={s}>{NOMBRE_ESTADO[s]}</option>)}
          </select>
        </label>
        <label>Municipio
          <select value={filtros.municipio} onChange={(e) => filtrar('municipio', e.target.value)}>
            <option value="">Todos</option>
            {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>Visita desde
          <input type="date" value={filtros.desde} onChange={(e) => filtrar('desde', e.target.value)} />
        </label>
        <label>Visita hasta
          <input type="date" value={filtros.hasta} onChange={(e) => filtrar('hasta', e.target.value)} />
        </label>
        {hayFiltros && <button type="button" className="enlace" onClick={() => { setTexto(''); setParams({}, { replace: true }); }}>Quitar filtros</button>}
      </form>

      {error && <div className="caja error">{error}</div>}
      {!expedientes && !error && <p className="cargando">Cargando…</p>}
      {expedientes && expedientes.length === 0 && (
        <p className="vacio">{hayFiltros ? 'Ningún expediente coincide con los filtros.' : 'Todavía no hay expedientes. Crea el primero con «+ Nuevo expediente».'}</p>
      )}

      {expedientes && expedientes.length > 0 && (
        <>
          <p className="suave">{expedientes.length} expediente{expedientes.length === 1 ? '' : 's'}</p>
          <ul className="tarjetas">
            {expedientes.map((e) => (
              <li key={e.id}>
                <Link to={`/expedientes/${e.id}`} className="tarjeta">
                  <div className="tarjeta-cabecera">
                    <strong>{e.codigo}</strong>
                    <EtiquetaEstado estado={e.estado} />
                  </div>
                  <div>{e.direccion}</div>
                  <div className="suave">{e.municipio} · {e.propietario_nombre}</div>
                  <div className="suave tarjeta-pie">
                    <span>Visita: {fecha(e.fecha_visita)}</span>
                    {e.calificacion_consumo && <span>Calificación: <Calificacion letra={e.calificacion_consumo} /> <Calificacion letra={e.calificacion_emisiones} /></span>}
                    {e.fecha_vencimiento && <span>Vence: {fecha(e.fecha_vencimiento)}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
