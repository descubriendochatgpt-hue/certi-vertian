-- Pruebas del módulo 4: resultados, checklist y adjuntos.
\set ON_ERROR_STOP 1

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'tecnico@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'otro@ejemplo.es');
insert into public.tecnicos (user_id) values
  ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');

create function pg_temp.como(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', 'aal2')::text, false);
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
create function pg_temp.exp() returns uuid language sql as $$ select id from public.expedientes where municipio = 'Gijón' $$;
grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;
select pg_temp.como('11111111-1111-1111-1111-111111111111');

insert into expedientes (direccion, municipio, tipo_edificio, propietario_nombre, fecha_visita)
values ('Calle Lima 6', 'Gijón', 'vivienda_en_bloque', 'Prueba', current_date - 2);
insert into toma_datos (expediente_id, datos) select pg_temp.exp(), '{}';

-- Resultados: solo en «Datos introducidos»
select pg_temp.falla($$insert into resultados (expediente_id) values (pg_temp.exp())$$, 'solo se pueden modificar');
select cambiar_estado(pg_temp.exp(), 'datos_introducidos');
select pg_temp.falla($$select cambiar_estado(pg_temp.exp(), 'calculo_revisado')$$, 'Todavía no se han registrado');
insert into resultados (expediente_id, origen, consumo_ep_nr, calificacion_consumo) values (pg_temp.exp(), 'pdf', 69.3, 'D');
select pg_temp.falla($$select cambiar_estado(pg_temp.exp(), 'calculo_revisado')$$, 'Faltan las calificaciones');
update resultados set emisiones_co2 = 13.6, calificacion_emisiones = 'C';
select pg_temp.falla($$update resultados set confirmado_en = now()$$, 'solo se registra al pasar');
select cambiar_estado(pg_temp.exp(), 'calculo_revisado', 'Resultados revisados');
select pg_temp.falla($$update resultados set consumo_ep_nr = 50$$, 'solo se pueden modificar');
do $$ begin
  if (select confirmado_en from resultados) is null then raise exception 'Los resultados debían quedar confirmados'; end if;
  raise notice 'RESULTADOS ✓ se editan solo en «Datos introducidos»; exigen calificaciones y quedan congelados';
end $$;

-- Checklist: todo marcado para firmar
insert into checklist_revision (expediente_id, clave)
select pg_temp.exp(), clave from checklist_items where orden <= 11;
select pg_temp.falla($$select cambiar_estado(pg_temp.exp(), 'certificado_firmado', null, current_date)$$, 'Faltan 1 punto');
insert into checklist_revision (expediente_id, clave, marcado_en) values (pg_temp.exp(), 'datos_tecnico', '2000-01-01');
select pg_temp.falla($$select cambiar_estado(pg_temp.exp(), 'certificado_firmado', null, current_date, 'A', 'C')$$, 'no coinciden');
do $$ begin
  if (select marcado_en from checklist_revision where clave = 'datos_tecnico') < now() - interval '1 minute' then
    raise exception 'La fecha de marcado no la debe poder poner el usuario';
  end if;
end $$;
select cambiar_estado(pg_temp.exp(), 'certificado_firmado', null, current_date);
select pg_temp.falla($$delete from checklist_revision$$, 'solo se puede modificar');
do $$ declare e expedientes; begin
  select * into e from expedientes where id = pg_temp.exp();
  if e.calificacion_consumo <> 'D' or e.calificacion_emisiones <> 'C' then raise exception 'Calificaciones no copiadas de los resultados'; end if;
  if e.fecha_vencimiento <> (current_date + interval '10 years')::date then raise exception 'Vencimiento a 10 años esperado'; end if;
  raise notice 'CHECKLIST ✓ sin todos los puntos no se firma; la firma toma las calificaciones de los resultados';
end $$;

-- Retroceso: descongela y borra el checklist
select cambiar_estado(pg_temp.exp(), 'calculo_revisado', 'Revisar de nuevo');
select cambiar_estado(pg_temp.exp(), 'datos_introducidos', 'Recalcular');
do $$ begin
  if exists (select 1 from checklist_revision) then raise exception 'El checklist debía borrarse'; end if;
  if (select confirmado_en from resultados) is not null then raise exception 'Los resultados debían descongelarse'; end if;
  raise notice 'RETROCESO ✓ volver a «Datos introducidos» descongela los resultados y reinicia el checklist';
end $$;
update resultados set consumo_ep_nr = 70.1;

-- Adjuntos y almacén
select pg_temp.falla($$insert into adjuntos (expediente_id, tipo, nombre, ruta, tamano)
  values (pg_temp.exp(), 'fichero_calculo', 'x.cex', '22222222-2222-2222-2222-222222222222/' || pg_temp.exp() || '/x.cex', 10)$$, 'row-level security');
insert into adjuntos (expediente_id, tipo, nombre, ruta, tamano)
values (pg_temp.exp(), 'fichero_calculo', 'x.cex', '11111111-1111-1111-1111-111111111111/' || pg_temp.exp() || '/a-x.cex', 10);
insert into storage.objects (bucket_id, name) values ('documentos', '11111111-1111-1111-1111-111111111111/' || pg_temp.exp() || '/a-x.cex');
select pg_temp.falla($$insert into storage.objects (bucket_id, name)
  values ('documentos', '11111111-1111-1111-1111-111111111111/00000000-0000-0000-0000-000000000000/y.cex')$$, 'row-level security');

select pg_temp.como('22222222-2222-2222-2222-222222222222');
do $$ begin
  if exists (select 1 from adjuntos) or exists (select 1 from storage.objects) or exists (select 1 from resultados) then
    raise exception 'Otro técnico ve adjuntos o resultados ajenos';
  end if;
end $$;
select pg_temp.falla($$insert into storage.objects (bucket_id, name)
  values ('documentos', '11111111-1111-1111-1111-111111111111/' || (select id from expedientes limit 1) || '/z.cex')$$, 'row-level security');
do $$ begin raise notice 'ADJUNTOS ✓ cada técnico solo sube y ve ficheros en sus propios expedientes'; end $$;

reset role;
