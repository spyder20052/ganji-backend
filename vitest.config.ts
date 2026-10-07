import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    include: ['test/**/*.spec.ts'],
    // Les suites d'intégration rejouent des parcours entiers sur une vraie base (parcours héros : demande,
    // alertes, SMS, transfusion) : sur le lanceur de la CI, avec la couverture, 5 s ne suffisent pas.
    testTimeout: 30_000,
    hookTimeout: 90_000,
    coverage: { provider: 'v8', include: ['src/**/*.service.ts', 'src/common/**/*.ts'], reporter: ['text', 'lcov'] },
    env: { DEMO_MODE: 'true' },
  },
});
