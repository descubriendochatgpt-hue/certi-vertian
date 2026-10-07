import { describe, expect, it } from 'vitest';
import {
  comando, detallesQueFaltan, hayQuePreguntar, normativaAutomatica, normativaPorAnio, elegirOpcion, guion, leerNumeroHablado, respuestaCampo, respuestaElemento, valoresAutomaticos,
} from '../asistenteVoz';
import { CAMPOS_ADMINISTRATIVOS, CAMPOS_GENERALES, CAMPOS_HUECO, CAMPOS_INSTALACION, tomaDatosVacia } from '../tomaDatos';

const def = (lista: typeof CAMPOS_GENERALES, c: string) => lista.find((d) => d.campo === c)!;
const exp = { tipo_edificio: 'vivienda_en_bloque' as const, anio_construccion: null as number | null, codigo_postal: '33003', direccion: 'C/ Uría 1', municipio: 'Oviedo', provincia: 'Asturias' };

describe('números dichos en voz alta', () => {
  it.each([
    ['85', 85], ['85,5', 85.5], ['85 coma 5', 85.5], ['ochenta y cinco', 85], ['ochenta y cinco coma cinco', 85.5],
    ['dos coma siete', 2.7], ['cero coma cuatro cinco', 0.45], ['cero coma cuarenta y cinco', 0.45], ['dos coma cero cinco', 2.05],
    ['mil novecientos setenta y cuatro', 1974], ['dos mil cuatro', 2004], ['1.200', 1200], ['veinticuatro kilovatios', 24],
    ['unos 120 metros cuadrados', 120], ['1,20 por 1,50', 1.8], ['tres por dos', 6],
  ])('«%s» → %s', (t, n) => expect(leerNumeroHablado(t)).toBe(n));

  it('sin número → null; «ninguna» vale 0 en una pregunta de número', () => {
    expect(leerNumeroHablado('no lo sé')).toBeNull();
    expect(respuestaCampo(def(CAMPOS_GENERALES, 'plantasBajoRasante'), 'ninguna')).toEqual({ valor: 0 });
  });
});

describe('opciones y órdenes', () => {
  it('entiende las opciones con las palabras de cada día', () => {
    const o = (c: string) => def([...CAMPOS_GENERALES, ...CAMPOS_ADMINISTRATIVOS, ...CAMPOS_HUECO, ...CAMPOS_INSTALACION], c).opciones!;
    expect(elegirOpcion('normativa', 'anterior a la CT 79', o('normativa'))).toBe('anterior_ct79');
    expect(elegirOpcion('normativa', 'CTE 2006', o('normativa'))).toBe('cte2006');
    expect(elegirOpcion('zonaClimatica', 'D 1', o('zonaClimatica'))).toBe('D1');
    expect(elegirOpcion('zonaClimatica', 'B3', o('zonaClimatica'))).toBe('otra');
    expect(elegirOpcion('gradoProteccion', 'ninguno', o('gradoProteccion'))).toBe('ninguna');
    expect(elegirOpcion('tipoVidrio', 'doble bajo emisivo', o('tipoVidrio'))).toBe('doble_be');
    expect(elegirOpcion('tipoMarco', 'aluminio con rotura de puente', o('tipoMarco'))).toBe('aluminio_rpt');
    expect(elegirOpcion('tipoMarco', 'aluminio', o('tipoMarco'))).toBe('aluminio');
    expect(elegirOpcion('servicio', 'calefacción y agua caliente', o('servicio'))).toBe('calefaccion_acs');
    expect(elegirOpcion('generador', 'caldera de condensación', o('generador'))).toBe('caldera_condensacion');
    expect(elegirOpcion('combustible', 'gas natural', o('combustible'))).toBe('gas_natural');
    expect(elegirOpcion('orientacion', 'noroeste', [])).toBe('NO');
    expect(elegirOpcion('normativa', 'patata', o('normativa'))).toBeNull();
  });

  it('órdenes: saltar, atrás, repetir, parar, terminado (y «no» es una respuesta, no saltar)', () => {
    expect(comando('Saltar')).toBe('saltar');
    expect(comando('no sé')).toBe('saltar');
    expect(comando('atrás')).toBe('atras');
    expect(comando('repite')).toBe('repetir');
    expect(comando('para')).toBe('parar');
    expect(comando('ya está')).toBe('terminado');
    expect(comando('no')).toBeNull();
    expect(comando('fachada norte')).toBeNull();
  });

  it('códigos postales y textos', () => {
    expect(respuestaCampo(def(CAMPOS_ADMINISTRATIVOS, 'clienteCodigoPostal'), '33 003')).toEqual({ valor: '33003' });
    expect(respuestaCampo(def(CAMPOS_ADMINISTRATIVOS, 'clienteCodigoPostal'), '330')).toHaveProperty('error');
    expect(respuestaCampo(def(CAMPOS_ADMINISTRATIVOS, 'clienteDireccion'), 'calle uría 1')).toEqual({ valor: 'Calle uría 1' });
  });
});

