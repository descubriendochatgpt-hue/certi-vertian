import { describe, expect, it } from 'vitest';
import { leerEncargo, partirDireccion, propuestaDesdeCrm, provinciaDeCodigoPostal, resumenEncargo } from '../encargosCrm';

// Como lo devuelve encargos_certificado(): un presupuesto con el inmueble del trámite…
const presupuesto = {
  origen: 'presupuesto' as const,
  numero: 'P-2026-0014',
  servicio: 'Certificado energético de vivienda',
  recibido_en: '2026-10-07T08:00:00Z',
  cliente: { nombre: 'Ana Pérez', razon_social: null, nif: '12345678Z', email: 'ana@ejemplo.es', telefono: '600000001', provincia: null },
  inmueble: { direccion: 'C/ Uría 1, 3ºB', codigo_postal: '33003', localidad: 'Oviedo', ref_catastral: '0000000AA0000A0001AA', tipo: 'Piso o apartamento', superficie: '85' },
  datos_pedido: null,
  mensaje: null,
  visita: '2026-10-09T22:30:00+00:00',
};
// …y un pedido con los campos del formulario de pedido de certificados.
const pedido = {
  origen: 'pedido' as const,
  numero: null,
  servicio: 'Certificado local',
  recibido_en: '2026-10-06T10:00:00Z',
  cliente: { nombre: 'Luis Díaz', razon_social: 'Inmuebles SL', nif: 'B12345674', email: 'luis@ejemplo.es', telefono: null, provincia: 'Asturias' },
  inmueble: null,
  datos_pedido: {
    'Tipo de inmueble': 'Edificio completo', 'Superficie': '320 m²', 'Dirección del inmueble': 'Avda. Galicia 5, 33212 Gijón',
    'Referencia catastral': '1111111 aa1111a 0001aa', 'Para qué': 'Venta', 'Plazo': 'Urgente (48 h)', 'Contacto para la visita': 'Portero · 600000002',
  },
  mensaje: 'Llamar antes de ir.',
  visita: null,
};

describe('encargos del CRM', () => {
  it('presupuesto: propone el expediente con los datos del cliente y del inmueble', () => {
    const p = propuestaDesdeCrm(leerEncargo(presupuesto));
    expect(p).toMatchObject({
      direccion: 'C/ Uría 1, 3ºB', municipio: 'Oviedo', codigo_postal: '33003', referencia_catastral: '0000000AA0000A0001AA',
      tipo_edificio: 'vivienda_en_bloque', propietario_nombre: 'Ana Pérez', propietario_nif: '12345678Z',
      propietario_telefono: '600000001', propietario_email: 'ana@ejemplo.es',
      fecha_visita: '2026-10-10', // 00:30 en Madrid: la fecha es la de España, no la UTC
    });
    expect(p.notas).toContain('P-2026-0014');
  });

  it('pedido: lee los campos del formulario de pedido (dirección, catastro, para qué, plazo, contacto)', () => {
    const d = leerEncargo(pedido);
    expect(d.inmueble).toEqual({
      direccion: 'Avda. Galicia 5', codigo_postal: '33212', localidad: 'Gijón', ref_catastral: '1111111AA1111A0001AA',
      tipo: 'Edificio completo', superficie: '320',
    });
    expect(d.referencia).toBe('Pedido del 6/10/2026');
    const p = propuestaDesdeCrm(d);
    expect(p.propietario_nombre).toBe('Inmuebles SL');
    expect(p.notas).toContain('Persona de contacto: Luis Díaz');
    expect(p.notas).toContain('Para qué: Venta');
    expect(p.notas).toContain('Plazo: Urgente (48 h)');
    expect(p.notas).toContain('Contacto para la visita: Portero · 600000002');
    expect(p.notas).toContain('Mensaje del cliente: Llamar antes de ir.');
  });

  it('el inmueble del presupuesto manda, y lo que falte se completa con el pedido', () => {
    const d = leerEncargo({ ...presupuesto, inmueble: { direccion: 'C/ Uría 1, 3ºB', codigo_postal: '33003', localidad: 'Oviedo' }, datos_pedido: pedido.datos_pedido });
    expect(d.inmueble.direccion).toBe('C/ Uría 1, 3ºB');
    expect(d.inmueble.ref_catastral).toBe('1111111AA1111A0001AA');
    expect(d.inmueble.tipo).toBe('Edificio completo');
  });

  it('no convierte la superficie construida en útil: la deja en notas y avisa', () => {
    const p = propuestaDesdeCrm(leerEncargo(presupuesto));
    expect(p).not.toHaveProperty('superficie_util');
    expect(p.notas).toContain('85 m² (construida o aproximada, no útil)');
    expect(p.revisar.join(' ')).toMatch(/Superficie útil/);
  });

  it('un tipo dudoso se deja sin elegir y se avisa', () => {
    const p = propuestaDesdeCrm(leerEncargo(pedido));
    expect(p.tipo_edificio).toBe('');
    expect(p.revisar.join(' ')).toMatch(/Edificio completo/);
  });

  it('avisa si el inmueble no está en Asturias', () => {
    expect(provinciaDeCodigoPostal('46001')).toBe('Valencia');
    expect(provinciaDeCodigoPostal('3300')).toBeNull();
    const p = propuestaDesdeCrm(leerEncargo({ ...presupuesto, inmueble: { ...presupuesto.inmueble, codigo_postal: '46001' } }));
    expect(p.revisar.join(' ')).toMatch(/Valencia/);
  });

  it('parte la dirección del formulario de pedido', () => {
    expect(partirDireccion('C/ Uría 1, 3ºB, 33003 Oviedo')).toEqual({ direccion: 'C/ Uría 1, 3ºB', codigo_postal: '33003', localidad: 'Oviedo' });
    expect(partirDireccion('Avda. Galicia 5, Gijón')).toEqual({ direccion: 'Avda. Galicia 5', codigo_postal: '', localidad: 'Gijón' });
    expect(partirDireccion('C/ Mayor 2, 33001')).toEqual({ direccion: 'C/ Mayor 2', codigo_postal: '33001', localidad: '' });
    expect(partirDireccion('Calle Sin Más 3')).toEqual({ direccion: 'Calle Sin Más 3', codigo_postal: '', localidad: '' });
  });

  it('lee con cuidado lo que escribió el cliente', () => {
    const d = leerEncargo({ ...pedido, cliente: { nombre: '  Ana\n\tPérez  ', nif: 42 }, datos_pedido: 'no es un objeto', visita: 'mañana' });
    expect(d.cliente.nombre).toBe('Ana Pérez');
    expect(d.cliente.nif).toBe('');
    expect(d.inmueble.direccion).toBe('');
    expect(d.visita).toBeNull();
    expect(resumenEncargo(d)).toBe('Sin dirección · Ana Pérez');
  });
});
