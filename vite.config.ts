import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
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
})
