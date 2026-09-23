import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cambiarEstado, guardarResultados, obtenerExpediente, obtenerResultados, subirAdjunto } from '../lib/api';
import { type DatosCertificado, type Letra, type Parciales, extraerPaginasPdf, interpretarCertificado } from '../lib/certificadoPdf';
import { CALIFICACIONES, DECLARACION_ESTADO, type Expediente, NOMBRE_ESTADO, NOMBRE_TIPO_EDIFICIO } from '../lib/estados';
import { fecha, fechaHora } from '../lib/fechas';
import { type Recomendacion, type Resultados as Datos, aplicarCertificado, avisosResultados, resultadosVacios } from '../lib/resultados';
import { formatearNumero } from '../lib/validaciones';
import { CampoNumero, CampoTexto, ConfirmarAvisos } from '../componentes/Campos';

const nuevoId = () => crypto.randomUUID();

function SelectorLetra({ etiqueta, valor, onCambio, deshabilitado }: { etiqueta: string; valor: Letra | null; onCambio: (l: Letra | null) => void; deshabilitado?: boolean }) {
  return (
    <div className="campo">
      <label>{etiqueta}
        <select value={valor ?? ''} disabled={deshabilitado} onChange={(e) => onCambio((e.target.value || null) as Letra | null)}>
          <option value="">—</option>
          {CALIFICACIONES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}

export function Resultados() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const [exp, setExp] = useState<Expediente | null>(null);
  const [r, setR] = useState<Datos>(resultadosVacios());
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [sucio, setSucio] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [lectura, setLectura] = useState<{ datos: DatosCertificado; fichero: File } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardarPdf, setGuardarPdf] = useState(true);
  const [declarado, setDeclarado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    Promise.all([obtenerExpediente(id), obtenerResultados(id)])
      .then(([e, res]) => {
        if (!e) { setError('Expediente no encontrado.'); return; }
        setExp(e);
        if (res) { setR(res); setConfirmados(new Set(res.avisos_confirmados)); }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [id]);

  useEffect(() => {
    const antes = (ev: BeforeUnloadEvent) => { if (sucio) ev.preventDefault(); };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [sucio]);

  const comprobacion = useMemo(() => (exp ? avisosResultados(r, exp) : { errores: [], avisos: [] }), [r, exp]);

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;
  if (!exp) return <main className="pagina"><div className="caja error">{error}</div><Link to="/expedientes">← Volver</Link></main>;

  const editable = exp.estado === 'datos_introducidos';
  const cambiar = (parcial: Partial<Datos>) => { setR((x) => ({ ...x, ...parcial })); setSucio(true); setMensaje(''); };
  const pendientes = comprobacion.avisos.filter((a) => !confirmados.has(a.clave));

  async function leerPdf(f: File) {
    setError('');
    setLeyendo(true);
    try {
      const paginas = await extraerPaginasPdf(await f.arrayBuffer());
      setLectura({ datos: interpretarCertificado(paginas), fichero: f });
    } catch (e) {
      setError(`No se ha podido leer el PDF: ${(e as Error).message}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function usarLectura() {
    if (!lectura) return;
    cambiar(aplicarCertificado(r, lectura.datos, lectura.fichero.name));
    if (guardarPdf) {
      try {
        await subirAdjunto(id, 'certificado_pdf', lectura.fichero);
      } catch (e) {
        setError(`Los valores se han cargado, pero el PDF no se ha podido guardar en los documentos: ${(e as Error).message}`);
      }
    }
    setLectura(null);
    setMensaje('Valores cargados en el formulario. Revísalos y pulsa «Guardar».');
  }

  async function guardar(): Promise<boolean> {
    setError('');
    try {
      const vigentes = comprobacion.avisos.map((a) => a.clave).filter((k) => confirmados.has(k));
      await guardarResultados(id, { ...r, avisos_confirmados: vigentes });
      setSucio(false);
      setMensaje('Resultados guardados.');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function confirmar() {
    setEnviando(true);
    if (!(await guardar())) { setEnviando(false); return; }
    try {
      await cambiarEstado(id, { destino: 'calculo_revisado', nota: `Resultados ${r.origen === 'pdf' ? `importados de «${r.fichero_origen}» y ` : ''}revisados: ${r.calificacion_consumo} / ${r.calificacion_emisiones}` });
      navegar(`/expedientes/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  }

  const bloqueos = [
    ...comprobacion.errores,
    pendientes.length > 0 && `Quedan ${pendientes.length} aviso(s) por confirmar.`,
    !declarado && 'Falta marcar la declaración.',
  ].filter(Boolean) as string[];

  const setRec = (i: number, cambio: Partial<Recomendacion>) =>
    cambiar({ recomendaciones: r.recomendaciones.map((x, j) => (j === i ? { ...x, ...cambio } : x)) });

  return (
    <main className="pagina">
      <p><Link to={`/expedientes/${id}`}>← {exp.codigo}</Link></p>
      <h1>Resultados del cálculo</h1>
      <p className="subtitulo">{exp.direccion} · {exp.municipio}</p>

      {!editable && (
        <div className="caja info">
          {r.confirmado_en ? <>Resultados confirmados el {fechaHora(r.confirmado_en)}. </> : null}
          {exp.estado === 'visita_pendiente'
            ? 'Primero hay que verificar la toma de datos de la visita.'
            : `Solo lectura (el expediente está en «${NOMBRE_ESTADO[exp.estado]}»). Para modificarlos, devuélvelo a «Datos introducidos» desde su ficha.`}
        </div>
      )}

      {editable && (
        <section className="caja">
          <h2>Importar del certificado en PDF</h2>
          <p className="suave">Elige el PDF que ha generado el programa oficial. Se lee en este dispositivo, sin enviarlo a ningún sitio, y los valores se proponen para que los revises.</p>
          <input type="file" accept="application/pdf,.pdf" disabled={leyendo}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) leerPdf(f); e.target.value = ''; }} />
          {leyendo && <p className="cargando">Leyendo el PDF…</p>}
        </section>
      )}

      {lectura && <RevisionLectura lectura={lectura} expediente={exp} guardarPdf={guardarPdf} setGuardarPdf={setGuardarPdf}
                                   onUsar={usarLectura} onDescartar={() => setLectura(null)} />}

      {mensaje && <div className="caja info" role="status">{mensaje}</div>}
      {error && <div className="caja error">{error}</div>}

      <section className="caja">
        <h2>Calificación</h2>
        {r.origen === 'pdf' && r.fichero_origen && <p className="suave">Valores importados de «{r.fichero_origen}».</p>}
        <div className="rejilla-campos">
          <CampoTexto etiqueta="Programa y versión" valor={r.programa ?? ''} deshabilitado={!editable} onCambio={(v) => cambiar({ programa: v || null })} />
          <CampoTexto etiqueta="Fecha del certificado" tipo="date" valor={r.fecha_certificado ?? ''} deshabilitado={!editable} onCambio={(v) => cambiar({ fecha_certificado: v || null })} />
        </div>
        <div className="rejilla-campos">
          <CampoNumero etiqueta="Consumo de energía primaria no renovable" rango={{ min: 0, max: 100000, unidad: 'kWh/m²·año' }} valor={r.consumo_ep_nr} deshabilitado={!editable} onCambio={(v) => cambiar({ consumo_ep_nr: v })} />
          <SelectorLetra etiqueta="Calificación de consumo" valor={r.calificacion_consumo} deshabilitado={!editable} onCambio={(v) => cambiar({ calificacion_consumo: v })} />
          <CampoNumero etiqueta="Emisiones de CO₂" rango={{ min: 0, max: 100000, unidad: 'kgCO₂/m²·año' }} valor={r.emisiones_co2} deshabilitado={!editable} onCambio={(v) => cambiar({ emisiones_co2: v })} />
          <SelectorLetra etiqueta="Calificación de emisiones" valor={r.calificacion_emisiones} deshabilitado={!editable} onCambio={(v) => cambiar({ calificacion_emisiones: v })} />
          <CampoNumero etiqueta="Demanda de calefacción" rango={{ min: 0, max: 100000, unidad: 'kWh/m²·año' }} valor={r.demanda_calefaccion} deshabilitado={!editable} onCambio={(v) => cambiar({ demanda_calefaccion: v })} />
          <SelectorLetra etiqueta="Calificación demanda calefacción" valor={r.calificacion_demanda_calefaccion} deshabilitado={!editable} onCambio={(v) => cambiar({ calificacion_demanda_calefaccion: v })} />
          <CampoNumero etiqueta="Demanda de refrigeración" rango={{ min: 0, max: 100000, unidad: 'kWh/m²·año' }} valor={r.demanda_refrigeracion} deshabilitado={!editable} onCambio={(v) => cambiar({ demanda_refrigeracion: v })} />
          <SelectorLetra etiqueta="Calificación demanda refrigeración" valor={r.calificacion_demanda_refrigeracion} deshabilitado={!editable} onCambio={(v) => cambiar({ calificacion_demanda_refrigeracion: v })} />
        </div>
        {(r.detalle.parcialesConsumo || r.detalle.parcialesEmisiones) && (
          <TablaParciales consumo={r.detalle.parcialesConsumo} emisiones={r.detalle.parcialesEmisiones} />
        )}
      </section>

      <section className="caja">
        <h2>Recomendaciones de mejora</h2>
        {r.detalle.certificado?.sinRecomendaciones && (
          <p className="nota-aviso">⚠ El Anexo III del PDF dice «Apartado no definido»: el certificado no incluye recomendaciones.</p>
        )}
        {r.detalle.certificado?.textoRecomendaciones && (
          <details><summary>Texto del Anexo III leído del PDF</summary><p className="texto-libre suave">{r.detalle.certificado.textoRecomendaciones}</p></details>
        )}
        {r.recomendaciones.length === 0 && <p className="vacio">Ninguna recomendación registrada.</p>}
        <ul className="filas">
          {r.recomendaciones.map((rec, i) => (
            <li key={rec.id} className="fila-lista">
              <CampoTexto etiqueta={`Medida ${i + 1}`} largo valor={rec.descripcion} deshabilitado={!editable} onCambio={(v) => setRec(i, { descripcion: v })} />
              <div className="rejilla-campos">
                <SelectorLetra etiqueta="Calificación de consumo con la medida" valor={rec.calificacion_consumo} deshabilitado={!editable} onCambio={(v) => setRec(i, { calificacion_consumo: v })} />
                <SelectorLetra etiqueta="Calificación de emisiones con la medida" valor={rec.calificacion_emisiones} deshabilitado={!editable} onCambio={(v) => setRec(i, { calificacion_emisiones: v })} />
                <CampoNumero etiqueta="Ahorro estimado" rango={{ min: 0, max: 100, unidad: '%' }} valor={rec.ahorro} deshabilitado={!editable} onCambio={(v) => setRec(i, { ahorro: v })} />
              </div>
              {editable && <button type="button" className="peligro" onClick={() => cambiar({ recomendaciones: r.recomendaciones.filter((_, j) => j !== i) })}>Quitar</button>}
            </li>
          ))}
        </ul>
        {editable && (
          <button type="button" onClick={() => cambiar({ recomendaciones: [...r.recomendaciones, { id: nuevoId(), descripcion: '', calificacion_consumo: null, calificacion_emisiones: null, ahorro: null }] })}>
            + Añadir recomendación
          </button>
        )}
        {r.recomendaciones.length === 0 && (
          <CampoTexto etiqueta="Justificación si no hay medidas técnica o económicamente viables" largo deshabilitado={!editable}
                      valor={r.justificacion_sin_recomendaciones ?? ''} onCambio={(v) => cambiar({ justificacion_sin_recomendaciones: v || null })} />
        )}
      </section>

      {editable && (
        <>
          <div className="acciones">
            <button type="button" className="principal" onClick={guardar} disabled={!sucio}>{sucio ? 'Guardar' : 'Guardado'}</button>
          </div>
          <section className="caja verificacion">
            <h2>Confirmar los resultados</h2>
            <p>Al confirmar, el expediente pasa a «Cálculo revisado por técnico» y estos resultados quedan congelados. Después vendrá el checklist previo a la firma.</p>
            <ConfirmarAvisos avisos={comprobacion.avisos} confirmados={confirmados} onCambio={(s) => { setConfirmados(s); setSucio(true); }} />
            <label className="declaracion">
              <input type="checkbox" checked={declarado} onChange={(e) => setDeclarado(e.target.checked)} /> {DECLARACION_ESTADO.calculo_revisado}
            </label>
            {bloqueos.length > 0 && <ul className="bloqueos">{bloqueos.map((b) => <li key={b}>{b}</li>)}</ul>}
            <button type="button" className="principal" disabled={bloqueos.length > 0 || enviando} onClick={confirmar}>
              {enviando ? 'Confirmando…' : 'Confirmar y pasar a «Cálculo revisado»'}
            </button>
          </section>
        </>
      )}
    </main>
  );
}

// ─────────────────────── revisión de lo leído del PDF ───────────────────────

function RevisionLectura({ lectura, expediente: e, guardarPdf, setGuardarPdf, onUsar, onDescartar }: {
  lectura: { datos: DatosCertificado; fichero: File };
  expediente: Expediente;
  guardarPdf: boolean;
  setGuardarPdf: (v: boolean) => void;
  onUsar: () => void;
  onDescartar: () => void;
}) {
  const d = lectura.datos;
  const ind = (v: number | null, l: string | null) => (v === null && !l ? '—' : `${v === null ? '—' : formatearNumero(v)} ${l ?? ''}`);
  const filas: [string, string, string?][] = [
    ['Programa', d.programa ?? '—'],
    ['Fecha del certificado', fecha(d.fechaCertificado)],
    ['Referencia catastral', d.referenciaCatastral ?? '—', e.referencia_catastral ?? '—'],
    ['Dirección', [d.direccion, d.municipio, d.codigoPostal].filter(Boolean).join(', ') || '—', [e.direccion, e.municipio, e.codigo_postal].filter(Boolean).join(', ')],
    ['Tipo de edificio', d.tipoEdificio ? NOMBRE_TIPO_EDIFICIO[d.tipoEdificio] : d.tipoEdificioTexto ?? '—', NOMBRE_TIPO_EDIFICIO[e.tipo_edificio]],
    ['Superficie habitable', d.superficieHabitable === null ? '—' : `${formatearNumero(d.superficieHabitable)} m²`],
    ['Fecha de visita (Anexo IV)', fecha(d.fechaVisita), fecha(e.fecha_visita)],
    ['Consumo EP no renovable', ind(d.consumo.valor, d.consumo.letra)],
    ['Emisiones CO₂', ind(d.emisiones.valor, d.emisiones.letra)],
    ['Demanda calefacción', ind(d.demandaCalefaccion.valor, d.demandaCalefaccion.letra)],
    ['Demanda refrigeración', d.demandaRefrigeracionNoCalificable ? 'No calificable' : ind(d.demandaRefrigeracion.valor, d.demandaRefrigeracion.letra)],
    ['Recomendaciones (Anexo III)', d.sinRecomendaciones ? '«Apartado no definido» (ninguna)' : d.textoRecomendaciones ? 'Hay texto: revísalo e introdúcelas' : '—'],
    ['Técnico', [d.tecnicoNombre, d.tecnicoNif, d.tecnicoTitulacion].filter(Boolean).join(' · ') || '—'],
  ];
  return (
    <section className="caja aviso">
      <h2>Esto es lo que se ha leído de «{lectura.fichero.name}»</h2>
      {d.noEncontrado.length > 0 && (
        <p className="nota-aviso">⚠ No se ha encontrado: {d.noEncontrado.join(', ')}. Esos campos no se tocarán; rellénalos a mano.</p>
      )}
      <div className="tabla-desplazable">
        <table className="tabla">
          <thead><tr><th>Dato</th><th>En el certificado</th><th>En el expediente</th></tr></thead>
          <tbody>
            {filas.map(([n, v, x]) => <tr key={n}><td>{n}</td><td>{v}</td><td className="suave">{x ?? ''}</td></tr>)}
          </tbody>
        </table>
      </div>
      <label className="campo-casilla"><input type="checkbox" checked={guardarPdf} onChange={(ev) => setGuardarPdf(ev.target.checked)} /> Guardar también este PDF en los documentos del expediente</label>
      <div className="acciones">
        <button type="button" className="principal" onClick={onUsar}>Usar estos valores</button>
        <button type="button" onClick={onDescartar}>Descartar</button>
      </div>
    </section>
  );
}

function TablaParciales({ consumo, emisiones }: { consumo?: Parciales; emisiones?: Parciales }) {
  const f = (p: Parciales | undefined, k: keyof Parciales) => {
    const i = p?.[k];
    return !i || (i.valor === null && !i.letra) ? '—' : `${i.valor === null ? '—' : formatearNumero(i.valor)} ${i.letra ?? ''}`;
  };
  const servicios: [keyof Parciales, string][] = [['calefaccion', 'Calefacción'], ['refrigeracion', 'Refrigeración'], ['acs', 'ACS'], ['iluminacion', 'Iluminación']];
  return (
    <details>
      <summary>Indicadores parciales leídos del certificado</summary>
      <div className="tabla-desplazable">
        <table className="tabla">
          <thead><tr><th>Servicio</th><th>Energía primaria (kWh/m²·año)</th><th>Emisiones (kgCO₂/m²·año)</th></tr></thead>
          <tbody>{servicios.map(([k, n]) => <tr key={k}><td>{n}</td><td>{f(consumo, k)}</td><td>{f(emisiones, k)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
