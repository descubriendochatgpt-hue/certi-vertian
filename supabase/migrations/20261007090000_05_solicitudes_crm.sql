-- ═══════════════════════════════════════════════════════════════════════════
--  05 · SOLICITUDES QUE LLEGAN DEL CRM
--  El CRM de Vertian envía aquí los datos que el cliente ha rellenado en la
--  web (inmueble y propietario). Quedan en una bandeja: NO se crea ningún
--  expediente solo. El técnico abre la solicitud, revisa el formulario ya
--  relleno y lo guarda él (y entonces la solicitud se marca como importada).
--
--  Cómo entra el CRM sin tener una cuenta de técnico: llama a la función
--  recibir_solicitud_crm() con un SECRETO compartido. Aquí solo se guarda su
--  huella SHA-256 (no el secreto). Sin el secreto la función no hace nada, y
--  la función no devuelve ningún dato: el CRM puede escribir en la bandeja,
--  nunca leer.
--
--  Puesta en marcha (una vez), en el SQL Editor de Supabase:
--    select public.configurar_secreto_crm('EL-MISMO-SECRETO-QUE-EN-EL-CRM');
-- ═══════════════════════════════════════════════════════════════════════════

create table public.integracion_crm (
  id            int primary key default 1 check (id = 1),     -- una sola fila
  secreto_hash  text not null,
  configurado_en timestamptz not null default now()
);
alter table public.integracion_crm enable row level security;
revoke all on public.integracion_crm from public, anon, authenticated;

create type public.estado_solicitud as enum ('pendiente', 'importada', 'descartada');

create table public.solicitudes_crm (
  id             uuid primary key default gen_random_uuid(),
  -- Identificador del envío en el CRM (p. ej. «presupuesto:P-2026-014»).
  -- Si el CRM vuelve a enviar lo mismo, se actualiza en vez de duplicarse.
  referencia     text not null unique check (length(referencia) between 1 and 120),
  datos          jsonb not null,
  estado         public.estado_solicitud not null default 'pendiente',
  expediente_id  uuid references public.expedientes(id) on delete set null,
  recibida_en    timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  resuelta_en    timestamptz
);
create index solicitudes_crm_estado_idx on public.solicitudes_crm (estado, recibida_en desc);

-- ─────────────────────────── configuración (admin) ─────────────────────────

create function public.configurar_secreto_crm(p_secreto text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_secreto is null or length(p_secreto) < 32 then
    raise exception 'El secreto debe tener al menos 32 caracteres.';
  end if;
  insert into public.integracion_crm (id, secreto_hash) values (1, encode(sha256(convert_to(p_secreto, 'UTF8')), 'hex'))
  on conflict (id) do update set secreto_hash = excluded.secreto_hash, configurado_en = now();
  return 'Secreto guardado. Pon el mismo en el CRM (variable CERTI_SECRETO).';
end $$;
-- Solo desde el SQL Editor (rol postgres): ni la web ni el CRM pueden cambiarlo.
revoke all on function public.configurar_secreto_crm(text) from public, anon, authenticated;

-- ─────────────────────────── entrada desde el CRM ──────────────────────────

create function public.recibir_solicitud_crm(p_secreto text, p_referencia text, p_datos jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_estado public.estado_solicitud;
begin
  select secreto_hash into v_hash from public.integracion_crm where id = 1;
  if v_hash is null or p_secreto is null or length(p_secreto) < 32 or length(p_secreto) > 200
     or encode(sha256(convert_to(p_secreto, 'UTF8')), 'hex') <> v_hash then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_referencia is null or length(trim(p_referencia)) = 0 or length(p_referencia) > 120 then
    raise exception 'Falta la referencia del envío.';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or octet_length(p_datos::text) > 20000 then
    raise exception 'Los datos no son válidos o son demasiado grandes.';
  end if;

  select estado into v_estado from public.solicitudes_crm where referencia = p_referencia;
  if v_estado is null then
    insert into public.solicitudes_crm (referencia, datos) values (p_referencia, p_datos);
    return 'recibida';
  end if;
  -- Reenvío: se guardan los datos nuevos. Si ya se había importado o
  -- descartado, vuelve a la bandeja para que el técnico vea el cambio.
  update public.solicitudes_crm
     set datos = p_datos, actualizada_en = now(),
         estado = 'pendiente', resuelta_en = null
   where referencia = p_referencia;
  return 'actualizada';
end $$;
revoke all on function public.recibir_solicitud_crm(text, text, jsonb) from public;
grant execute on function public.recibir_solicitud_crm(text, text, jsonb) to anon, authenticated;

-- ─────────────────────────── bandeja del técnico ───────────────────────────

alter table public.solicitudes_crm enable row level security;
revoke all on public.solicitudes_crm from public, anon, authenticated;

-- El técnico lee la bandeja y solo puede cambiar el estado y el expediente
-- (no los datos que mandó el cliente).
grant select on public.solicitudes_crm to authenticated;
grant update (estado, expediente_id, resuelta_en) on public.solicitudes_crm to authenticated;
create policy solicitudes_crm_tecnico on public.solicitudes_crm
  for all to authenticated
  using      (public.es_tecnico_verificado())
  with check (public.es_tecnico_verificado()
              and (expediente_id is null
                   or exists (select 1 from public.expedientes x where x.id = expediente_id and x.tecnico_id = auth.uid())));
grant usage on type public.estado_solicitud to authenticated;
