import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as fs from 'fs';
import * as path from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'exclude-rtp-audio',
      apply: 'build',
      closeBundle() {
        const distRtp = path.resolve('dist/rtp');
        if (!fs.existsSync(distRtp)) return;
        for (const engine of ['2k', '2k3']) {
          for (const sub of ['music', 'sound']) {
            const p = path.join(distRtp, engine, sub);
            if (fs.existsSync(p)) {
              fs.rmSync(p, { recursive: true, force: true });
              console.log(`  [rtp] excluded ${engine}/${sub}/ from build`);
            }
          }
        }
      },
    },
  ],
  base: '/rm200x-material-manager/',
  server: {
    port: 5173,
    open: true,
  },
  define: {
    global: 'globalThis',
  },
});
