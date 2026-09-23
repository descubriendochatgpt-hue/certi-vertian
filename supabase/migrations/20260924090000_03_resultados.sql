-- ═══════════════════════════════════════════════════════════════════════════
--  03 · RESULTADOS, CHECKLIST DE REVISIÓN Y ADJUNTOS (módulo 4)
--
--  · resultados: lo que dio el cálculo en el programa oficial (CE3X…), ya
--    sea importado del certificado o tecleado. Se edita solo en «Datos
--    introducidos»; al confirmarlo se pasa a «Cálculo revisado» y se congela.
--  · checklist_revision: la revisión previa a la firma. Cada punto se marca
--    a mano; sin todos marcados no se puede pasar a «Certificado firmado».
--  · adjuntos: ficheros del expediente (.cex, PDF, XML…) en el almacén
--    privado de Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────── resultados ─────────────────────────────────

create table public.resultados (
  expediente_id                      uuid primary key references public.expedientes(id) on delete cascade,
  tecnico_id                         uuid not null default auth.uid() references public.tecnicos(user_id),

  origen                             text not null default 'manual' check (origen in ('manual', 'pdf', 'xml')),
  fichero_origen                     text,          -- nombre del fichero importado, si lo hay
  programa                           text,          -- p. ej. «CEXv2.3»
  fecha_certificado                  date,

  consumo_ep_nr                      numeric(10,2) check (consumo_ep_nr is null or consumo_ep_nr >= 0),  -- kWh/m²·año
  calificacion_consumo               char(1) check (calificacion_consumo in ('A','B','C','D','E','F','G')),
  emisiones_co2                      numeric(10,2) check (emisiones_co2 is null or emisiones_co2 >= 0),  -- kgCO2/m²·año
  calificacion_emisiones             char(1) check (calificacion_emisiones in ('A','B','C','D','E','F','G')),
  demanda_calefaccion                numeric(10,2) check (demanda_calefaccion is null or demanda_calefaccion >= 0),
  calificacion_demanda_calefaccion   char(1) check (calificacion_demanda_calefaccion in ('A','B','C','D','E','F','G')),
  demanda_refrigeracion              numeric(10,2) check (demanda_refrigeracion is null or demanda_refrigeracion >= 0),
  calificacion_demanda_refrigeracion char(1) check (calificacion_demanda_refrigeracion in ('A','B','C','D','E','F','G')),

  -- Indicadores parciales y datos identificativos leídos del certificado
  -- (referencia catastral, fechas, superficie…), para el checklist.
  detalle                            jsonb not null default '{}'::jsonb,
  -- [{ id, descripcion, calificacion_consumo, calificacion_emisiones, ahorro }]
  recomendaciones                    jsonb not null default '[]'::jsonb,
  -- RD 390/2021: si no hay medidas técnica o económicamente viables, se justifica.
  justificacion_sin_recomendaciones  text,
  avisos_confirmados                 jsonb not null default '[]'::jsonb,

  confirmado_en                      timestamptz,   -- lo pone cambiar_estado()
  creado_en                          timestamptz not null default now(),
  actualizado_en                     timestamptz not null default now()
);

create function public.tg_resultados_guardia()
returns trigger language plpgsql as $$
declare
  v_estado      public.estado_expediente;
  v_por_funcion boolean := coalesce(current_setting('certi.cambio_estado', true), '') = 'si';
begin
  select estado into v_estado from public.expedientes where id = coalesce(new.expediente_id, old.expediente_id);
  if not v_por_funcion then
    if v_estado <> 'datos_introducidos' then
      raise exception 'Los resultados solo se pueden modificar con el expediente en «Datos introducidos».';
    end if;
    if tg_op = 'INSERT' then
      new.confirmado_en := null;
    elsif tg_op = 'UPDATE' and new.confirmado_en is distinct from old.confirmado_en then
      raise exception 'La confirmación de los resultados solo se registra al pasar a «Cálculo revisado».';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.actualizado_en := now();
  return new;
end $$;

