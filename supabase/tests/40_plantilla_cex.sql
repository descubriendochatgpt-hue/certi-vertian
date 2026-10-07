-- Pruebas de la migración 06: plantilla de CE3X y dirección del cliente.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'tecnico@ejemplo.es'),
  ('33333333-3333-3333-3333-333333333333', 'otro@ejemplo.es');
insert into public.tecnicos (user_id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Técnico'), ('33333333-3333-3333-3333-333333333333', 'Otro técnico');

create function pg_temp.como(p_uid text, p_aal text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal)::text, false);
$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into clientes (id, nombre, direccion, codigo_postal, ciudad) values
  ('c0000000-0000-0000-0000-000000000001', 'Ana', 'C/ Facturación 3', '33001', 'Oviedo');
insert into pedidos (cliente_id, linea_negocio_id, servicio, datos) values
  ('c0000000-0000-0000-0000-000000000001', 1, 'Certificado', '{"Dirección del inmueble": "C/ Uría 1, 33003 Oviedo"}');

set role authenticated;
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
do $$ declare c jsonb; begin
  select cliente into c from encargos_certificado();
  if c ->> 'direccion' <> 'C/ Facturación 3' or c ->> 'codigo_postal' <> '33001' or c ->> 'ciudad' <> 'Oviedo' then
    raise exception 'Falta la dirección del cliente: %', c;
  end if;
  raise notice 'CLIENTE ✓ los encargos traen la dirección del cliente';
end $$;

insert into plantillas_cex (nombre, version, contenido) values ('plantilla.cex', 'CE3Xv3.1 Residencial', 'UzAK');
select pg_temp.como('33333333-3333-3333-3333-333333333333', 'aal2');
do $$ begin
  if (select count(*) from plantillas_cex) <> 0 then raise exception 'Otro técnico ve la plantilla ajena'; end if;
end $$;
insert into plantillas_cex (nombre, version, contenido) values ('mia.cex', 'CE3Xv3.1 Residencial', 'UzAK');
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal1');
do $$ begin
  if (select count(*) from plantillas_cex) <> 0 then raise exception 'Sin 2FA se ve la plantilla'; end if;
end $$;
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
do $$ begin
  if (select nombre from plantillas_cex) <> 'plantilla.cex' then raise exception 'El técnico no ve su plantilla'; end if;
  raise notice 'PLANTILLA ✓ cada técnico ve y guarda solo la suya, y con 2FA';
end $$;
