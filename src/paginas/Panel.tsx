import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listarExpedientes } from '../lib/api';
import { ESTADOS, type Expediente, NOMBRE_ESTADO } from '../lib/estados';
import { dentroDeMeses, diasHasta, fecha, hoyIso } from '../lib/fechas';
import { contarPorEstado, distribucionCalificaciones, firmadosPorAnio, firmadosPorMes } from '../lib/estadisticas';
import { generarCopia, registrarCopia, ultimaCopia } from '../lib/copiaSeguridad';
import { Calificacion, EtiquetaEstado } from '../componentes/EstadoExpediente';

const DIAS_AVISO_COPIA = 7;

export function Panel() {
  const [exps, setExps] = useState<Expediente[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listarExpedientes().then(setExps).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="pagina"><div className="caja error">{error}</div></main>;
  if (!exps) return <main className="pagina"><p className="cargando">Cargando…</p></main>;

  const porEstado = contarPorEstado(exps);
  const hoy = hoyIso();
  const proximasVisitas = exps.filter((e) => e.estado === 'visita_pendiente' && e.fecha_visita && e.fecha_visita >= hoy)
    .sort((a, b) => a.fecha_visita!.localeCompare(b.fecha_visita!)).slice(0, 8);
  const pendientes = exps.filter((e) => e.estado !== 'registrado' && !(e.estado === 'visita_pendiente' && e.fecha_visita && e.fecha_visita >= hoy))
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en)).slice(0, 10);
  const limite = dentroDeMeses(12);
  const vencimientos = exps.filter((e) => e.fecha_vencimiento && e.fecha_vencimiento <= limite)
    .sort((a, b) => a.fecha_vencimiento!.localeCompare(b.fecha_vencimiento!));
  const meses = firmadosPorMes(exps, 12);
  const anios = firmadosPorAnio(exps);
  const consumo = distribucionCalificaciones(exps, 'calificacion_consumo');
  const emisiones = distribucionCalificaciones(exps, 'calificacion_emisiones');

  return (
    <main className="pagina">
      <div className="titulo-con-accion">
        <h1>Panel</h1>
        <Link to="/expedientes/nuevo" className="boton principal">+ Nuevo expediente</Link>
      </div>

      <AvisoCopia />

      <ul className="tiles" aria-label="Expedientes por estado">
        {ESTADOS.map((e) => (
          <li key={e}>
            <Link to={`/expedientes?estado=${e}`} className="tile">
              <span className="tile-numero">{porEstado[e]}</span>
              <span className="tile-texto">{NOMBRE_ESTADO[e]}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="dos-columnas">
        <section>
          <h2>Pendientes</h2>
          {pendientes.length === 0 ? <p className="vacio">Nada pendiente.</p> : (
            <ul className="lista-panel">
              {pendientes.map((e) => (
                <li key={e.id}>
                  <Link to={`/expedientes/${e.id}`}><strong>{e.codigo}</strong> · {e.direccion}</Link>
                  <div className="pequeno"><EtiquetaEstado estado={e.estado} /> <span className="suave">{e.municipio}{e.fecha_visita ? ` · visita ${fecha(e.fecha_visita)}` : ''}</span></div>
                </li>
              ))}
            </ul>
          )}
          <h2>Próximas visitas</h2>
          {proximasVisitas.length === 0 ? <p className="vacio">No hay visitas programadas.</p> : (
            <ul className="lista-panel">
              {proximasVisitas.map((e) => (
                <li key={e.id}>
                  <Link to={`/expedientes/${e.id}`}><strong>{fecha(e.fecha_visita)}</strong> · {e.direccion}</Link>
                  <div className="pequeno suave">{e.municipio} · {e.propietario_nombre}{e.propietario_telefono ? ` · ${e.propietario_telefono}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Vencimientos (próximos 12 meses)</h2>
          {vencimientos.length === 0 ? <p className="vacio">Ningún certificado vence en los próximos 12 meses.</p> : (
            <ul className="lista-panel">
              {vencimientos.map((e) => {
                const dias = diasHasta(e.fecha_vencimiento!);
                return (
                  <li key={e.id}>
                    <Link to={`/expedientes/${e.id}`}><strong>{e.codigo}</strong> · {e.direccion}</Link>
                    <div className={`pequeno ${dias < 0 ? 'nota-error' : dias < 183 ? 'nota-aviso' : 'suave'}`}>
                      {dias < 0 ? `⚠ Venció el ${fecha(e.fecha_vencimiento)}` : `Vence el ${fecha(e.fecha_vencimiento)} (en ${dias} días)`}
                      {' · '}{e.propietario_nombre}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="suave pequeno">Buena ocasión para ofrecer la renovación al propietario.</p>
        </section>
      </div>

      <section>
        <h2>Certificados firmados por mes</h2>
        <GraficoBarras datos={meses.map((m) => ({ etiqueta: m.etiqueta, valor: m.total, titulo: `${m.etiqueta}: ${m.total} certificado(s)` }))}
                       nombre="Certificados firmados en los últimos 12 meses" />
        {anios.length > 0 && (
          <p className="pequeno">Por año: {anios.map((a) => `${a.anio}: ${a.total}`).join(' · ')}</p>
        )}
      </section>

      <div className="dos-columnas">
        {([['Calificación de consumo', consumo], ['Calificación de emisiones', emisiones]] as const).map(([titulo, dist]) => (
          <section key={titulo}>
            <h2>{titulo}</h2>
            <GraficoBarras letras datos={dist.tramos.map((t) => ({ etiqueta: t.letra, valor: t.total, titulo: `${t.letra}: ${t.total} certificado(s)` }))} nombre={titulo} />
            <p className="pequeno">{dist.masFrecuente.length ? <>Más frecuente: {dist.masFrecuente.map((l) => <Calificacion key={l} letra={l} />)}</> : 'Todavía no hay certificados firmados.'}</p>
          </section>
        ))}
      </div>
    </main>
  );
}

/**
 * Barras verticales en HTML. Una sola serie: sin leyenda (el título la nombra).
 * Con `letras`, cada barra lleva el color oficial de su letra de la etiqueta
 * energética, siempre con la letra escrita debajo (nunca solo color).
 */
function GraficoBarras({ datos, nombre, letras }: { datos: { etiqueta: string; valor: number; titulo: string }[]; nombre: string; letras?: boolean }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <figure className="grafico">
      <div className="grafico-area" role="img" aria-label={`${nombre}: ${datos.map((d) => `${d.etiqueta} ${d.valor}`).join(', ')}`}>
        {datos.map((d) => (
          <div key={d.etiqueta} className="grafico-columna" title={d.titulo}>
            <span className="grafico-valor">{d.valor > 0 ? d.valor : ''}</span>
            <div className={`grafico-barra ${letras ? `letra-${d.etiqueta}` : ''}`} style={{ height: `${(d.valor / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="grafico-ejes">{datos.map((d) => <span key={d.etiqueta}>{d.etiqueta}</span>)}</div>
      <details className="pequeno">
        <summary>Ver como tabla</summary>
        <table className="tabla"><tbody>{datos.map((d) => <tr key={d.etiqueta}><td>{d.etiqueta}</td><td>{d.valor}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

function AvisoCopia() {
  const [ultima, setUltima] = useState(ultimaCopia);
  const [progreso, setProgreso] = useState('');
  const [error, setError] = useState('');
  const dias = ultima ? Math.floor((Date.now() - ultima.getTime()) / 86_400_000) : null;

  async function copiar() {
    setError('');
    try {
      const { zip, fallidos } = await generarCopia(setProgreso);
      const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `copia-certificados-${hoyIso()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      registrarCopia();
      setUltima(new Date());
      setProgreso(fallidos.length ? `Copia descargada, pero ${fallidos.length} documento(s) no se pudieron incluir: ${fallidos.join(', ')}` : '');
    } catch (e) {
      setError((e as Error).message);
      setProgreso('');
    }
  }

  const atrasada = dias === null || dias >= DIAS_AVISO_COPIA;
  return (
    <section className={`caja ${atrasada ? 'aviso' : ''} copia`}>
      <div>
        <strong>Copia de seguridad</strong>
        <div className="pequeno">
          {ultima ? `Última copia desde este dispositivo: ${ultima.toLocaleDateString('es-ES')} (hace ${dias} día${dias === 1 ? '' : 's'}).` : 'Todavía no has hecho ninguna copia desde este dispositivo.'}
          {atrasada && ' Conviene hacer una al menos cada semana: el plan gratuito de Supabase no guarda copias.'}
        </div>
        {progreso && <div className="pequeno" role="status">{progreso}</div>}
        {error && <div className="nota-error">{error}</div>}
      </div>
      <button type="button" className={atrasada ? 'principal' : ''} onClick={copiar} disabled={Boolean(progreso) && !progreso.startsWith('Copia')}>
        Descargar copia completa
      </button>
    </section>
  );
}
