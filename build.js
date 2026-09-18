import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

const config = {
  entryPoints: [
    'src/background.ts',
    'src/popup.ts',
    'src/dashboard.ts',
    'src/settings.ts',
  ],
  bundle: true,
  outdir: 'dist',
  format: /** @type {const} */ ('esm'),
  target: 'chrome112',
  // Inline maps embed the TypeScript source in the shipped bundle; strip them
  // (and minify) for the Web Store package.
  sourcemap: isProduction ? false : 'inline',
  minify: isProduction,
  logLevel: /** @type {const} */ ('info'),
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('👀 Watching for changes... (Ctrl+C to stop)');
} else {
  await esbuild.build(config);
  console.log('');
  console.log('✅ Build complete! Load the extension:');
  console.log('   1. Open chrome://extensions');
  console.log('   2. Enable "Developer mode"');
  console.log('   3. Click "Load unpacked" → select this folder');
  console.log('');
}
