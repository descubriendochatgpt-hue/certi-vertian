-- Solo para pruebas locales: lo mínimo de las tablas del CRM de Vertian que
-- usa la migración 05 (en producción las crean las migraciones del CRM, en
-- el mismo Supabase). Mismos nombres y tipos de columna que en el CRM.
create table public.lineas_negocio (id smallint primary key, slug text not null unique);
create table public.clientes (
  id uuid primary key default gen_random_uuid(), nombre text not null, razon_social text, nif text,
  email text, telefono text, provincia text, direccion text, codigo_postal text, ciudad text
);
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  linea_negocio_id smallint references public.lineas_negocio (id),
  servicio text not null, datos jsonb not null default '{}'::jsonb, mensaje text,
  estado text not null default 'recibido', created_at timestamptz not null default now()
);
create table public.presupuestos (
  id uuid primary key default gen_random_uuid(), numero text not null unique,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  pedido_id uuid references public.pedidos (id) on delete set null,
  linea_negocio_id smallint references public.lineas_negocio (id),
  titulo text not null, estado text not null default 'borrador', inmueble jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.citas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  presupuesto_id uuid references public.presupuestos (id) on delete set null,
  pedido_id uuid references public.pedidos (id) on delete set null,
  estado text not null default 'pendiente', inicio timestamptz,
  updated_at timestamptz not null default now()
);
-- Como en el CRM: solo con RLS, sin políticas para estos roles en las pruebas.
alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
alter table public.presupuestos enable row level security;
alter table public.citas enable row level security;
insert into public.lineas_negocio values (1, 'certificaciones'), (2, 'ia-saas');