create trigger resultados_guardia before insert or update or delete on public.resultados
  for each row execute function public.tg_resultados_guardia();

-- ─────────────────────────── checklist de revisión ──────────────────────────

-- La lista de puntos vive aquí para que la base de datos pueda exigir que
-- estén todos marcados. La app muestra estos mismos textos.
create table public.checklist_items (
  clave text primary key,
  orden int  not null unique,
  texto text not null
);

insert into public.checklist_items (clave, orden, texto) values
  ('ref_catastral',            1, 'La referencia catastral del certificado coincide con la del inmueble.'),
  ('direccion',                2, 'La dirección, el municipio y el código postal del certificado son correctos.'),
  ('tipo_edificio',            3, 'El tipo de edificio o parte que se certifica es correcto.'),
  ('superficie',               4, 'La superficie habitable del certificado coincide con la medida en la visita.'),
  ('envolvente_instalaciones', 5, 'Los cerramientos, huecos e instalaciones del Anexo I coinciden con la toma de datos.'),
  ('fecha_visita',             6, 'La fecha de visita del Anexo IV coincide con la de la visita realizada.'),
  ('fecha_certificado',        7, 'La fecha del certificado es igual o posterior a la de la visita.'),
  ('calificacion',             8, 'Las calificaciones y valores del certificado coinciden con los resultados registrados.'),
  ('recomendaciones',          9, 'El certificado incluye recomendaciones de mejora (o la justificación de que no hay medidas viables).'),
  ('fichero_calculo',         10, 'El archivo de cálculo del programa oficial (.cex u otro) está adjunto al expediente.'),
  ('certificado_pdf',         11, 'El PDF del certificado está adjunto al expediente.'),
  ('datos_tecnico',           12, 'Los datos del técnico certificador (nombre, NIF, titulación) son correctos.');

create table public.checklist_revision (
  expediente_id uuid not null references public.expedientes(id) on delete cascade,
  clave         text not null references public.checklist_items(clave),
  tecnico_id    uuid not null default auth.uid() references public.tecnicos(user_id),
  nota          text,
  marcado_en    timestamptz not null default now(),
  primary key (expediente_id, clave)
);

create function public.tg_checklist_guardia()
returns trigger language plpgsql as $$
declare
  v_estado      public.estado_expediente;
  v_por_funcion boolean := coalesce(current_setting('certi.cambio_estado', true), '') = 'si';
begin
  select estado into v_estado from public.expedientes where id = coalesce(new.expediente_id, old.expediente_id);
  if not v_por_funcion and v_estado <> 'calculo_revisado' then
    raise exception 'El checklist solo se puede modificar con el expediente en «Cálculo revisado».';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- La fecha de marcado la pone siempre la base de datos.
  new.marcado_en := now();
  return new;
end $$;

create trigger checklist_guardia before insert or update or delete on public.checklist_revision
  for each row execute function public.tg_checklist_guardia();

-- ─────────────────────────────── adjuntos ───────────────────────────────────

create table public.adjuntos (
  id            uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references public.expedientes(id) on delete cascade,
  tecnico_id    uuid not null default auth.uid() references public.tecnicos(user_id),
  tipo          text not null check (tipo in ('fichero_calculo', 'certificado_pdf', 'certificado_xml',
                                              'certificado_firmado', 'informe_conformidad', 'foto', 'otro')),
  nombre        text not null,
  ruta          text not null unique,   -- ruta en el almacén: <técnico>/<expediente>/<id>-<nombre>
  tamano        bigint not null check (tamano >= 0),
  tipo_mime     text,
  sha256        text,                   -- huella del fichero, para comprobar después que no ha cambiado
  subido_en     timestamptz not null default now()
);
create index adjuntos_expediente_idx on public.adjuntos (expediente_id, subido_en);

-- ──────────────────────── almacén de ficheros (Storage) ─────────────────────
-- Cubo privado. Cada fichero va en <técnico>/<expediente>/…; las políticas
-- exigen lo mismo que para las tablas: sesión, 2FA y ser el titular.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 26214400)   -- 25 MB por fichero
on conflict (id) do nothing;

