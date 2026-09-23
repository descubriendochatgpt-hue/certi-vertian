import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type Adjunto, borrarExpediente, cambiarEstado, historial, listarAdjuntos, obtenerChecklist, obtenerExpediente, obtenerResultados,
} from '../lib/api';
import type { Resultados } from '../lib/resultados';
import { Documentos } from '../componentes/Documentos';
import {
  type AnotacionHistorial, DECLARACION_ESTADO, type Estado,
  type Expediente, NOMBRE_ESTADO, NOMBRE_TIPO_EDIFICIO, estadoAnterior, siguienteEstado,
} from '../lib/estados';
import { fecha, fechaHora, hoyIso } from '../lib/fechas';
import { formatearNumero } from '../lib/validaciones';
import { Calificacion, EtiquetaEstado, PasosEstado } from '../componentes/EstadoExpediente';

export function DetalleExpediente() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const [e, setE] = useState<Expediente | null>(null);
  const [hist, setHist] = useState<AnotacionHistorial[]>([]);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [accion, setAccion] = useState<'avanzar' | 'retroceder' | 'borrar' | null>(null);
  const [res, setRes] = useState<Resultados | null>(null);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [checklist, setChecklist] = useState<{ hechos: number; total: number }>({ hechos: 0, total: 0 });

  const cargar = useCallback(async () => {
    try {
      const [exp, h, r, a, c] = await Promise.all([obtenerExpediente(id), historial(id), obtenerResultados(id), listarAdjuntos(id), obtenerChecklist(id)]);
      setE(exp);
      setHist(h);
      setRes(r);
      setAdjuntos(a);
      setChecklist({ hechos: c.filter((p) => p.marcado_en).length, total: c.length });
      if (!exp) setError('Expediente no encontrado.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;
  if (!e) return <main className="pagina"><div className="caja error">{error}</div><Link to="/">← Volver</Link></main>;

  const siguiente = siguienteEstado(e.estado);
  const anterior = estadoAnterior(e.estado);

  return (
    <main className="pagina">
      <p><Link to="/">← Expedientes</Link></p>
      <div className="titulo-con-accion">
        <h1>{e.codigo}</h1>
        <EtiquetaEstado estado={e.estado} />
      </div>
      <p className="subtitulo">{e.direccion} · {e.municipio}</p>

      <PasosEstado estado={e.estado} />

      <section className="caja siguiente-paso">
        {e.estado === 'visita_pendiente' && (
          <>
            <p><strong>Siguiente paso:</strong> rellenar la toma de datos de la visita y, una vez revisada, verificarla.</p>
            <Link to={`/expedientes/${e.id}/toma-datos`} className="boton principal">Toma de datos de la visita</Link>
          </>
        )}
        {e.estado === 'datos_introducidos' && (
          <>
            <p><strong>Siguiente paso:</strong> hacer el cálculo en el programa oficial y registrar aquí sus resultados (puedes importarlos del PDF del certificado).</p>
            <div className="acciones">
              <Link to={`/expedientes/${e.id}/resultados`} className="boton principal">Resultados del cálculo</Link>
              <Link to={`/expedientes/${e.id}/toma-datos`} className="boton">Ver datos de la visita</Link>
            </div>
          </>
        )}
        {e.estado === 'calculo_revisado' && (
          <>
            <p><strong>Siguiente paso:</strong> completar el checklist de revisión ({checklist.hechos} de {checklist.total}), firmar el certificado y marcarlo como firmado.</p>
            <div className="acciones">
              <Link to={`/expedientes/${e.id}/revision`} className={`boton ${checklist.hechos < checklist.total ? 'principal' : ''}`}>Checklist de revisión</Link>
              <button className={checklist.hechos === checklist.total ? 'principal' : ''} disabled={checklist.total === 0 || checklist.hechos < checklist.total}
                      onClick={() => setAccion('avanzar')}>Confirmar: Certificado firmado…</button>
            </div>
            {checklist.hechos < checklist.total && <p className="suave">Para marcarlo como firmado hay que completar antes el checklist.</p>}
          </>
        )}
        {(e.estado === 'certificado_firmado' || e.estado === 'registrado') && (
          <>
            {siguiente ? <p><strong>Siguiente paso:</strong> {NOMBRE_ESTADO[siguiente]}.</p> : <p><strong>Expediente completado.</strong> Certificado registrado.</p>}
            <div className="acciones">
              {siguiente && <button className="principal" onClick={() => setAccion('avanzar')}>Confirmar: {NOMBRE_ESTADO[siguiente]}…</button>}
              <Link to={`/expedientes/${e.id}/revision`} className="boton">Ver checklist</Link>
            </div>
          </>
        )}
        {e.estado !== 'visita_pendiente' && (
          <p className="enlaces-secundarios">
            <Link to={`/expedientes/${e.id}/toma-datos`}>Datos de la visita</Link>
            {e.estado !== 'datos_introducidos' && <> · <Link to={`/expedientes/${e.id}/resultados`}>Resultados</Link></>}
          </p>
        )}
        {anterior && (
          <p><button className="enlace" onClick={() => setAccion('retroceder')}>Devolver a «{NOMBRE_ESTADO[anterior]}»…</button></p>
        )}
      </section>

      {accion === 'avanzar' && siguiente && (
        <DialogoAvanzar expediente={e} destino={siguiente} resultados={res} onCerrar={() => setAccion(null)} onHecho={() => { setAccion(null); cargar(); }} />
      )}
      {accion === 'retroceder' && anterior && (
        <DialogoRetroceder expediente={e} destino={anterior} onCerrar={() => setAccion(null)} onHecho={() => { setAccion(null); cargar(); }} />
      )}

      <div className="dos-columnas">
        <section>
          <h2>Inmueble</h2>
          <dl className="datos">
            <dt>Dirección</dt><dd>{e.direccion}</dd>
            <dt>Municipio</dt><dd>{e.municipio}{e.codigo_postal ? ` (${e.codigo_postal})` : ''}</dd>
            <dt>Ref. catastral</dt><dd>{e.referencia_catastral ?? '—'}</dd>
            <dt>Tipo</dt><dd>{NOMBRE_TIPO_EDIFICIO[e.tipo_edificio]}</dd>
            <dt>Superficie útil</dt><dd>{e.superficie_util ? `${formatearNumero(Number(e.superficie_util))} m²` : '—'}</dd>
            <dt>Año de construcción</dt><dd>{e.anio_construccion ?? '—'}</dd>
            <dt>Fecha de visita</dt><dd>{fecha(e.fecha_visita)}</dd>
          </dl>
        </section>
        <section>
          <h2>Propietario / promotor</h2>
          <dl className="datos">
            <dt>Nombre</dt><dd>{e.propietario_nombre}</dd>
            <dt>NIF</dt><dd>{e.propietario_nif ?? '—'}</dd>
            <dt>Teléfono</dt><dd>{e.propietario_telefono ? <a href={`tel:${e.propietario_telefono}`}>{e.propietario_telefono}</a> : '—'}</dd>
            <dt>Email</dt><dd>{e.propietario_email ? <a href={`mailto:${e.propietario_email}`}>{e.propietario_email}</a> : '—'}</dd>
          </dl>
          <h2>Certificado</h2>
          <dl className="datos">
            <dt>Calificación</dt><dd>{res?.calificacion_consumo
              ? <>Consumo <Calificacion letra={res.calificacion_consumo} /> {res.consumo_ep_nr !== null && `${formatearNumero(res.consumo_ep_nr)} kWh/m²·año`} · Emisiones <Calificacion letra={res.calificacion_emisiones} /> {res.emisiones_co2 !== null && `${formatearNumero(res.emisiones_co2)} kgCO₂/m²·año`}{!res.confirmado_en && <span className="suave"> (sin confirmar)</span>}</>
              : <>—</>}</dd>
            <dt>Fecha de firma</dt><dd>{fecha(e.fecha_firma)}</dd>
            <dt>Vence</dt><dd>{fecha(e.fecha_vencimiento)}</dd>
            <dt>Registro</dt><dd>{e.fecha_registro ? `${fecha(e.fecha_registro)}${e.numero_registro ? ` · nº ${e.numero_registro}` : ''}` : '—'}</dd>
          </dl>
        </section>
      </div>
      {e.notas && <section><h2>Notas</h2><p className="texto-libre">{e.notas}</p></section>}

      <div className="acciones">
        <Link to={`/expedientes/${e.id}/editar`} className="boton">Editar datos del expediente</Link>
        {e.estado === 'visita_pendiente' && <button className="peligro" onClick={() => setAccion('borrar')}>Borrar expediente…</button>}
      </div>
      {accion === 'borrar' && (
        <DialogoBorrar expediente={e} onCerrar={() => setAccion(null)} onHecho={() => navegar('/')} />
      )}

      <Documentos expedienteId={e.id} adjuntos={adjuntos} soloLectura={e.estado === 'registrado'}
                  onCambio={() => listarAdjuntos(e.id).then(setAdjuntos).catch((err: Error) => setError(err.message))} />

      <section>
        <h2>Historial</h2>
        <ol className="historial">
          {hist.map((h) => (
            <li key={h.id}>
              <span className="suave">{fechaHora(h.creado_en)}</span>{' '}
              {h.estado_anterior ? <>{NOMBRE_ESTADO[h.estado_anterior]} → <strong>{NOMBRE_ESTADO[h.estado_nuevo]}</strong></> : <strong>{NOMBRE_ESTADO[h.estado_nuevo]}</strong>}
              {h.nota && <div className="nota-historial">{h.nota}</div>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

// ─────────────────────────────── Diálogos ─────────────────────────────────

function Dialogo({ titulo, children, onCerrar }: { titulo: string; children: ReactNode; onCerrar: () => void }) {
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCerrar]);
  return (
    <div className="fondo-dialogo" onClick={onCerrar}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={titulo} onClick={(ev) => ev.stopPropagation()}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

interface PropsDialogo { expediente: Expediente; onCerrar: () => void; onHecho: () => void }

function DialogoAvanzar({ expediente: e, destino, resultados, onCerrar, onHecho }: PropsDialogo & { destino: Estado; resultados: Resultados | null }) {
  const [declarado, setDeclarado] = useState(false);
  const [fechaAccion, setFechaAccion] = useState(hoyIso());
  const [numero, setNumero] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    if (!declarado) { setError('Marca la casilla de confirmación.'); return; }
    setEnviando(true);
    try {
      await cambiarEstado(e.id, {
        destino,
        nota: nota.trim() || undefined,
        fecha: destino === 'certificado_firmado' || destino === 'registrado' ? fechaAccion : undefined,
        numeroRegistro: numero.trim() || undefined,
      });
      onHecho();
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <Dialogo titulo={`Pasar a «${NOMBRE_ESTADO[destino]}»`} onCerrar={onCerrar}>
      <form onSubmit={confirmar} className="formulario">
        {destino === 'certificado_firmado' && (
          <>
            <p>Calificación que constará en el certificado (de los resultados confirmados):{' '}
              Consumo <Calificacion letra={resultados?.calificacion_consumo ?? null} /> · Emisiones <Calificacion letra={resultados?.calificacion_emisiones ?? null} /></p>
            <label>Fecha de firma
              <input type="date" required value={fechaAccion} max={hoyIso()} onChange={(ev) => setFechaAccion(ev.target.value)} />
            </label>
            {(resultados?.calificacion_consumo === 'G' || resultados?.calificacion_emisiones === 'G') && <p className="nota-aviso">Con calificación G la validez es de 5 años.</p>}
          </>
        )}
        {destino === 'registrado' && (
          <>
            <p className="suave">La presentación en la sede electrónica la haces tú; aquí solo se anota que está hecha.</p>
            <label>Fecha de registro
              <input type="date" required value={fechaAccion} max={hoyIso()} onChange={(ev) => setFechaAccion(ev.target.value)} />
            </label>
            <label>Número de registro o de entrada (opcional)
              <input value={numero} onChange={(ev) => setNumero(ev.target.value)} />
            </label>
          </>
        )}
        <label>Nota (opcional)
          <input value={nota} onChange={(ev) => setNota(ev.target.value)} />
        </label>
        <label className="declaracion">
          <input type="checkbox" checked={declarado} onChange={(ev) => setDeclarado(ev.target.checked)} /> {DECLARACION_ESTADO[destino]}
        </label>
        {error && <div className="caja error">{error}</div>}
        <div className="acciones">
          <button type="submit" className="principal" disabled={!declarado || enviando}>Confirmar</button>
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function DialogoRetroceder({ expediente: e, destino, onCerrar, onHecho }: PropsDialogo & { destino: Estado }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const efectos: Partial<Record<Estado, string>> = {
    datos_introducidos: 'Los datos de la visita dejarán de estar verificados y podrás volver a editarlos.',
    certificado_firmado: 'Se borrarán la fecha de firma y las calificaciones anotadas.',
    registrado: 'Se borrarán la fecha y el número de registro anotados.',
  };

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    if (!motivo.trim()) { setError('Indica el motivo.'); return; }
    try {
      await cambiarEstado(e.id, { destino, nota: motivo.trim() });
      onHecho();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialogo titulo={`Devolver a «${NOMBRE_ESTADO[destino]}»`} onCerrar={onCerrar}>
      <form onSubmit={confirmar} className="formulario">
        {efectos[e.estado] && <p>{efectos[e.estado]}</p>}
        <label>Motivo (queda en el historial)
          <input required value={motivo} onChange={(ev) => setMotivo(ev.target.value)} autoFocus />
        </label>
        {error && <div className="caja error">{error}</div>}
        <div className="acciones">
          <button type="submit" className="principal">Devolver</button>
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}

function DialogoBorrar({ expediente: e, onCerrar, onHecho }: PropsDialogo) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    try {
      await borrarExpediente(e.id);
      onHecho();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Dialogo titulo="Borrar expediente" onCerrar={onCerrar}>
      <form onSubmit={confirmar} className="formulario">
        <p>Se borrarán el expediente <strong>{e.codigo}</strong> y sus datos de visita. No se puede deshacer.</p>
        <label>Escribe el código <strong>{e.codigo}</strong> para confirmar
          <input value={texto} onChange={(ev) => setTexto(ev.target.value)} autoFocus />
        </label>
        {error && <div className="caja error">{error}</div>}
        <div className="acciones">
          <button type="submit" className="peligro" disabled={texto.trim() !== e.codigo}>Borrar</button>
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </Dialogo>
  );
}
