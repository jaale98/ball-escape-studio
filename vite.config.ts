import { defineConfig } from 'vite';
import { studioPlugin } from './server/studio';

export default defineConfig({
  plugins: [studioPlugin()],
  server: {
    // Scene history and taste notes change constantly; they never affect the page.
    watch: { ignored: ['**/.studio/**', '**/captures/**', '**/exports/**'] },
  },
});
