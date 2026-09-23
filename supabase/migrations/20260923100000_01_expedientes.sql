-- ═══════════════════════════════════════════════════════════════════════════
--  01 · EXPEDIENTES Y TOMA DE DATOS
--  Módulos 1 y 2. Un expediente por inmueble, su historial de estados y los
--  datos tomados en la visita.
--
--  Regla de oro: el estado de un expediente SOLO cambia a través de la
--  función cambiar_estado(), que exige una acción explícita del técnico y
--  deja rastro en historial_estados. Un UPDATE directo del estado se rechaza.
-- ═══════════════════════════════════════════════════════════════════════════

-- Técnicos autorizados a usar la aplicación. Se da de alta a mano desde el
-- editor SQL de Supabase (ver README). Aunque alguien consiguiera crearse
-- una cuenta, sin estar en esta tabla no ve ni puede crear nada.
create table public.tecnicos (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nombre    text,
  creado_en timestamptz not null default now()
);

create type public.estado_expediente as enum (
  'visita_pendiente',
  'datos_introducidos',
  'calculo_revisado',
  'certificado_firmado',
  'registrado'
);

create type public.tipo_edificio as enum (
  'vivienda_unifamiliar',
  'vivienda_en_bloque',       -- una vivienda dentro de un edificio
  'bloque_viviendas',         -- el edificio de viviendas completo
  'local_terciario',
  'edificio_terciario'
);

-- Datos comunes de un edificio (envolvente, instalaciones centralizadas),
-- para certificar varias viviendas sin repetir la toma de datos. Se usará
-- de lleno en el módulo 3; se crea ya para que los expedientes puedan
-- enlazarse desde el principio.
create table public.edificios (
  id                   uuid primary key default gen_random_uuid(),
  tecnico_id           uuid not null default auth.uid() references public.tecnicos(user_id),
  nombre               text not null,
  direccion            text not null,
  municipio            text not null,
  referencia_catastral text,
  datos_comunes        jsonb not null default '{}'::jsonb,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);

create table public.expedientes (
  id                     uuid primary key default gen_random_uuid(),
  tecnico_id             uuid not null default auth.uid() references public.tecnicos(user_id),
  codigo                 text not null,                 -- 2026-001, lo pone el trigger
  edificio_id            uuid references public.edificios(id) on delete set null,

  -- Inmueble
  direccion              text not null check (length(trim(direccion)) > 0),
  municipio              text not null check (length(trim(municipio)) > 0),
  codigo_postal          text,
  provincia              text not null default 'Asturias',
  referencia_catastral   text,
  tipo_edificio          public.tipo_edificio not null,
  superficie_util        numeric(10,2) check (superficie_util is null or superficie_util > 0),
  anio_construccion      int check (anio_construccion is null or anio_construccion between 1500 and 2100),

  -- Propietario / promotor
  propietario_nombre     text not null check (length(trim(propietario_nombre)) > 0),
  propietario_nif        text,
  propietario_telefono   text,
  propietario_email      text,

  -- Seguimiento
  fecha_visita           date,
  estado                 public.estado_expediente not null default 'visita_pendiente',
  calificacion_consumo   char(1) check (calificacion_consumo   in ('A','B','C','D','E','F','G')),
  calificacion_emisiones char(1) check (calificacion_emisiones in ('A','B','C','D','E','F','G')),
  fecha_firma            date,
  fecha_registro         date,
  numero_registro        text,

  -- RD 390/2021, art. 13: validez máxima de 10 años, 5 si la calificación
  -- es G. Se toma la G en cualquiera de las dos letras (criterio prudente).
  fecha_vencimiento      date generated always as (
    case
      when fecha_firma is null then null
      when calificacion_consumo = 'G' or calificacion_emisiones = 'G'
        then (fecha_firma + interval '5 years')::date
      else (fecha_firma + interval '10 years')::date
    end
  ) stored,

  -- Avisos de validación (NIF, ref. catastral…) que el técnico ha revisado
  -- y confirmado como correctos. Nunca se corrige un dato por su cuenta.
  avisos_confirmados     jsonb not null default '[]'::jsonb,
  notas                  text,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  unique (tecnico_id, codigo)
);

