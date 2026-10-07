import { describe, expect, it } from 'vitest';
import { esquemaExtraccion, instruccionesExtraccion, mensajeVisita, propuestaDesdeExtraccion } from '../visita';

const catalogo = [
  { clave: 'cerramiento:1', tipo: 'cerramiento', etiqueta: 'Fachada · Estimadas · U 1,69' },
  { clave: 'hueco:2', tipo: 'hueco', etiqueta: 'Hueco · marco Metálico sin RPT' },
];

/** Recorre el esquema: toda la salida estructurada exige objetos cerrados y con todo «required». */
function revisar(s: unknown, ruta = '$'): string[] {
  if (!s || typeof s !== 'object') return [];
  const o = s as Record<string, unknown>;
  const fallos: string[] = [];
  if (o.type === 'object') {
    if (o.additionalProperties !== false) fallos.push(`${ruta}: additionalProperties`);
    const props = Object.keys(o.properties as object);
    if (JSON.stringify([...(o.required as string[])].sort()) !== JSON.stringify(props.sort())) fallos.push(`${ruta}: required`);
  }
  for (const [k, v] of Object.entries(o)) {
    if (['minimum', 'maximum', 'minLength', 'maxLength'].includes(k)) fallos.push(`${ruta}: ${k} no admitido`);
    if (Array.isArray(v)) v.forEach((x, i) => fallos.push(...revisar(x, `${ruta}.${k}[${i}]`)));
    else fallos.push(...revisar(v, `${ruta}.${k}`));
  }
  return fallos;
}

describe('lo que se pide a la IA', () => {
  it('el esquema es válido para la salida estructurada y ofrece solo soluciones del catálogo', () => {
    const e = esquemaExtraccion(catalogo);
    expect(revisar(e)).toEqual([]);
    const cerr = (e as { properties: Record<string, { items: { properties: Record<string, unknown> } }> }).properties.cerramientos!.items.properties;
    expect(cerr.solucionCe3x).toEqual({ anyOf: [{ type: 'string', enum: ['cerramiento:1'] }, { type: 'null' }] });
    const inst = (e as { properties: Record<string, { items: { properties: Record<string, unknown> } }> }).properties.instalaciones!.items.properties;
    expect(inst.solucionCe3x).toEqual({ type: 'null' }); // no hay instalaciones en el catálogo
  });

  it('las instrucciones no piden inventar y explican cada campo', () => {
    const t = instruccionesExtraccion();
    expect(t).toMatch(/No inventes nada/);
    expect(t).toMatch(/tipoMarco: Marco \(aluminio = Aluminio sin RPT/);
    expect(t).not.toMatch(/normativa:/); // la normativa sale del año
    expect(mensajeVisita({ expediente: 'x', conocido: '', catalogo, transcripcion: 'hola', fotos: [{ hora: '10:00' }] }))
      .toMatch(/hueco:2[\s\S]*Foto 1 \(10:00\)[\s\S]*hola/);
  });
});

describe('respuesta de la IA → propuesta', () => {
  it('cada valor pasa las comprobaciones de la toma de datos', () => {
    const p = propuestaDesdeExtraccion({
      generales: [
        { campo: 'anioConstruccion', valor: '1972', cita: 'el edificio es del 72' },
        { campo: 'descripcionVisita', valor: 'Se inspeccionó la carpintería.', cita: 'visita' },
        { campo: 'inventado', valor: 1, cita: 'x' },
      ],
      cerramientos: [{ nombre: 'Fachada norte', tipo: 'fachada', orientacion: 'N', longitud: 10, altura: 2.5, superficie: null, u: null, origenU: null, solucionCe3x: 'cerramiento:1', notas: null, cita: 'fachada norte de diez por dos y medio' }],
      huecos: [{ nombre: 'Ventana', tipoMarco: 'titanio', alto: 1.2, solucionCe3x: 'hueco:999', cita: 'ventana' }],
      instalaciones: [], puentesTermicos: [], renovables: [], iluminacion: [],
      observaciones: 'Humedades en el baño', dudas: ['¿La ventana es de 1,20 de alto o de ancho?'], fotos: [{ foto: 1, contenido: 'Placa del termo' }],
    }, catalogo);
    expect(p.elementos.map((e) => [e.destino, e.valores])).toEqual([
      ['generales', { anioConstruccion: 1972 }],
      ['generales', { descripcionVisita: 'Se inspeccionó la carpintería.' }],
      ['cerramientos', { nombre: 'Fachada norte', tipo: 'fachada', orientacion: 'N', longitud: 10, altura: 2.5, solucionCe3x: 'cerramiento:1' }],
      ['huecos', { nombre: 'Ventana', alto: 1.2 }],
    ]);
    expect(p.elementos[0]!.origen).toBe('el edificio es del 72');
    expect(p.elementos[3]!.notas.join(' ')).toMatch(/no está en el catálogo[\s\S]*titanio/);
    expect(p).toMatchObject({ observaciones: 'Humedades en el baño', fotos: [{ foto: 1, contenido: 'Placa del termo' }] });
    expect(p.dudas).toHaveLength(1);
  });

  it('una respuesta sin formato no rompe nada', () => {
    expect(propuestaDesdeExtraccion('hola').dudas[0]).toMatch(/formato/);
  });
});
