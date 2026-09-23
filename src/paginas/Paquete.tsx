import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { zipSync } from 'fflate';
import { type Adjunto, NOMBRE_TIPO_ADJUNTO, type TipoAdjunto, descargarAdjunto, listarAdjuntos, obtenerExpediente } from '../lib/api';
import { type Expediente, NOMBRE_ESTADO } from '../lib/estados';
import {
  type EntradaZip, type OpcionesPaquete, REQUISITOS, TIPOS_FICHEROS_PROGRAMA, URL_TRAMITE, analizarXml, esPdf, extension,
  nombreZip, pdfTieneFirma, propuestaPorTipo, sha256, textoLeeme,
} from '../lib/paquete';
import { Documentos } from '../componentes/Documentos';

const CLAVE_OPCIONES = 'certi.opcionesPaquete';

function leerOpciones(): OpcionesPaquete {
  try {
    const o = JSON.parse(localStorage.getItem(CLAVE_OPCIONES) ?? '{}') as Partial<OpcionesPaquete>;
    return { inscritoRegistroTecnicos: o.inscritoRegistroTecnicos ?? false, controlExterno: false };
  } catch {
    return { inscritoRegistroTecnicos: false, controlExterno: false };
  }
}

interface Comprobado {
  entradas: EntradaZip[];
  ficheros: Record<string, Uint8Array>;
  errores: string[];
  avisos: string[];
}

