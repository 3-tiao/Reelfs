import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => {
  const env = loadEnv("development", process.cwd());

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    define: {
      'import.meta.env.VITE_LOG_LEVEL': JSON.stringify(env.VITE_LOG_LEVEL || 'DEBUG'),
    },
  };
});
