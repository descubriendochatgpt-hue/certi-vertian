import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// La clave pública (anon / publishable) de Supabase está pensada para ir en
// el navegador: por sí sola no da acceso a ningún dato. Lo que protege los
// datos son las políticas RLS de la base de datos (supabase/migrations).
// La clave de servicio (service_role) NUNCA debe ponerse aquí.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const clave = import.meta.env.VITE_SUPABASE_CLAVE_PUBLICA as string | undefined;

export const configuracionCompleta = Boolean(url && clave);

export const supabase: SupabaseClient = createClient(
  url || 'http://configuracion-pendiente.invalid',
  clave || 'configuracion-pendiente',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);
