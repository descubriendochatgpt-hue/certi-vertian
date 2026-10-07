import { useState } from 'react';
import { type FichaCatastro, consultarCatastro } from '../lib/grabacion';
import type { TomaDatos } from '../lib/tomaDatos';

/**
 * Consulta la ficha del Catastro con la referencia del expediente y propone
 * año de construcción, superficie construida y uso. Nada se añade solo.
 */
export function DatosCatastro({ referencia, datos, editable, anioExpediente, onCambio }: {
  referencia: string | null;
  datos: TomaDatos;
  editable: boolean;
  anioExpediente: number | null;
  onCambio: (d: TomaDatos) => void;
}) {
  const [ficha, setFicha] = useState<FichaCatastro | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  if (!referencia) return null;

  async function consultar() {
    setError('');
    setCargando(true);
    try {
      setFicha(await consultarCatastro(referencia!));
    } catch (e) {
      setError(`${(e as Error).message} También puedes adjuntar el PDF del Catastro en la pantalla de la visita.`);
    } finally {
      setCargando(false);
    }
  }

  const nota = ficha && [
    `Catastro (${ficha.referencia})`,
    ficha.uso && `uso ${ficha.uso}`,
    ficha.superficieConstruida !== null && `superficie construida ${ficha.superficieConstruida} m²`,
    ficha.anioConstruccion !== null && `año ${ficha.anioConstruccion}`,
    ficha.construcciones.length > 0 && `(${ficha.construcciones.join(', ')})`,
  ].filter(Boolean).join(', ');

  const sinAnio = !anioExpediente && typeof datos.generales.anioConstruccion !== 'number';

  return (
    <details className="seccion catastro">
      <summary>Datos del Catastro</summary>
      {!ficha && (
        <div className="acciones">
          <button type="button" disabled={cargando} onClick={consultar}>{cargando ? 'Consultando…' : `Consultar la referencia ${referencia}`}</button>
        </div>
      )}
      {error && <div className="caja aviso">{error}</div>}
      {ficha && (
        <>
          <ul className="lista-simple">
            {ficha.direccion && <li>Dirección: {ficha.direccion}</li>}
            <li>Uso: {ficha.uso ?? '—'}</li>
            <li>Superficie construida: {ficha.superficieConstruida !== null ? `${ficha.superficieConstruida} m²` : '—'} <small className="suave">(no es la superficie útil)</small></li>
            <li>Año de construcción: {ficha.anioConstruccion ?? '—'}</li>
            {ficha.planta && <li>Planta: {ficha.planta}</li>}
            {ficha.construcciones.length > 0 && <li>Construcciones: {ficha.construcciones.join(' · ')}</li>}
          </ul>
          {editable && (
            <div className="acciones">
              {sinAnio && ficha.anioConstruccion !== null && (
                <button type="button" className="principal" onClick={() => onCambio({ ...datos, generales: { ...datos.generales, anioConstruccion: ficha.anioConstruccion } })}>
                  Usar el año {ficha.anioConstruccion}
                </button>
              )}
              {nota && !datos.observaciones.includes(`Catastro (${ficha.referencia})`) && (
                <button type="button" onClick={() => onCambio({ ...datos, observaciones: [datos.observaciones, nota].filter(Boolean).join('\n') })}>
                  Añadir a las observaciones
                </button>
              )}
            </div>
          )}
        </>
      )}
    </details>
  );
}
