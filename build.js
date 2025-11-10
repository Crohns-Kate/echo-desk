import * as esbuild from 'esbuild';
import { builtinModules } from 'module';
import { readFileSync } from 'fs';

// Read package.json to get all dependencies
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const dependencies = Object.keys(pkg.dependencies || {});
const devDependencies = Object.keys(pkg.devDependencies || {});
const allDeps = [...dependencies, ...devDependencies];

console.log('Externalizing dependencies:', allDeps.join(', '));

// Build with ALL dependencies and built-ins marked as external
await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  external: [
    ...builtinModules,                      // Node.js built-ins (fs, path, etc.)
    ...builtinModules.map(m => `node:${m}`), // node: prefix imports
    ...allDeps,                              // All npm dependencies
  ],
  alias: {
    '@shared': './shared',
    '@': './client/src',
    '@assets': './attached_assets'
  }
});

console.log('✓ Build complete - All dependencies externalized (loaded from node_modules at runtime)');
