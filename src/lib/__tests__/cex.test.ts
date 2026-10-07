import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Py, PyBytes, PyDict, PyFloat, PyLong, PyObject, PyTuple, escribirPickle, escribirPickles, leerPickles, texto,
} from '../cex/pickle';
import { leerCex, rellenarPlantilla } from '../cex/proyecto';
import type { Expediente } from '../estados';
import { tomaDatosVacia } from '../tomaDatos';

// Bytes originales escritos por CE3X v3.1 (cabecera, envolvente e
// instalaciones de un proyecto real; sin datos personales).
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/ce3x-envolvente.cex', import.meta.url)));

describe('pickle de Python 2 (protocolo 0)', () => {
  it('lee un fichero real de CE3X', () => {
    const [cabecera, env, inst] = leerPickles(fixture);
    expect(cabecera).toEqual(new PyBytes('CE3Xv3.1 Residencial'));
    const [cerr, huecos, puentes] = env as Py[][];
    expect(cerr!.map((c) => (c as Py[])[0])).toEqual(['Muro O', 'Muro E', 'Muro N', 'Pared con ascensor', 'Entrada vivienda']);
    // str y unicode se distinguen; los reales también
    expect((cerr![0] as Py[])[1]).toEqual(new PyBytes('Fachada'));
    expect((cerr![0] as Py[])[3]).toEqual(new PyFloat(0.81));
    expect((cerr![2] as Py[])[4]).toBe(200);
    expect((cerr![3] as Py[])[1]).toBe('Partición Interior');
    // huecos: objetos con estado; el id es un UUID (entero largo)
    const h = huecos![0] as PyObject;
    expect(h.cls.name).toBe('HuecoEstimadas');
    const estado = h.state as PyDict;
    expect(estado.get('descripcion')).toBe('Ventana E');
    expect(estado.get('tipoMarco')).toBe('Metálico sin RPT');
    const id = estado.get('id') as PyObject;
    expect(id.kind).toBe('reduce');
    expect((id.state as PyDict).get('int')).toBeInstanceOf(PyLong);
    expect(puentes).toHaveLength(15);
    expect(((inst as Py[][])[0]![0] as Py[])[0]).toBe('Termo');
  });

  it('escribir y volver a leer da lo mismo (incluido lo compartido)', () => {
    const original = leerPickles(fixture);
    const otra = leerPickles(escribirPickles(original));
    expect(otra).toEqual(original);
  });

  it('escribe como Python 2: CRLF, cadenas, reales y referencias', () => {
    const compartida: Py[] = ['x'];
    const v: Py = [new PyBytes("it's"), 'Partición\\\n', new PyFloat(100), new PyFloat(0.1), 7, true, null,
      new PyLong(12345678901234567890n), new PyTuple([1]), compartida, compartida, 'Ω'];
    const t = escribirPickle(v);
    expect(t).toContain(`S"it's"\n`);
    expect(t).toContain('VPartici\xf3n\\u005c\\u000a\n'); // «ó» en latin-1; «\» y salto escapados
    expect(t).toContain('F100.0\n');
    expect(t).toContain('L12345678901234567890L\n');
    expect(t).toContain('V\\u03a9\n');
    const [leido] = leerPickles(t);
    expect(leido).toEqual(v);
    const l = leido as Py[];
    expect(l[9]).toBe(l[10]); // la lista compartida sigue siendo el mismo objeto
    expect(new TextDecoder('latin1').decode(escribirPickles([1]))).toBe('I1\r\n.');
  });

  it('no ejecuta nada: las clases quedan como nombres', () => {
    const [o] = leerPickles("cos\nsystem\n(S'echo hola'\ntR.");
    expect(o).toBeInstanceOf(PyObject);
    expect((o as PyObject).cls).toMatchObject({ module: 'os', name: 'system' });
  });

  it('rechaza ficheros que no son pickles', () => {
    expect(() => leerPickles('hola\n')).toThrow();
    expect(() => leerCex(new TextEncoder().encode("S'otra cosa'\np0\n."))).toThrow(/CE3X/);
  });
});

// Plantilla sintética con la estructura de un proyecto vacío de CE3X v3.1.
function plantilla(envolvente: Py[][] = [[], [], [], []]): Uint8Array {
  const admin: Py[] = Array.from({ length: 29 }, () => '');
  admin[15] = [];
  admin[25] = 'Ingeniería Industrial';
  admin[28] = new PyBytes('ResidencialPrivado');
  const gen: Py[] = Array.from({ length: 26 }, () => '');
  gen[0] = 'Anterior';
  gen[10] = 'Media';
  gen[16] = '0.63';
  return escribirPickles([
    new PyBytes('CE3Xv3.1 Residencial'), admin, gen, envolvente, Array.from({ length: 14 }, () => []),
    [], [], [], [], [], [], [], new PyDict(), true, new PyBytes('huella'),
  ]);
}

const exp = {
  codigo: 'CEE-2026/001', direccion: 'Calle Ejemplo 1, 2º', municipio: 'Oviedo', provincia: 'Asturias',
  referencia_catastral: '0000000AA0000A0001AA', tipo_edificio: 'vivienda_en_bloque', anio_construccion: 1972,
} as Expediente;

