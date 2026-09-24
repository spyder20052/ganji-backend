import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    include: ['test/**/*.spec.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.service.ts', 'src/common/**/*.ts'], reporter: ['text', 'lcov'] },
    env: { DEMO_MODE: 'true' },
  },
});