create index expedientes_estado_idx      on public.expedientes (tecnico_id, estado);
create index expedientes_municipio_idx   on public.expedientes (tecnico_id, municipio);
create index expedientes_vencimiento_idx on public.expedientes (tecnico_id, fecha_vencimiento);

create table public.historial_estados (
  id              bigint generated always as identity primary key,
  expediente_id   uuid not null references public.expedientes(id) on delete cascade,
  tecnico_id      uuid not null default auth.uid() references public.tecnicos(user_id),
  estado_anterior public.estado_expediente,
  estado_nuevo    public.estado_expediente not null,
  nota            text,
  creado_en       timestamptz not null default now()
);
create index historial_expediente_idx on public.historial_estados (expediente_id, creado_en);

-- Toma de datos de la visita. Los datos van en JSON (envolvente, huecos,
-- instalaciones…) porque son listas de longitud variable que se rellenan
-- poco a poco desde el móvil; la estructura la define src/lib/tomaDatos.ts.
create table public.toma_datos (
  expediente_id      uuid primary key references public.expedientes(id) on delete cascade,
  tecnico_id         uuid not null default auth.uid() references public.tecnicos(user_id),
  version_esquema    int  not null default 1,
  datos              jsonb not null default '{}'::jsonb,
  avisos_confirmados jsonb not null default '[]'::jsonb,
  verificado_en      timestamptz,     -- lo pone cambiar_estado(), no el formulario
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);

-- ─────────────────────────── orden de los estados ──────────────────────────

create function public.orden_estado(e public.estado_expediente)
returns int language sql immutable as $$
  select array_position(enum_range(null::public.estado_expediente), e)
$$;

-- ─────────────────────────── código correlativo ────────────────────────────

create function public.tg_expediente_codigo()
returns trigger language plpgsql as $$
declare
  v_anio text := to_char(now(), 'YYYY');
  v_n    int;
begin
  if new.codigo is null or new.codigo = '' then
    -- Un bloqueo por técnico y año evita dos códigos iguales si se dan de
    -- alta dos expedientes a la vez (por ejemplo, desde el móvil y el PC).
    perform pg_advisory_xact_lock(hashtext(new.tecnico_id::text || v_anio));
    select coalesce(max(split_part(codigo, '-', 2)::int), 0) + 1 into v_n
      from public.expedientes
     where tecnico_id = new.tecnico_id and codigo like v_anio || '-%'
       and split_part(codigo, '-', 2) ~ '^\d+$';
    new.codigo := v_anio || '-' || lpad(v_n::text, 3, '0');
  end if;
  return new;
end $$;

create trigger expediente_codigo before insert on public.expedientes
  for each row execute function public.tg_expediente_codigo();

-- ──────────────── guardia: el estado no se toca por la puerta de atrás ─────

create function public.tg_expediente_guardia()
returns trigger language plpgsql as $$
declare
  v_por_funcion boolean := coalesce(current_setting('certi.cambio_estado', true), '') = 'si';
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'visita_pendiente'
       or new.fecha_firma is not null or new.fecha_registro is not null
       or new.numero_registro is not null
       or new.calificacion_consumo is not null or new.calificacion_emisiones is not null then
      raise exception 'Un expediente nuevo empieza siempre en «Visita pendiente», sin firma ni registro.';
    end if;
    return new;
  end if;

  if not v_por_funcion and (
       new.estado                 is distinct from old.estado
    or new.fecha_firma            is distinct from old.fecha_firma
    or new.fecha_registro         is distinct from old.fecha_registro
    or new.numero_registro        is distinct from old.numero_registro
    or new.calificacion_consumo   is distinct from old.calificacion_consumo
    or new.calificacion_emisiones is distinct from old.calificacion_emisiones) then
    raise exception 'El estado, la firma, la calificación y el registro solo cambian con una confirmación explícita del técnico (cambiar_estado).';
  end if;

  if new.tecnico_id is distinct from old.tecnico_id or new.codigo is distinct from old.codigo then
    raise exception 'El código y el titular de un expediente no se pueden cambiar.';
  end if;

  new.actualizado_en := now();
  return new;
