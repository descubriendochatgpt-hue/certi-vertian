// Lector y escritor de «pickle» de Python 2, protocolo 0 (texto).
//
// Los proyectos .cex de CE3X son una sucesión de pickles de Python 2
// guardados en modo texto de Windows (saltos de línea CRLF). Aquí se lee y se
// escribe exactamente el subconjunto de operaciones que usa CE3X, conservando
// la diferencia entre cadenas de bytes (S) y unicode (V), enteros y reales,
// porque Python 2 no las trata igual al comparar.
//
// Seguridad: leer NO ejecuta nada. Las clases que aparecen en el fichero
// (GLOBAL, INST, REDUCE) se guardan como datos con su nombre; nunca se llaman.

/** Cadena de bytes de Python 2 (`str`), guardada como texto latin-1. */
export class PyBytes {
  constructor(public s: string) {}
}
/** Número real (`float`). Los enteros se representan con `number` normal. */
export class PyFloat {
  constructor(public v: number) {}
}
/** Entero largo (`long`). */
export class PyLong {
  constructor(public v: bigint) {}
}
export class PyTuple {
  constructor(public items: Py[]) {}
}
/** Diccionario que conserva el orden en que estaba escrito. */
export class PyDict {
  constructor(public entries: [Py, Py][] = []) {}
  get(clave: string): Py | undefined {
    return this.entries.find(([k]) => claveTexto(k) === clave)?.[1];
  }
  set(clave: string, valor: Py): void {
    const e = this.entries.find(([k]) => claveTexto(k) === clave);
    if (e) e[1] = valor;
    else this.entries.push([new PyBytes(clave), valor]);
  }
}
/** Referencia a una clase o función (`módulo.nombre`). No se resuelve nunca. */
export class PyGlobal {
  constructor(public module: string, public name: string) {}
}
/**
 * Objeto: o bien una instancia de clase antigua (INST), o bien el resultado de
 * llamar a una función con argumentos (REDUCE); después, opcionalmente, su
 * estado (BUILD).
 */
export class PyObject {
  state: Py | undefined = undefined;
  constructor(
    public kind: 'inst' | 'reduce',
    public cls: PyGlobal,
    public args: Py[],
  ) {}
}

export type Py =
  | null | boolean | number | string
  | PyBytes | PyFloat | PyLong | PyTuple | PyDict | PyGlobal | PyObject | Py[];

function claveTexto(k: Py): string | undefined {
  return typeof k === 'string' ? k : k instanceof PyBytes ? k.s : undefined;
}

/** Texto de un valor de cadena, sea `str` o `unicode`. */
export function texto(v: Py | undefined): string | undefined {
  return typeof v === 'string' ? v : v instanceof PyBytes ? v.s : undefined;
}

// ───────────────────────────────── Lectura ─────────────────────────────────

/**
 * Identidad de las cadenas unicode. En JavaScript dos textos iguales son
 * indistinguibles, pero pickle (como Python) escribe una referencia («g5»)
 * solo cuando es EL MISMO objeto y un texto nuevo cuando es otro objeto con el
 * mismo contenido. Para reescribir un .cex exactamente como lo escribió CE3X,
 * al leer se anota de qué texto del fichero viene cada posición de cada lista,
 * tupla o diccionario; al escribir, se reutiliza la referencia solo si la
 * posición sigue teniendo ese mismo texto.
 */
const identidades = new WeakMap<object, Map<string, { token: number; valor: string }>>();
let contadorTokens = 0;

function anotar(contenedor: object, posicion: string, valor: Py, token: number | undefined) {
  if (token === undefined || typeof valor !== 'string') return;
  let m = identidades.get(contenedor);
  if (!m) identidades.set(contenedor, (m = new Map()));
  m.set(posicion, { token, valor });
}

function tokenDe(contenedor: object, posicion: string, valor: Py): number | undefined {
  const e = identidades.get(contenedor)?.get(posicion);
  return e && e.valor === valor ? e.token : undefined;
}

const MARCA = Symbol('marca');
type Pila = (Py | typeof MARCA)[];

/** Convierte bytes a texto latin-1 (un carácter por byte). */
export function bytesALatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

export function latin1ABytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 255) throw new Error('Carácter fuera de latin-1 en la salida del pickle.');
    b[i] = c;
  }
  return b;
}

