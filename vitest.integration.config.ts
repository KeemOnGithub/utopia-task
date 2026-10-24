import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/integration/**/*.test.ts','apps/**/*.integration.test.ts'],testTimeout:30000,maxWorkers:1}});
