export type Estado =
  | 'visita_pendiente'
  | 'datos_introducidos'
  | 'calculo_revisado'
  | 'certificado_firmado'
  | 'registrado';

export const ESTADOS: Estado[] = [
  'visita_pendiente',
  'datos_introducidos',
  'calculo_revisado',
  'certificado_firmado',
  'registrado',
];

export const NOMBRE_ESTADO: Record<Estado, string> = {
  visita_pendiente: 'Visita pendiente',
  datos_introducidos: 'Datos introducidos',
  calculo_revisado: 'Cálculo revisado por técnico',
  certificado_firmado: 'Certificado firmado',
  registrado: 'Registrado en sede electrónica',
};

/** Lo que el técnico declara al confirmar la llegada a cada estado. */
export const DECLARACION_ESTADO: Record<Estado, string> = {
  visita_pendiente: '',
  datos_introducidos:
    'He realizado personalmente la visita al inmueble y he revisado que los datos tomados son correctos.',
  calculo_revisado:
    'He ejecutado yo mismo el cálculo en el programa oficial de certificación y he revisado sus resultados.',
  certificado_firmado:
    'He firmado electrónicamente el certificado de eficiencia energética de este inmueble.',
  registrado:
    'He presentado yo mismo el certificado en la sede electrónica del Principado de Asturias.',
};

export function siguienteEstado(e: Estado): Estado | null {
  return ESTADOS[ESTADOS.indexOf(e) + 1] ?? null;
}

export function estadoAnterior(e: Estado): Estado | null {
  const i = ESTADOS.indexOf(e);
  return i > 0 ? ESTADOS[i - 1]! : null;
}

export type TipoEdificio =
  | 'vivienda_unifamiliar'
  | 'vivienda_en_bloque'
  | 'bloque_viviendas'
  | 'local_terciario'
  | 'edificio_terciario';

export const NOMBRE_TIPO_EDIFICIO: Record<TipoEdificio, string> = {
  vivienda_unifamiliar: 'Vivienda unifamiliar',
  vivienda_en_bloque: 'Vivienda individual en bloque',
  bloque_viviendas: 'Bloque de viviendas completo',
  local_terciario: 'Local terciario',
  edificio_terciario: 'Edificio terciario completo',
};

export function esResidencial(t: TipoEdificio): boolean {
  return t === 'vivienda_unifamiliar' || t === 'vivienda_en_bloque' || t === 'bloque_viviendas';
}

export const CALIFICACIONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type Calificacion = (typeof CALIFICACIONES)[number];

export interface Expediente {
  id: string;
  codigo: string;
  edificio_id: string | null;
  direccion: string;
  municipio: string;
  codigo_postal: string | null;
  provincia: string;
  referencia_catastral: string | null;
  tipo_edificio: TipoEdificio;
  superficie_util: number | null;
  anio_construccion: number | null;
  propietario_nombre: string;
  propietario_nif: string | null;
  propietario_telefono: string | null;
  propietario_email: string | null;
  fecha_visita: string | null;
  estado: Estado;
  calificacion_consumo: Calificacion | null;
  calificacion_emisiones: Calificacion | null;
  fecha_firma: string | null;
  fecha_registro: string | null;
  numero_registro: string | null;
  fecha_vencimiento: string | null;
  avisos_confirmados: string[];
  notas: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface AnotacionHistorial {
  id: number;
  expediente_id: string;
  estado_anterior: Estado | null;
  estado_nuevo: Estado;
  nota: string | null;
  creado_en: string;
}
