import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Py, PyBytes, PyDict, PyLong, PyObject, escribirPickles, leerPickles, texto } from '../cex/pickle';
import { aprenderDeCex, aprenderSoluciones, catalogoDePartida, nuevoUuid, unirCatalogos } from '../cex/catalogo';
import { rellenarPlantilla } from '../cex/proyecto';
import type { Expediente } from '../estados';
import { tomaDatosVacia } from '../tomaDatos';

// Envolvente e instalaciones originales de CE3X (proyecto de ejemplo, sin datos personales)
const [, ENV, INST] = leerPickles(new Uint8Array(readFileSync(new URL('./fixtures/ce3x-envolvente.cex', import.meta.url)))) as Py[][];
const original = (parte: number, nombre: string) =>
  (ENV![parte] as Py[]).find((e) => (Array.isArray(e) ? texto(e[0]) : texto((e as PyObject).state instanceof PyDict ? ((e as PyObject).state as PyDict).get('descripcion') : undefined)) === nombre);

function plantilla(): Uint8Array {
  const admin: Py[] = Array.from({ length: 29 }, () => '');
  admin[15] = [];
  const gen: Py[] = Array.from({ length: 26 }, () => '');
  const informe: Py[] = ['', '', '', '', '', ['', '', ''], ['', '', ''], ''];
  return escribirPickles([
    new PyBytes('CE3Xv3.1 Residencial'), admin, gen, [[], [], [], []], Array.from({ length: 14 }, () => []),
    [], [], [], [], [], ['Sin patrón'], informe, new PyDict(), true, new PyBytes('huella'),
  ]);
}

const exp = { codigo: 'CEE-1', direccion: 'Calle Ejemplo 1', municipio: 'Oviedo', provincia: 'Asturias', tipo_edificio: 'vivienda_en_bloque' } as Expediente;
const catalogo = catalogoDePartida();
const clave = (texto_: string) => catalogo.find((s) => s.etiqueta.includes(texto_))!.clave;

describe('catálogo de soluciones de CE3X', () => {
  it('aprende del proyecto de ejemplo cada solución una sola vez', () => {
    const tipos = catalogo.map((s) => s.tipo);
    expect(tipos.filter((t) => t === 'cerramiento')).toHaveLength(3);
    expect(tipos.filter((t) => t === 'hueco')).toHaveLength(1);
    expect(tipos.filter((t) => t === 'puente')).toHaveLength(5);
    expect(tipos.filter((t) => t === 'instalacion')).toHaveLength(2);
    expect(catalogo.map((s) => s.etiqueta)).toContain('ACS · Efecto Joule · Electricidad · Estimado según Instalación · rendimiento 100 %');
    // La composición de la librería viaja con la fachada que la usa
    expect(catalogo.find((s) => s.etiqueta.includes('Conocidas'))!.composicion).toContain('Cerramiento actualizado');
  });

  it('una fachada que usa una composición que no está en el proyecto no se aprende', () => {
    const sinLibreria = aprenderSoluciones([new PyBytes('CE3X'), [], [], ENV!, INST!, [], [], [], []], 'x');
    expect(sinLibreria.some((s) => s.etiqueta.includes('Conocidas'))).toBe(false);
    expect(sinLibreria.some((s) => s.etiqueta.includes('Estimadas'))).toBe(true);
  });

  it('rechaza lo que no es un .cex y une catálogos sin repetir', () => {
    expect(() => aprenderDeCex(new TextEncoder().encode('hola'), 'x')).toThrow(/CE3X/);
    expect(unirCatalogos(catalogo, catalogo)).toHaveLength(catalogo.length);
  });

  it('UUID de versión 4', () => {
    const u = nuevoUuid(() => new Uint8Array(16).fill(255));
    expect(u).toBeInstanceOf(PyLong);
    expect(u.v.toString(16)).toBe('ffffffffffff4fffbfffffffffffffff');
  });
});

