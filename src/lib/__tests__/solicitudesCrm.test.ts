import { describe, expect, it } from 'vitest';
import { leerDatosCrm, propuestaDesdeCrm, provinciaDeCodigoPostal, resumenSolicitud } from '../solicitudesCrm';

const ejemplo = {
  version: 1,
  origen: 'presupuesto',
  referencia_crm: 'P-2026-0014',
  servicio: 'Certificado energético de vivienda',
  cliente: { nombre: 'Ana Pérez', razon_social: '', nif: '12345678Z', email: 'ana@ejemplo.es', telefono: '600000001' },
  inmueble: {
    direccion: 'C/ Uría 1, 3ºB', codigo_postal: '33003', localidad: 'Oviedo', provincia: '',
    ref_catastral: '0000000AA0000A0001AA', tipo: 'Piso o apartamento', superficie: '85',
  },
  visita: '2026-10-09T22:30:00.000Z',
  notas: 'Llamar antes de ir.',
  enlace_crm: 'https://crm.ejemplo.es/presupuestos/abc',
};

describe('solicitudes del CRM', () => {
  it('propone el expediente con los datos del cliente y del inmueble', () => {
    const p = propuestaDesdeCrm(leerDatosCrm(ejemplo));
    expect(p).toMatchObject({
      direccion: 'C/ Uría 1, 3ºB', municipio: 'Oviedo', codigo_postal: '33003', referencia_catastral: '0000000AA0000A0001AA',
      tipo_edificio: 'vivienda_en_bloque', propietario_nombre: 'Ana Pérez', propietario_nif: '12345678Z',
      propietario_telefono: '600000001', propietario_email: 'ana@ejemplo.es',
      fecha_visita: '2026-10-10', // 00:30 en Madrid: la fecha es la de España, no la UTC
    });
    expect(p.notas).toContain('P-2026-0014');
    expect(p.notas).toContain('Llamar antes de ir.');
  });

  it('no convierte la superficie construida en útil: la deja en notas y avisa', () => {
    const p = propuestaDesdeCrm(leerDatosCrm(ejemplo));
    expect(p).not.toHaveProperty('superficie_util');
    expect(p.notas).toContain('85 m² (construida o aproximada, no útil)');
    expect(p.revisar.join(' ')).toMatch(/Superficie útil/);
  });

  it('un tipo dudoso se deja sin elegir y se avisa; una empresa va con su razón social', () => {
    const p = propuestaDesdeCrm(leerDatosCrm({
      ...ejemplo,
      cliente: { ...ejemplo.cliente, razon_social: 'Inmuebles SL' },
      inmueble: { ...ejemplo.inmueble, tipo: 'Edificio completo' },
    }));
    expect(p.tipo_edificio).toBe('');
    expect(p.revisar.join(' ')).toMatch(/Edificio completo/);
    expect(p.propietario_nombre).toBe('Inmuebles SL');
    expect(p.notas).toContain('Persona de contacto: Ana Pérez');
  });

  it('avisa si el inmueble no está en Asturias', () => {
    expect(provinciaDeCodigoPostal('46001')).toBe('Valencia');
    expect(provinciaDeCodigoPostal('3300')).toBeNull();
    const p = propuestaDesdeCrm(leerDatosCrm({ ...ejemplo, inmueble: { ...ejemplo.inmueble, codigo_postal: '46001' } }));
    expect(p.revisar.join(' ')).toMatch(/Valencia/);
  });

  it('lee con cuidado lo que llega de fuera', () => {
    const d = leerDatosCrm({
      cliente: { nombre: '  Ana\n\tPérez  ', nif: 42 },
      inmueble: 'no es un objeto',
      visita: 'mañana',
      enlace_crm: 'javascript:alert(1)',
    });
    expect(d.cliente.nombre).toBe('Ana Pérez');
    expect(d.cliente.nif).toBe('');
    expect(d.inmueble.direccion).toBe('');
    expect(d.visita).toBeNull();
    expect(d.enlace_crm).toBe('');
    expect(leerDatosCrm(null).cliente.nombre).toBe('');
    expect(resumenSolicitud(d)).toBe('Sin dirección · Ana Pérez');
  });
});
