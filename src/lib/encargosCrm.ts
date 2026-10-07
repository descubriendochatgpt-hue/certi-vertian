// Encargos de certificado del CRM de Vertian (pantalla «Solicitudes»).
//
// CertiVertian y el CRM comparten la misma base de datos. La función
// encargos_certificado() (migración 05) devuelve los pedidos y presupuestos
// de certificados con los datos que el cliente ha rellenado: propietario,
// inmueble y, si la ha reservado, la fecha de la visita. Aquí se leen con
// cuidado (los escribió el cliente) y se convierten en una PROPUESTA de
// expediente: el técnico la revisa en el formulario de siempre y la guarda él.

import type { TipoEdificio } from './estados';

/** Una fila de encargos_certificado(). */
export interface EncargoCrm {
  origen: 'pedido' | 'presupuesto';
  crm_id: string;
  pedido_id: string | null;
  presupuesto_id: string | null;
  numero: string | null;
  servicio: string | null;
  recibido_en: string;
  actualizado_en: string;
  estado_crm: string | null;
  cliente_id: string;
  cliente: unknown;
  inmueble: unknown;
  datos_pedido: unknown;
  mensaje: string | null;
  visita: string | null;
  expediente_id: string | null;
  descartado: boolean;
}

/** Clave para la dirección de la página: «pedido:<id>» o «presupuesto:<id>». */
export const claveEncargo = (e: Pick<EncargoCrm, 'origen' | 'crm_id'>) => `${e.origen}:${e.crm_id}`;

/** Datos del encargo ya leídos y limpios. */
export interface DatosEncargo {
  referencia: string;        // «P-2026-0014» o «Pedido del 7/10/2026»
  servicio: string;
  cliente: { nombre: string; razon_social: string; nif: string; email: string; telefono: string; provincia: string };
  inmueble: {
    direccion: string; codigo_postal: string; localidad: string; ref_catastral: string;
    tipo: string;            // «Piso o apartamento», «Casa o chalet»…
    superficie: string;      // la que indica el cliente (construida o aproximada)
  };
  visita: string | null;
  notas: string[];           // para qué, plazo, contacto para la visita, mensaje…
}

const texto = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** «C/ Uría 1, 3ºB, 33003 Oviedo» (como lo guarda el formulario de pedido del CRM) → partes. */
export function partirDireccion(t: string): { direccion: string; codigo_postal: string; localidad: string } {
  const s = t.trim();
  const m = /^(.*?),\s*(\d{5})\s+(.+)$/.exec(s);
  if (m) return { direccion: m[1]!.trim(), codigo_postal: m[2]!, localidad: m[3]!.trim() };
  const soloCp = /^(.*?),\s*(\d{5})$/.exec(s);
  if (soloCp) return { direccion: soloCp[1]!.trim(), codigo_postal: soloCp[2]!, localidad: '' };
  const sinCp = /^(.*),\s*([^,\s\d][^,]*)$/.exec(s);
  return sinCp ? { direccion: sinCp[1]!.trim(), codigo_postal: '', localidad: sinCp[2]!.trim() } : { direccion: s, codigo_postal: '', localidad: '' };
}

/**
 * Lee una fila del CRM. El inmueble del presupuesto (estructurado) manda; si
 * falta algo, se completa con lo que el cliente puso en el formulario de pedido.
 */