describe('envolvente e instalaciones en el .cex', () => {
  it('reconstruye a partir de la toma de datos lo mismo que guardó CE3X', () => {
    const toma = tomaDatosVacia();
    toma.generales = { superficieUtil: 58.7 };
    toma.cerramientos = [
      { id: '1', nombre: 'Muro N', tipo: 'fachada', orientacion: 'N', longitud: 2.5, altura: 2.5, solucionCe3x: clave('Estimadas') },
      { id: '2', nombre: 'Pared con ascensor', tipo: 'particion_nh', superficie: 2.5, altura: 2.5 },
    ];
    toma.huecos = [{ id: 'h', nombre: 'Ventana N', cerramiento: 'Muro N', alto: 1.35, ancho: 1.4, tipoMarco: 'aluminio', tipoVidrio: 'doble', proteccionSolar: 'persiana' }];
    toma.instalaciones = [
      { id: 'a', servicio: 'acs', generador: 'efecto_joule', combustible: 'electricidad', potencia: 2.5 },
      { id: 'b', servicio: 'calefaccion', generador: 'efecto_joule', combustible: 'electricidad', potencia: 4 },
    ];
    const r = rellenarPlantilla(plantilla(), exp, toma);
    const [, , , env, inst] = leerPickles(escribirPickles(r.proyecto.bloques)) as Py[][];
    const [cerr, huecos, puentes] = env as Py[][];
    // Cerramientos: idénticos a los de CE3X
    expect(cerr).toEqual([original(0, 'Muro N'), original(0, 'Pared con ascensor')]);
    // Puentes térmicos: los mismos que CE3X generó para ese muro y esa ventana
    const ptDe = (muro: string, hueco: string) => (ENV![2] as Py[][]).filter((p) => texto(p[7]) === muro && (!texto(p[0])!.includes('-Ventana') || texto(p[0])!.endsWith(hueco)));
    expect(puentes).toEqual(ptDe('Muro N', 'Ventana N'));
    // Hueco: mismos datos que el de CE3X (salvo su identificador)
    const h = huecos![0] as PyObject, o = original(1, 'Ventana N') as PyObject;
    const sinId = (x: PyObject) => (x.state as PyDict).entries.filter(([k]) => !['id', 'patronSombras', 'correctorFSCTE', 'correctorFSInvierno', 'correctorFSVerano'].includes(texto(k)!)).map(([k, v]) => [texto(k), v instanceof PyBytes ? v.s : v]);
    expect(Object.fromEntries(sinId(h))).toEqual(Object.fromEntries(sinId(o)));
    expect(texto((h.state as PyDict).get('patronSombras'))).toBe('Sin patrón');
    const idNuevo = ((h.state as PyDict).get('id') as PyObject).state as PyDict;
    expect(idNuevo.get('int')).not.toEqual(((o.state as PyDict).get('id') as PyObject).state instanceof PyDict ? (((o.state as PyDict).get('id') as PyObject).state as PyDict).get('int') : null);
    // Instalaciones: idénticas a las de CE3X
    expect([inst![0], inst![1]]).toEqual([INST![0], INST![1]]);
    expect(r.pendientes).toEqual(expect.arrayContaining([expect.stringMatching(/Huecos: abre cada uno en CE3X/)]));
  });

  it('copia la composición de la librería y cambia medidas y orientación vista', () => {
    const toma = tomaDatosVacia();
    toma.cerramientos = [{ id: '1', nombre: 'Salón', tipo: 'fachada', orientacion: 'E', longitud: 4, altura: 2.6, u: 0.81 }];
    const r = rellenarPlantilla(plantilla(), exp, toma);
    const b = leerPickles(escribirPickles(r.proyecto.bloques)) as Py[][];
    const muro = (b[3]![0] as Py[][])[0]!;
    expect([muro[0], muro[2], muro[5], muro[6], muro[10], muro[11]]).toEqual(['Salón', '10.4', 'Este', 'Cerramiento actualizado', '4', '2.6']);
    expect(texto(((b[8]![0] as PyObject).state as PyDict).get('nombre'))).toBe('Cerramiento actualizado');
    // Pilares: ceil(4/5)+1 = 2 → 2 × 2,6
    expect((b[3]![2] as Py[][]).map((p) => [texto(p[2]), p[4]])).toEqual([
      ['Pilar integrado en fachada', expect.objectContaining({ v: 5.2 })],
      ['Pilar en Esquina', expect.objectContaining({ v: 2.6 })],
      ['Encuentro de fachada con forjado', expect.objectContaining({ v: 4 })],
    ]);
  });

  it('lo que no está en el catálogo, o una orientación no vista, queda pendiente', () => {
    const toma = tomaDatosVacia();
    toma.generales = { superficieUtil: 80 };
    toma.cerramientos = [
      { id: '1', nombre: 'Fachada sur', tipo: 'fachada', orientacion: 'S', superficie: 12, u: 0.81 },
      { id: '2', nombre: 'Cubierta', tipo: 'cubierta', superficie: 80, u: 0.4 },
    ];
    toma.huecos = [{ id: 'h', nombre: 'Balcón', cerramiento: 'Fachada sur', alto: 2.1, ancho: 0.9, tipoMarco: 'pvc', tipoVidrio: 'doble' }];
    toma.instalaciones = [{ id: 'c', servicio: 'calefaccion_acs', generador: 'caldera_condensacion', combustible: 'gas_natural', potencia: 24 }];
    const r = rellenarPlantilla(plantilla(), exp, toma);
    const env = r.proyecto.bloques[3] as Py[][];
    expect(env[0]).toHaveLength(1); // la fachada sí (solución por U), la cubierta no
    expect(texto((env[0]![0] as Py[])[5])).not.toBe('Sur'); // «Sur» no se ha visto en CE3X: no se escribe
    expect(env[1]).toHaveLength(0);
    expect((r.proyecto.bloques[4] as Py[][]).every((p) => p.length === 0)).toBe(true);
    expect(r.pendientes).toEqual(expect.arrayContaining([
      expect.stringMatching(/Fachada sur»: pon la orientación Sur en CE3X/),
      expect.stringMatching(/Cubierta»: no hay en el catálogo/),
      expect.stringMatching(/Balcón»: no hay en el catálogo/),
      expect.stringMatching(/Instalación \(calefaccion_acs · caldera_condensacion · gas_natural\): no hay en el catálogo/),
    ]));
  });

  it('escribe la descripción de la visita en el informe', () => {
    const toma = tomaDatosVacia();
    toma.generales = { descripcionVisita: 'Visita al inmueble y toma de medidas.' };
    const r = rellenarPlantilla(plantilla(), exp, toma);
    expect((r.proyecto.bloques[11] as Py[])[3]).toBe('Visita al inmueble y toma de medidas.');
  });
});