create policy documentos_leer on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and public.es_tecnico_verificado()
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy documentos_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and public.es_tecnico_verificado()
              and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.expedientes x
                           where x.id::text = (storage.foldername(name))[2] and x.tecnico_id = auth.uid()));

create policy documentos_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos' and public.es_tecnico_verificado()
         and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from public.expedientes x
                          where x.id::text = (storage.foldername(name))[2] and x.estado = 'registrado'));

-- ─────────────────────────────── RLS de tablas ──────────────────────────────

alter table public.resultados         enable row level security;
alter table public.checklist_items    enable row level security;
alter table public.checklist_revision enable row level security;
alter table public.adjuntos           enable row level security;

revoke all on public.resultados, public.checklist_items, public.checklist_revision, public.adjuntos
  from anon, authenticated;

grant select, insert, update, delete on public.resultados to authenticated;
create policy resultados_titular on public.resultados
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid()
              and exists (select 1 from public.expedientes x where x.id = expediente_id and x.tecnico_id = auth.uid()));

grant select on public.checklist_items to authenticated;
create policy checklist_items_leer on public.checklist_items
  for select to authenticated using (public.es_tecnico_verificado());

grant select, insert, update, delete on public.checklist_revision to authenticated;
create policy checklist_titular on public.checklist_revision
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid()
              and exists (select 1 from public.expedientes x where x.id = expediente_id and x.tecnico_id = auth.uid()));

grant select, insert, delete on public.adjuntos to authenticated;
create policy adjuntos_titular on public.adjuntos
  for all to authenticated
  using      (public.es_tecnico_verificado() and tecnico_id = auth.uid())
  with check (public.es_tecnico_verificado() and tecnico_id = auth.uid()
              and ruta like auth.uid()::text || '/' || expediente_id::text || '/%'
              and exists (select 1 from public.expedientes x where x.id = expediente_id and x.tecnico_id = auth.uid()));
-- Los ficheros de un expediente registrado ya no se borran.
create policy adjuntos_no_borrar_registrados on public.adjuntos
  as restrictive for delete to authenticated
  using (not exists (select 1 from public.expedientes x where x.id = expediente_id and x.estado = 'registrado'));

revoke all on function public.tg_resultados_guardia(), public.tg_checklist_guardia() from public, anon, authenticated;

-- ─────────────────────── cambiar_estado, con el módulo 4 ────────────────────
-- Igual que antes, más:
--   · → «Cálculo revisado»: exige resultados con las dos calificaciones y
--     sus valores; los congela.
--   · → «Certificado firmado»: exige el checklist completo. Las
--     calificaciones se toman de los resultados; si se pasan, deben coincidir.
--   · ← desde «Cálculo revisado»: descongela los resultados y borra las
--     marcas del checklist (hay que volver a revisarlo).

create or replace function public.cambiar_estado(
  p_expediente             uuid,
  p_destino                public.estado_expediente,
  p_nota                   text    default null,
  p_fecha                  date    default null,
  p_calificacion_consumo   char(1) default null,
  p_calificacion_emisiones char(1) default null,
  p_numero_registro        text    default null
) returns public.expedientes
language plpgsql security invoker set search_path = public as $$
declare
  e          public.expedientes;
  r          public.resultados;
  v_origen   public.estado_expediente;
  v_paso     int;
  v_faltan   int;
