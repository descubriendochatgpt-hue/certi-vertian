import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { obtenerExpediente, obtenerTomaDatos } from '../lib/api';
import { type Expediente, NOMBRE_TIPO_EDIFICIO } from '../lib/estados';
import { fecha, fechaHora } from '../lib/fechas';
import {
  CAMPOS_CERRAMIENTO, CAMPOS_GENERALES, CAMPOS_HUECO, CAMPOS_ILUMINACION, CAMPOS_INSTALACION, CAMPOS_PUENTE_TERMICO,
  CAMPOS_RENOVABLE, type DefCampo, type Fila, type TomaDatos, type Valor,
} from '../lib/tomaDatos';

// Módulo 3, fase 1: ficha para teclear a mano en CE3X los datos ya
// verificados de la visita, en el orden de sus pantallas. No es un fichero
// que se abra en el programa: la introducción y el cálculo los haces tú.

type Separador = ',' | '.';
const CLAVE_SEPARADOR = 'certi.separadorDecimal';

function leerSeparador(): Separador {
  try { return localStorage.getItem(CLAVE_SEPARADOR) === '.' ? '.' : ','; } catch { return ','; }
}

function etiquetaDe(campos: DefCampo[], campo: string, valor: Valor | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  return campos.find((c) => c.campo === campo)?.opciones?.find((o) => o.valor === valor)?.etiqueta ?? String(valor);
}