/** Interpreta un literal de cadena de Python 2 (`'…'` o `"…"`) con sus escapes. */
function leerLiteral(l: string): string {
  const q = l[0];
  if ((q !== "'" && q !== '"') || l[l.length - 1] !== q || l.length < 2) throw new Error(`Cadena mal formada en el pickle: ${l.slice(0, 40)}`);
  const c = l.slice(1, -1);
  let r = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]!;
    if (ch !== '\\') { r += ch; continue; }
    const n = c[++i];
    switch (n) {
      case 'n': r += '\n'; break;
      case 't': r += '\t'; break;
      case 'r': r += '\r'; break;
      case '\\': r += '\\'; break;
      case "'": r += "'"; break;
      case '"': r += '"'; break;
      case 'a': r += '\x07'; break;
      case 'b': r += '\b'; break;
      case 'f': r += '\f'; break;
      case 'v': r += '\v'; break;
      case 'x': r += String.fromCharCode(parseInt(c.slice(i + 1, i + 3), 16)); i += 2; break;
      default:
        if (n !== undefined && /[0-7]/.test(n)) {
          const m = /^[0-7]{1,3}/.exec(c.slice(i))![0];
          r += String.fromCharCode(parseInt(m, 8));
          i += m.length - 1;
        } else r += '\\' + (n ?? '');
    }
  }
  return r;
}

/** raw-unicode-escape: el texto ya viene en latin-1; solo hay que resolver \uXXXX y \UXXXXXXXX. */
function leerRawUnicode(l: string): string {
  return l.replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (_m, a: string | undefined, b: string | undefined) =>
    String.fromCodePoint(parseInt((a ?? b)!, 16)));
}

/**
 * Lee todos los pickles seguidos de un fichero. Admite saltos de línea CRLF
 * (como los guarda CE3X en Windows) o LF.
 */
