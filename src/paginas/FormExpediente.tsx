import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type DatosExpediente, actualizarExpediente, crearExpediente, obtenerExpediente } from '../lib/api';
import { NOMBRE_TIPO_EDIFICIO, type TipoEdificio, esResidencial } from '../lib/estados';
import {
  type Aviso, type Comprobacion, CONCEJOS_ASTURIAS, comprobarCodigoPostal, comprobarConcejo, comprobarEmail,
  comprobarNif, comprobarRango, comprobarReferenciaCatastral, comprobarTelefono, normalizarCodigo,
} from '../lib/validaciones';
import { CampoNumero, CampoOpcion, CampoTexto, ConfirmarAvisos } from '../componentes/Campos';

interface Formulario {
  direccion: string;
  municipio: string;
  codigo_postal: string;
  referencia_catastral: string;
  tipo_edificio: TipoEdificio | '';
  superficie_util: number | null;
  anio_construccion: number | null;
  propietario_nombre: string;
  propietario_nif: string;
  propietario_telefono: string;
  propietario_email: string;
  fecha_visita: string;
  notas: string;
}

const VACIO: Formulario = {
  direccion: '', municipio: '', codigo_postal: '', referencia_catastral: '', tipo_edificio: '',
  superficie_util: null, anio_construccion: null, propietario_nombre: '', propietario_nif: '',
  propietario_telefono: '', propietario_email: '', fecha_visita: '', notas: '',
};

type Comprobaciones = Partial<Record<keyof Formulario, Comprobacion>>;

function comprobar(f: Formulario): Comprobaciones {
  const c: Comprobaciones = {
    municipio: comprobarConcejo(f.municipio),
    codigo_postal: comprobarCodigoPostal(f.codigo_postal),
    referencia_catastral: comprobarReferenciaCatastral(f.referencia_catastral),
    propietario_nif: comprobarNif(f.propietario_nif),
    propietario_telefono: comprobarTelefono(f.propietario_telefono),
    propietario_email: comprobarEmail(f.propietario_email),
    superficie_util: comprobarRango(f.superficie_util,
      f.tipo_edificio && esResidencial(f.tipo_edificio) && f.tipo_edificio !== 'bloque_viviendas'
        ? { min: 0.01, max: 100000, avisoMin: 20, avisoMax: 600, unidad: 'm²' }
        : { min: 0.01, max: 1000000, unidad: 'm²' }),
    anio_construccion: comprobarRango(f.anio_construccion, { min: 1500, max: new Date().getFullYear() + 3, avisoMin: 1850, avisoMax: new Date().getFullYear() }),
  };
  if (f.anio_construccion !== null && !Number.isInteger(f.anio_construccion)) {
    c.anio_construccion = { tipo: 'error', mensaje: 'El año debe ser un número entero.' };
  }
  return c;
}

const ETIQUETAS: Partial<Record<keyof Formulario, string>> = {
  municipio: 'Municipio', codigo_postal: 'Código postal', referencia_catastral: 'Referencia catastral',
  propietario_nif: 'NIF', propietario_telefono: 'Teléfono', superficie_util: 'Superficie útil', anio_construccion: 'Año de construcción',
};

function avisosDe(f: Formulario, c: Comprobaciones): Aviso[] {
  return (Object.keys(c) as (keyof Formulario)[]).flatMap((k) => {
    const r = c[k];
    return r?.tipo === 'aviso' ? [{ clave: `${k}=${String(f[k])}`, mensaje: `${ETIQUETAS[k] ?? k}: ${r.mensaje}` }] : [];
  });
}

const vacioANull = (s: string) => (s.trim() ? s.trim() : null);

