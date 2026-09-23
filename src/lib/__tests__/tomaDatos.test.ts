import { describe, expect, it } from 'vitest';
import { comprobarTomaDatos, normalizarTomaDatos, tomaDatosVacia } from '../tomaDatos';
import { estadoAnterior, siguienteEstado } from '../estados';

const ctx = { tipoEdificio: 'vivienda_en_bloque' as const, superficieExpediente: 80 };

describe('comprobarTomaDatos', () => {
  it('avisa de U fuera de lo habitual según el tipo de cerramiento', () => {
    const d = tomaDatosVacia();
    d.cerramientos = [{ id: 'a', tipo: 'fachada', u: 3.8 }, { id: 'b', tipo: 'cubierta', u: 3.2 }];
    const { avisos, errores } = comprobarTomaDatos(d, ctx);
    expect(errores).toHaveLength(0);
    expect(avisos.some((a) => a.clave === 'cerramientos.a.u=3.8')).toBe(true);
    expect(avisos.some((a) => a.clave.startsWith('cerramientos.b.u'))).toBe(false); // 3,2 es posible en cubierta
  });

  it('la clave del aviso incluye el valor: si cambia, hay que confirmar de nuevo', () => {
    const d = tomaDatosVacia();
    d.cerramientos = [{ id: 'a', tipo: 'fachada', u: 3.8 }];
    const k1 = comprobarTomaDatos(d, ctx).avisos.find((a) => a.clave.startsWith('cerramientos.a.u'))!.clave;
    d.cerramientos = [{ id: 'a', tipo: 'fachada', u: 4.1 }];
    const k2 = comprobarTomaDatos(d, ctx).avisos.find((a) => a.clave.startsWith('cerramientos.a.u'))!.clave;
    expect(k1).not.toBe(k2);
  });

  it('errores imposibles, coherencias y datos que faltan', () => {
    const d = tomaDatosVacia();
    d.generales.superficieUtil = 95;
    d.huecos = [{ id: 'h', tipoVidrio: 'simple', uVidrio: 2.8, porcentajeMarco: 140 }];
    d.instalaciones = [
      { id: 'i1', servicio: 'calefaccion', cobertura: 80, unidadRendimiento: 'porcentaje', rendimiento: 92 },
      { id: 'i2', servicio: 'calefaccion_acs', cobertura: 40 },
    ];
    const { avisos, errores } = comprobarTomaDatos(d, ctx);
    expect(errores.map((e) => e.ruta)).toContain('huecos.h.porcentajeMarco');
    const claves = avisos.map((a) => a.clave);
    expect(claves).toContain('coherencia.superficie=95/80');
    expect(claves).toContain('huecos.h.coherencia=2.8');
    expect(claves).toContain('coherencia.cobertura.calefaccion=120');
    expect(claves).toContain('faltan.cerramientos');
    expect(claves).not.toContain('faltan.instalaciones');
  });

  it('potencia: más margen si la instalación es centralizada', () => {
    const d = tomaDatosVacia();
    d.instalaciones = [{ id: 'x', potencia: 150 }];
    expect(comprobarTomaDatos(d, ctx).avisos.some((a) => a.clave.startsWith('instalaciones.x.potencia'))).toBe(true);
    d.instalaciones = [{ id: 'x', potencia: 150, centralizada: true }];
    expect(comprobarTomaDatos(d, ctx).avisos.some((a) => a.clave.startsWith('instalaciones.x.potencia'))).toBe(false);
  });
});

describe('normalizarTomaDatos', () => {
  it('rellena lo que falta y descarta filas sin id', () => {
    const d = normalizarTomaDatos({ cerramientos: [{ id: 'a' }, { sinId: true }], observaciones: 5 });
    expect(d.cerramientos).toHaveLength(1);
    expect(d.huecos).toEqual([]);
    expect(d.observaciones).toBe('');
  });
});

describe('estados', () => {
  it('avanza y retrocede de uno en uno', () => {
    expect(siguienteEstado('visita_pendiente')).toBe('datos_introducidos');
    expect(siguienteEstado('registrado')).toBeNull();
    expect(estadoAnterior('visita_pendiente')).toBeNull();
    expect(estadoAnterior('certificado_firmado')).toBe('calculo_revisado');
  });
});
