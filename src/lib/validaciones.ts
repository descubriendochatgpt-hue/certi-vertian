// Validaciones de formato. Dos niveles:
//
//  · error: el dato no se puede guardar así (p. ej. un email sin @).
//  · aviso: el dato es posible pero raro (un NIF cuya letra no cuadra, una U
//    de 3,8 W/m²K). La app lo señala y pide al técnico que lo confirme.
//
// Nada de lo que hay aquí modifica el dato: solo lo comprueba.

export interface Aviso {
  /** Identifica el aviso Y el valor avisado: si el valor cambia, hay que volver a confirmarlo. */
  clave: string;
  mensaje: string;
}

export type Comprobacion = { tipo: 'ok' } | { tipo: 'error'; mensaje: string } | { tipo: 'aviso'; mensaje: string };

const OK: Comprobacion = { tipo: 'ok' };

/** Quita espacios y guiones y pasa a mayúsculas, solo para comparar. */
export function normalizarCodigo(v: string): string {
  return v.replace(/[\s.-]/g, '').toUpperCase();
}

// ─────────────────────────── NIF / NIE / CIF ─────────────────────────────

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function comprobarNif(entrada: string): Comprobacion {
  const v = normalizarCodigo(entrada);
  if (!v) return OK;

  // DNI: 8 cifras + letra
  if (/^\d{8}[A-Z]$/.test(v)) {
    const esperada = LETRAS_DNI[Number(v.slice(0, 8)) % 23];
    return esperada === v[8]
      ? OK
      : { tipo: 'aviso', mensaje: `La letra del DNI no cuadra: para ${v.slice(0, 8)} debería ser «${esperada}».` };
  }

  // NIE: X/Y/Z + 7 cifras + letra
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const numero = 'XYZ'.indexOf(v[0]!) + v.slice(1, 8);
    const esperada = LETRAS_DNI[Number(numero) % 23];
    return esperada === v[8]
      ? OK
      : { tipo: 'aviso', mensaje: `La letra del NIE no cuadra: debería ser «${esperada}».` };
  }

  // NIF de persona jurídica (antiguo CIF): letra + 7 cifras + control
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const cifras = v.slice(1, 8);
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      let n = Number(cifras[i]);
      if (i % 2 === 0) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      suma += n;
    }
    const digito = (10 - (suma % 10)) % 10;
    const letra = 'JABCDEFGHI'[digito]!;
    const control = v[8]!;
    const soloLetra = 'PQRSNW'.includes(v[0]!);
    const soloNumero = 'ABEH'.includes(v[0]!);
    const valido = soloLetra ? control === letra : soloNumero ? control === String(digito) : control === letra || control === String(digito);
    return valido
      ? OK
      : { tipo: 'aviso', mensaje: `El carácter de control del NIF no cuadra (esperado «${soloLetra ? letra : digito}»).` };
  }

  return { tipo: 'aviso', mensaje: 'No parece un DNI, NIE ni NIF de empresa (formato no reconocido).' };
}

// ───────────────────────── Referencia catastral ──────────────────────────
// 20 caracteres: 14 de la finca + 4 del inmueble (cargo) + 2 de control.
// Los dos de control se calculan con el algoritmo público de la Dirección
// General del Catastro.

const PESOS_RC = [13, 15, 12, 5, 4, 17, 9, 21, 3, 7, 1];
const LETRAS_RC = 'MQWERTYUIOPASDFGHJKLBZX';

function valorRc(c: string): number {
  if (/\d/.test(c)) return Number(c);
  const i = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.indexOf(c);
  return i + 1;
}

function controlRc(parte: string): string {
  let suma = 0;
  for (let i = 0; i < parte.length; i++) suma += valorRc(parte[i]!) * PESOS_RC[i]!;
  return LETRAS_RC[suma % 23]!;
}

export function comprobarReferenciaCatastral(entrada: string): Comprobacion {
  const v = normalizarCodigo(entrada);
  if (!v) return OK;
  if (!/^[0-9A-ZÑ]+$/.test(v)) return { tipo: 'error', mensaje: 'Solo puede contener letras y números.' };
  if (v.length === 14) {
    return { tipo: 'aviso', mensaje: 'Tiene 14 caracteres: es la referencia de la finca, no la del inmueble (20 caracteres).' };
  }
  if (v.length !== 20) {
    return { tipo: 'aviso', mensaje: `Una referencia catastral de inmueble tiene 20 caracteres y esta tiene ${v.length}.` };
  }
  const cargo = v.slice(14, 18);
  const esperado = controlRc(v.slice(0, 7) + cargo) + controlRc(v.slice(7, 14) + cargo);
  if (esperado !== v.slice(18, 20)) {
    return { tipo: 'aviso', mensaje: `Los dos caracteres de control no cuadran (según el algoritmo del Catastro deberían ser «${esperado}»). Compruébala en la sede del Catastro.` };
  }
  return OK;
}

