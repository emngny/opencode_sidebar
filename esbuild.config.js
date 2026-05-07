const esbuild = require('esbuild');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

async function build() {
  const ctx = await esbuild.context({
    entryPoints: ['./src/webview/index.tsx'],
    bundle: true,
    outfile: './out/webview.js',
    format: 'iife',
    target: ['es2020'],
    jsx: 'automatic',
    sourcemap: true,
    minify: true,
    external: ['vscode']
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    ctx.dispose();
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
