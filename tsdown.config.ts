import { defineConfig } from 'tsdown'

const clientExternals = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-layout/client',
]

export default defineConfig([
  { name: 'dsh-fleet/host', entry: { index: 'src/index.ts' }, outDir: 'dist-host', format: 'esm', platform: 'node', target: 'es2023', fixedExtension: false, dts: false, clean: false },
  { name: 'dsh-fleet/testing', entry: { testing: 'src/testing.ts' }, outDir: 'dist-testing', format: 'esm', platform: 'node', target: 'es2023', fixedExtension: false, dts: false, clean: false },
  {
    name: 'dsh-fleet/agent', entry: { agent: 'src/agent/cli.ts' }, outDir: 'dist-agent',
    format: 'esm', platform: 'node', target: 'es2023', fixedExtension: false, dts: false, clean: false,
    deps: { alwaysBundle: ['semver', 'yaml'], onlyBundle: ['semver', 'yaml'] },
  },
  {
    name: 'dsh-fleet/worker', entry: { worker: 'src/worker/index.ts' }, outDir: 'dist-worker',
    format: 'esm', platform: 'node', target: 'es2023', fixedExtension: false, dts: false, clean: false,
    deps: { alwaysBundle: ['semver'], onlyBundle: ['semver'] },
  },
  {
    name: 'dsh-fleet/bootstrap', entry: { bootstrap: 'src/bootstrap/cli.ts' }, outDir: 'dist-bootstrap',
    format: 'esm', platform: 'node', target: 'es2023', fixedExtension: false, dts: false, clean: false,
    deps: { alwaysBundle: ['semver', 'yaml'], onlyBundle: ['semver', 'yaml'] },
  },
  {
    name: 'dsh-fleet/client', entry: { client: 'src/client/index.tsx' }, outDir: 'dist-client',
    format: 'cjs', platform: 'browser', target: 'es2022', fixedExtension: false, dts: false, sourcemap: true, clean: false,
    deps: { neverBundle: clientExternals, alwaysBundle: (id: string) => !clientExternals.includes(id) },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: \"dsh-fleet\", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