/** Módulo 5: prepara (NO envía) la documentación para el registro autonómico. */
export function Paquete() {
  const { id = '' } = useParams();
  const [exp, setExp] = useState<Expediente | null>(null);
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [eleccion, setEleccion] = useState<Partial<Record<TipoAdjunto, string>>>({});
  const [opciones, setOpciones] = useState<OpcionesPaquete>(leerOpciones);
  const [comprobado, setComprobado] = useState<Comprobado | null>(null);
  const [avisosAceptados, setAvisosAceptados] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  const cargarAdjuntos = useCallback(async () => {
    const a = await listarAdjuntos(id);
    setAdjuntos(a);
    const p = propuestaPorTipo(a);
    setEleccion(Object.fromEntries(Object.entries(p).map(([t, x]) => [t, x!.id])));
    setComprobado(null);
  }, [id]);

  useEffect(() => {
    Promise.all([obtenerExpediente(id), cargarAdjuntos()])
      .then(([e]) => { if (!e) setError('Expediente no encontrado.'); setExp(e); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [id, cargarAdjuntos]);

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;
  if (!exp) return <main className="pagina"><div className="caja error">{error}</div><Link to="/expedientes">← Volver</Link></main>;

  const disponible = exp.estado === 'certificado_firmado' || exp.estado === 'registrado';
  const elegido = (t: TipoAdjunto) => adjuntos.find((a) => a.id === eleccion[t]);
  const faltan = REQUISITOS.filter((r) => r.obligatorio(opciones) && !elegido(r.tipo));

  function cambiarOpciones(o: OpcionesPaquete) {
    setOpciones(o);
    setComprobado(null);
    try { localStorage.setItem(CLAVE_OPCIONES, JSON.stringify({ inscritoRegistroTecnicos: o.inscritoRegistroTecnicos })); } catch { /* sin almacenamiento */ }
  }

  async function bytesDe(a: Adjunto): Promise<Uint8Array> {
    return new Uint8Array(await (await descargarAdjunto(a)).arrayBuffer());
  }

  /** Descarga los documentos elegidos y comprueba su contenido antes de montar el ZIP. */
  async function comprobar() {
    setError('');
    setTrabajando(true);
    setAvisosAceptados(false);
    const r: Comprobado = { entradas: [], ficheros: {}, errores: [], avisos: [] };
    try {
      for (const req of REQUISITOS) {
        const a = elegido(req.tipo);
        if (!a) {
          if (req.obligatorio(opciones)) r.errores.push(`Falta: ${req.titulo}.`);
          continue;
        }
        const b = await bytesDe(a);
        const huella = await sha256(b);
        if (a.sha256 && a.sha256 !== huella) r.errores.push(`«${a.nombre}» no coincide con el fichero que se subió (la huella ha cambiado). Vuelve a subirlo.`);
        if (req.tipo === 'certificado_firmado') {
          if (!esPdf(b)) r.errores.push(`«${a.nombre}» no es un PDF.`);
          else if (!pdfTieneFirma(b)) r.avisos.push(`No se ha encontrado ninguna firma electrónica en «${a.nombre}». ¿Es el PDF ya firmado?`);
        }
        if (req.tipo === 'certificado_xml') {
          const x = analizarXml(b);
          if (!x.esXml) r.errores.push(`«${a.nombre}» no parece un fichero XML.`);
          else if (!x.oficial) r.avisos.push(`«${a.nombre}» no tiene la estructura del XML oficial (DatosEnergeticosDelEdificio). Comprueba que es el que genera el programa.`);
        }
        if ((req.tipo === 'justificante_tasa' || req.tipo === 'declaracion_responsable' || req.tipo === 'informe_conformidad') && !esPdf(b)) {
          r.avisos.push(`«${a.nombre}» no es un PDF; la sede suele pedir los documentos en PDF.`);
        }
        const nombre = req.nombreEnZip + extension(a.nombre);
        r.ficheros[nombre] = b;
        r.entradas.push({ nombreEnZip: nombre, original: a.nombre, tamano: b.length, sha256: huella, descripcion: req.titulo });
      }

      // Ficheros del programa (entrada .cex + salida .xml) en un único comprimido, para tu archivo.
      const programa: Record<string, Uint8Array> = {};
      for (const t of TIPOS_FICHEROS_PROGRAMA) {
        const a = elegido(t);
        if (a) programa[a.nombre] = await bytesDe(a);
      }
      if (!elegido('fichero_calculo')) r.avisos.push('No hay fichero de cálculo (.cex) adjunto: el comprimido de ficheros del programa llevará solo el XML.');
      if (Object.keys(programa).length > 0) {
        const z = zipSync(programa, { level: 6 });
        const nombre = '06_ficheros_programa.zip';
        r.ficheros[nombre] = z;
        r.entradas.push({ nombreEnZip: nombre, original: Object.keys(programa).join(', '), tamano: z.length, sha256: await sha256(z), descripcion: 'Ficheros de entrada y salida del programa de certificación (para archivo)' });
      }
      setComprobado(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  }

  function descargarZip() {
    if (!comprobado || !exp) return;
    const leeme = new TextEncoder().encode(textoLeeme(exp, comprobado.entradas, opciones, new Date()));
    const zip = zipSync({ 'LEEME.txt': leeme, ...comprobado.ficheros }, { level: 6 });
    const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreZip(exp);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <main className="pagina">
      <p><Link to={`/expedientes/${id}`}>← {exp.codigo}</Link></p>
      <h1>Paquete para el registro</h1>
      <p className="subtitulo">{exp.direccion} · {exp.municipio}</p>

      <div className="caja info">
        Esta pantalla <strong>prepara</strong> un ZIP con la documentación que pide el Registro de certificados de
        eficiencia energética del Principado de Asturias. <strong>No envía nada</strong>: la presentación la haces tú,
        con tu certificado digital, en la <a href={URL_TRAMITE} target="_blank" rel="noopener noreferrer">sede electrónica (trámite RECE0016T01)</a>.
      </div>

      {!disponible && (
        <div className="caja aviso">
          El paquete se prepara cuando el certificado está firmado. Ahora el expediente está en «{NOMBRE_ESTADO[exp.estado]}».
        </div>
      )}

      <section className="caja">
        <h2>Tu situación</h2>
        <label className="campo-casilla"><input type="checkbox" checked={opciones.inscritoRegistroTecnicos}
          onChange={(e) => cambiarOpciones({ ...opciones, inscritoRegistroTecnicos: e.target.checked })} /> Estoy inscrito en el Registro de técnicos cualificados del Principado (entonces no hace falta declaración responsable)</label>
        <label className="campo-casilla"><input type="checkbox" checked={opciones.controlExterno}
          onChange={(e) => cambiarOpciones({ ...opciones, controlExterno: e.target.checked })} /> Este certificado ha pasado control externo</label>
      </section>

      <section className="caja">
        <h2>Documentos del paquete</h2>
        <ul className="requisitos">
          {REQUISITOS.map((req) => {
            const obligatorio = req.obligatorio(opciones);
            const candidatos = adjuntos.filter((a) => a.tipo === req.tipo);
            const a = elegido(req.tipo);
            return (
              <li key={req.clave} className={a ? 'con-documento' : obligatorio ? 'falta' : ''}>
                <div>
                  <strong>{a ? '✓' : obligatorio ? '✗' : '·'} {req.titulo}</strong> {!obligatorio && <span className="suave">(no necesario)</span>}
                  <div className="suave pequeno">{req.explicacion}</div>
                </div>
                {candidatos.length > 1 ? (
                  <select value={eleccion[req.tipo] ?? ''} onChange={(e) => { setEleccion({ ...eleccion, [req.tipo]: e.target.value }); setComprobado(null); }}>
                    {candidatos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                ) : a ? <span className="pequeno">{a.nombre}</span>
                  : <span className="pequeno suave">Sube un documento de tipo «{NOMBRE_TIPO_ADJUNTO[req.tipo]}» más abajo.</span>}
              </li>
            );
          })}
          <li className={elegido('fichero_calculo') ? 'con-documento' : ''}>
            <div>
              <strong>{elegido('fichero_calculo') ? '✓' : '·'} Ficheros del programa en un único comprimido</strong> <span className="suave">(para tu archivo)</span>
              <div className="suave pequeno">El fichero de cálculo (.cex) y el XML, juntos en un ZIP dentro del paquete.</div>
            </div>
          </li>
        </ul>

        {faltan.length > 0 && <p className="nota-aviso">Faltan {faltan.length} documento(s) obligatorio(s).</p>}
        <div className="acciones">
          <button type="button" className="principal" disabled={!disponible || faltan.length > 0 || trabajando} onClick={comprobar}>
            {trabajando ? 'Comprobando…' : 'Comprobar documentos'}
          </button>
        </div>

        {comprobado && (
          <div className="resultado-paquete">
            {comprobado.errores.length > 0 && (
              <div className="caja error"><strong>No se puede preparar el paquete</strong><ul>{comprobado.errores.map((x) => <li key={x}>{x}</li>)}</ul></div>
            )}
            {comprobado.errores.length === 0 && (
              <>
                {comprobado.avisos.length > 0 && (
                  <div className="caja aviso">
                    <strong>Revisa antes de descargar</strong>
                    <ul>{comprobado.avisos.map((x) => <li key={x}>{x}</li>)}</ul>
                    <label className="campo-casilla"><input type="checkbox" checked={avisosAceptados} onChange={(e) => setAvisosAceptados(e.target.checked)} /> Lo he revisado y quiero preparar el paquete igualmente</label>
                  </div>
                )}
                <div className="tabla-desplazable">
                  <table className="tabla">
                    <thead><tr><th>En el ZIP</th><th>Original</th><th>SHA-256</th></tr></thead>
                    <tbody>{comprobado.entradas.map((x) => (
                      <tr key={x.nombreEnZip}><td>{x.nombreEnZip}</td><td>{x.original}</td><td className="huella">{x.sha256.slice(0, 16)}…</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <button type="button" className="principal" disabled={comprobado.avisos.length > 0 && !avisosAceptados} onClick={descargarZip}>
                  Descargar {nombreZip(exp)}
                </button>
                <p className="suave pequeno">El ZIP incluye un LEEME.txt con el índice y las huellas de cada documento.
                  Después de presentarlo en la sede, marca el expediente como «Registrado» desde su ficha.</p>
              </>
            )}
          </div>
        )}
        {error && <div className="caja error">{error}</div>}
      </section>

      <Documentos expedienteId={id} adjuntos={adjuntos} soloLectura={exp.estado === 'registrado'}
                  onCambio={() => cargarAdjuntos().catch((e: Error) => setError(e.message))} />
    </main>
  );
}
