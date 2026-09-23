-- ═══════════════════════════════════════════════════════════════════════════
--  02 · SEGURIDAD (RLS)
--  La web es estática y el navegador habla directamente con Supabase, así que
--  TODA la protección de los datos vive aquí. Para leer o escribir una fila
--  hace falta, a la vez:
--
--    1. haber iniciado sesión,
--    2. haber pasado la verificación en dos pasos (aal2),
--    3. estar dado de alta en la tabla `tecnicos`,
--    4. ser el titular de esa fila.
--
--  El rol `anon` (quien visita la web sin sesión) no tiene acceso a nada.
-- ═══════════════════════════════════════════════════════════════════════════

create function public.es_tecnico_verificado()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.tecnicos where user_id = auth.uid())
$$;

revoke all on function public.es_tecnico_verificado() from public;
grant execute on function public.es_tecnico_verificado() to authenticated;

alter table public.tecnicos          enable row level security;
alter table public.edificios         enable row level security;
alter table public.expedientes       enable row level security;
alter table public.historial_estados enable row level security;
alter table public.toma_datos        enable row level security;

revoke all on public.tecnicos, public.edificios, public.expedientes,
              public.historial_estados, public.toma_datos from anon, authenticated;

-- El técnico puede ver su propia ficha (para saber si está autorizado),
-- pero no darse de alta a sí mismo.
grant select on public.tecnicos to authenticated;
create policy tecnicos_propio on public.tecnicos
  for select to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.edificios to authenticated;
create policy edificios_titular on public.edificios
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid());

grant select, insert, update, delete on public.expedientes to authenticated;
create policy expedientes_titular on public.expedientes
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid());

-- El historial solo se lee: lo escriben los triggers y cambiar_estado().
-- Nadie puede reescribirlo ni borrarlo a mano.
grant select, insert on public.historial_estados to authenticated;
create policy historial_leer on public.historial_estados
  for select to authenticated
  using (public.es_tecnico_verificado() and tecnico_id = auth.uid());
create policy historial_anotar on public.historial_estados
  for insert to authenticated
  with check (
    public.es_tecnico_verificado() and tecnico_id = auth.uid()
    and (coalesce(current_setting('certi.cambio_estado', true), '') = 'si'
         or (estado_anterior is null and estado_nuevo = 'visita_pendiente'
             and exists (select 1 from public.expedientes x
                          where x.id = expediente_id and x.estado = 'visita_pendiente'
                            and not exists (select 1 from public.historial_estados h
                                             where h.expediente_id = x.id))))
  );

grant select, insert, update, delete on public.toma_datos to authenticated;
create policy toma_datos_titular on public.toma_datos
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid()
              and exists (select 1 from public.expedientes x
                           where x.id = expediente_id and x.tecnico_id = auth.uid()));

grant usage on type public.estado_expediente, public.tipo_edificio to authenticated;

revoke all on function public.cambiar_estado(uuid, public.estado_expediente, text, date, char, char, text) from public, anon;
grant execute on function public.cambiar_estado(uuid, public.estado_expediente, text, date, char, char, text) to authenticated;

-- Las funciones de los triggers no se llaman desde fuera.
revoke all on function public.tg_expediente_codigo(), public.tg_expediente_guardia(),
                       public.tg_expediente_historial_inicial(), public.tg_toma_datos_guardia()
  from public, anon, authenticated;

-- Un expediente solo se puede borrar mientras está en «Visita pendiente».
-- Uno con certificado firmado o registrado no desaparece por un clic.
create policy expedientes_borrar_solo_pendientes on public.expedientes
  as restrictive for delete to authenticated
  using (estado = 'visita_pendiente');
