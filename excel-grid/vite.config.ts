import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Domaine public (enregistrement A → 77.159.204.155) : Vite refuse par
// défaut les requêtes dont l'en-tête Host n'est pas localhost.
const publicHost = 'budgetpbdbcompta.aic-informatique.net';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true, host: true, allowedHosts: [publicHost] },
  preview: { port: 4173, host: true, allowedHosts: [publicHost] },
});