begin
  select * into e from public.expedientes where id = p_expediente for update;
  if not found then
    raise exception 'Expediente no encontrado.';
  end if;

  v_origen := e.estado;
  v_paso := orden_estado(p_destino) - orden_estado(e.estado);
  if v_paso not in (1, -1) then
    raise exception 'Solo se puede avanzar o retroceder un estado cada vez (de «%» a «%» no).', e.estado, p_destino;
  end if;

  if v_paso = -1 and coalesce(trim(p_nota), '') = '' then
    raise exception 'Para devolver un expediente a un estado anterior hay que indicar el motivo.';
  end if;

  perform set_config('certi.cambio_estado', 'si', true);

  if v_paso = 1 then
    case p_destino
      when 'datos_introducidos' then
        if e.fecha_visita is null then
          raise exception 'Falta la fecha de la visita técnica.';
        end if;
        if e.fecha_visita > current_date then
          raise exception 'La fecha de la visita (%) es posterior a hoy.', e.fecha_visita;
        end if;
        if not exists (select 1 from toma_datos where expediente_id = e.id) then
          raise exception 'No hay datos de la visita guardados para este expediente.';
        end if;
        update toma_datos set verificado_en = now() where expediente_id = e.id;

      when 'calculo_revisado' then
        select * into r from resultados where expediente_id = e.id;
        if not found then
          raise exception 'Todavía no se han registrado los resultados del cálculo.';
        end if;
        if r.calificacion_consumo is null or r.calificacion_emisiones is null
           or r.consumo_ep_nr is null or r.emisiones_co2 is null then
          raise exception 'Faltan las calificaciones o los valores de consumo y emisiones en los resultados.';
        end if;
        update resultados set confirmado_en = now() where expediente_id = e.id;

      when 'certificado_firmado' then
        select * into r from resultados where expediente_id = e.id;
        select count(*) into v_faltan
          from checklist_items i
         where not exists (select 1 from checklist_revision c where c.expediente_id = e.id and c.clave = i.clave);
        if v_faltan > 0 then
          raise exception 'Faltan % punto(s) del checklist de revisión por marcar.', v_faltan;
        end if;
        if p_fecha is null then
          raise exception 'Falta la fecha de firma.';
        end if;
        if (p_calificacion_consumo is not null and upper(p_calificacion_consumo) <> r.calificacion_consumo)
           or (p_calificacion_emisiones is not null and upper(p_calificacion_emisiones) <> r.calificacion_emisiones) then
          raise exception 'Las calificaciones indicadas no coinciden con los resultados registrados (% / %).',
            r.calificacion_consumo, r.calificacion_emisiones;
        end if;
        if p_fecha > current_date then
          raise exception 'La fecha de firma (%) es posterior a hoy.', p_fecha;
        end if;
        if e.fecha_visita is not null and p_fecha < e.fecha_visita then
          raise exception 'La fecha de firma (%) es anterior a la de la visita (%).', p_fecha, e.fecha_visita;
        end if;
        update expedientes
           set fecha_firma = p_fecha,
               calificacion_consumo = r.calificacion_consumo,
               calificacion_emisiones = r.calificacion_emisiones
         where id = e.id;

      when 'registrado' then
        if p_fecha is null then
          raise exception 'Falta la fecha de registro en la sede electrónica.';
        end if;
        if p_fecha < e.fecha_firma then
          raise exception 'La fecha de registro (%) es anterior a la de firma (%).', p_fecha, e.fecha_firma;
        end if;
        if p_fecha > current_date then
          raise exception 'La fecha de registro (%) es posterior a hoy.', p_fecha;
        end if;
        update expedientes
           set fecha_registro = p_fecha, numero_registro = nullif(trim(p_numero_registro), '')
         where id = e.id;
      else
        null;
    end case;
  else
    case e.estado
      when 'datos_introducidos' then
        update toma_datos set verificado_en = null where expediente_id = e.id;
      when 'calculo_revisado' then
        update resultados set confirmado_en = null where expediente_id = e.id;
        delete from checklist_revision where expediente_id = e.id;
      when 'certificado_firmado' then
        update expedientes
           set fecha_firma = null, calificacion_consumo = null, calificacion_emisiones = null
         where id = e.id;
      when 'registrado' then
        update expedientes set fecha_registro = null, numero_registro = null where id = e.id;
      else
        null;
    end case;
  end if;

  update expedientes set estado = p_destino where id = e.id returning * into e;

  insert into historial_estados (expediente_id, tecnico_id, estado_anterior, estado_nuevo, nota)
  values (e.id, e.tecnico_id, v_origen, p_destino, nullif(trim(p_nota), ''));

  perform set_config('certi.cambio_estado', '', true);
  return e;
end $$;
