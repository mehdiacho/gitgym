import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev runs at /. The portfolio copy is built with --base=/projects/gitgym/ (npm run build:portfolio).
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node' },
} as never);
