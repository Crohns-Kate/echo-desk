import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',
  alias: {
    '@shared': './shared',
    '@': './client/src',
    '@assets': './attached_assets'
  },
  banner: {
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`
  }
});

console.log('✓ Build complete');
