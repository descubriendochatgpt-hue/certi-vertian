// Copia de seguridad del borrador de la toma de datos en el propio
// dispositivo (móvil, tablet u ordenador). Protege contra cortes de conexión
// durante la visita: lo escrito no se pierde aunque no llegue al servidor.
//
// Se borra en cuanto el servidor confirma que ha guardado los mismos datos.
// Es una ayuda; la copia buena es siempre la del servidor.

import { type TomaDatos, normalizarTomaDatos } from './tomaDatos';

export interface CopiaLocal {
  datos: TomaDatos;
  confirmados: string[];
  guardadaEn: string;   // ISO
}

const clave = (expedienteId: string) => `certi.borrador.${expedienteId}`;

export function guardarCopiaLocal(expedienteId: string, c: CopiaLocal): void {
  try {
    localStorage.setItem(clave(expedienteId), JSON.stringify(c));
  } catch {
    // Almacenamiento lleno o bloqueado (modo privado): se sigue sin copia local.
  }
}

export function leerCopiaLocal(expedienteId: string): CopiaLocal | null {
  try {
    const bruto = localStorage.getItem(clave(expedienteId));
    if (!bruto) return null;
    const c = JSON.parse(bruto) as Partial<CopiaLocal>;
    if (typeof c.guardadaEn !== 'string') return null;
    return { datos: normalizarTomaDatos(c.datos), confirmados: Array.isArray(c.confirmados) ? c.confirmados : [], guardadaEn: c.guardadaEn };
  } catch {
    return null;
  }
}

export function borrarCopiaLocal(expedienteId: string): void {
  try {
    localStorage.removeItem(clave(expedienteId));
  } catch {
    /* nada que hacer */
  }
}

/** Al salir de la sesión se borran todas las copias locales del dispositivo. */
export function borrarTodasLasCopiasLocales(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('certi.borrador.')) localStorage.removeItem(k);
  } catch {
    /* nada que hacer */
  }
}

export function hayCopiasLocales(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('certi.borrador.'));
  } catch {
    return false;
  }
}
