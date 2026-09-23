-- Pruebas del flujo de estados y de la seguridad de los módulos 1 y 2.
\set ON_ERROR_STOP 1

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'tecnico@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'intruso@ejemplo.es');
insert into public.tecnicos (user_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Técnico');

create function pg_temp.como(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal)::text, false);
$$;

-- Espera que una sentencia falle y que el mensaje contenga un texto.
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
grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;

-- ── seguridad: sin 2FA no se ve nada, y sin estar autorizado tampoco ──────
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal1');
select pg_temp.falla($$insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre)
                      values ('C/ Uría 1', 'Oviedo', 'vivienda_en_bloque', 'Ana')$$, 'row-level security');

select pg_temp.como('22222222-2222-2222-2222-222222222222', 'aal2');
select pg_temp.falla($$insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre)
                      values ('C/ Uría 1', 'Oviedo', 'vivienda_en_bloque', 'Ana')$$, 'row-level security');

-- ── alta ──────────────────────────────────────────────────────────────────
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre, fecha_visita)
values ('C/ Uría 1, 3ºB', 'Oviedo', 'vivienda_en_bloque', 'Ana Pérez', current_date - 3),
       ('Avda. Galicia 5', 'Gijón',  'vivienda_unifamiliar', 'Luis Díaz', null);

do $$
declare n int; c text;
begin
  select count(*) into n from historial_estados;
  if n <> 2 then raise exception 'Esperaba 2 altas en el historial, hay %', n; end if;
  select string_agg(codigo, ',' order by codigo) into c from expedientes;
  if c <> to_char(now(), 'YYYY') || '-001,' || to_char(now(), 'YYYY') || '-002' then
    raise exception 'Códigos inesperados: %', c;
  end if;
  raise notice 'ALTA ✓ códigos correlativos y alta anotada en el historial';
end $$;

-- ── el estado no se cambia por la puerta de atrás ────────────────────────
select pg_temp.falla($$update expedientes set estado = 'registrado' where municipio = 'Oviedo'$$, 'confirmación explícita');
select pg_temp.falla($$update expedientes set fecha_firma = current_date where municipio = 'Oviedo'$$, 'confirmación explícita');
select pg_temp.falla($$insert into historial_estados (expediente_id, estado_anterior, estado_nuevo)
                      select id, 'visita_pendiente', 'registrado' from expedientes limit 1$$, 'row-level security');
select pg_temp.falla($$insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre, estado)
                      values ('x', 'y', 'local_terciario', 'z', 'registrado')$$, 'empieza siempre');
do $$ begin raise notice 'GUARDIA ✓ el estado, la firma y el historial no se tocan a mano'; end $$;

-- ── avance: no se salta estados y exige toma de datos ────────────────────
select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'calculo_revisado')$$, 'un estado cada vez');
select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'datos_introducidos')$$, 'No hay datos de la visita');
select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Gijón'), 'datos_introducidos')$$, 'fecha de la visita');

insert into toma_datos (expediente_id, datos)
select id, '{"cerramientos": [{"tipo": "fachada", "u": 1.2}]}' from expedientes where municipio = 'Oviedo';
select pg_temp.falla($$update toma_datos set verificado_en = now()$$, 'solo se registra al confirmar');

select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'datos_introducidos', 'Revisado');

do $$
begin
  if (select verificado_en from toma_datos) is null then raise exception 'La toma de datos debía quedar verificada'; end if;
  raise notice 'AVANCE ✓ no salta estados; exige fecha de visita y datos; verifica la toma';
end $$;

-- ── datos congelados tras la verificación ─────────────────────────────────
select pg_temp.falla($$update toma_datos set datos = '{}'$$, 'devuelve primero');

select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'visita_pendiente')$$, 'motivo');
select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'visita_pendiente', 'Corregir U de cubierta');
update toma_datos set datos = '{"cerramientos": [{"tipo": "cubierta", "u": 0.4}]}';
do $$
begin
  if (select verificado_en from toma_datos) is not null then raise exception 'Al retroceder debía perderse la verificación'; end if;
  raise notice 'RETROCESO ✓ exige motivo, descongela los datos y quita la verificación';
end $$;

-- ── firma y vencimiento ───────────────────────────────────────────────────
select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'datos_introducidos');
select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'calculo_revisado');
select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'certificado_firmado')$$, 'fecha de firma');
select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'certificado_firmado', null, current_date - 10, 'E', 'E')$$, 'anterior a la de la visita');
select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'certificado_firmado', null, current_date, 'E', 'G');

do $$
declare v date;
begin
  select fecha_vencimiento into v from expedientes where municipio = 'Oviedo';
  if v <> (current_date + interval '5 years')::date then raise exception 'Con una G debía vencer a 5 años: %', v; end if;
  raise notice 'FIRMA ✓ exige fecha y calificaciones; con G vence a 5 años';
end $$;

select pg_temp.falla($$select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'registrado', null, current_date - 1)$$, 'anterior a la de firma');
select cambiar_estado((select id from expedientes where municipio = 'Oviedo'), 'registrado', null, current_date, null, null, 'CEE/2026/123');

do $$
declare n int; e expedientes;
begin
  select count(*) into n from historial_estados h join expedientes x on x.id = h.expediente_id where x.municipio = 'Oviedo';
  if n <> 7 then raise exception 'Esperaba 7 anotaciones en el historial, hay %', n; end if;
  select * into e from expedientes where municipio = 'Oviedo';
  if e.estado <> 'registrado' or e.numero_registro <> 'CEE/2026/123' then raise exception 'Registro mal guardado'; end if;
  raise notice 'REGISTRO ✓ recorrido completo con % anotaciones en el historial', n;
end $$;

-- ── borrar: solo en «Visita pendiente» ─────────────────────────────────────
do $$
declare n int;
begin
  delete from expedientes where municipio = 'Oviedo';          -- registrado: no se borra
  if not exists (select 1 from expedientes where municipio = 'Oviedo') then
    raise exception 'Se ha borrado un expediente registrado';
  end if;
  delete from expedientes where municipio = 'Gijón';           -- visita pendiente: sí
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'No se pudo borrar el expediente pendiente'; end if;
  raise notice 'BORRADO ✓ solo se borran expedientes en «Visita pendiente»';
end $$;

-- ── otro usuario no ve nada ───────────────────────────────────────────────
select pg_temp.como('22222222-2222-2222-2222-222222222222', 'aal2');
do $$
begin
  if exists (select 1 from expedientes) or exists (select 1 from toma_datos) or exists (select 1 from historial_estados) then
    raise exception 'Un usuario no autorizado está viendo datos';
  end if;
  raise notice 'AISLAMIENTO ✓ un usuario no autorizado no ve ningún dato';
end $$;

reset role;
