import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  aplicarPropuesta, interpretarJson, interpretarTabla, interpretarTexto, leerCsv, leerNumeroEs, leerXlsx, mapaColumnas,
  partirFrases, plantillaCsv,
} from '../importarDatos';
import { CAMPOS_GENERALES, SECCIONES, normalizarTomaDatos, tomaDatosVacia } from '../tomaDatos';

describe('interpretarTexto (dictado y texto libre)', () => {
  it('reconoce cerramientos con orientación, superficie, U y origen', () => {
    const { elementos, sinEntender } = interpretarTexto('Fachada norte 25,4 metros cuadrados U 0 coma 45 estimada');
    expect(sinEntender).toEqual([]);
    expect(elementos).toHaveLength(1);
    expect(elementos[0]!.destino).toBe('cerramientos');
    expect(elementos[0]!.valores).toEqual({ tipo: 'fachada', orientacion: 'N', nombre: 'Fachada norte', superficie: 25.4, u: 0.45, origenU: 'estimado' });
  });

  it('«este» como demostrativo no es una orientación', () => {
    const [e] = interpretarTexto('este muro tiene 12 m2').elementos;
    expect(e!.valores.orientacion).toBeUndefined();
    const [f] = interpretarTexto('muro este 12 m2').elementos;
    expect(f!.valores.orientacion).toBe('E');
  });

  it('huecos: cantidad, medidas, vidrio, marco y cerramiento', () => {
    const [e] = interpretarTexto('dos ventanas en fachada sur de 1,20 por 1,50 doble vidrio bajo emisivo aluminio con rotura de puente térmico 25 % de marco con persiana').elementos;
    expect(e!.destino).toBe('huecos');
    expect(e!.valores).toMatchObject({
      nombre: 'Ventana sur', orientacion: 'S', cerramiento: 'Fachada sur', cantidad: 2, superficie: 1.8,
      tipoVidrio: 'doble_be', tipoMarco: 'aluminio_rpt', porcentajeMarco: 25, proteccionSolar: 'persiana',
    });
    expect(e!.notas.some((n) => n.includes('1,2 × 1,5'))).toBe(true);
  });

  it('una U de hueco sin decir de qué no se usa, y se avisa', () => {
    const [e] = interpretarTexto('ventana norte 2 m2 U 2,8').elementos;
    expect(e!.valores.uVidrio).toBeUndefined();
    expect(e!.notas.some((n) => n.includes('vidrio o del marco'))).toBe(true);
    const [f] = interpretarTexto('ventana norte U del vidrio 2,8 U del marco 5,7').elementos;
    expect(f!.valores).toMatchObject({ uVidrio: 2.8, uMarco: 5.7 });
  });

  it('instalaciones', () => {
    const [e] = interpretarTexto('Caldera de condensación de gas natural para calefacción y agua caliente, 24 kilovatios, rendimiento 98 %, instalada en 2018, individual').elementos;
    expect(e!.destino).toBe('instalaciones');
    expect(e!.valores).toEqual({
      servicio: 'calefaccion_acs', generador: 'caldera_condensacion', combustible: 'gas_natural', centralizada: false,
      potencia: 24, unidadRendimiento: 'porcentaje', rendimiento: 98, anioInstalacion: 2018,
    });
    const [b] = interpretarTexto('aerotermia para ACS SCOP 3,2 con depósito de 200 litros').elementos;
    expect(b!.valores).toMatchObject({ servicio: 'acs', generador: 'bomba_calor', unidadRendimiento: 'cop', rendimiento: 3.2, acumulacion: 200 });
  });

  it('datos generales en una sola frase', () => {
    const [e] = interpretarTexto('zona climática D1, superficie útil 85,5, altura libre 2,5, 2 plantas, CTE 2006').elementos;
    expect(e!.destino).toBe('generales');
    expect(e!.valores).toEqual({ zonaClimatica: 'D1', normativa: 'cte2006', superficieUtil: 85.5, alturaLibre: 2.5, numeroPlantas: 2 });
    const [d] = interpretarTexto('demanda de ACS 112 litros').elementos;
    expect(d!.valores).toEqual({ demandaAcs: 112 });
  });

  it('puentes térmicos y renovables', () => {
    const [p] = interpretarTexto('frente de forjado 12 metros').elementos;
    expect(p!.valores).toEqual({ tipo: 'frente_forjado', longitud: 12 });
    const [r] = interpretarTexto('placas solares fotovoltaicas 3 kW pico').elementos;
    expect(r!.valores).toEqual({ tipo: 'fotovoltaica', potenciaPico: 3 });
  });

  it('parte en frases y deja aparte lo que no entiende', () => {
    expect(partirFrases('fachada norte 20 m2. ventana sur\ncubierta 50 m2 siguiente pilar 3 m')).toEqual(
      ['fachada norte 20 m2', 'ventana sur', 'cubierta 50 m2', 'pilar 3 m']);
    const r = interpretarTexto('fachada norte 20 m2; hola qué tal');
    expect(r.elementos).toHaveLength(1);
    expect(r.sinEntender).toEqual(['hola qué tal']);
  });

  it('el punto de millares se lee como en castellano pero se avisa', () => {
    expect(leerNumeroEs('1.200')).toMatchObject({ valor: 1200 });
    expect(leerNumeroEs('1.200').nota).toBeTruthy();
    expect(leerNumeroEs('0,45')).toEqual({ valor: 0.45 });
    expect(leerNumeroEs('1.5')).toEqual({ valor: 1.5 });
  });
});

