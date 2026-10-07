-- ═══════════════════════════════════════════════════════════════════════════
--  07 · VISITAS GRABADAS Y CATÁLOGO DE CE3X
--  · catalogo_ce3x: «soluciones» de CE3X (cerramientos, ventanas, equipos…)
--    que el técnico aprende de sus propios proyectos .cex. Al generar el .cex
--    de un expediente se copian de aquí: así todo lo que llega a CE3X lo
--    escribió antes el propio CE3X. Solo envolvente e instalaciones: nunca
--    datos administrativos ni del cliente.
--  · visitas: el resultado de procesar una visita grabada (transcripción y
--    propuesta de datos). El audio y las fotos NO se guardan aquí: se quedan
--    en el dispositivo del técnico.
--  Se ejecuta en el Supabase del CRM, después de la 06.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.catalogo_ce3x (
  id           uuid primary key default gen_random_uuid(),
  tecnico_id   uuid not null default auth.uid() references public.tecnicos(user_id) on delete cascade,
  clave        text not null check (length(clave) <= 100),
  tipo         text not null check (tipo in ('cerramiento', 'hueco', 'instalacion', 'puente')),
  etiqueta     text not null check (length(etiqueta) <= 1000),
  ce3x         jsonb not null default '{}'::jsonb,
  datos        text not null check (length(datos) <= 500000),
  composicion  text check (length(composicion) <= 500000),
  origen       text not null check (length(origen) <= 300),
  creada_en    timestamptz not null default now(),
  unique (tecnico_id, clave)
);
alter table public.catalogo_ce3x enable row level security;
revoke all on public.catalogo_ce3x from public, anon, authenticated;
grant select, insert, delete on public.catalogo_ce3x to authenticated;
create policy catalogo_ce3x_titular on public.catalogo_ce3x
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid());

create table public.visitas (
  id             uuid primary key default gen_random_uuid(),
  expediente_id  uuid not null references public.expedientes(id) on delete cascade,
  tecnico_id     uuid not null default auth.uid() references public.tecnicos(user_id) on delete cascade,
  grabada_en     timestamptz not null,
  procesada_en   timestamptz not null default now(),
  duracion_s     integer check (duracion_s >= 0),
  fotos          integer not null default 0 check (fotos >= 0),
  transcripcion  text not null default '' check (length(transcripcion) <= 1000000),
  propuesta      jsonb not null,
  aplicada_en    timestamptz
);
create index visitas_expediente on public.visitas (expediente_id, procesada_en desc);
alter table public.visitas enable row level security;
revoke all on public.visitas from public, anon, authenticated;
grant select, insert, update, delete on public.visitas to authenticated;
create policy visitas_titular on public.visitas
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid()
              and exists (select 1 from public.expedientes x
                           where x.id = expediente_id and x.tecnico_id = auth.uid()));
