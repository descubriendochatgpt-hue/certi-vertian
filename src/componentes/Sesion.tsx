import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type EstadoSesion =
  | { tipo: 'cargando' }
  | { tipo: 'sin_sesion' }
  | { tipo: 'activar_2fa' }
  | { tipo: 'verificar_2fa' }
  | { tipo: 'no_autorizado'; usuario: User }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'lista'; usuario: User };

/**
 * Comprueba, por este orden: que hay sesión, que se ha pasado la verificación
 * en dos pasos y que la cuenta está autorizada en la tabla `tecnicos`.
 * La base de datos exige lo mismo (RLS); esto solo evita pantallas vacías.
 */
export async function comprobarSesion(): Promise<EstadoSesion> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { tipo: 'sin_sesion' };

  const { data: nivel, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return { tipo: 'error', mensaje: error.message };
  if (nivel.currentLevel !== 'aal2') {
    return nivel.nextLevel === 'aal2' ? { tipo: 'verificar_2fa' } : { tipo: 'activar_2fa' };
  }

  const { data: tecnico, error: e2 } = await supabase.from('tecnicos').select('user_id').maybeSingle();
  if (e2) return { tipo: 'error', mensaje: e2.message };
  if (!tecnico) return { tipo: 'no_autorizado', usuario: session.user };
  return { tipo: 'lista', usuario: session.user };
}

export function RequiereSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSesion>({ tipo: 'cargando' });
  const ubicacion = useLocation();

  useEffect(() => {
    let vivo = true;
    comprobarSesion().then((e) => vivo && setEstado(e));
    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') setEstado({ tipo: 'sin_sesion' });
    });
    return () => { vivo = false; data.subscription.unsubscribe(); };
  }, []);

  switch (estado.tipo) {
    case 'cargando':
      return <p className="cargando">Comprobando la sesión…</p>;
    case 'sin_sesion':
      return <Navigate to="/acceso" replace state={{ desde: ubicacion.pathname }} />;
    case 'activar_2fa':
      return <Navigate to="/acceso/activar-2fa" replace />;
    case 'verificar_2fa':
      return <Navigate to="/acceso/verificar" replace state={{ desde: ubicacion.pathname }} />;
    case 'error':
      return (
        <main className="pagina estrecha">
          <div className="caja error">No se ha podido comprobar la sesión: {estado.mensaje}</div>
          <button onClick={() => location.reload()}>Reintentar</button>
        </main>
      );
    case 'no_autorizado':
      return (
        <main className="pagina estrecha">
          <h1>Cuenta no autorizada</h1>
          <p>Has entrado como <strong>{estado.usuario.email}</strong>, pero esta cuenta todavía no está dada de alta como técnico.</p>
          <p>Para autorizarla, abre el <em>SQL Editor</em> de Supabase y ejecuta (ver README, paso «Autorizar tu cuenta»):</p>
          <pre className="codigo">insert into public.tecnicos (user_id, nombre){'\n'}values ('{estado.usuario.id}', 'Tu nombre');</pre>
          <button onClick={() => supabase.auth.signOut()}>Salir</button>
        </main>
      );
    case 'lista':
      return <>{children}</>;
  }
}
