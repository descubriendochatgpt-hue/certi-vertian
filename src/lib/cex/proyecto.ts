// Generar un proyecto .cex de CE3X a partir de una PLANTILLA (experimental).
//
// Formato (CE3X v3.1, analizado con un proyecto real y su XML):
//   bloque 0  cabecera, p. ej. «CE3Xv3.1 Residencial»
//   bloque 1  datos administrativos (lista de textos)
//   bloque 2  datos generales (lista de textos, fotos en base64…)
//   bloque 3  envolvente: [cerramientos, huecos, puentes térmicos, …]
//   bloque 4  instalaciones: [ACS, calefacción, …]
//   bloque 5  medidas de mejora y resultados
//   …         librerías, patrones de sombras, observaciones
//   último    huella del propio CE3X (no se toca)
//
// La plantilla es un proyecto VACÍO guardado por el técnico en su CE3X (con
// sus datos de técnico). Aquí solo se sustituyen los campos cuya posición se
// ha comprobado contra el XML oficial; todo lo demás se queda como en la
// plantilla y se lista como «pendiente» para rellenarlo en CE3X. Cada campo
// conserva el tipo de cadena (str/unicode) que tenía en la plantilla.

import { type Py, PyBytes, escribirPickles, leerPickles, texto } from './pickle';
import type { Expediente } from '../estados';
import type { TomaDatos } from '../tomaDatos';

export interface ProyectoCex {
  version: string;
  bloques: Py[];
}

export function leerCex(datos: Uint8Array): ProyectoCex {
  let bloques: Py[];
  try {
    bloques = leerPickles(datos);
  } catch (e) {
    throw new Error(`No parece un proyecto de CE3X (${(e as Error).message})`);
  }
  const version = texto(bloques[0]);
  if (!version?.startsWith('CE3X') || bloques.length < 6 || !Array.isArray(bloques[1]) || !Array.isArray(bloques[2])) {
    throw new Error('No parece un proyecto .cex de CE3X.');
  }
  return { version, bloques };
}

export function escribirCex(p: ProyectoCex): Uint8Array {
  return escribirPickles(p.bloques);
}

/** Versiones con las que se ha comprobado la posición de los campos. */
export const VERSIONES_PROBADAS = ['CE3Xv3.1 Residencial'];

const lista = (v: Py | undefined): Py[] => (Array.isArray(v) ? v : []);

export function contarElementos(p: ProyectoCex): { cerramientos: number; huecos: number; puentes: number; instalaciones: number } {
  const env = lista(p.bloques[3]);
  const inst = lista(p.bloques[4]);
  return {
    cerramientos: lista(env[0]).length,
    huecos: lista(env[1]).length,
    puentes: lista(env[2]).length,
    instalaciones: inst.reduce<number>((n, x) => n + lista(x).length, 0),
  };
}

/** Número con punto decimal, como lo guarda CE3X («58.7», «2.5»). */
const num = (n: number) => String(Math.round(n * 1000) / 1000);

export interface CampoRellenado {
  etiqueta: string;
  antes: string;
  valor: string;
}

export interface ResultadoCex {
  proyecto: ProyectoCex;
  rellenados: CampoRellenado[];
  /** Lo que hay que completar a mano en CE3X. */
  pendientes: string[];
  avisos: string[];
}

/**
 * Copia la plantilla y escribe en ella los datos del expediente y de la toma
 * de datos que se saben colocar. Lanza un error si la plantilla no está vacía
 * (para no arrastrar cerramientos o instalaciones de otro edificio).
 */