export function FormExpediente() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [f, setF] = useState<Formulario>(VACIO);
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(Boolean(id));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [mostrarAvisos, setMostrarAvisos] = useState(false);

  useEffect(() => {
    if (!id) return;
    obtenerExpediente(id).then((e) => {
      if (!e) { setError('Expediente no encontrado.'); return; }
      setF({
        direccion: e.direccion, municipio: e.municipio, codigo_postal: e.codigo_postal ?? '',
        referencia_catastral: e.referencia_catastral ?? '', tipo_edificio: e.tipo_edificio,
        superficie_util: e.superficie_util === null ? null : Number(e.superficie_util),
        anio_construccion: e.anio_construccion, propietario_nombre: e.propietario_nombre,
        propietario_nif: e.propietario_nif ?? '', propietario_telefono: e.propietario_telefono ?? '',
        propietario_email: e.propietario_email ?? '', fecha_visita: e.fecha_visita ?? '', notas: e.notas ?? '',
      });
      setConfirmados(new Set(e.avisos_confirmados));
    }).catch((e: Error) => setError(e.message)).finally(() => setCargando(false));
  }, [id]);

  const set = <K extends keyof Formulario>(k: K) => (v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));
  const c = comprobar(f);
  const avisos = avisosDe(f, c);
  const hayErrores = Object.values(c).some((r) => r?.tipo === 'error');
  const pendientes = avisos.filter((a) => !confirmados.has(a.clave));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (hayErrores) { setError('Corrige los campos marcados en rojo.'); return; }
    if (!f.tipo_edificio) { setError('Elige el tipo de edificio.'); return; }
    if (pendientes.length > 0) {
      setMostrarAvisos(true);
      setError(`Hay ${pendientes.length} dato${pendientes.length === 1 ? '' : 's'} poco habitual${pendientes.length === 1 ? '' : 'es'}: revísalo${pendientes.length === 1 ? '' : 's'} y confírmalo${pendientes.length === 1 ? '' : 's'} abajo para guardar.`);
      return;
    }
    const datos: DatosExpediente = {
      direccion: f.direccion.trim(),
      municipio: f.municipio.trim(),
      codigo_postal: vacioANull(f.codigo_postal),
      // Se guarda tal cual la escribió el técnico, solo sin espacios.
      referencia_catastral: f.referencia_catastral.trim() ? normalizarCodigo(f.referencia_catastral) : null,
      tipo_edificio: f.tipo_edificio,
      superficie_util: f.superficie_util,
      anio_construccion: f.anio_construccion,
      propietario_nombre: f.propietario_nombre.trim(),
      propietario_nif: f.propietario_nif.trim() ? normalizarCodigo(f.propietario_nif) : null,
      propietario_telefono: vacioANull(f.propietario_telefono),
      propietario_email: vacioANull(f.propietario_email),
      fecha_visita: f.fecha_visita || null,
      notas: vacioANull(f.notas),
      // Solo se guardan las confirmaciones de avisos que siguen vigentes.
      avisos_confirmados: avisos.map((a) => a.clave),
    };
    setEnviando(true);
    try {
      const guardado = id ? await actualizarExpediente(id, datos) : await crearExpediente(datos);
      navegar(`/expedientes/${guardado.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) return <main className="pagina"><p className="cargando">Cargando…</p></main>;

  return (
    <main className="pagina">
      <p><Link to={id ? `/expedientes/${id}` : '/expedientes'}>← Volver</Link></p>
      <h1>{id ? 'Editar expediente' : 'Nuevo expediente'}</h1>

      <form onSubmit={guardar} className="formulario" noValidate>
        <fieldset>
          <legend>Inmueble</legend>
          <CampoTexto etiqueta="Dirección" obligatorio valor={f.direccion} onCambio={set('direccion')} autoComplete="street-address" />
          <div className="fila-campos">
            <CampoTexto etiqueta="Municipio (concejo)" obligatorio valor={f.municipio} onCambio={set('municipio')} lista="concejos" comprobacion={c.municipio} />
            <CampoTexto etiqueta="Código postal" valor={f.codigo_postal} onCambio={set('codigo_postal')} comprobacion={c.codigo_postal} />
          </div>
          <datalist id="concejos">{CONCEJOS_ASTURIAS.map((m) => <option key={m} value={m} />)}</datalist>
          <CampoTexto etiqueta="Referencia catastral" valor={f.referencia_catastral} onCambio={set('referencia_catastral')}
                      comprobacion={c.referencia_catastral} ayuda="20 caracteres. Se comprueban los dígitos de control del Catastro." />
          <CampoOpcion etiqueta="Tipo de edificio" obligatorio valor={f.tipo_edificio} onCambio={(v) => set('tipo_edificio')(v as TipoEdificio)}
                       opciones={Object.entries(NOMBRE_TIPO_EDIFICIO).map(([valor, etiqueta]) => ({ valor, etiqueta }))} />
          <div className="fila-campos">
            <CampoNumero etiqueta="Superficie útil" valor={f.superficie_util} onCambio={set('superficie_util')} comprobacion={c.superficie_util} rango={{ unidad: 'm²' }} />
            <CampoNumero etiqueta="Año de construcción" valor={f.anio_construccion} onCambio={set('anio_construccion')} comprobacion={c.anio_construccion} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Propietario o promotor</legend>
          <CampoTexto etiqueta="Nombre o razón social" obligatorio valor={f.propietario_nombre} onCambio={set('propietario_nombre')} />
          <CampoTexto etiqueta="NIF / NIE" valor={f.propietario_nif} onCambio={set('propietario_nif')} comprobacion={c.propietario_nif} />
          <div className="fila-campos">
            <CampoTexto etiqueta="Teléfono" tipo="tel" valor={f.propietario_telefono} onCambio={set('propietario_telefono')} comprobacion={c.propietario_telefono} />
            <CampoTexto etiqueta="Email" tipo="email" valor={f.propietario_email} onCambio={set('propietario_email')} comprobacion={c.propietario_email} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Visita técnica</legend>
          <CampoTexto etiqueta="Fecha de la visita" tipo="date" valor={f.fecha_visita} onCambio={set('fecha_visita')}
                      ayuda="Puede ser una fecha prevista; se exige que ya haya pasado al verificar los datos." />
          <CampoTexto etiqueta="Notas" largo valor={f.notas} onCambio={set('notas')} />
        </fieldset>

        {(mostrarAvisos || avisos.some((a) => confirmados.has(a.clave))) && (
          <ConfirmarAvisos avisos={avisos} confirmados={confirmados} onCambio={setConfirmados} />
        )}

        {error && <div className="caja error">{error}</div>}
        <div className="acciones">
          <button type="submit" className="principal" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
          <Link to={id ? `/expedientes/${id}` : '/expedientes'} className="boton">Cancelar</Link>
        </div>
      </form>
    </main>
  );
}