export function FichaCe3x() {
  const { id = '' } = useParams();
  const [exp, setExp] = useState<Expediente | null>(null);
  const [toma, setToma] = useState<{ datos: TomaDatos; verificado_en: string | null } | null>(null);
  const [sep, setSep] = useState<Separador>(leerSeparador);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    Promise.all([obtenerExpediente(id), obtenerTomaDatos(id)])
      .then(([e, t]) => { setExp(e); setToma(t); if (!e) setError('Expediente no encontrado.'); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [id]);

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;
  if (!exp) return <main className="pagina"><div className="caja error">{error}</div><Link to="/expedientes">← Volver</Link></main>;

  const d = toma?.datos;
  // Números tal cual se guardaron (sin redondear), con el separador elegido.
  const n = (v: Valor | undefined, unidad = ''): string =>
    typeof v === 'number' ? `${String(v).replace('.', sep)}${unidad ? ` ${unidad}` : ''}` : '';
  const g = d?.generales ?? {};
  const pendientes = [
    !g.zonaClimatica && 'zona climática', !g.normativa && 'normativa vigente', typeof g.superficieUtil !== 'number' && 'superficie útil',
    typeof g.alturaLibre !== 'number' && 'altura libre', typeof g.numeroPlantas !== 'number' && 'número de plantas',
    !g.masaParticiones && 'masa de las particiones',
  ].filter(Boolean) as string[];

  const grupos: [string, string][] = [['cubierta', 'Cubiertas'], ['fachada', 'Muros de fachada'], ['suelo', 'Suelos'], ['medianeria', 'Medianerías'], ['particion_nh', 'Particiones con espacio no habitable']];
  const sinTipo = d?.cerramientos.filter((c) => !grupos.some(([t]) => t === c.tipo)) ?? [];

  return (
    <main className="pagina ficha">
      <div className="no-imprimir">
        <p><Link to={`/expedientes/${id}`}>← {exp.codigo}</Link></p>
        <div className="caja info">
          Ficha para <strong>introducir a mano</strong> en CE3X los datos de la visita, en el orden de sus pantallas.
          No es un fichero para abrir en el programa: la introducción y el cálculo los haces tú.
        </div>
        <div className="acciones">
          <label className="campo-casilla">Separador decimal:
            <select value={sep} onChange={(e) => { const s = e.target.value as Separador; setSep(s); try { localStorage.setItem(CLAVE_SEPARADOR, s); } catch { /* nada */ } }}>
              <option value=",">coma (1,25)</option>
              <option value=".">punto (1.25)</option>
            </select>
          </label>
          <button type="button" className="principal" onClick={() => window.print()}>Imprimir o guardar en PDF</button>
        </div>
      </div>

      <h1>Ficha para CE3X · {exp.codigo}</h1>
      <p className="subtitulo">{exp.direccion} · {exp.municipio} · visita {fecha(exp.fecha_visita)}</p>

      {!toma && <div className="caja aviso">Todavía no hay toma de datos para este expediente.</div>}
      {toma && !toma.verificado_en && <div className="caja aviso">⚠ Datos SIN VERIFICAR (borrador). Verifícalos antes de pasarlos a CE3X.</div>}
      {toma?.verificado_en && <p className="suave pequeno">Datos verificados el {fechaHora(toma.verificado_en)}.</p>}
      {pendientes.length > 0 && <div className="caja aviso">Faltan en la toma de datos: {pendientes.join(', ')}.</div>}

      <Bloque titulo="1. Datos administrativos">
        <Pares filas={[
          ['Dirección', exp.direccion], ['Municipio', exp.municipio], ['Código postal', exp.codigo_postal ?? ''],
          ['Provincia', exp.provincia], ['Comunidad autónoma', 'Principado de Asturias'],
          ['Referencia catastral', exp.referencia_catastral ?? ''],
          ['Cliente (nombre o razón social)', exp.propietario_nombre], ['NIF cliente', exp.propietario_nif ?? ''],
          ['Teléfono cliente', exp.propietario_telefono ?? ''], ['Email cliente', exp.propietario_email ?? ''],
        ]} />
      </Bloque>

      <Bloque titulo="2. Datos generales">
        <Pares filas={[
          ['Tipo de edificio', NOMBRE_TIPO_EDIFICIO[exp.tipo_edificio]],
          ['Normativa vigente', etiquetaDe(CAMPOS_GENERALES, 'normativa', g.normativa)],
          ['Año de construcción', exp.anio_construccion ? String(exp.anio_construccion) : ''],
          ['Zona climática', String(g.zonaClimatica ?? '')],
          ['Superficie útil habitable', n(g.superficieUtil, 'm²')],
          ['Altura libre de planta', n(g.alturaLibre, 'm')],
          ['Número de plantas habitables', n(g.numeroPlantas)],
          ['Ventilación', n(g.ventilacion, 'ren/h')],
          ['Demanda diaria de ACS', n(g.demandaAcs, 'l/día')],
          ['Masa de las particiones', etiquetaDe(CAMPOS_GENERALES, 'masaParticiones', g.masaParticiones)],
        ]} />
      </Bloque>

      <Bloque titulo="3. Envolvente térmica">
        {d && d.cerramientos.length === 0 && <p className="vacio">No hay cerramientos en la toma de datos.</p>}
        {grupos.map(([tipo, titulo]) => {
          const filas = d?.cerramientos.filter((c) => c.tipo === tipo) ?? [];
          return filas.length ? <TablaCerramientos key={tipo} titulo={titulo} filas={filas} n={n} /> : null;
        })}
        {sinTipo.length > 0 && <TablaCerramientos titulo="Sin tipo indicado" filas={sinTipo} n={n} />}

        {d && d.huecos.length > 0 && (
          <>
            <h3>Huecos y lucernarios</h3>
            <Tabla cabecera={['Nombre', 'En cerramiento', 'Orient.', 'Nº', 'Sup. unit. (m²)', 'Sup. total (m²)', 'Vidrio', 'U vidrio', 'Marco', 'U marco', '% marco', 'g', 'Permeab.', 'Protección']}
              filas={d.huecos.map((h) => [
                String(h.nombre ?? ''), String(h.cerramiento ?? ''), String(h.orientacion ?? ''), n(h.cantidad ?? 1),
                n(h.superficie), typeof h.superficie === 'number' ? n(Math.round(h.superficie * (typeof h.cantidad === 'number' ? h.cantidad : 1) * 1000) / 1000) : '',
                etiquetaDe(CAMPOS_HUECO, 'tipoVidrio', h.tipoVidrio), n(h.uVidrio), etiquetaDe(CAMPOS_HUECO, 'tipoMarco', h.tipoMarco), n(h.uMarco),
                n(h.porcentajeMarco), n(h.factorSolar), n(h.permeabilidad), etiquetaDe(CAMPOS_HUECO, 'proteccionSolar', h.proteccionSolar),
              ])} />
          </>
        )}

        {d && d.puentesTermicos.length > 0 && (
          <>
            <h3>Puentes térmicos</h3>
            <Tabla cabecera={['Tipo', 'Longitud (m)', 'ψ (W/mK)', 'Notas']}
              filas={d.puentesTermicos.map((p) => [etiquetaDe(CAMPOS_PUENTE_TERMICO, 'tipo', p.tipo), n(p.longitud), p.psi === null || p.psi === undefined ? 'por defecto' : n(p.psi), String(p.notas ?? '')])} />
          </>
        )}
      </Bloque>

      <Bloque titulo="4. Instalaciones">
        {d && d.instalaciones.length === 0 && <p className="vacio">No hay instalaciones: el programa aplicará las de referencia.</p>}
        {d && d.instalaciones.length > 0 && (
          <Tabla cabecera={['Servicio', 'Generador', 'Energía', 'Central.', 'Potencia (kW)', 'Rendimiento', 'Año', 'Cobertura (%)', 'Acumulación (l)', 'Notas']}
            filas={d.instalaciones.map((i) => [
              etiquetaDe(CAMPOS_INSTALACION, 'servicio', i.servicio), etiquetaDe(CAMPOS_INSTALACION, 'generador', i.generador),
              etiquetaDe(CAMPOS_INSTALACION, 'combustible', i.combustible), i.centralizada ? 'sí' : 'no', n(i.potencia),
              i.rendimiento === null || i.rendimiento === undefined ? '' : `${n(i.rendimiento)} ${i.unidadRendimiento === 'cop' ? '(COP/SCOP)' : i.unidadRendimiento === 'eer' ? '(EER/SEER)' : '%'}`,
              typeof i.anioInstalacion === 'number' ? String(i.anioInstalacion) : '', n(i.cobertura), n(i.acumulacion), String(i.notas ?? ''),
            ])} />
        )}
        {d && d.renovables.length > 0 && (
          <>
            <h3>Energías renovables</h3>
            <Tabla cabecera={['Sistema', 'Captadores (m²)', 'Contribución ACS (%)', 'Potencia pico (kWp)', 'Producción (kWh/año)', 'Notas']}
              filas={d.renovables.map((r) => [etiquetaDe(CAMPOS_RENOVABLE, 'tipo', r.tipo), n(r.superficieCaptadores), n(r.coberturaAcs), n(r.potenciaPico), n(r.produccionAnual), String(r.notas ?? '')])} />
          </>
        )}
        {d && d.iluminacion.length > 0 && (
          <>
            <h3>Iluminación</h3>
            <Tabla cabecera={['Zona', 'Superficie (m²)', 'Potencia (W)', 'Iluminancia (lux)', 'Lámpara', 'Notas']}
              filas={d.iluminacion.map((l) => [String(l.zona ?? ''), n(l.superficie), n(l.potencia), n(l.iluminancia), etiquetaDe(CAMPOS_ILUMINACION, 'tipoLampara', l.tipoLampara), String(l.notas ?? '')])} />
          </>
        )}
      </Bloque>

      {d?.observaciones && <Bloque titulo="Observaciones de la visita"><p className="texto-libre">{d.observaciones}</p></Bloque>}
      <p className="suave pequeno">Generada el {new Date().toLocaleString('es-ES')} con los datos guardados en la herramienta.</p>
    </main>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section className="bloque-ficha"><h2>{titulo}</h2>{children}</section>;
}

function Pares({ filas }: { filas: [string, string][] }) {
  return (
    <dl className="datos">
      {filas.map(([k, v]) => <FilaPar key={k} k={k} v={v} />)}
    </dl>
  );
}

function FilaPar({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v || <span className="falta-dato">—</span>}</dd></>;
}

function Tabla({ cabecera, filas }: { cabecera: string[]; filas: string[][] }) {
  return (
    <div className="tabla-desplazable">
      <table className="tabla">
        <thead><tr>{cabecera.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function TablaCerramientos({ titulo, filas, n }: { titulo: string; filas: Fila[]; n: (v: Valor | undefined, u?: string) => string }) {
  return (
    <>
      <h3>{titulo}</h3>
      <Tabla cabecera={['Nombre', 'Orientación', 'Superficie (m²)', 'U (W/m²K)', 'Obtención de U', 'Notas']}
        filas={filas.map((c) => [String(c.nombre ?? ''), etiquetaDe(CAMPOS_CERRAMIENTO, 'orientacion', c.orientacion), n(c.superficie), n(c.u), etiquetaDe(CAMPOS_CERRAMIENTO, 'origenU', c.origenU), String(c.notas ?? '')])} />
    </>
  );
}