describe('guion', () => {
  it('pantalla 1 sin preguntas: lo conocido se rellena solo; sin zona; normativa por el año', () => {
    const t = tomaDatosVacia();
    const auto = valoresAutomaticos(t, exp);
    t.generales = Object.fromEntries(auto.map((a) => [a.campo, a.valor]));
    const campos = guion(t, exp).filter((x) => x.tipo === 'lista' || hayQuePreguntar(x, t))
      .flatMap((x) => (x.tipo === 'campo' ? [x.def.campo] : [x.pantalla]));
    expect(campos).toEqual([
      'anioConstruccion', 'normativa', 'superficieUtilRd390', 'superficieUtil',
      'numeroPlantas', 'plantasSobreRasante', 'plantasBajoRasante', 'demandaAcs',
      'Envolvente térmica', 'Instalaciones',
    ]);
    for (const no of ['zonaClimatica', 'alturaLibre', 'ventilacion', 'masaParticiones', 'nombreEdificio', 'gradoProteccion', 'clienteDireccion']) {
      expect(campos).not.toContain(no);
    }
    // Sin CRM, el cliente toma la dirección del inmueble
    expect(t.generales).toMatchObject({ clienteDireccion: 'C/ Uría 1', clienteLocalidad: 'Oviedo', clienteCodigoPostal: '33003', clienteProvincia: 'Asturias', gradoProteccion: 'ninguna', usoEdificio: 'residencial_privado', numeroViviendas: 1 });
  });

  it('el cliente del CRM manda sobre la dirección del inmueble, y nunca se pisa lo ya puesto', () => {
    const t = tomaDatosVacia();
    t.generales = { clienteLocalidad: 'Avilés' };
    const auto = Object.fromEntries(valoresAutomaticos(t, exp, { direccion: 'C/ Facturación 3', codigo_postal: '33001', ciudad: 'Oviedo' }).map((a) => [a.campo, a.valor]));
    expect(auto.clienteDireccion).toBe('C/ Facturación 3');
    expect(auto.clienteCodigoPostal).toBe('33001');
    expect(auto).not.toHaveProperty('clienteLocalidad');
  });

  it('normativa por el año de construcción (y aviso en los años frontera)', () => {
    expect(normativaPorAnio(1965)).toEqual({ valor: 'anterior_ct79', dudoso: false });
    expect(normativaPorAnio(1990)).toEqual({ valor: 'ct79', dudoso: false });
    expect(normativaPorAnio(2010).valor).toBe('cte2006');
    expect(normativaPorAnio(2016).valor).toBe('cte2013');
    expect(normativaPorAnio(2022).valor).toBe('cte2019');
    expect(normativaPorAnio(2007).dudoso).toBe(true);
    const t = tomaDatosVacia();
    expect(normativaAutomatica(t, { anio_construccion: 1974 })[0]).toMatchObject({ valor: 'anterior_ct79' });
    t.generales.anioConstruccion = 2015;
    expect(normativaAutomatica(t, { anio_construccion: null })[0]).toMatchObject({ valor: 'cte2013' });
    const p = guion(t, exp).find((x) => x.tipo === 'campo' && x.def.campo === 'normativa')!;
    expect(hayQuePreguntar(p, t)).toBe(false);
  });

  it('antes de cada pregunta se comprueba si ya se sabe la respuesta', () => {
    const t = tomaDatosVacia();
    const p = guion(t, exp).find((x) => x.tipo === 'campo' && x.def.campo === 'clienteProvincia')!;
    expect(hayQuePreguntar(p, t)).toBe(true);
    t.generales.clienteCodigoPostal = '33201';
    expect(hayQuePreguntar(p, t)).toBe(false);
  });
});

describe('elementos', () => {
  it('después de describir un elemento pregunta solo lo que falta', () => {
    const r = respuestaElemento('Envolvente térmica', 'fachada norte');
    expect('elemento' in r && r.elemento.destino).toBe('cerramientos');
    if ('elemento' in r) expect(detallesQueFaltan('cerramientos', r.elemento.valores).map((d) => d.campo)).toEqual(['superficie']);
    const v = respuestaElemento('Envolvente térmica', 'ventana sur de 1,20 por 1,50 doble vidrio');
    if ('elemento' in v) expect(detallesQueFaltan('huecos', v.elemento.valores).map((d) => d.campo)).toEqual(['tipoMarco']);
    const i = respuestaElemento('Instalaciones', 'caldera de gas natural para calefacción y agua caliente de 24 kilovatios');
    if ('elemento' in i) expect(detallesQueFaltan('instalaciones', i.elemento.valores)).toEqual([]);
    expect(respuestaElemento('Instalaciones', 'hola')).toHaveProperty('error');
  });
});
