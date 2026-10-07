import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { atender, catastro, comprobarTecnico, extraer, transcribir, type Env } from '../index';
import { leerRespuestaCatastro, normalizarReferencia } from '../catastro';

const env: Env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_CLAVE_PUBLICA: 'sb_publishable_x', ANTHROPIC_API_KEY: 'sk-ant-x' };
const peticion = (ruta: string, init: RequestInit = {}) => new Request(`https://certi.ejemplo.es${ruta}`, init);
const respuestaRpc = (cuerpo: unknown, estado = 200) => (async () => new Response(JSON.stringify(cuerpo), { status: estado })) as unknown as typeof fetch;

describe('acceso a /api', () => {
  it('solo técnicos verificados (lo decide Supabase con el token del técnico)', async () => {
    const conToken = peticion('/api/catastro', { headers: { Authorization: 'Bearer abc' } });
    expect(await comprobarTecnico(conToken, env, respuestaRpc(true))).toBeNull();
    expect((await comprobarTecnico(conToken, env, respuestaRpc(false)))!.status).toBe(403);
    expect((await comprobarTecnico(conToken, env, respuestaRpc({ message: 'JWT expired' }, 401)))!.status).toBe(401);
    expect((await comprobarTecnico(peticion('/api/catastro'), env, respuestaRpc(true)))!.status).toBe(401);
    expect((await comprobarTecnico(conToken, {}, respuestaRpc(true)))!.status).toBe(500);
    let llamada: [string, RequestInit] | undefined;
    await comprobarTecnico(conToken, env, (async (u: string, i: RequestInit) => { llamada = [u, i]; return new Response('true'); }) as unknown as typeof fetch);
    expect(llamada![0]).toBe('https://x.supabase.co/rest/v1/rpc/es_tecnico_verificado');
    expect((llamada![1].headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('rutas, métodos y origen', async () => {
    expect((await atender(peticion('/api/otra'), env)).status).toBe(404);
    expect((await atender(peticion('/api/catastro', { method: 'POST' }), env)).status).toBe(405);
    expect((await atender(peticion('/api/catastro', { headers: { Origin: 'https://malo.es' } }), env)).status).toBe(403);
  });
});

describe('Catastro', () => {
  const ejemplo = {
    consulta_dnprcResult: {
      control: { cudnp: 1, cucons: 2 },
      bico: {
        bi: {
          idbi: { cn: 'UR' },
          dt: { locs: { lous: { lourb: { loint: { es: '1', pt: '02', pu: 'B' } } } } },
          ldt: 'CL EJEMPLO 1 Es:1 Pl:02 Pt:B 33003 OVIEDO (ASTURIAS)',
          debi: { luso: 'Residencial', sfc: '85', cpt: '1,5', ant: '1972' },
        },
        lcons: [{ lcd: 'VIVIENDA', dfcons: { stl: '75' } }, { lcd: 'ELEMENTOS COMUNES', dfcons: { stl: '10' } }],
      },
    },
  };

  it('lee año, superficie construida, uso y planta', () => {
    expect(leerRespuestaCatastro(ejemplo, '0000000AA0000A0001AA')).toEqual({
      referencia: '0000000AA0000A0001AA', direccion: 'CL EJEMPLO 1 Es:1 Pl:02 Pt:B 33003 OVIEDO (ASTURIAS)', uso: 'Residencial',
      superficieConstruida: 85, anioConstruccion: 1972, planta: '02', construcciones: ['VIVIENDA 75 m²', 'ELEMENTOS COMUNES 10 m²'],
    });
  });

  it('errores del Catastro y referencias de parcela', () => {
    expect(() => leerRespuestaCatastro({ consulta_dnprcResult: { lerr: [{ cod: '33', des: 'LA REFERENCIA CATASTRAL NO EXISTE' }] } }, 'x')).toThrow(/NO EXISTE/);
    expect(() => leerRespuestaCatastro({ consulta_dnprcResult: { lrcdnp: { rcdnp: [] } } }, 'x')).toThrow(/varios inmuebles/);
    expect(normalizarReferencia('0000000aa0000a 0001-aa')).toBe('0000000AA0000A0001AA');
    expect(normalizarReferencia('0000000AA0000A')).toBeNull();
  });

  it('consulta el servicio público con la referencia normalizada', async () => {
    let pedida = '';
    const r = await catastro(new URL('https://x/api/catastro?rc=0000000aa0000a0001aa'),
      (async (u: string) => { pedida = u; return new Response(JSON.stringify(ejemplo)); }) as unknown as typeof fetch);
    expect(pedida).toMatch(/Consulta_DNPRC\?RefCat=0000000AA0000A0001AA$/);
    expect((await r.json() as { anioConstruccion: number }).anioConstruccion).toBe(1972);
    expect((await catastro(new URL('https://x/api/catastro?rc=123'))).status).toBe(400);
  });
});

describe('transcripción', () => {
  it('envía el audio a Whisper en español con el vocabulario técnico', async () => {
    let entrada: Record<string, unknown> = {};
    const ai = { run: async (_m: string, e: Record<string, unknown>) => { entrada = e; return { text: ' Fachada norte de ladrillo. ' }; } };
    const r = await transcribir(peticion('/api/transcribir', { method: 'POST', body: new Uint8Array([1, 2, 3]) }), { AI: ai });
    expect(await r.json()).toEqual({ texto: 'Fachada norte de ladrillo.', duracion: null });
    expect(entrada).toMatchObject({ audio: 'AQID', language: 'es', task: 'transcribe' });
    expect(entrada.initial_prompt).toMatch(/rotura de puente térmico/);
  });
});

describe('procesado de la visita con Claude', () => {
  function clienteFalso(respuesta: Partial<Anthropic.Beta.BetaMessage>) {
    const llamadas: Record<string, unknown>[] = [];
    const cliente = {
      beta: { messages: { stream: (p: Record<string, unknown>) => { llamadas.push(p); return { finalMessage: async () => ({ model: 'm', usage: { input_tokens: 1, output_tokens: 2 }, ...respuesta }) }; } } },
    } as unknown as Anthropic;
    return { cliente, llamadas };
  }
  const cuerpo = {
    expediente: 'Vivienda en bloque en Oviedo', conocido: 'Año 1972', transcripcion: 'Fachada norte de 10 por 2,5.',
    catalogo: [{ clave: 'cerramiento:1', tipo: 'cerramiento', etiqueta: 'Fachada · Estimadas' }],
    fotos: [{ hora: '10:42', tipo: 'image/jpeg', datos: 'AAAA' }, { hora: '10:43', tipo: 'text/html', datos: 'x' }, { hora: '10:44', tipo: 'application/pdf', datos: 'JVBE' }],
  };
  const pedir = (c: unknown) => peticion('/api/visita/extraer', { method: 'POST', body: JSON.stringify(c) });

  it('pide una salida estructurada, con respaldo ante rechazos y las fotos antes del texto', async () => {
    const { cliente, llamadas } = clienteFalso({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"generales":[]}' } as Anthropic.Beta.BetaTextBlock] });
    const r = await extraer(pedir(cuerpo), env, cliente);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ extraccion: { generales: [] }, uso: { entrada: 1, salida: 2 } });
    const p = llamadas[0]!;
    expect(p).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect(p.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
    const contenido = (p.messages as { content: { type: string }[] }[])[0]!.content;
    expect(contenido.map((b) => b.type)).toEqual(['text', 'image', 'text', 'document', 'text']); // lo que no es imagen ni PDF se descarta
    expect(JSON.stringify(contenido.at(-1))).toContain('cerramiento:1');
  });

  it('rechazos, respuestas cortadas y peticiones no válidas', async () => {
    expect((await extraer(pedir(cuerpo), env, clienteFalso({ stop_reason: 'refusal', content: [] }).cliente)).status).toBe(422);
    expect((await extraer(pedir(cuerpo), env, clienteFalso({ stop_reason: 'max_tokens', content: [] }).cliente)).status).toBe(422);
    expect((await extraer(pedir({ ...cuerpo, transcripcion: '', fotos: [] }), env, clienteFalso({}).cliente)).status).toBe(400);
    expect((await extraer(pedir(cuerpo), { ...env, ANTHROPIC_API_KEY: undefined })).status).toBe(500);
  });
});
