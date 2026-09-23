import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { borrarExpediente, cambiarEstado, historial, obtenerExpediente } from '../lib/api';
import {
  type AnotacionHistorial, CALIFICACIONES, type Calificacion as Letra, DECLARACION_ESTADO, type Estado,
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

  const cargar = useCallback(async () => {
    try {
      const [exp, h] = await Promise.all([obtenerExpediente(id), historial(id)]);
      setE(exp);
      setHist(h);
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
        {e.estado === 'visita_pendiente' ? (
          <>
            <p><strong>Siguiente paso:</strong> rellenar la toma de datos de la visita y, una vez revisada, verificarla.</p>
            <Link to={`/expedientes/${e.id}/toma-datos`} className="boton principal">Toma de datos de la visita</Link>
          </>
        ) : (
          <>
            {siguiente && <p><strong>Siguiente paso:</strong> {NOMBRE_ESTADO[siguiente]}.</p>}
            {!siguiente && <p><strong>Expediente completado.</strong> Certificado registrado.</p>}
            <div className="acciones">
              {siguiente && <button className="principal" onClick={() => setAccion('avanzar')}>Confirmar: {NOMBRE_ESTADO[siguiente]}…</button>}
              <Link to={`/expedientes/${e.id}/toma-datos`} className="boton">Ver datos de la visita</Link>
            </div>
          </>
        )}
        {anterior && (
          <p><button className="enlace" onClick={() => setAccion('retroceder')}>Devolver a «{NOMBRE_ESTADO[anterior]}»…</button></p>
        )}
      </section>

      {accion === 'avanzar' && siguiente && (
        <DialogoAvanzar expediente={e} destino={siguiente} onCerrar={() => setAccion(null)} onHecho={() => { setAccion(null); cargar(); }} />
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
            <dt>Calificación</dt><dd>Consumo <Calificacion letra={e.calificacion_consumo} /> · Emisiones <Calificacion letra={e.calificacion_emisiones} /></dd>
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

function DialogoAvanzar({ expediente: e, destino, onCerrar, onHecho }: PropsDialogo & { destino: Estado }) {
  const [declarado, setDeclarado] = useState(false);
  const [fechaAccion, setFechaAccion] = useState(hoyIso());
  const [consumo, setConsumo] = useState<Letra | ''>('');
  const [emisiones, setEmisiones] = useState<Letra | ''>('');
  const [numero, setNumero] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    if (!declarado) { setError('Marca la casilla de confirmación.'); return; }
    if (destino === 'certificado_firmado' && (!consumo || !emisiones)) { setError('Indica las dos calificaciones.'); return; }
    setEnviando(true);
    try {
      await cambiarEstado(e.id, {
        destino,
        nota: nota.trim() || undefined,
        fecha: destino === 'certificado_firmado' || destino === 'registrado' ? fechaAccion : undefined,
        calificacionConsumo: consumo || undefined,
        calificacionEmisiones: emisiones || undefined,
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
        {destino === 'calculo_revisado' && (
          <p className="suave">El cálculo se hace en el programa oficial (CE3X, CE3, CERMA…), fuera de esta herramienta. En el módulo 4 podrás registrar aquí sus resultados.</p>
        )}
        {destino === 'certificado_firmado' && (
          <>
            <label>Fecha de firma
              <input type="date" required value={fechaAccion} max={hoyIso()} onChange={(ev) => setFechaAccion(ev.target.value)} />
            </label>
            <div className="fila-campos">
              <label>Calificación de consumo
                <select required value={consumo} onChange={(ev) => setConsumo(ev.target.value as Letra)}>
                  <option value="">—</option>{CALIFICACIONES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <label>Calificación de emisiones
                <select required value={emisiones} onChange={(ev) => setEmisiones(ev.target.value as Letra)}>
                  <option value="">—</option>{CALIFICACIONES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
            </div>
            {(consumo === 'G' || emisiones === 'G') && <p className="nota-aviso">Con calificación G la validez es de 5 años.</p>}
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
