import { describe, expect, it } from 'vitest';
import {
  CONCEJOS_ASTURIAS, comprobarCodigoPostal, comprobarConcejo, comprobarEmail, comprobarNif, comprobarRango,
  comprobarReferenciaCatastral, comprobarTelefono, leerNumero,
} from '../validaciones';

describe('NIF', () => {
  it('acepta DNI, NIE y NIF de empresa válidos', () => {
    for (const v of ['12345678Z', '12345678-z', 'X1234567L', 'Y1234567X', 'A58818501', 'B12345674', 'P1234567D']) {
      expect(comprobarNif(v).tipo, v).toBe('ok');
    }
  });
  it('avisa (no bloquea) si la letra no cuadra, sin cambiar nada', () => {
    const r = comprobarNif('12345678A');
    expect(r.tipo).toBe('aviso');
    expect(r.tipo === 'aviso' && r.mensaje).toContain('«Z»');
  });
  it('avisa con formatos desconocidos y acepta vacío', () => {
    expect(comprobarNif('ABC').tipo).toBe('aviso');
    expect(comprobarNif('').tipo).toBe('ok');
  });
});

describe('Referencia catastral', () => {
  it('valida los caracteres de control del Catastro', () => {
    expect(comprobarReferenciaCatastral('9872023VH5797S0001WX').tipo).toBe('ok');
    expect(comprobarReferenciaCatastral('9872023 VH5797S 0001 WX').tipo).toBe('ok');
    expect(comprobarReferenciaCatastral('9872023VH5797S0001WA').tipo).toBe('aviso');
  });
  it('distingue la referencia de finca (14) y longitudes raras', () => {
    expect(comprobarReferenciaCatastral('9872023VH5797S')).toMatchObject({ tipo: 'aviso' });
    expect(comprobarReferenciaCatastral('9872023VH5797S00')).toMatchObject({ tipo: 'aviso' });
    expect(comprobarReferenciaCatastral('9872023VH5797S0001W#').tipo).toBe('error');
  });
});

describe('Contacto', () => {
  it('email, teléfono y código postal', () => {
    expect(comprobarEmail('a@b.es').tipo).toBe('ok');
    expect(comprobarEmail('a@b').tipo).toBe('error');
    expect(comprobarTelefono('+34 612 345 678').tipo).toBe('ok');
    expect(comprobarTelefono('985 12 34 56').tipo).toBe('ok');
    expect(comprobarTelefono('123').tipo).toBe('aviso');
    expect(comprobarCodigoPostal('33001').tipo).toBe('ok');
    expect(comprobarCodigoPostal('28001').tipo).toBe('aviso');
    expect(comprobarCodigoPostal('3300').tipo).toBe('error');
  });
  it('los 78 concejos, sin importar tildes ni mayúsculas', () => {
    expect(CONCEJOS_ASTURIAS).toHaveLength(78);
    expect(comprobarConcejo('aviles').tipo).toBe('ok');
    expect(comprobarConcejo('GIJÓN').tipo).toBe('ok');
    expect(comprobarConcejo('Madrid').tipo).toBe('aviso');
  });
});

describe('Números', () => {
  it('admite coma decimal y rechaza texto sin inventarse un valor', () => {
    expect(leerNumero('1,25')).toBe(1.25);
    expect(leerNumero(' 0.4 ')).toBe(0.4);
    expect(leerNumero('')).toBeNull();
    expect(leerNumero('1,2,3')).toBeNaN();
    expect(leerNumero('12abc')).toBeNaN();
  });
  it('rango: error fuera de límites, aviso fuera de lo habitual', () => {
    const r = { min: 0, max: 10, avisoMin: 0.15, avisoMax: 3, unidad: 'W/m²K' };
    expect(comprobarRango(1.2, r).tipo).toBe('ok');
    expect(comprobarRango(3.8, r).tipo).toBe('aviso');
    expect(comprobarRango(12, r).tipo).toBe('error');
    expect(comprobarRango(null, r).tipo).toBe('ok');
  });
});
