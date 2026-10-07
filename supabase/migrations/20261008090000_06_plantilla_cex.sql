-- ═══════════════════════════════════════════════════════════════════════════
--  06 · PLANTILLA DE CE3X Y DIRECCIÓN DEL CLIENTE
--  · plantillas_cex: el proyecto .cex VACÍO de cada técnico (con sus datos de
--    técnico), para generar el .cex de cada expediente sin elegirlo cada vez.
--  · encargos_certificado(): además devuelve la dirección del cliente (la de
--    facturación del CRM), para la pantalla «Datos del cliente» de CE3X.
--  Se ejecuta en el Supabase del CRM, después de la 05.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.plantillas_cex (
  tecnico_id uuid primary key default auth.uid() references public.tecnicos(user_id) on delete cascade,
  nombre     text not null check (length(nombre) <= 200),
  version    text not null check (length(version) <= 100),
  -- El fichero, en base64 (un proyecto vacío ocupa poco; límite generoso)
  contenido  text not null check (length(contenido) <= 20000000),
  subida_en  timestamptz not null default now()
);
alter table public.plantillas_cex enable row level security;
revoke all on public.plantillas_cex from public, anon, authenticated;
grant select, insert, update, delete on public.plantillas_cex to authenticated;
create policy plantillas_cex_titular on public.plantillas_cex
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid());

-- Misma función que en la 05, con la dirección del cliente en «cliente».
create or replace function public.encargos_certificado()
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
                            'email', c.email, 'telefono', c.telefono, 'provincia', c.provincia,
                            'direccion', c.direccion, 'codigo_postal', c.codigo_postal, 'ciudad', c.ciudad),
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

