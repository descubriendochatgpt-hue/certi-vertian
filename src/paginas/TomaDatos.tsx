import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cambiarEstado, guardarTomaDatos, obtenerExpediente, obtenerTomaDatos } from '../lib/api';
import { DECLARACION_ESTADO, type Expediente, esResidencial } from '../lib/estados';
import { diasHasta, fecha, fechaHora } from '../lib/fechas';
import {
  CAMPOS_GENERALES, type DefCampo, type DefSeccion, type Fila, SECCIONES, type TomaDatos as Datos, type Valor,
  comprobarTomaDatos, rangoDe, tomaDatosVacia,
} from '../lib/tomaDatos';
import { comprobarRango } from '../lib/validaciones';
import { CampoNumero, CampoOpcion, CampoSiNo, CampoTexto, ConfirmarAvisos } from '../componentes/Campos';
import { type CopiaLocal, borrarCopiaLocal, guardarCopiaLocal, leerCopiaLocal } from '../lib/copiaLocal';

type EstadoGuardado = 'guardado' | 'pendiente' | 'guardando' | 'sin_conexion' | 'error';

/** Cada cuánto se sube el borrador al servidor si hay cambios. */
const INTERVALO_AUTOGUARDADO_MS = 20_000;

const nuevoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function TomaDatos() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const [exp, setExp] = useState<Expediente | null>(null);
  const [datos, setDatos] = useState<Datos>(tomaDatosVacia());
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [verificadoEn, setVerificadoEn] = useState<string | null>(null);
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null);
  const [estadoGuardado, setEstadoGuardado] = useState<EstadoGuardado>('guardado');
  const [copiaPendiente, setCopiaPendiente] = useState<CopiaLocal | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [declarado, setDeclarado] = useState(false);
  const [verificando, setVerificando] = useState(false);

  // Referencias para el autoguardado (evitan cerrar sobre valores viejos).
  const actual = useRef({ datos, confirmados });
  actual.current = { datos, confirmados };
  const sucio = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [e, t] = await Promise.all([obtenerExpediente(id), obtenerTomaDatos(id)]);
        if (!e) { setError('Expediente no encontrado.'); return; }
        setExp(e);
        if (t) {
          setDatos(t.datos);
          setConfirmados(new Set(t.avisos_confirmados));
          setVerificadoEn(t.verificado_en);
          setGuardadoEn(t.actualizado_en);
        }
        // ¿Hay en este dispositivo cambios más recientes que no llegaron a subirse?
        const copia = leerCopiaLocal(id);
        if (copia && e.estado === 'visita_pendiente' && (!t?.actualizado_en || new Date(copia.guardadaEn) > new Date(t.actualizado_en))
            && JSON.stringify(copia.datos) !== JSON.stringify(t?.datos ?? tomaDatosVacia())) {
          setCopiaPendiente(copia);
        } else if (copia) {
          borrarCopiaLocal(id);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setCargando(false);
      }
    })();
  }, [id]);

  const editable = exp?.estado === 'visita_pendiente' && !copiaPendiente;

  const subir = useCallback(async (): Promise<boolean> => {
    if (!exp || exp.estado !== 'visita_pendiente') return false;
    setEstadoGuardado('guardando');
    try {
      const { datos: d, confirmados: c } = actual.current;
      const en = await guardarTomaDatos(id, d, [...c]);
      // Si se ha seguido escribiendo mientras se guardaba, sigue pendiente.
      if (actual.current.datos === d && actual.current.confirmados === c) {
        sucio.current = false;
        borrarCopiaLocal(id);
        setEstadoGuardado('guardado');
      } else {
        setEstadoGuardado('pendiente');
      }
      setGuardadoEn(en);
      return true;
    } catch (err) {
      const m = (err as Error).message;
      setEstadoGuardado(/conexión/i.test(m) ? 'sin_conexion' : 'error');
      if (!/conexión/i.test(m)) setError(m);
      return false;
    }
  }, [exp, id]);

  // Autoguardado periódico y al volver la conexión.
  useEffect(() => {
    if (!editable) return;
    const t = setInterval(() => { if (sucio.current && navigator.onLine) subir(); }, INTERVALO_AUTOGUARDADO_MS);
    const alVolver = () => { if (sucio.current) subir(); };
    window.addEventListener('online', alVolver);
    return () => { clearInterval(t); window.removeEventListener('online', alVolver); };
  }, [editable, subir]);

  // Aviso al cerrar la pestaña con cambios sin subir (la copia local sí queda).
  useEffect(() => {
    const antes = (ev: BeforeUnloadEvent) => { if (sucio.current) ev.preventDefault(); };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, []);

  function cambiar(nuevos: Datos, nuevosConfirmados = confirmados) {
    setDatos(nuevos);
    sucio.current = true;
    setEstadoGuardado('pendiente');
    guardarCopiaLocal(id, { datos: nuevos, confirmados: [...nuevosConfirmados], guardadaEn: new Date().toISOString() });
  }

  function cambiarConfirmados(s: Set<string>) {
    setConfirmados(s);
    sucio.current = true;
    setEstadoGuardado('pendiente');
    guardarCopiaLocal(id, { datos, confirmados: [...s], guardadaEn: new Date().toISOString() });
  }

  const comprobacion = useMemo(
    () => exp ? comprobarTomaDatos(datos, { tipoEdificio: exp.tipo_edificio, superficieExpediente: exp.superficie_util ? Number(exp.superficie_util) : null }) : { errores: [], avisos: [] },
    [datos, exp],
  );

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;
  if (!exp) return <main className="pagina"><div className="caja error">{error}</div><Link to="/expedientes">← Volver</Link></main>;

  const avisosPendientes = comprobacion.avisos.filter((a) => !confirmados.has(a.clave));
  const visitaFutura = exp.fecha_visita ? diasHasta(exp.fecha_visita) > 0 : false;
  const bloqueos = [
    !exp.fecha_visita && 'Falta la fecha de la visita en el expediente.',
    visitaFutura && `La fecha de la visita (${fecha(exp.fecha_visita)}) aún no ha llegado.`,
    comprobacion.errores.length > 0 && `Hay ${comprobacion.errores.length} dato(s) no válidos (en rojo).`,
    avisosPendientes.length > 0 && `Quedan ${avisosPendientes.length} aviso(s) por confirmar.`,
    !declarado && 'Falta marcar la declaración de verificación.',
  ].filter(Boolean) as string[];

  async function verificar() {
    setError('');
    setVerificando(true);
    const ok = await subir();
    if (!ok) { setVerificando(false); setError((e) => e || 'No se ha podido guardar. Revisa la conexión e inténtalo de nuevo.'); return; }
    try {
      await cambiarEstado(id, { destino: 'datos_introducidos', nota: avisosPendientes.length === 0 && comprobacion.avisos.length > 0 ? `Datos verificados; ${comprobacion.avisos.length} aviso(s) revisados y confirmados` : 'Datos verificados' });
      navegar(`/expedientes/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setVerificando(false);
    }
  }

  const secciones = SECCIONES.filter((s) => !s.soloTerciario || !esResidencial(exp.tipo_edificio) || datos[s.clave].length > 0);

  return (
    <main className="pagina toma-datos">
      <p><Link to={`/expedientes/${id}`}>← {exp.codigo}</Link></p>
      <h1>Toma de datos</h1>
      <p className="subtitulo">{exp.direccion} · {exp.municipio} · visita {fecha(exp.fecha_visita)}</p>

      {copiaPendiente && (
        <div className="caja aviso">
          <strong>Hay cambios guardados en este dispositivo que no llegaron a subirse</strong> ({fechaHora(copiaPendiente.guardadaEn)}).
          <div className="acciones">
            <button className="principal" onClick={() => {
              const c = copiaPendiente;
              setCopiaPendiente(null);
              setConfirmados(new Set(c.confirmados));
              setDatos(c.datos);
              sucio.current = true;
              setEstadoGuardado('pendiente');
            }}>Recuperar esos cambios</button>
            <button onClick={() => { borrarCopiaLocal(id); setCopiaPendiente(null); }}>Descartarlos y usar lo del servidor</button>
          </div>
        </div>
      )}

      {!editable && !copiaPendiente && (
        <div className="caja info">
          {verificadoEn ? <>Datos verificados el {fechaHora(verificadoEn)}. </> : null}
          Solo lectura: para modificarlos, devuelve el expediente a «Visita pendiente» desde su ficha.
        </div>
      )}

      {editable && (
        <div className={`barra-guardado ${estadoGuardado}`} role="status">
          {estadoGuardado === 'guardado' && <>✓ Guardado {guardadoEn ? fechaHora(guardadoEn) : ''}</>}
          {estadoGuardado === 'pendiente' && <>Cambios sin subir (copia guardada en este dispositivo)</>}
          {estadoGuardado === 'guardando' && <>Guardando…</>}
          {estadoGuardado === 'sin_conexion' && <>Sin conexión: los cambios están a salvo en este dispositivo y se subirán al volver la conexión</>}
          {estadoGuardado === 'error' && <>No se ha podido guardar</>}
          <button className="principal" disabled={estadoGuardado === 'guardando'} onClick={() => subir()}>Guardar borrador</button>
        </div>
      )}

      {error && <div className="caja error">{error}</div>}

      <details className="seccion" open>
        <summary>Datos generales</summary>
        <div className="rejilla-campos">
          {CAMPOS_GENERALES.map((def) => (
            <CampoDef key={def.campo} def={def} fila={datos.generales} tipoEdificio={exp.tipo_edificio} deshabilitado={!editable}
                      onCambio={(v) => cambiar({ ...datos, generales: { ...datos.generales, [def.campo]: v } })} />
          ))}
        </div>
      </details>

      {secciones.map((s) => (
        <SeccionLista key={s.clave} def={s} filas={datos[s.clave]} tipoEdificio={exp.tipo_edificio} deshabilitado={!editable}
                      onCambio={(filas) => cambiar({ ...datos, [s.clave]: filas })} />
      ))}

      <details className="seccion" open={Boolean(datos.observaciones)}>
        <summary>Observaciones generales</summary>
        <CampoTexto etiqueta="Observaciones" largo valor={datos.observaciones} deshabilitado={!editable}
                    onCambio={(v) => cambiar({ ...datos, observaciones: v })} />
      </details>

      {editable && (
        <section className="caja verificacion">
          <h2>Verificar los datos</h2>
          <p>Cuando hayas revisado todos los datos, verifícalos para pasar el expediente a «Datos introducidos». A partir de ese momento quedan congelados.</p>
          {comprobacion.errores.length > 0 && (
            <div className="caja error">
              <strong>Datos no válidos</strong>
              <ul>{comprobacion.errores.map((e) => <li key={e.ruta}>{e.mensaje}</li>)}</ul>
            </div>
          )}
          <ConfirmarAvisos avisos={comprobacion.avisos} confirmados={confirmados} onCambio={cambiarConfirmados} />
          <label className="declaracion">
            <input type="checkbox" checked={declarado} onChange={(e) => setDeclarado(e.target.checked)} /> {DECLARACION_ESTADO.datos_introducidos}
          </label>
          {bloqueos.length > 0 && <ul className="bloqueos">{bloqueos.map((b) => <li key={b}>{b}</li>)}</ul>}
          <button className="principal" disabled={bloqueos.length > 0 || verificando} onClick={verificar}>
            {verificando ? 'Verificando…' : 'Verificar y pasar a «Datos introducidos»'}
          </button>
        </section>
      )}
    </main>
  );
}

// ───────────────────────────── Campos y listas ────────────────────────────

function CampoDef({ def, fila, tipoEdificio, deshabilitado, onCambio }: {
  def: DefCampo;
  fila: Record<string, Valor>;
  tipoEdificio: Expediente['tipo_edificio'];
  deshabilitado: boolean;
  onCambio: (v: Valor) => void;
}) {
  if (def.visibleSi && !def.visibleSi(fila)) return null;
  const v = fila[def.campo];
  switch (def.tipo) {
    case 'numero': {
      const rango = rangoDe(def, fila, tipoEdificio);
      return <CampoNumero etiqueta={def.etiqueta} ayuda={def.ayuda} deshabilitado={deshabilitado} rango={rango}
                          valor={typeof v === 'number' ? v : null} onCambio={onCambio}
                          comprobacion={comprobarRango(typeof v === 'number' ? v : null, rango ?? {})} />;
    }
    case 'opcion':
      return <CampoOpcion etiqueta={def.etiqueta} ayuda={def.ayuda} deshabilitado={deshabilitado} opciones={def.opciones ?? []}
                          valor={typeof v === 'string' ? v : ''} onCambio={(x) => onCambio(x || null)} />;
    case 'si_no':
      return <CampoSiNo etiqueta={def.etiqueta} ayuda={def.ayuda} deshabilitado={deshabilitado} valor={v === true} onCambio={onCambio} />;
    case 'texto_largo':
    case 'texto':
      return <CampoTexto etiqueta={def.etiqueta} ayuda={def.ayuda} deshabilitado={deshabilitado} largo={def.tipo === 'texto_largo'}
                         valor={typeof v === 'string' ? v : ''} onCambio={(x) => onCambio(x || null)} />;
  }
}

function SeccionLista({ def, filas, tipoEdificio, deshabilitado, onCambio }: {
  def: DefSeccion;
  filas: Fila[];
  tipoEdificio: Expediente['tipo_edificio'];
  deshabilitado: boolean;
  onCambio: (filas: Fila[]) => void;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const cambiarFila = (i: number, campo: string, v: Valor) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, [campo]: v } : f)));

  return (
    <details className="seccion" open={filas.length > 0}>
      <summary>{def.titulo} <span className="contador">{filas.length}</span></summary>
      {filas.length === 0 && <p className="vacio">Ninguno todavía.</p>}
      <ul className="filas">
        {filas.map((f, i) => {
          const abiertaEsta = abierta === f.id || (abierta === null && i === filas.length - 1 && !deshabilitado);
          return (
            <li key={f.id} className="fila-lista">
              <button type="button" className="cabecera-fila" onClick={() => setAbierta(abiertaEsta ? '' : f.id)} aria-expanded={abiertaEsta}>
                <span>{def.titulo_fila(f, i)}</span><span aria-hidden>{abiertaEsta ? '▾' : '▸'}</span>
              </button>
              {abiertaEsta && (
                <>
                  <div className="rejilla-campos">
                    {def.campos.map((c) => (
                      <CampoDef key={c.campo} def={c} fila={f} tipoEdificio={tipoEdificio} deshabilitado={deshabilitado}
                                onCambio={(v) => cambiarFila(i, c.campo, v)} />
                    ))}
                  </div>
                  {!deshabilitado && (
                    <div className="acciones">
                      <button type="button" onClick={() => {
                        const copia = { ...f, id: nuevoId() };
                        onCambio([...filas.slice(0, i + 1), copia, ...filas.slice(i + 1)]);
                        setAbierta(copia.id);
                      }}>Duplicar</button>
                      <button type="button" className="peligro" onClick={() => {
                        if (confirm(`¿Quitar «${def.titulo_fila(f, i)}»?`)) onCambio(filas.filter((_, j) => j !== i));
                      }}>Quitar</button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!deshabilitado && (
        <button type="button" onClick={() => {
          const nueva: Fila = { id: nuevoId() };
          onCambio([...filas, nueva]);
          setAbierta(nueva.id);
        }}>+ Añadir {def.elemento}</button>
      )}
    </details>
  );
}
