import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const isTest = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VITEST

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(isTest ? [] : [cloudflare()])],
  server: { port: 5195 },
  test: { environment: 'node', include: ['shared/**/*.test.ts', 'src/**/*.test.ts'] },
} as never)