// ─────────────────────────── Contacto y dirección ────────────────────────

export function comprobarEmail(v: string): Comprobacion {
  if (!v.trim()) return OK;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? OK : { tipo: 'error', mensaje: 'El email no tiene un formato válido.' };
}

export function comprobarTelefono(v: string): Comprobacion {
  const t = v.replace(/[\s.-]/g, '');
  if (!t) return OK;
  if (/^(\+34|0034)?[6789]\d{8}$/.test(t)) return OK;
  if (/^\+\d{8,15}$/.test(t)) return OK;
  return { tipo: 'aviso', mensaje: 'No parece un teléfono español de 9 cifras.' };
}

export function comprobarCodigoPostal(v: string): Comprobacion {
  const t = v.trim();
  if (!t) return OK;
  if (!/^\d{5}$/.test(t)) return { tipo: 'error', mensaje: 'El código postal tiene 5 cifras.' };
  if (!t.startsWith('33')) return { tipo: 'aviso', mensaje: 'Los códigos postales de Asturias empiezan por 33.' };
  return OK;
}

// ─────────────────────────────── Números ─────────────────────────────────

/** Admite coma decimal («1,25»). Devuelve null si está vacío y NaN si no es un número. */
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  if (!/^-?\d+(\.\d+)?$/.test(t) && !/^-?\.\d+$/.test(t)) return NaN;
  return Number(t);
}

export interface Rango {
  /** Fuera de [min, max] no se admite. */
  min?: number;
  max?: number;
  /** Fuera de [avisoMin, avisoMax] se admite, pero pidiendo confirmación. */
  avisoMin?: number;
  avisoMax?: number;
  unidad?: string;
}

export function formatearNumero(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 3 });
}

export function comprobarRango(valor: number | null | undefined, r: Rango): Comprobacion {
  if (valor === null || valor === undefined) return OK;
  if (Number.isNaN(valor)) return { tipo: 'error', mensaje: 'No es un número válido.' };
  const u = r.unidad ? ` ${r.unidad}` : '';
  if (r.min !== undefined && valor < r.min) return { tipo: 'error', mensaje: `No puede ser menor que ${formatearNumero(r.min)}${u}.` };
  if (r.max !== undefined && valor > r.max) return { tipo: 'error', mensaje: `No puede ser mayor que ${formatearNumero(r.max)}${u}.` };
  if ((r.avisoMin !== undefined && valor < r.avisoMin) || (r.avisoMax !== undefined && valor > r.avisoMax)) {
    return {
      tipo: 'aviso',
      mensaje: `${formatearNumero(valor)}${u} está fuera de lo habitual (${formatearNumero(r.avisoMin ?? r.min ?? 0)}–${formatearNumero(r.avisoMax ?? r.max ?? 0)}${u}). ¿Es correcto?`,
    };
  }
  return OK;
}

// ────────────────────────────── Concejos ─────────────────────────────────

export const CONCEJOS_ASTURIAS = [
  'Allande', 'Aller', 'Amieva', 'Avilés', 'Belmonte de Miranda', 'Bimenes', 'Boal', 'Cabrales', 'Cabranes',
  'Candamo', 'Cangas de Onís', 'Cangas del Narcea', 'Caravia', 'Carreño', 'Caso', 'Castrillón', 'Castropol',
  'Coaña', 'Colunga', 'Corvera de Asturias', 'Cudillero', 'Degaña', 'El Franco', 'Gijón', 'Gozón', 'Grado',
  'Grandas de Salime', 'Ibias', 'Illano', 'Illas', 'Langreo', 'Las Regueras', 'Laviana', 'Lena', 'Llanera',
  'Llanes', 'Mieres', 'Morcín', 'Muros de Nalón', 'Nava', 'Navia', 'Noreña', 'Onís', 'Oviedo', 'Parres',
  'Peñamellera Alta', 'Peñamellera Baja', 'Pesoz', 'Piloña', 'Ponga', 'Pravia', 'Proaza', 'Quirós',
  'Ribadedeva', 'Ribadesella', 'Ribera de Arriba', 'Riosa', 'Salas', 'San Martín de Oscos',
  'San Martín del Rey Aurelio', 'San Tirso de Abres', 'Santa Eulalia de Oscos', 'Santo Adriano', 'Sariego',
  'Siero', 'Sobrescobio', 'Somiedo', 'Soto del Barco', 'Tapia de Casariego', 'Taramundi', 'Teverga', 'Tineo',
  'Valdés', 'Vegadeo', 'Villanueva de Oscos', 'Villaviciosa', 'Villayón', 'Yernes y Tameza',
];

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function comprobarConcejo(v: string): Comprobacion {
  if (!v.trim()) return OK;
  const t = sinTildes(v);
  return CONCEJOS_ASTURIAS.some((c) => sinTildes(c) === t)
    ? OK
    : { tipo: 'aviso', mensaje: 'No coincide con ninguno de los 78 concejos de Asturias.' };
}
