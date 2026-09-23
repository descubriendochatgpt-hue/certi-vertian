import { type ReactNode, useEffect, useId, useState } from 'react';
import { type Comprobacion, type Rango, comprobarRango, formatearNumero, leerNumero } from '../lib/validaciones';
import type { Opcion } from '../lib/tomaDatos';
import type { Aviso } from '../lib/validaciones';

export function MensajeComprobacion({ c }: { c: Comprobacion }) {
  if (c.tipo === 'ok') return null;
  return <span className={c.tipo === 'error' ? 'nota-error' : 'nota-aviso'}>{c.tipo === 'aviso' ? '⚠ ' : ''}{c.mensaje}</span>;
}

interface Base {
  etiqueta: string;
  ayuda?: string;
  comprobacion?: Comprobacion;
  obligatorio?: boolean;
  deshabilitado?: boolean;
}

function Envoltorio({ etiqueta, ayuda, comprobacion, obligatorio, children, id }: Base & { children: ReactNode; id: string }) {
  return (
    <div className={`campo ${comprobacion?.tipo === 'error' ? 'con-error' : comprobacion?.tipo === 'aviso' ? 'con-aviso' : ''}`}>
      <label htmlFor={id}>{etiqueta}{obligatorio && <span className="obligatorio"> *</span>}</label>
      {children}
      {ayuda && <small className="ayuda">{ayuda}</small>}
      {comprobacion && <MensajeComprobacion c={comprobacion} />}
    </div>
  );
}

export function CampoTexto(p: Base & { valor: string; onCambio: (v: string) => void; tipo?: string; lista?: string; largo?: boolean; autoComplete?: string }) {
  const id = useId();
  return (
    <Envoltorio {...p} id={id}>
      {p.largo ? (
        <textarea id={id} value={p.valor} disabled={p.deshabilitado} rows={3} onChange={(e) => p.onCambio(e.target.value)} />
      ) : (
        <input id={id} type={p.tipo ?? 'text'} value={p.valor} list={p.lista} disabled={p.deshabilitado}
               required={p.obligatorio} autoComplete={p.autoComplete ?? 'off'} onChange={(e) => p.onCambio(e.target.value)} />
      )}
    </Envoltorio>
  );
}

/**
 * Campo numérico que admite coma decimal. Mientras lo escrito no es un número
 * válido, el valor guardado NO cambia y se muestra el error: nunca se
 * «arregla» lo escrito por su cuenta.
 */
export function CampoNumero(p: Base & { valor: number | null; onCambio: (v: number | null) => void; rango?: Rango }) {
  const id = useId();
  const [texto, setTexto] = useState(p.valor === null ? '' : formatearNumero(p.valor).replace(/\./g, ''));
  const [invalido, setInvalido] = useState(false);

  // Si el valor cambia desde fuera (p. ej. al recuperar un borrador), se refleja.
  useEffect(() => {
    const actual = leerNumero(texto);
    if (actual !== p.valor && !(actual !== null && Number.isNaN(actual))) {
      setTexto(p.valor === null ? '' : formatearNumero(p.valor).replace(/\./g, ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.valor]);

  const comprobacion: Comprobacion = invalido
    ? { tipo: 'error', mensaje: 'No es un número válido (usa coma o punto para los decimales).' }
    : p.comprobacion ?? (p.rango ? comprobarRango(p.valor, p.rango) : { tipo: 'ok' });

  return (
    <Envoltorio {...p} id={id} comprobacion={comprobacion}
                etiqueta={p.rango?.unidad ? `${p.etiqueta} (${p.rango.unidad})` : p.etiqueta}>
      <input id={id} inputMode="decimal" value={texto} disabled={p.deshabilitado}
             onChange={(e) => {
               setTexto(e.target.value);
               const n = leerNumero(e.target.value);
               if (n !== null && Number.isNaN(n)) { setInvalido(true); return; }
               setInvalido(false);
               p.onCambio(n);
             }} />
    </Envoltorio>
  );
}

export function CampoOpcion(p: Base & { valor: string; opciones: Opcion[]; onCambio: (v: string) => void; sinVacio?: boolean }) {
  const id = useId();
  return (
    <Envoltorio {...p} id={id}>
      <select id={id} value={p.valor} disabled={p.deshabilitado} required={p.obligatorio} onChange={(e) => p.onCambio(e.target.value)}>
        {!p.sinVacio && <option value="">— Elegir —</option>}
        {p.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </Envoltorio>
  );
}

export function CampoSiNo(p: Base & { valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <div className="campo campo-casilla">
      <label><input type="checkbox" checked={p.valor} disabled={p.deshabilitado} onChange={(e) => p.onCambio(e.target.checked)} /> {p.etiqueta}</label>
      {p.ayuda && <small className="ayuda">{p.ayuda}</small>}
    </div>
  );
}

/**
 * Lista de avisos que el técnico debe revisar y confirmar uno a uno.
 * Ningún aviso se da por confirmado automáticamente.
 */
export function ConfirmarAvisos({ avisos, confirmados, onCambio, titulo }: {
  avisos: Aviso[];
  confirmados: Set<string>;
  onCambio: (s: Set<string>) => void;
  titulo?: string;
}) {
  if (avisos.length === 0) return null;
  const pendientes = avisos.filter((a) => !confirmados.has(a.clave)).length;
  return (
    <div className="caja aviso">
      <strong>{titulo ?? 'Revisa estos datos antes de continuar'}</strong>
      <p className="suave">No son errores, pero cada uno debe confirmarse a mano. {pendientes > 0 ? `Quedan ${pendientes} por confirmar.` : 'Todos confirmados.'}</p>
      <ul className="lista-avisos">
        {avisos.map((a) => (
          <li key={a.clave}>
            <label>
              <input type="checkbox" checked={confirmados.has(a.clave)}
                     onChange={(e) => {
                       const s = new Set(confirmados);
                       if (e.target.checked) s.add(a.clave); else s.delete(a.clave);
                       onCambio(s);
                     }} />
              <span>{a.mensaje} <em>— He revisado este dato y es correcto.</em></span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
