import { ESTADOS, type Estado, NOMBRE_ESTADO } from '../lib/estados';

export function EtiquetaEstado({ estado }: { estado: Estado }) {
  return <span className={`etiqueta estado-${ESTADOS.indexOf(estado)}`}>{NOMBRE_ESTADO[estado]}</span>;
}

export function PasosEstado({ estado }: { estado: Estado }) {
  const actual = ESTADOS.indexOf(estado);
  return (
    <ol className="pasos">
      {ESTADOS.map((e, i) => (
        <li key={e} className={i < actual ? 'hecho' : i === actual ? 'actual' : ''}>
          <span className="numero">{i < actual ? '✓' : i + 1}</span> {NOMBRE_ESTADO[e]}
        </li>
      ))}
    </ol>
  );
}

export function Calificacion({ letra }: { letra: string | null }) {
  if (!letra) return <span>—</span>;
  return <span className={`calificacion letra-${letra}`}>{letra}</span>;
}
