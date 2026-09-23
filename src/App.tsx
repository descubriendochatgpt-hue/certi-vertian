import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { configuracionCompleta } from './lib/supabase';
import { RequiereSesion } from './componentes/Sesion';
import { Marco } from './componentes/Marco';
import { Acceso, Activar2fa, Verificar2fa } from './paginas/Acceso';
import { Expedientes } from './paginas/Expedientes';
import { FormExpediente } from './paginas/FormExpediente';
import { DetalleExpediente } from './paginas/DetalleExpediente';
import { TomaDatos } from './paginas/TomaDatos';
import { AvisoLegal } from './paginas/AvisoLegal';
import { Resultados } from './paginas/Resultados';
import { Revision } from './paginas/Revision';
import { Panel } from './paginas/Panel';
import { Paquete } from './paginas/Paquete';
import { FichaCe3x } from './paginas/FichaCe3x';

export function App() {
  if (!configuracionCompleta) {
    return (
      <main className="pagina estrecha">
        <h1>Falta la configuración</h1>
        <p>No se han indicado la dirección y la clave pública de Supabase.</p>
        <p>Sigue el README, apartado «Conectar la app con Supabase»: hay que definir <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_CLAVE_PUBLICA</code>.</p>
      </main>
    );
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/acceso" element={<Acceso />} />
        <Route path="/acceso/verificar" element={<Verificar2fa />} />
        <Route path="/acceso/activar-2fa" element={<Activar2fa />} />
        <Route element={<RequiereSesion><Marco /></RequiereSesion>}>
          <Route index element={<Panel />} />
          <Route path="expedientes" element={<Expedientes />} />
          <Route path="expedientes/nuevo" element={<FormExpediente />} />
          <Route path="expedientes/:id" element={<DetalleExpediente />} />
          <Route path="expedientes/:id/editar" element={<FormExpediente />} />
          <Route path="expedientes/:id/toma-datos" element={<TomaDatos />} />
          <Route path="expedientes/:id/resultados" element={<Resultados />} />
          <Route path="expedientes/:id/revision" element={<Revision />} />
          <Route path="expedientes/:id/paquete" element={<Paquete />} />
          <Route path="expedientes/:id/ficha-ce3x" element={<FichaCe3x />} />
          <Route path="aviso-legal" element={<AvisoLegal />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