describe('ficheros', () => {
  it('lee CSV con «;», comillas y BOM', () => {
    expect(leerCsv('﻿a;b;c\r\n1;"x;y";"di ""hola"""\n\n2;;3\n')).toEqual([['a', 'b', 'c'], ['1', 'x;y', 'di "hola"'], ['2', '', '3']]);
    expect(leerCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('las etiquetas de columna no se confunden entre campos', () => {
    const vistos = new Map<string, string>();
    for (const d of [...CAMPOS_GENERALES, ...SECCIONES.flatMap((s) => s.campos)]) {
      const previo = vistos.get(d.etiqueta);
      if (previo) expect(previo).toBe(d.campo);
      vistos.set(d.etiqueta, d.campo);
    }
    expect(mapaColumnas().get('transmitancia u')).toBe('u');
  });

  it('la plantilla se vuelve a leer igual (ida y vuelta)', () => {
    const { elementos, sinEntender } = interpretarTabla(leerCsv(plantillaCsv()));
    expect(sinEntender).toEqual([]);
    expect(elementos.map((e) => e.destino)).toEqual(['generales', 'cerramientos', 'huecos', 'puentesTermicos', 'instalaciones']);
    expect(elementos.every((e) => e.notas.length === 0)).toBe(true);
    expect(elementos[0]!.valores).toMatchObject({ zonaClimatica: 'D1', normativa: 'ct79', superficieUtil: 85.5 });
    expect(elementos[4]!.valores).toMatchObject({ centralizada: false, unidadRendimiento: 'porcentaje', rendimiento: 98 });
  });

  it('tabla: opciones desconocidas y columnas que no son de esa sección se señalan', () => {
    const { elementos, sinEntender } = interpretarTabla([
      ['Sección', 'Tipo', 'Superficie (m²)', 'Potencia pico', 'Cosa rara'],
      ['cerramientos', 'Tejado raro', '30', '5', 'x'],
      ['nada', '', '', '', ''],
    ]);
    expect(elementos[0]!.valores).toEqual({ superficie: 30 });
    expect(elementos[0]!.notas.join(' ')).toMatch(/Tejado raro.*no es una de las opciones/);
    expect(elementos[0]!.notas.join(' ')).toMatch(/Potencia pico.*no se usa/);
    expect(sinEntender.join(' ')).toMatch(/Cosa rara/);
    expect(sinEntender.join(' ')).toMatch(/Fila 3/);
  });

  it('una tabla sin columna «Sección» se lee como texto', () => {
    const { elementos } = interpretarTabla([['Fachada norte 20 m2'], ['Ventana sur 1,5 m2']]);
    expect(elementos.map((e) => e.destino)).toEqual(['cerramientos', 'huecos']);
  });

  it('lee la primera hoja de un .xlsx', () => {
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Sección</t></si><si><t>Transmitancia U</t></si><si><r><t>Cerra</t></r><r><t>miento</t></r></si><si><t>Tipo</t></si><si><t>Muro de fachada</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>'
        + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2.125</v></c><c r="C2" t="s"><v>4</v></c></row></sheetData></worksheet>'),
    });
    const filas = leerXlsx(xlsx);
    expect(filas).toEqual([['Sección', 'Transmitancia U', 'Tipo'], ['Cerramiento', '2,125', 'Muro de fachada']]);
    expect(interpretarTabla(filas).elementos[0]!.valores).toEqual({ u: 2.125, tipo: 'fachada' });
  });

  it('JSON de la propia app (fila de la copia de seguridad)', () => {
    const { elementos } = interpretarJson(JSON.stringify({ datos: { generales: { superficieUtil: 90 }, cerramientos: [{ id: 'x', tipo: 'fachada', u: 1 }] } }));
    expect(elementos.map((e) => e.destino)).toEqual(['generales', 'cerramientos']);
    expect(elementos[1]!.valores).toEqual({ tipo: 'fachada', u: 1 });
    expect(() => interpretarJson('{}')).toThrow();
  });
});

describe('aplicarPropuesta', () => {
  it('añade filas nuevas y sustituye solo los datos generales indicados', () => {
    const d = tomaDatosVacia();
    d.generales = { superficieUtil: 80, alturaLibre: 2.4 };
    d.cerramientos = [{ id: 'a', tipo: 'cubierta' }];
    let n = 0;
    const r = aplicarPropuesta(d, [
      { destino: 'generales', valores: { superficieUtil: 85 }, origen: '', notas: [] },
      { destino: 'cerramientos', valores: { tipo: 'fachada' }, origen: '', notas: [] },
    ], () => `n${++n}`);
    expect(r.generales).toEqual({ superficieUtil: 85, alturaLibre: 2.4 });
    expect(r.cerramientos).toEqual([{ id: 'a', tipo: 'cubierta' }, { id: 'n1', tipo: 'fachada' }]);
    expect(d.generales.superficieUtil).toBe(80); // no modifica el original
    expect(normalizarTomaDatos(r).cerramientos).toHaveLength(2);
  });
});