end $$;

create trigger expediente_guardia before insert or update on public.expedientes
  for each row execute function public.tg_expediente_guardia();

create function public.tg_expediente_historial_inicial()
returns trigger language plpgsql as $$
begin
  insert into public.historial_estados (expediente_id, tecnico_id, estado_anterior, estado_nuevo, nota)
  values (new.id, new.tecnico_id, null, new.estado, 'Alta del expediente');
  return new;
end $$;

create trigger expediente_historial_inicial after insert on public.expedientes
  for each row execute function public.tg_expediente_historial_inicial();

-- ───────────── guardia: la toma de datos se congela tras la verificación ───
-- Mientras el expediente está en «Visita pendiente» los datos se editan con
-- libertad (borrador). Al verificarlos y pasar a «Datos introducidos» quedan
-- congelados: para corregirlos, el técnico tiene que devolver antes el
-- expediente a «Visita pendiente», con una nota. Así nunca hay un cálculo
-- revisado sobre unos datos que han cambiado después.

create function public.tg_toma_datos_guardia()
returns trigger language plpgsql as $$
declare
  v_estado      public.estado_expediente;
  v_por_funcion boolean := coalesce(current_setting('certi.cambio_estado', true), '') = 'si';
begin
  select estado into v_estado from public.expedientes where id = new.expediente_id;

  if not v_por_funcion then
    if v_estado <> 'visita_pendiente' then
      raise exception 'Los datos de la visita ya están verificados. Para modificarlos, devuelve primero el expediente a «Visita pendiente».';
    end if;
    if tg_op = 'INSERT' then
      new.verificado_en := null;
    elsif new.verificado_en is distinct from old.verificado_en then
      raise exception 'La verificación de los datos solo se registra al confirmar el paso a «Datos introducidos».';
    end if;
  end if;

  new.actualizado_en := now();
  return new;
end $$;

create trigger toma_datos_guardia before insert or update on public.toma_datos
  for each row execute function public.tg_toma_datos_guardia();

-- ─────────────────────────────── cambiar_estado ────────────────────────────
-- Avanza un paso o retrocede un paso. Nunca salta estados. Se ejecuta con
-- los permisos de quien llama (security invoker): las políticas RLS siguen
-- aplicándose, así que nadie puede cambiar un expediente que no es suyo.

create function public.cambiar_estado(
  p_expediente             uuid,
  p_destino                public.estado_expediente,
  p_nota                   text    default null,
  p_fecha                  date    default null,  -- fecha de firma o de registro
  p_calificacion_consumo   char(1) default null,
  p_calificacion_emisiones char(1) default null,
  p_numero_registro        text    default null
) returns public.expedientes
language plpgsql security invoker set search_path = public as $$
declare
  e        public.expedientes;
  v_origen public.estado_expediente;
  v_paso   int;
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
        null;  -- el módulo 4 exigirá aquí el resultado del cálculo

      when 'certificado_firmado' then
        if p_fecha is null or p_calificacion_consumo is null or p_calificacion_emisiones is null then
          raise exception 'Para marcar el certificado como firmado hacen falta la fecha de firma y las dos calificaciones.';
        end if;
        if p_fecha > current_date then
          raise exception 'La fecha de firma (%) es posterior a hoy.', p_fecha;
        end if;
        if e.fecha_visita is not null and p_fecha < e.fecha_visita then
          raise exception 'La fecha de firma (%) es anterior a la de la visita (%).', p_fecha, e.fecha_visita;
        end if;
        update expedientes
           set fecha_firma = p_fecha,
               calificacion_consumo = upper(p_calificacion_consumo),
               calificacion_emisiones = upper(p_calificacion_emisiones)
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
    -- Al retroceder se deshace lo que añadió el estado del que se sale.
    case e.estado
      when 'datos_introducidos' then
        update toma_datos set verificado_en = null where expediente_id = e.id;
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
