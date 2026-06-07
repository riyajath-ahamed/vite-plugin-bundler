import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

const external = [
  'fs',
  'path',
  'zlib',
  'crypto',
  'stream',
  'url',
  'node:fs',
  'node:path',
  'node:zlib',
  'node:crypto',
  'node:stream',
  'node:url',
  'vite',
  'piscina',
  '@mongodb-js/zstd',
];

export default [
  {
    input: 'src/index.ts',
    external,
    output: [
      { file: 'dist/index.mjs', format: 'esm' },
      { file: 'dist/index.cjs', format: 'cjs', esModule: true, exports: 'named' },
    ],
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.build.json',
        declaration: true,
        declarationDir: './dist/types',
      }),
    ],
  },
  {
    input: 'src/compression-worker.ts',
    external,
    output: [
      { file: 'dist/compression-worker.mjs', format: 'esm' },
      { file: 'dist/compression-worker.cjs', format: 'cjs', exports: 'default' },
    ],
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.build.json',
        declaration: false,
        declarationDir: undefined,
      }),
    ],
  },
  {
    input: 'dist/types/index.d.ts',
    output: { file: 'dist/index.d.mts', format: 'esm' },
    plugins: [dts()],
    external,
  },
  {
    input: 'dist/types/index.d.ts',
    output: { file: 'dist/index.d.cts', format: 'cjs' },
    plugins: [dts()],
    external,
  },
];
