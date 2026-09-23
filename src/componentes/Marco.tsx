import { NavLink, Outlet, useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { borrarTodasLasCopiasLocales, hayCopiasLocales } from '../lib/copiaLocal';

export function Marco() {
  const navegar = useNavigate();

  async function salir() {
    if (hayCopiasLocales() && !confirm('En este dispositivo hay cambios de la toma de datos que aún no se han subido al servidor. Si sales, se borrarán. ¿Salir igualmente?')) return;
    borrarTodasLasCopiasLocales();
    await supabase.auth.signOut();
    navegar('/acceso');
  }

  return (
    <>
      <header className="cabecera">
        <NavLink to="/" className="marca">Certificados CEE</NavLink>
        <nav>
          <NavLink to="/" end>Expedientes</NavLink>
          <NavLink to="/expedientes/nuevo">+ Nuevo</NavLink>
          <NavLink to="/aviso-legal">Aviso legal</NavLink>
          <button className="enlace" onClick={salir}>Salir</button>
        </nav>
      </header>
      <Outlet />
      <footer className="pie">
        Herramienta de apoyo administrativo. El certificado lo verifica y firma personalmente el técnico competente (RD 390/2021).
      </footer>
    </>
  );
}
