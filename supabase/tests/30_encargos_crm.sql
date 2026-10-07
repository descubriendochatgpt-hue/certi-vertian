-- Pruebas de la lectura de encargos del CRM (migración 05).
\set ON_ERROR_STOP 1

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'tecnico@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'empleado@ejemplo.es');
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

-- Datos del CRM (como los dejan sus formularios)
insert into clientes (id, nombre, nif, email, telefono) values
  ('c0000000-0000-0000-0000-000000000001', 'Ana Pérez', '12345678Z', 'ana@ejemplo.es', '600000001'),
  ('c0000000-0000-0000-0000-000000000002', 'Luis Díaz', null, 'luis@ejemplo.es', null);
-- 1) pedido de certificado con inmueble, sin presupuesto
insert into pedidos (id, cliente_id, linea_negocio_id, servicio, datos) values
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, 'Certificado vivienda',
   '{"Dirección del inmueble": "C/ Uría 1, 3ºB, 33003 Oviedo", "Referencia catastral": "0000000AA0000A0001AA", "Tipo de inmueble": "Piso o apartamento"}');
-- 2) pedido de certificado que luego tiene presupuesto con inmueble: cuenta una vez, como presupuesto
insert into pedidos (id, cliente_id, linea_negocio_id, servicio, datos) values
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 1, 'Certificado local',
   '{"Dirección del inmueble": "Avda. Galicia 5, 33212 Gijón"}');
insert into presupuestos (id, numero, cliente_id, pedido_id, linea_negocio_id, titulo, estado, inmueble) values
  ('b0000000-0000-0000-0000-000000000002', 'P-2026-0002', 'c0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002', 1, 'Certificado local', 'aceptado',
   '{"direccion": "Avda. Galicia 5", "codigo_postal": "33212", "localidad": "Gijón", "ref_catastral": "1111111AA1111A0001AA", "tipo": "Local u oficina", "superficie": "120"}');
insert into citas (cliente_id, presupuesto_id, estado, inicio) values
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'confirmada', '2026-10-20 09:00+02');
-- 3) lo que NO es un encargo de certificado
insert into pedidos (cliente_id, linea_negocio_id, servicio, datos) values
  ('c0000000-0000-0000-0000-000000000001', 2, 'Chatbot', '{"Nombre del negocio": "X"}'),         -- otra línea
  ('c0000000-0000-0000-0000-000000000001', 1, 'Consulta', '{}');                                -- sin inmueble
insert into presupuestos (numero, cliente_id, linea_negocio_id, titulo, estado, inmueble) values
  ('P-2026-0003', 'c0000000-0000-0000-0000-000000000001', 1, 'Rechazado', 'rechazado', '{"direccion": "X"}'),
  ('P-2026-0004', 'c0000000-0000-0000-0000-000000000001', 2, 'Proyecto IA', 'aceptado', '{"clase": "ia", "datos": {}}');

-- ── solo el técnico verificado lee los encargos ──────────────────────────
set role anon;
select pg_temp.falla($$select * from encargos_certificado()$$, 'permission denied');
reset role;
set role authenticated;
select pg_temp.como('22222222-2222-2222-2222-222222222222', 'aal2');
select pg_temp.falla($$select * from encargos_certificado()$$, 'No tienes permiso');
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal1');
select pg_temp.falla($$select * from encargos_certificado()$$, 'No tienes permiso');
-- …y no lee las tablas del CRM directamente
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
select pg_temp.falla($$select * from clientes$$, 'permission denied');
do $$ begin raise notice 'ACCESO ✓ solo el técnico con 2FA lee los encargos, y sin acceso directo a las tablas del CRM'; end $$;

-- ── qué se considera encargo ─────────────────────────────────────────────
do $$
declare r record; n int;
begin
  select count(*) into n from encargos_certificado();
  if n <> 2 then raise exception 'Esperaba 2 encargos, hay %', n; end if;

  select * into r from encargos_certificado() where origen = 'presupuesto';
  if r.crm_id <> 'b0000000-0000-0000-0000-000000000002' or r.pedido_id <> 'a0000000-0000-0000-0000-000000000002' then
    raise exception 'El presupuesto debería sustituir a su pedido';
  end if;
  if r.inmueble ->> 'ref_catastral' <> '1111111AA1111A0001AA' or r.cliente ->> 'nombre' <> 'Luis Díaz' then
    raise exception 'Datos del presupuesto incorrectos: %', row_to_json(r);
  end if;
  if r.visita <> '2026-10-20 09:00+02'::timestamptz then raise exception 'Falta la visita confirmada'; end if;

  select * into r from encargos_certificado() where origen = 'pedido';
  if r.datos_pedido ->> 'Referencia catastral' <> '0000000AA0000A0001AA' or r.cliente ->> 'nif' <> '12345678Z' then
    raise exception 'Datos del pedido incorrectos: %', row_to_json(r);
  end if;
  if r.expediente_id is not null or r.descartado then raise exception 'No debería estar enlazado ni descartado'; end if;
  raise notice 'ENCARGOS ✓ pedidos y presupuestos de certificados con inmueble; un presupuesto sustituye a su pedido';
end $$;

-- ── crear el expediente enlazado y descartar ─────────────────────────────
insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre, crm_pedido_id, crm_presupuesto_id)
values ('Avda. Galicia 5', 'Gijón', 'local_terciario', 'Luis Díaz',
        'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002');
insert into encargos_descartados (origen, crm_id) values ('pedido', 'a0000000-0000-0000-0000-000000000001');
do $$ begin
  if (select expediente_id from encargos_certificado() where origen = 'presupuesto') is null then
    raise exception 'El encargo no aparece enlazado a su expediente';
  end if;
  if not (select descartado from encargos_certificado() where origen = 'pedido') then
    raise exception 'El descarte no se refleja';
  end if;
  raise notice 'ENLACE ✓ el expediente queda enlazado al encargo y el descarte se recuerda';
end $$;
reset role;

-- ── si el CRM borra al cliente (supresión), el expediente se queda sin enlace
delete from clientes where id = 'c0000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from expedientes) <> 1 then raise exception 'El borrado en el CRM ha borrado el expediente'; end if;
  if (select crm_pedido_id from expedientes) is not null or (select crm_presupuesto_id from expedientes) is not null then
    raise exception 'El enlace debería quedar vacío';
  end if;
  raise notice 'SUPRESIÓN ✓ borrar en el CRM no borra el expediente ni lo bloquea';
end $$;