export function leerPickles(datos: Uint8Array | string): Py[] {
  const s = (typeof datos === 'string' ? datos : bytesALatin1(datos)).replace(/\r\n/g, '\n');
  const resultado: Py[] = [];
  let i = 0;

  const linea = (): string => {
    const fin = s.indexOf('\n', i);
    if (fin < 0) throw new Error('Fin de fichero inesperado dentro del pickle.');
    const l = s.slice(i, fin);
    i = fin + 1;
    return l;
  };

  while (i < s.length) {
    if (s[i] === '\n' || s[i] === '\r') { i++; continue; }
    const pila: Pila = [];
    const tokens: (number | undefined)[] = []; // en paralelo a la pila: de qué texto del fichero viene cada cadena
    const memo = new Map<string, Py>();
    const memoTokens = new Map<string, number | undefined>();
    let ultimos: (number | undefined)[] = [];
    const hastaMarca = (): Py[] => {
      const k = pila.lastIndexOf(MARCA);
      if (k < 0) throw new Error('Pickle mal formado: falta una marca.');
      const items = pila.splice(k) as Py[];
      items.shift();
      ultimos = tokens.splice(k).slice(1);
      return items;
    };
    const meter = (v: Py | typeof MARCA, token?: number) => { pila.push(v); tokens.push(token); };
    const sacar = (): [Py, number | undefined] => [pila.pop() as Py, tokens.pop()];
    const anotarTodos = (c: object, items: Py[], desde = 0) => items.forEach((v, j) => anotar(c, String(desde + j), v, ultimos[j]));
    const cima = (): Py => {
      const v = pila[pila.length - 1];
      if (v === undefined || v === MARCA) throw new Error('Pickle mal formado: pila vacía.');
      return v;
    };
    let terminado = false;
    while (!terminado) {
      if (i >= s.length) throw new Error('Fin de fichero inesperado dentro del pickle.');
      const op = s[i++]!;
      switch (op) {
        case '(': meter(MARCA); break;
        case '.': resultado.push(sacar()[0]); terminado = true; break;
        case '0': sacar(); break;
        case 'N': meter(null); break;
        case 'I': {
          const l = linea();
          if (l === '01') meter(true);
          else if (l === '00') meter(false);
          else meter(Number(l));
          break;
        }
        case 'L': meter(new PyLong(BigInt(linea().replace(/L$/, '')))); break;
        case 'F': meter(new PyFloat(Number(linea()))); break;
        case 'S': meter(new PyBytes(leerLiteral(linea()))); break;
        case 'V': meter(leerRawUnicode(linea()), ++contadorTokens); break;
        case 'l': { const items = hastaMarca(); anotarTodos(items, items); meter(items); break; }
        case 'd': {
          const items = hastaMarca();
          const d = new PyDict();
          for (let k = 0; k < items.length; k += 2) {
            anotar(d, `k${d.entries.length}`, items[k]!, ultimos[k]);
            anotar(d, `v${d.entries.length}`, items[k + 1]!, ultimos[k + 1]);
            d.entries.push([items[k]!, items[k + 1]!]);
          }
          meter(d);
          break;
        }
        case 't': { const items = hastaMarca(); anotarTodos(items, items); meter(new PyTuple(items)); break; }
        case ')': meter(new PyTuple([])); break;
        case ']': meter([]); break;
        case '}': meter(new PyDict()); break;
        case 'a': {
          const [v, t] = sacar();
          const lista = cima();
          if (!Array.isArray(lista)) throw new Error('Pickle mal formado: APPEND sin lista.');
          anotar(lista, String(lista.length), v, t);
          lista.push(v);
          break;
        }
        case 'e': {
          const items = hastaMarca();
          const lista = cima();
          if (!Array.isArray(lista)) throw new Error('Pickle mal formado: APPENDS sin lista.');
          anotarTodos(lista, items, lista.length);
          lista.push(...items);
          break;
        }
        case 's': {
          const [v, tv] = sacar(), [k, tk] = sacar();
          const d = cima();
          if (!(d instanceof PyDict)) throw new Error('Pickle mal formado: SETITEM sin diccionario.');
          anotar(d, `k${d.entries.length}`, k, tk);
          anotar(d, `v${d.entries.length}`, v, tv);
          d.entries.push([k, v]);
          break;
        }
        case 'u': {
          const items = hastaMarca();
          const d = cima();
          if (!(d instanceof PyDict)) throw new Error('Pickle mal formado: SETITEMS sin diccionario.');
          for (let k = 0; k < items.length; k += 2) {
            anotar(d, `k${d.entries.length}`, items[k]!, ultimos[k]);
            anotar(d, `v${d.entries.length}`, items[k + 1]!, ultimos[k + 1]);
            d.entries.push([items[k]!, items[k + 1]!]);
          }
          break;
        }
        case 'p': { const k = linea(); memo.set(k, cima()); memoTokens.set(k, tokens[tokens.length - 1]); break; }
        case 'g': {
          const k = linea();
          if (!memo.has(k)) throw new Error(`Pickle mal formado: referencia ${k} desconocida.`);
          meter(memo.get(k)!, memoTokens.get(k));
          break;
        }
        case 'c': { const m = linea(); meter(new PyGlobal(m, linea())); break; }
        case 'i': {
          const m = linea(), n = linea();
          const args = hastaMarca();
          anotarTodos(args, args);
          meter(new PyObject('inst', new PyGlobal(m, n), args));
          break;
        }
        case 'R': {
          const [args] = sacar(), [f] = sacar();
          if (!(f instanceof PyGlobal) || !(args instanceof PyTuple)) throw new Error('Pickle mal formado: REDUCE.');
          meter(new PyObject('reduce', f, args.items));
          break;
        }
        case 'b': {
          const [estado] = sacar();
          const o = cima();
          if (!(o instanceof PyObject)) throw new Error('Pickle mal formado: BUILD sin objeto.');
          o.state = estado;
          break;
        }
        default:
          throw new Error(`Operación de pickle no admitida: «${op}» en la posición ${i - 1}.`);
      }
    }
  }
  return resultado;
}

// ──────────────────────────────── Escritura ────────────────────────────────

/** repr() de una cadena de bytes en Python 2. */
function reprBytes(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let r = q;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === '\\') r += '\\\\';
    else if (ch === q) r += '\\' + q;
    else if (ch === '\t') r += '\\t';
    else if (ch === '\n') r += '\\n';
    else if (ch === '\r') r += '\\r';
    else if (c < 32 || c >= 127) r += '\\x' + c.toString(16).padStart(2, '0');
    else r += ch;
  }
  return r + q;
}

/** raw-unicode-escape tal como lo escribe pickle en Python 2.7 (escapa también «\» y el salto de línea). */
function rawUnicode(s: string): string {
  let r = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') r += '\\u005c';
    else if (ch === '\n') r += '\\u000a';
    else if (c < 256) r += ch;
    else if (c < 0x10000) r += '\\u' + c.toString(16).padStart(4, '0');
    else r += '\\U' + c.toString(16).padStart(8, '0');
  }
  return r;
}