export function rellenarPlantilla(plantilla: Uint8Array, exp: Expediente, toma: TomaDatos): ResultadoCex {
  const p = leerCex(plantilla);
  const n = contarElementos(p);
  if (n.cerramientos || n.huecos || n.puentes || n.instalaciones) {
    throw new Error(
      `La plantilla no está vacía (${n.cerramientos} cerramientos, ${n.huecos} huecos, ${n.puentes} puentes térmicos, ` +
      `${n.instalaciones} instalaciones). Crea en CE3X un proyecto nuevo, rellena solo tus datos de técnico y guárdalo como plantilla.`);
  }
  const avisos: string[] = [];
  if (!VERSIONES_PROBADAS.includes(p.version)) {
    avisos.push(`La plantilla es de «${p.version}»; el formato solo se ha comprobado con ${VERSIONES_PROBADAS.join(', ')}. Revisa todos los campos.`);
  }
  const admin = p.bloques[1] as Py[];
  const gen = p.bloques[2] as Py[];
  const rellenados: CampoRellenado[] = [];
  const pendientes: string[] = [];

  /** Sustituye un texto conservando si era str o unicode. Solo si en la plantilla había un texto en esa posición. */
  const poner = (bloque: Py[], i: number, etiqueta: string, valor: string | null | undefined) => {
    if (valor === null || valor === undefined || valor === '') { pendientes.push(etiqueta); return; }
    const actual = bloque[i];
    const antes = texto(actual);
    if (antes === undefined) { pendientes.push(`${etiqueta} (la plantilla no tiene este campo donde se esperaba)`); return; }
    bloque[i] = actual instanceof PyBytes ? new PyBytes(valor) : valor;
    rellenados.push({ etiqueta, antes, valor });
  };

  // Datos administrativos (bloque 1)
  poner(admin, 0, 'Nombre del edificio', exp.direccion);
  poner(admin, 1, 'Dirección', exp.direccion);
  poner(admin, 2, 'Municipio', exp.municipio);
  poner(admin, 3, 'Provincia', exp.provincia);
  if (exp.referencia_catastral && Array.isArray(admin[15])) {
    const rc = admin[15] as Py[];
    const antes = rc.map((x) => texto(x) ?? '').join(', ');
    rc.splice(0, rc.length, exp.referencia_catastral);
    rellenados.push({ etiqueta: 'Referencia catastral', antes, valor: exp.referencia_catastral });
  } else pendientes.push('Referencia catastral');
  pendientes.push('Código postal del edificio', 'Datos del cliente (nombre, NIF, teléfono, email)');

  // Datos generales (bloque 2)
  const g = toma.generales;
  const NORMATIVA: Record<string, string> = { anterior_ct79: 'Anterior' };
  const normativa = typeof g.normativa === 'string' ? NORMATIVA[g.normativa] : undefined;
  if (g.normativa && !normativa) pendientes.push('Normativa vigente (elígela en CE3X)');
  else poner(gen, 0, 'Normativa vigente', normativa);
  const TIPO: Partial<Record<Expediente['tipo_edificio'], string>> = { vivienda_en_bloque: 'Vivienda Individual' };
  const tipo = TIPO[exp.tipo_edificio];
  if (tipo) poner(gen, 1, 'Tipo de edificio', tipo); else pendientes.push('Tipo de edificio (elígelo en CE3X)');
  poner(gen, 2, 'Provincia (datos generales)', exp.provincia);
  poner(gen, 3, 'Localidad', exp.municipio);
  const zona = typeof g.zonaClimatica === 'string' && g.zonaClimatica !== 'otra' ? g.zonaClimatica : undefined;
  poner(gen, 4, 'Zona climática', zona);
  poner(gen, 6, 'Superficie útil habitable (m²)', typeof g.superficieUtil === 'number' ? num(g.superficieUtil) : undefined);
  poner(gen, 7, 'Altura libre de planta (m)', typeof g.alturaLibre === 'number' ? num(g.alturaLibre) : undefined);
  poner(gen, 8, 'Número de plantas habitables', typeof g.numeroPlantas === 'number' ? num(g.numeroPlantas) : undefined);
  poner(gen, 9, 'Demanda diaria de ACS (l/día)', typeof g.demandaAcs === 'number' ? num(g.demandaAcs) : undefined);
  const masa = typeof g.masaParticiones === 'string' ? g.masaParticiones.charAt(0).toUpperCase() + g.masaParticiones.slice(1) : undefined;
  poner(gen, 10, 'Masa de las particiones', masa);
  poner(gen, 16, 'Ventilación (ren/h)', typeof g.ventilacion === 'number' ? num(g.ventilacion) : undefined);
  poner(gen, 19, 'Año de construcción', exp.anio_construccion ? String(exp.anio_construccion) : undefined);

  // Lo que todavía no se escribe en el .cex
  const cuenta = (k: keyof TomaDatos, nombre: string) => {
    const v = toma[k];
    if (Array.isArray(v) && v.length) pendientes.push(`${nombre}: ${v.length} (introdúcelos en CE3X con la ficha)`);
  };
  cuenta('cerramientos', 'Cerramientos opacos');
  cuenta('huecos', 'Huecos');
  cuenta('puentesTermicos', 'Puentes térmicos');
  cuenta('instalaciones', 'Instalaciones');
  cuenta('renovables', 'Renovables');
  cuenta('iluminacion', 'Iluminación');

  return { proyecto: p, rellenados, pendientes, avisos };
}

/** Nombre del fichero descargado: código del expediente sin caracteres raros. */
export function nombreCex(exp: Expediente): string {
  return `${exp.codigo.replace(/[^\w.-]+/g, '_')}.cex`;
}
