import * as esbuild from 'esbuild';
import { builtinModules } from 'module';

// Build with all Node.js built-ins and packages marked as external
await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  packages: 'external', // External all npm packages
  external: [
    ...builtinModules, // External all Node.js built-ins (fs, path, etc.)
    ...builtinModules.map(m => `node:${m}`), // Also handle node: prefix imports
  ],
  alias: {
    '@shared': './shared',
    '@': './client/src',
    '@assets': './attached_assets'
  }
});

console.log('✓ Build complete - All dependencies and built-ins externalized');