describe('rellenar una plantilla .cex', () => {
  it('pone los datos generales y administrativos y conserva el resto', () => {
    const toma = tomaDatosVacia();
    toma.generales = { zonaClimatica: 'D1', normativa: 'anterior_ct79', superficieUtil: 85.5, alturaLibre: 2.5, numeroPlantas: 1, masaParticiones: 'pesada', ventilacion: 0.63, demandaAcs: 112 };
    toma.cerramientos = [{ id: 'a', tipo: 'fachada' }];
    const r = rellenarPlantilla(plantilla(), exp, toma);
    const [, admin, gen, , , , , , , , , , , calc, huella] = leerPickles(escribirPickles(r.proyecto.bloques));
    const a = admin as Py[], g = gen as Py[];
    expect(a.slice(0, 4)).toEqual(['Calle Ejemplo 1, 2º', 'Calle Ejemplo 1, 2º', 'Oviedo', 'Asturias']);
    expect(a[15]).toEqual(['0000000AA0000A0001AA']);
    expect(a[25]).toBe('Ingeniería Industrial'); // datos del técnico: de la plantilla
    expect(a[28]).toEqual(new PyBytes('ResidencialPrivado')); // conserva el tipo str
    expect([g[0], g[1], g[2], g[3], g[4], g[6], g[7], g[8], g[9], g[10], g[16], g[19]])
      .toEqual(['Anterior', 'Vivienda Individual', 'Asturias', 'Oviedo', 'D1', '85.5', '2.5', '1', '112', 'Pesada', '0.63', '1972']);
    expect(calc).toBe(true);
    expect(texto(huella)).toBe('huella'); // la huella de CE3X no se toca
    expect(r.pendientes.join(' | ')).toMatch(/Cerramientos opacos: 1/);
    expect(r.avisos).toEqual([expect.stringMatching(/datos del cliente/)]);
  });

  it('pantallas 1 y 2 completas: edificio, cliente y datos generales en su sitio', () => {
    const toma = tomaDatosVacia();
    toma.generales = {
      nombreEdificio: 'Residencial Ejemplo', gradoProteccion: 'ninguna', usoEdificio: 'residencial_privado',
      clienteDireccion: 'C/ Cliente 2', clienteLocalidad: 'Gijón', clienteCodigoPostal: '33201',
      superficieUtilRd390: 77, superficieUtil: 58.7, numeroViviendas: 1, numeroPlantas: 1, plantasSobreRasante: 6,
      plantasBajoRasante: 0, demandaAcs: 86, anioConstruccion: 1990,
    };
    const e = { ...exp, codigo_postal: '33003', propietario_nombre: 'Ana Pérez', propietario_telefono: '600000001', propietario_email: 'ana@ejemplo.es' } as Expediente;
    const r = rellenarPlantilla(plantilla(), e, toma);
    const [, admin, gen] = leerPickles(escribirPickles(r.proyecto.bloques)) as Py[][];
    // Edificio
    expect([admin![0], admin![14], admin![26], admin![28]]).toEqual(['Residencial Ejemplo', '33003', 'Ninguna', new PyBytes('ResidencialPrivado')]);
    // Cliente (la provincia sale del código postal)
    expect([admin![5], admin![7], admin![16], admin![17], admin![18], admin![8], admin![9]])
      .toEqual(['Ana Pérez', 'C/ Cliente 2', 'Gijón', 'Asturias', '33201', '600000001', 'ana@ejemplo.es']);
    // Datos generales; el año del expediente manda sobre el de la toma
    expect([gen![22], gen![6], gen![23], gen![8], gen![25], gen![24], gen![9], gen![19]])
      .toEqual(['77', '58.7', '1', '1', '6', '0', '86', '1972']);
    // Lo que CE3X trae por defecto no se toca si no se tomó otro valor
    expect([gen![7], gen![16], gen![10]]).toEqual(['', '0.63', 'Media']);
    expect(r.pendientes).not.toContain('Grado de protección (elígelo en CE3X)');
  });

  it('lo que no se sabe colocar queda pendiente, no se inventa', () => {
    const toma = tomaDatosVacia();
    toma.generales = { normativa: 'cte2006', zonaClimatica: 'otra' };
    const r = rellenarPlantilla(plantilla(), { ...exp, tipo_edificio: 'vivienda_unifamiliar' }, toma);
    const g = r.proyecto.bloques[2] as Py[];
    expect(g[0]).toBe('Anterior'); // sin tocar
    expect(r.pendientes).toEqual(expect.arrayContaining([
      'Normativa vigente: elige «CTE 2006» en CE3X', 'Tipo de edificio (elígelo en CE3X)',
      'Zona climática: la asigna CE3X por la localidad; comprueba que aparece',
    ]));
  });

  it('rechaza una plantilla que ya tiene elementos de otro edificio', () => {
    const [, env] = leerPickles(fixture);
    expect(() => rellenarPlantilla(plantilla(env as Py[][]), exp, tomaDatosVacia())).toThrow(/no está vacía/);
  });
});
