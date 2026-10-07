-- ═══════════════════════════════════════════════════════════════════════════
--  05 · ENCARGOS DEL CRM (una sola base de datos)
--  CertiVertian vive en el MISMO Supabase que el CRM de Vertian. Aquí no se
--  copia nada: la app lee los encargos de certificado del CRM (pedidos y
--  presupuestos con datos del inmueble) a través de una función de solo
--  lectura, y cada expediente guarda a qué pedido o presupuesto corresponde.
--
--  Seguridad:
--    · encargos_certificado() solo responde a un técnico verificado (sesión
--      con 2FA y alta en «tecnicos»), devuelve solo los campos necesarios y
--      no permite modificar nada del CRM.
--    · Las políticas del CRM no cambian: sus empleados siguen sin ver nada
--      de CertiVertian, y CertiVertian no puede escribir en el CRM.
--
--  Requisito: ejecutar DESPUÉS de las migraciones del CRM (necesita sus
--  tablas clientes, pedidos, presupuestos, citas y lineas_negocio).
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.pedidos') is null or to_regclass('public.presupuestos') is null
     or to_regclass('public.clientes') is null or to_regclass('public.citas') is null
     or to_regclass('public.lineas_negocio') is null then
    raise exception 'Esta migración se ejecuta en el Supabase del CRM, después de sus migraciones (faltan sus tablas).';
  end if;
end $$;

-- ─────────────────────────── enlace expediente ↔ CRM ───────────────────────
-- Si el CRM borra el pedido o el presupuesto (p. ej. al ejercer el cliente su
-- derecho de supresión), el expediente se queda, sin el enlace.

alter table public.expedientes
  add column crm_pedido_id      uuid references public.pedidos(id)      on delete set null,
  add column crm_presupuesto_id uuid references public.presupuestos(id) on delete set null;
create index expedientes_crm_pedido_idx      on public.expedientes (crm_pedido_id)      where crm_pedido_id is not null;
create index expedientes_crm_presupuesto_idx on public.expedientes (crm_presupuesto_id) where crm_presupuesto_id is not null;

-- Encargos que el técnico ha quitado de su bandeja (no se borra nada del CRM).
create table public.encargos_descartados (
  tecnico_id    uuid not null default auth.uid() references public.tecnicos(user_id) on delete cascade,
  origen        text not null check (origen in ('pedido', 'presupuesto')),
  crm_id        uuid not null,
  descartado_en timestamptz not null default now(),
  primary key (tecnico_id, origen, crm_id)
);
alter table public.encargos_descartados enable row level security;
revoke all on public.encargos_descartados from public, anon, authenticated;
grant select, insert, delete on public.encargos_descartados to authenticated;
create policy encargos_descartados_titular on public.encargos_descartados
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid());

-- ─────────────────────────── lectura de los encargos ───────────────────────
-- Un encargo es:
--   · un presupuesto de certificados con el inmueble rellenado (o que viene de
--     un pedido con inmueble); si viene de un pedido, sustituye a ese pedido;
--   · un pedido de certificados con dirección del inmueble que aún no tiene un
--     presupuesto así.
-- Devuelve los datos tal cual están en el CRM; la app los interpreta
-- (src/lib/encargosCrm.ts) y el técnico los revisa antes de guardarlos.

create function public.encargos_certificado()
returns table (
  origen          text,          -- 'pedido' | 'presupuesto'
  crm_id          uuid,
  pedido_id       uuid,
  presupuesto_id  uuid,
  numero          text,          -- número del presupuesto
  servicio        text,
  recibido_en     timestamptz,
  actualizado_en  timestamptz,
  estado_crm      text,
  cliente_id      uuid,
  cliente         jsonb,         -- nombre, razon_social, nif, email, telefono, provincia
  inmueble        jsonb,         -- el del presupuesto (estructurado) o null
  datos_pedido    jsonb,         -- los campos del formulario de pedido o null
  mensaje         text,
  visita          timestamptz,   -- visita confirmada más reciente
  expediente_id   uuid,          -- expediente de este técnico ya enlazado
  descartado      boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_tecnico_verificado() then
    raise exception 'No tienes permiso para ver los encargos del CRM.' using errcode = '42501';
  end if;

  return query
  with cert as (
    select id from public.lineas_negocio where slug = 'certificaciones'
  ),
  pres as (
    select p.*
      from public.presupuestos p
     where (p.linea_negocio_id is null or p.linea_negocio_id in (select id from cert))
       and p.estado <> 'rechazado'
       and ((p.inmueble is not null and not (p.inmueble ? 'clase'))
            or exists (select 1 from public.pedidos pe where pe.id = p.pedido_id and pe.datos ? 'Dirección del inmueble'))
  ),
  filas as (
    select 'presupuesto'::text as origen, p.id as crm_id, p.pedido_id, p.id as presupuesto_id, p.numero, p.titulo as servicio,
           p.created_at as recibido_en, greatest(p.updated_at, pe.created_at) as actualizado_en, p.estado as estado_crm,
           p.cliente_id, case when p.inmueble ? 'clase' then null else p.inmueble end as inmueble,
           pe.datos as datos_pedido, pe.mensaje
      from pres p
      left join public.pedidos pe on pe.id = p.pedido_id
    union all
    select 'pedido', pe.id, pe.id, null, null, pe.servicio,
           pe.created_at, pe.created_at, pe.estado,
           pe.cliente_id, null, pe.datos, pe.mensaje
      from public.pedidos pe
     where pe.linea_negocio_id in (select id from cert)
       and pe.datos ? 'Dirección del inmueble'
       and not exists (select 1 from pres p where p.pedido_id = pe.id)
  )
  select f.origen, f.crm_id, f.pedido_id, f.presupuesto_id, f.numero, f.servicio, f.recibido_en,
         greatest(f.actualizado_en, v.updated_at), f.estado_crm, f.cliente_id,
         jsonb_build_object('nombre', c.nombre, 'razon_social', c.razon_social, 'nif', c.nif,
                            'email', c.email, 'telefono', c.telefono, 'provincia', c.provincia),
         f.inmueble, f.datos_pedido, f.mensaje, v.inicio,
         (select x.id from public.expedientes x
           where x.tecnico_id = auth.uid()
             and (x.crm_presupuesto_id = f.presupuesto_id or x.crm_pedido_id = f.pedido_id)
           order by x.creado_en limit 1),
         exists (select 1 from public.encargos_descartados d
                  where d.tecnico_id = auth.uid() and d.origen = f.origen and d.crm_id = f.crm_id)
    from filas f
    join public.clientes c on c.id = f.cliente_id
    left join lateral (
      select ci.inicio, ci.updated_at from public.citas ci
       where ci.estado = 'confirmada'
         and (ci.presupuesto_id = f.presupuesto_id or ci.pedido_id = f.pedido_id)
       order by ci.updated_at desc limit 1
    ) v on true
   order by f.recibido_en desc
   limit 500;
end $$;

revoke all on function public.encargos_certificado() from public, anon;
grant execute on function public.encargos_certificado() to authenticated;
