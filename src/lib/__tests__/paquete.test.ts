import { describe, expect, it } from 'vitest';
import { REQUISITOS, analizarXml, esPdf, extension, nombreZip, pdfTieneFirma, propuestaPorTipo, sha256, textoLeeme } from '../paquete';
import { aCsv, nombreArchivo } from '../copiaSeguridad';
import { contarPorEstado, distribucionCalificaciones, firmadosPorAnio, firmadosPorMes } from '../estadisticas';
import type { Adjunto } from '../api';
import type { Expediente } from '../estados';

const b = (s: string) => new TextEncoder().encode(s);

describe('paquete para el registro', () => {
  it('requisitos según la situación del técnico', () => {
    const obligatorios = (o: { inscritoRegistroTecnicos: boolean; controlExterno: boolean }) => REQUISITOS.filter((r) => r.obligatorio(o)).map((r) => r.clave);
    expect(obligatorios({ inscritoRegistroTecnicos: true, controlExterno: false })).toEqual(['certificado_firmado', 'certificado_xml', 'justificante_tasa']);
    expect(obligatorios({ inscritoRegistroTecnicos: false, controlExterno: true })).toContain('declaracion_responsable');
    expect(obligatorios({ inscritoRegistroTecnicos: false, controlExterno: true })).toContain('informe_conformidad');
  });

  it('detecta PDF, firma y XML oficial sin validar nada más', () => {
    expect(esPdf(b('%PDF-1.7 ...'))).toBe(true);
    expect(esPdf(b('<html>'))).toBe(false);
    expect(pdfTieneFirma(b('%PDF-1.7 /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 1 2 3]'))).toBe(true);
    expect(pdfTieneFirma(b('%PDF-1.7 sin firma'))).toBe(false);
    expect(analizarXml(b('﻿<?xml version="1.0"?><DatosEnergeticosDelEdificio version="2.1">'))).toEqual({ esXml: true, oficial: true });
    expect(analizarXml(b('<?xml version="1.0"?><otra/>'))).toEqual({ esXml: true, oficial: false });
    expect(analizarXml(b('PK\u0003\u0004'))).toEqual({ esXml: false, oficial: false });
  });

  it('elige el documento más reciente de cada tipo', () => {
    const a = (id: string, tipo: Adjunto['tipo'], subido_en: string) => ({ id, tipo, subido_en } as Adjunto);
    const p = propuestaPorTipo([a('2', 'certificado_firmado', '2026-09-02'), a('1', 'certificado_firmado', '2026-09-01'), a('3', 'certificado_xml', '2026-09-01')]);
    expect(p.certificado_firmado?.id).toBe('2');
    expect(p.certificado_xml?.id).toBe('3');
  });

  it('huella, nombres e índice', async () => {
    expect(await sha256(b('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(extension('Certificado Firmado.PDF')).toBe('.pdf');
    expect(extension('sin_extension')).toBe('');
    const e = { codigo: '2026-001', referencia_catastral: '2144201TP8224S0011LQ', direccion: 'Calle Lima 6', municipio: 'Gijón', codigo_postal: '33213',
      calificacion_consumo: 'D', calificacion_emisiones: 'C', fecha_firma: '2026-08-30', fecha_vencimiento: '2036-08-30' } as Expediente;
    expect(nombreZip(e)).toBe('CEE_2026-001_2144201TP8224S0011LQ.zip');
    const t = textoLeeme(e, [{ nombreEnZip: '01_certificado_firmado.pdf', original: 'cee.pdf', tamano: 10, sha256: 'abc', descripcion: 'Certificado' }],
      { inscritoRegistroTecnicos: true, controlExterno: false }, new Date(2026, 8, 25));
    expect(t).toContain('NO SE HA ENVIADO');
    expect(t).toContain('SHA-256: abc');
    expect(t).toContain('RECE0016T01');
  });
});

describe('copia de seguridad', () => {
  it('CSV para Excel: «;», comillas y BOM', () => {
    const csv = aCsv([{ a: 'x;y', b: 'dice "hola"', c: null }], [['a', 'A'], ['b', 'B'], ['c', 'C']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"x;y";"dice ""hola""";');
    expect(nombreArchivo('Certificado Ñandú (1).pdf')).toBe('Certificado_Nandu_1_.pdf');
  });
});

describe('estadísticas del panel', () => {
  const e = (estado: Expediente['estado'], fecha_firma: string | null, c: string | null, em: string | null) =>
    ({ estado, fecha_firma, calificacion_consumo: c, calificacion_emisiones: em } as Expediente);
  const lista = [
    e('registrado', '2026-09-02', 'D', 'C'), e('registrado', '2026-09-20', 'E', 'E'), e('certificado_firmado', '2026-07-01', 'D', 'G'),
    e('visita_pendiente', null, null, null), e('registrado', '2025-01-10', 'G', 'G'),
  ];
  it('cuenta por estado, por mes y por año', () => {
    expect(contarPorEstado(lista)).toMatchObject({ registrado: 3, visita_pendiente: 1, certificado_firmado: 1, calculo_revisado: 0 });
    const meses = firmadosPorMes(lista, 12, new Date(2026, 8, 25));
    expect(meses).toHaveLength(12);
    expect(meses.at(-1)).toMatchObject({ clave: '2026-09', total: 2 });
    expect(meses.find((m) => m.clave === '2026-07')?.total).toBe(1);
    expect(meses.some((m) => m.clave === '2025-01')).toBe(false);
    expect(firmadosPorAnio(lista)).toEqual([{ anio: '2026', total: 3 }, { anio: '2025', total: 1 }]);
  });
  it('calificación más frecuente (empates incluidos)', () => {
    expect(distribucionCalificaciones(lista, 'calificacion_consumo').masFrecuente).toEqual(['D']);
    expect(distribucionCalificaciones(lista, 'calificacion_emisiones').masFrecuente).toEqual(['G']);
    expect(distribucionCalificaciones([], 'calificacion_consumo').masFrecuente).toEqual([]);
  });
});
