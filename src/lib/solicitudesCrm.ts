// Solicitudes que llegan del CRM de Vertian (bandeja «Solicitudes»).
//
// El CRM envía, por cada encargo de certificado, los datos que el cliente ha
// rellenado en la web: propietario e inmueble y, si la ha reservado, la fecha
// de la visita. Aquí se leen con cuidado (vienen de fuera) y se convierten en
// una PROPUESTA de expediente: el técnico la revisa en el formulario de
// siempre y la guarda él. Lo que no encaja se deja vacío y se explica.

import type { TipoEdificio } from './estados';

/** Lo que manda el CRM (versión 1). Todo es opcional: se comprueba al leerlo. */
export interface SolicitudCrmDatos {
  version: number;
  origen: string;            // 'presupuesto' | 'pedido'
  referencia_crm: string;    // número de presupuesto o del pedido en el CRM
  servicio: string;
  cliente: {
    nombre: string;
    razon_social: string;
    nif: string;
    email: string;
    telefono: string;
  };
  inmueble: {
    direccion: string;
    codigo_postal: string;
    localidad: string;
    provincia: string;
    ref_catastral: string;
    tipo: string;            // «Piso o apartamento», «Casa o chalet»…
    superficie: string;      // la que indica el cliente (construida o aproximada)
  };
  visita: string | null;     // fecha y hora ISO de la visita reservada
  notas: string;
  enlace_crm: string;
}

export type EstadoSolicitud = 'pendiente' | 'importada' | 'descartada';

export interface SolicitudCrm {
  id: string;
  referencia: string;
  datos: unknown;
  estado: EstadoSolicitud;
  expediente_id: string | null;
  recibida_en: string;
  actualizada_en: string;
  resuelta_en: string | null;
}

const texto = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** Lee los datos del CRM sin fiarse de su forma: lo que no es texto se ignora. */
export function leerDatosCrm(bruto: unknown): SolicitudCrmDatos {
  const d = obj(bruto), c = obj(d.cliente), i = obj(d.inmueble);
  const visita = texto(d.visita, 40);
  const enlace = texto(d.enlace_crm, 500);
  return {
    version: typeof d.version === 'number' ? d.version : 1,
    origen: texto(d.origen, 40),
    referencia_crm: texto(d.referencia_crm, 80),
    servicio: texto(d.servicio, 200),
    cliente: {
      nombre: texto(c.nombre, 120), razon_social: texto(c.razon_social, 160), nif: texto(c.nif, 20),
      email: texto(c.email, 200), telefono: texto(c.telefono, 40),
    },
    inmueble: {
      direccion: texto(i.direccion, 200), codigo_postal: texto(i.codigo_postal, 10), localidad: texto(i.localidad, 80),
      provincia: texto(i.provincia, 80), ref_catastral: texto(i.ref_catastral, 30), tipo: texto(i.tipo, 60),
      superficie: texto(i.superficie, 20),
    },
    visita: visita && !Number.isNaN(Date.parse(visita)) ? visita : null,
    notas: texto(d.notas, 2000),
    // Solo enlaces web normales (nunca javascript: ni similares).
    enlace_crm: /^https:\/\//i.test(enlace) ? enlace : '',
  };
}

/** Tipo de inmueble del CRM → tipo de edificio. Lo dudoso se deja sin elegir. */
const TIPOS: Record<string, TipoEdificio> = {
  'piso o apartamento': 'vivienda_en_bloque',
  'casa o chalet': 'vivienda_unifamiliar',
  'local u oficina': 'local_terciario',
};

// Provincia por las dos primeras cifras del código postal.
const PROVINCIAS: Record<string, string> = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila', '06': 'Badajoz', '07': 'Illes Balears',
  '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba',
  '15': 'A Coruña', '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa', '21': 'Huelva',
  '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida', '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga',
  '30': 'Murcia', '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra',
  '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia', '41': 'Sevilla', '42': 'Soria',
  '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '49': 'Zamora',
  '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
};

export function provinciaDeCodigoPostal(cp: string): string | null {
  return /^\d{5}$/.test(cp) ? PROVINCIAS[cp.slice(0, 2)] ?? null : null;
}

/** Lo que se propone para el formulario del expediente. */
export interface PropuestaExpediente {
  direccion: string;
  municipio: string;
  codigo_postal: string;
  referencia_catastral: string;
  tipo_edificio: TipoEdificio | '';
  propietario_nombre: string;
  propietario_nif: string;
  propietario_telefono: string;
  propietario_email: string;
  fecha_visita: string;
  notas: string;
  /** Cosas que el técnico debe mirar antes de guardar. */
  revisar: string[];
}

/** Fecha local (AAAA-MM-DD) de un instante ISO, en la zona de España. */
function fechaLocal(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

export function propuestaDesdeCrm(d: SolicitudCrmDatos): PropuestaExpediente {
  const revisar: string[] = [];
  const i = d.inmueble, c = d.cliente;
  const tipo = TIPOS[i.tipo.toLowerCase()] ?? '';
  if (!tipo) revisar.push(i.tipo ? `Tipo de edificio: el cliente indicó «${i.tipo}»; elige el que corresponda.` : 'Tipo de edificio: el cliente no lo indicó.');
  const provincia = i.provincia || provinciaDeCodigoPostal(i.codigo_postal);
  if (provincia && provincia !== 'Asturias') {
    revisar.push(`El inmueble está en ${provincia}: la app está pensada para Asturias (concejos, registro); revisa municipio y trámites.`);
  }
  // El CRM pide la superficie construida o aproximada; el expediente lleva la
  // útil. No se copia: se deja en las notas para que la midas en la visita.
  const notas = [
    `Solicitud del CRM${d.referencia_crm ? ` ${d.referencia_crm}` : ''}${d.servicio ? ` · ${d.servicio}` : ''}.`,
    i.superficie && `Superficie indicada por el cliente: ${i.superficie} m² (construida o aproximada, no útil).`,
    c.razon_social && c.nombre && `Persona de contacto: ${c.nombre}.`,
    d.notas,
  ].filter(Boolean).join('\n');
  if (i.superficie) revisar.push('Superficie útil: el cliente dio una superficie construida o aproximada (está en las notas); la útil se mide en la visita.');
  return {
    direccion: i.direccion,
    municipio: i.localidad,
    codigo_postal: i.codigo_postal,
    referencia_catastral: i.ref_catastral,
    tipo_edificio: tipo,
    propietario_nombre: c.razon_social || c.nombre,
    propietario_nif: c.nif,
    propietario_telefono: c.telefono,
    propietario_email: c.email,
    fecha_visita: d.visita ? fechaLocal(d.visita) : '',
    notas,
    revisar,
  };
}

/** Una línea para la bandeja: «C/ Uría 1, Oviedo · Ana Pérez». */
export function resumenSolicitud(d: SolicitudCrmDatos): string {
  const lugar = [d.inmueble.direccion, d.inmueble.localidad].filter(Boolean).join(', ');
  return [lugar || 'Sin dirección', d.cliente.razon_social || d.cliente.nombre].filter(Boolean).join(' · ');
}
