import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  if (command === 'build' && !env.VITE_REOWN_PROJECT_ID?.trim()) {
    throw new Error(
      'Missing VITE_REOWN_PROJECT_ID. Set it in Cloudflare Pages environment variables before deploying.',
    )
  }

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 900,
      rolldownOptions: {
        output: {
          codeSplitting: {
            minSize: 32 * 1024,
            groups: [
              {
                name: 'react-vendor',
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: 'wallet-vendor',
                test: /node_modules[\\/](@coinbase|@reown|@wagmi|@walletconnect|viem|wagmi)[\\/]/,
                priority: 20,
                maxSize: 700 * 1024,
              },
              {
                name: 'ui-vendor',
                test: /node_modules[\\/](@tanstack|lucide-react)[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
  }
})
