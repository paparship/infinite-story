import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-standalone',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'standalone.html'),
      },
      output: {
        // 确保输出文件名不带 hash（便于部署）
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: {
    port: 5175,
    open: '/standalone.html',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@standalone': path.resolve(__dirname, 'standalone'),
    },
  },
});
