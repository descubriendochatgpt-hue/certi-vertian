-- Pruebas de la bandeja de solicitudes que llegan del CRM.
\set ON_ERROR_STOP 1

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'tecnico@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'intruso@ejemplo.es');
insert into public.tecnicos (user_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Técnico');

create function pg_temp.como(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal)::text, false);
$$;
create function pg_temp.falla(p_sql text, p_texto text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'Debía fallar y no falló: %', p_sql;
exception when others then
  if sqlerrm like 'Debía fallar%' then raise; end if;
  if position(lower(p_texto) in lower(sqlerrm)) = 0 then
    raise exception 'Falló, pero con otro mensaje. Esperado «%», recibido «%»', p_texto, sqlerrm;
  end if;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ── sin secreto configurado, nadie entra ─────────────────────────────────
set role anon;
select pg_temp.falla($$select recibir_solicitud_crm(repeat('x', 40), 'p:1', '{}')$$, 'No autorizado');
select pg_temp.falla($$select configurar_secreto_crm(repeat('x', 40))$$, 'permission denied');
reset role;

-- El administrador configura el secreto desde el SQL Editor
select pg_temp.falla($$select configurar_secreto_crm('corto')$$, '32 caracteres');
select configurar_secreto_crm('secreto-de-prueba-con-mas-de-32-caracteres');
do $$ begin
  if exists (select 1 from integracion_crm where secreto_hash like '%secreto%') then
    raise exception 'El secreto no debe guardarse en claro';
  end if;
  raise notice 'CONFIGURAR ✓ solo desde el SQL Editor y se guarda la huella, no el secreto';
end $$;

-- ── el CRM envía (como anon, con el secreto) ─────────────────────────────
set role anon;
select pg_temp.falla($$select recibir_solicitud_crm('secreto-equivocado-pero-largo-de-32-caracteres', 'p:1', '{}')$$, 'No autorizado');
select pg_temp.falla($$select recibir_solicitud_crm('secreto-de-prueba-con-mas-de-32-caracteres', 'p:1', '[1]')$$, 'no son válidos');
select pg_temp.falla($$select recibir_solicitud_crm('secreto-de-prueba-con-mas-de-32-caracteres', 'p:1',
                       jsonb_build_object('x', repeat('a', 30000)))$$, 'demasiado grandes');
do $$ declare r text; begin
  r := recibir_solicitud_crm('secreto-de-prueba-con-mas-de-32-caracteres', 'presupuesto:P-1',
        '{"inmueble": {"direccion": "C/ Uría 1"}, "cliente": {"nombre": "Ana"}}');
  if r <> 'recibida' then raise exception 'Esperaba recibida, %', r; end if;
end $$;
-- …pero no puede leer la bandeja ni tocarla
select pg_temp.falla($$select * from solicitudes_crm$$, 'permission denied');
select pg_temp.falla($$update solicitudes_crm set estado = 'descartada'$$, 'permission denied');
select pg_temp.falla($$select * from integracion_crm$$, 'permission denied');
reset role;
do $$ begin raise notice 'ENTRADA ✓ con el secreto se escribe; sin él, nada; y el CRM nunca lee'; end $$;

-- ── el técnico ve la bandeja; sin 2FA o sin ser técnico, no ─────────────
set role authenticated;
select pg_temp.como('22222222-2222-2222-2222-222222222222', 'aal2');
do $$ begin
  if (select count(*) from solicitudes_crm) <> 0 then raise exception 'Un no técnico ve la bandeja'; end if;
end $$;
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal1');
do $$ begin
  if (select count(*) from solicitudes_crm) <> 0 then raise exception 'Sin 2FA se ve la bandeja'; end if;
end $$;
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
do $$ begin
  if (select count(*) from solicitudes_crm where estado = 'pendiente') <> 1 then raise exception 'El técnico no ve la solicitud'; end if;
end $$;
-- No puede cambiar lo que mandó el cliente
select pg_temp.falla($$update solicitudes_crm set datos = '{}'$$, 'permission denied');
select pg_temp.falla($$insert into solicitudes_crm (referencia, datos) values ('x', '{}')$$, 'permission denied');

-- Crea el expediente y marca la solicitud como importada
insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre)
values ('C/ Uría 1', 'Oviedo', 'vivienda_en_bloque', 'Ana');
update solicitudes_crm set estado = 'importada', resuelta_en = now(),
       expediente_id = (select id from expedientes limit 1);
do $$ begin
  if (select estado from solicitudes_crm) <> 'importada' then raise exception 'No se marcó como importada'; end if;
  raise notice 'BANDEJA ✓ solo el técnico verificado la ve y solo cambia el estado';
end $$;
reset role;

-- ── un reenvío del CRM actualiza la misma solicitud y la devuelve a la bandeja
set role anon;
do $$ declare r text; begin
  r := recibir_solicitud_crm('secreto-de-prueba-con-mas-de-32-caracteres', 'presupuesto:P-1',
        '{"inmueble": {"direccion": "C/ Uría 1, 2º"}}');
  if r <> 'actualizada' then raise exception 'Esperaba actualizada, %', r; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from solicitudes_crm) <> 1 then raise exception 'El reenvío ha duplicado la solicitud'; end if;
  if (select estado from solicitudes_crm) <> 'pendiente' then raise exception 'El reenvío no vuelve a la bandeja'; end if;
  if (select expediente_id from solicitudes_crm) is null then raise exception 'Se ha perdido el enlace al expediente'; end if;
  raise notice 'REENVÍO ✓ no duplica y vuelve a la bandeja conservando el expediente';
end $$;
