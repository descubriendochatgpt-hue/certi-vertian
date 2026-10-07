-- Pruebas de la migración 07: catálogo de CE3X y visitas grabadas.
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

set role authenticated;
select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
insert into expedientes (id, direccion, municipio, tipo_edificio, propietario_nombre)
  values ('e0000000-0000-0000-0000-000000000001', 'C/ Uría 1', 'Oviedo', 'vivienda_en_bloque', 'Ana');
insert into catalogo_ce3x (clave, tipo, etiqueta, datos, origen) values ('cerramiento:abc', 'cerramiento', 'Fachada', '(lp0\n.', 'Lima.cex');
insert into visitas (expediente_id, grabada_en, propuesta) values ('e0000000-0000-0000-0000-000000000001', now(), '{"elementos": []}');
do $$ begin
  begin
    insert into catalogo_ce3x (clave, tipo, etiqueta, datos, origen) values ('cerramiento:abc', 'cerramiento', 'Otra', 'x', 'y');
    raise exception 'Se ha repetido una solución';
  exception when unique_violation then null;
  end;
  begin
    insert into catalogo_ce3x (clave, tipo, etiqueta, datos, origen) values ('x', 'cliente', 'x', 'x', 'y');
    raise exception 'Se ha aceptado un tipo que no existe';
  exception when check_violation then null;
  end;
  raise notice 'CATÁLOGO ✓ sin repetidos y solo tipos de la envolvente o instalaciones';
end $$;

select pg_temp.como('33333333-3333-3333-3333-333333333333', 'aal2');
do $$ begin
  if (select count(*) from catalogo_ce3x) <> 0 or (select count(*) from visitas) <> 0 then
    raise exception 'Otro técnico ve el catálogo o las visitas ajenas';
  end if;
  begin
    insert into visitas (expediente_id, grabada_en, propuesta) values ('e0000000-0000-0000-0000-000000000001', now(), '{}');
    raise exception 'Se ha guardado una visita en un expediente ajeno';
  exception when insufficient_privilege then null;
  end;
  raise notice 'AJENOS ✓ ni catálogo ni visitas de otro técnico';
end $$;

select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal1');
do $$ begin
  if (select count(*) from catalogo_ce3x) <> 0 or (select count(*) from visitas) <> 0 then
    raise exception 'Sin 2FA se ve el catálogo o las visitas';
  end if;
  raise notice '2FA ✓ sin segundo factor no se ve nada';
end $$;

select pg_temp.como('11111111-1111-1111-1111-111111111111', 'aal2');
reset role;
delete from expedientes where id = 'e0000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from visitas) <> 0 then raise exception 'Las visitas no se borran con el expediente'; end if;
  raise notice 'BORRADO ✓ las visitas se van con su expediente';
end $$;
