import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type PaginaPdf, interpretarCertificado, letraCoherente } from '../certificadoPdf';

const { paginas } = JSON.parse(readFileSync(new URL('./fixtures/certificado-cex23.json', import.meta.url), 'utf8')) as { paginas: PaginaPdf[] };

describe('certificado CE3X v2.3', () => {
  const d = interpretarCertificado(paginas);

  it('identificación', () => {
    expect(d).toMatchObject({
      programa: 'CEXv2.3', fechaCertificado: '2026-08-30', nombreEdificio: 'Prueba testeo edificio residencial',
      direccion: 'Calle Lima 6', municipio: 'Gijón', codigoPostal: '33213', zonaClimatica: 'C1', anioConstruccion: 1974,
      normativa: 'Anterior a la NBE-CT-79', referenciaCatastral: '2144201TP8224S0011LQ', tipoEdificio: 'bloque_viviendas',
      tecnicoNombre: 'Técnica de Prueba', tecnicoNif: '00000000T', tecnicoTitulacion: 'Ingeniero', superficieHabitable: 77,
    });
  });

  it('calificación global y escalas', () => {
    expect(d.consumo).toEqual({ valor: 69.3, letra: 'D' });
    expect(d.emisiones).toEqual({ valor: 13.6, letra: 'C' });
    expect(d.escalaConsumo).toHaveLength(7);
    expect(d.escalaConsumo.find((t) => t.letra === 'D')).toEqual({ letra: 'D', desde: 60.7, hasta: 93.4 });
    expect(d.escalaEmisiones.find((t) => t.letra === 'G')).toEqual({ letra: 'G', desde: 55, hasta: null });
    expect(letraCoherente(d.consumo, d.escalaConsumo)).toBe(true);
    expect(letraCoherente({ valor: 100, letra: 'D' }, d.escalaConsumo)).toBe(false);
  });

  it('indicadores parciales, demanda y emisiones por origen', () => {
    expect(d.parcialesEmisiones.calefaccion).toEqual({ valor: 9.36, letra: 'C' });
    expect(d.parcialesEmisiones.acs).toEqual({ valor: 4.26, letra: 'E' });
    expect(d.parcialesEmisiones.refrigeracion).toEqual({ valor: 0, letra: null });
    expect(d.parcialesEmisiones.iluminacion).toEqual({ valor: null, letra: null });
    expect(d.parcialesConsumo.calefaccion).toEqual({ valor: 44.21, letra: 'C' });
    expect(d.parcialesConsumo.acs).toEqual({ valor: 25.14, letra: 'G' });
    expect(d.demandaCalefaccion).toEqual({ valor: 34.2, letra: 'D' });
    expect(d.emisionesElectricas).toBe(4.26);
    expect(d.emisionesOtrosCombustibles).toBe(9.36);
  });

  it('anexos III y IV', () => {
    expect(d.sinRecomendaciones).toBe(true);
    expect(d.textoRecomendaciones).toBeNull();
    expect(d.fechaVisita).toBe('2026-08-30');
    expect(d.noEncontrado).toEqual([]);
  });

  it('un PDF que no es un certificado no inventa nada', () => {
    const r = interpretarCertificado([[{ x: 10, y: 10, texto: 'Factura nº 25' }]]);
    expect(r.consumo).toEqual({ valor: null, letra: null });
    expect(r.referenciaCatastral).toBeNull();
    expect(r.noEncontrado.length).toBeGreaterThan(5);
  });
});
