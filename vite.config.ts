import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Sin mapas de código en producción: no aportan nada al usuario.
  build: { sourcemap: false },
});