/** repr() de un float en Python 2.7 (el más corto que se lee igual). */
function reprFloat(v: number): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  let t = String(v);
  if (/e/.test(t)) {
    // JS: «1e-7», «1.5e+21» → Python: «1e-07», «1.5e+21»
    t = t.replace(/e([+-])(\d)$/, 'e$10$2');
    return t;
  }
  return Number.isInteger(v) ? `${t}.0` : t;
}

/**
 * Escribe un valor como un pickle de protocolo 0, igual que lo haría
 * `pickle.dump(valor, f)` en Python 2: lo que ya se ha escrito (el MISMO
 * objeto) se referencia; un texto leído de un fichero se referencia solo si en
 * el fichero era el mismo objeto (ver «identidades»).
 */
export function escribirPickle(valor: Py): string {
  const partes: string[] = [];
  const memoObj = new Map<object, number>();
  const memoTokens = new Map<number, number>();
  let n = 0;
  const poner = (): number => { partes.push(`p${n}\n`); return n++; };

  /** `contenedor` y `posicion`: dónde está el valor (para saber de qué texto del fichero venía). */
  const escribir = (v: Py, contenedor?: object, posicion?: string): void => {
    if (v === null) { partes.push('N'); return; }
    if (typeof v === 'boolean') { partes.push(v ? 'I01\n' : 'I00\n'); return; }
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) throw new Error('Un entero de pickle no puede tener decimales (usa PyFloat).');
      partes.push(`I${v}\n`);
      return;
    }
    if (v instanceof PyFloat) { partes.push(`F${reprFloat(v.v)}\n`); return; }
    if (v instanceof PyLong) { partes.push(`L${v.v}L\n`); return; }
    if (typeof v === 'string') {
      const token = contenedor && posicion !== undefined ? tokenDe(contenedor, posicion, v) : undefined;
      const m = token === undefined ? undefined : memoTokens.get(token);
      if (m !== undefined) { partes.push(`g${m}\n`); return; }
      partes.push(`V${rawUnicode(v)}\n`);
      const id = poner();
      if (token !== undefined) memoTokens.set(token, id);
      return;
    }
    const m = memoObj.get(v);
    if (m !== undefined) { partes.push(`g${m}\n`); return; }
    if (v instanceof PyBytes) {
      partes.push(`S${reprBytes(v.s)}\n`);
      memoObj.set(v, poner());
      return;
    }
    if (Array.isArray(v)) {
      partes.push('(l');
      memoObj.set(v, poner());
      v.forEach((x, i) => { escribir(x, v, String(i)); partes.push('a'); });
      return;
    }
    if (v instanceof PyDict) {
      partes.push('(d');
      memoObj.set(v, poner());
      v.entries.forEach(([k, x], i) => { escribir(k, v, `k${i}`); escribir(x, v, `v${i}`); partes.push('s'); });
      return;
    }
    if (v instanceof PyTuple) {
      partes.push('(');
      v.items.forEach((x, i) => escribir(x, v.items, String(i)));
      partes.push('t');
      memoObj.set(v, poner());
      return;
    }
    if (v instanceof PyGlobal) {
      partes.push(`c${v.module}\n${v.name}\n`);
      memoObj.set(v, poner());
      return;
    }
    if (v instanceof PyObject) {
      if (v.kind === 'inst') {
        partes.push('(');
        v.args.forEach((x, i) => escribir(x, v.args, String(i)));
        partes.push(`i${v.cls.module}\n${v.cls.name}\n`);
      } else {
        escribir(v.cls);
        escribir(new PyTuple(v.args));
        partes.push('R');
      }
      memoObj.set(v, poner());
      if (v.state !== undefined) { escribir(v.state); partes.push('b'); }
      return;
    }
    throw new Error('Valor no admitido en el pickle.');
  };

  escribir(valor);
  partes.push('.');
  return partes.join('');
}

/** Escribe varios pickles seguidos con saltos de línea de Windows, como CE3X. */
export function escribirPickles(valores: Py[]): Uint8Array {
  return latin1ABytes(valores.map(escribirPickle).join('').replace(/\n/g, '\r\n'));
}