export function leerEncargo(e: Pick<EncargoCrm, 'origen' | 'numero' | 'servicio' | 'recibido_en' | 'cliente' | 'inmueble' | 'datos_pedido' | 'mensaje' | 'visita'>): DatosEncargo {
  const c = obj(e.cliente), i = obj(e.inmueble), p = obj(e.datos_pedido);
  const delPedido = partirDireccion(texto(p['Dirección del inmueble'], 300));
  const visita = texto(e.visita, 40);
  const notas = [
    texto(p['Para qué'], 80) && `Para qué: ${texto(p['Para qué'], 80)}`,
    texto(p['Plazo'], 80) && `Plazo: ${texto(p['Plazo'], 80)}`,
    texto(p['Contacto para la visita'], 200) && `Contacto para la visita: ${texto(p['Contacto para la visita'], 200)}`,
    texto(e.mensaje, 2000) && `Mensaje del cliente: ${texto(e.mensaje, 2000)}`,
  ].filter(Boolean) as string[];
  const fechaPedido = Date.parse(e.recibido_en);
  return {
    referencia: e.origen === 'presupuesto' && e.numero
      ? texto(e.numero, 40)
      : `Pedido del ${Number.isNaN(fechaPedido) ? '—' : new Date(fechaPedido).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' })}`,
    servicio: texto(e.servicio, 200),
    cliente: {
      nombre: texto(c.nombre, 120), razon_social: texto(c.razon_social, 160), nif: texto(c.nif, 20),
      email: texto(c.email, 200), telefono: texto(c.telefono, 40), provincia: texto(c.provincia, 80),
    },
    inmueble: {
      direccion: texto(i.direccion, 200) || delPedido.direccion,
      codigo_postal: texto(i.codigo_postal, 10) || delPedido.codigo_postal,
      localidad: texto(i.localidad, 80) || delPedido.localidad,
      ref_catastral: (texto(i.ref_catastral, 30) || texto(p['Referencia catastral'], 30)).toUpperCase().replace(/[\s-]/g, ''),
      tipo: texto(i.tipo, 60) || texto(p['Tipo de inmueble'], 60),
      superficie: (texto(i.superficie, 20) || texto(p['Superficie'], 20)).replace(/\s*m²$/, ''),
    },
    visita: visita && !Number.isNaN(Date.parse(visita)) ? visita : null,
    notas,
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

export function propuestaDesdeCrm(d: DatosEncargo): PropuestaExpediente {
  const revisar: string[] = [];
  const i = d.inmueble, c = d.cliente;
  const tipo = TIPOS[i.tipo.toLowerCase()] ?? '';
  if (!tipo) revisar.push(i.tipo ? `Tipo de edificio: el cliente indicó «${i.tipo}»; elige el que corresponda.` : 'Tipo de edificio: el cliente no lo indicó.');
  const provincia = provinciaDeCodigoPostal(i.codigo_postal) ?? (c.provincia || null);
  if (provincia && provincia !== 'Asturias') {
    revisar.push(`El inmueble está en ${provincia}: la app está pensada para Asturias (concejos, registro); revisa municipio y trámites.`);
  }
  // El CRM pide la superficie construida o aproximada; el expediente lleva la
  // útil. No se copia: se deja en las notas para que la midas en la visita.
  if (i.superficie) revisar.push('Superficie útil: el cliente dio una superficie construida o aproximada (está en las notas); la útil se mide en la visita.');
  const notas = [
    `Encargo del CRM: ${d.referencia}${d.servicio ? ` · ${d.servicio}` : ''}.`,
    i.superficie && `Superficie indicada por el cliente: ${i.superficie} m² (construida o aproximada, no útil).`,
    c.razon_social && c.nombre && `Persona de contacto: ${c.nombre}.`,
    ...d.notas,
  ].filter(Boolean).join('\n');
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
export function resumenEncargo(d: DatosEncargo): string {
  const lugar = [d.inmueble.direccion, d.inmueble.localidad].filter(Boolean).join(', ');
  return [lugar || 'Sin dirección', d.cliente.razon_social || d.cliente.nombre].filter(Boolean).join(' · ');
}

/** Enlace a la ficha en el CRM, si se ha configurado su dirección (VITE_CRM_URL). */
export function enlaceCrm(e: Pick<EncargoCrm, 'presupuesto_id' | 'cliente_id'>): string | null {
  const base = (import.meta.env.VITE_CRM_URL as string | undefined)?.trim().replace(/\/$/, '');
  if (!base || !/^https:\/\//i.test(base)) return null;
  return e.presupuesto_id ? `${base}/presupuestos/${e.presupuesto_id}` : `${base}/clientes/${e.cliente_id}`;
}
