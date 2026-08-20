import { defineConfig } from 'tsdown'

const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

const inlineSafeDshClientImport = /^@deepseek-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)/
const vendoredClientLibrary = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const generatedRemote = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

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
    plugins: [{
      name: 'dsh-fleet-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (clientExternals.includes(source)) return null
        if (inlineSafeDshClientImport.test(source) || vendoredClientLibrary.test(source) || generatedRemote.test(source)) return null
        throw new Error(`client bundle purity: undeclared DSH value import ${JSON.stringify(source)}`)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: \"dsh-fleet\", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
