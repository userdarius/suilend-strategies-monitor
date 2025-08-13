import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    define: {
      // Provide process.env for browser environment
      global: "globalThis",
      process: {
        env: {
          NODE_ENV: JSON.stringify(env.NODE_ENV || "development"),
          NEXT_PUBLIC_SUILEND_USE_BETA_MARKET: JSON.stringify(
            env.NEXT_PUBLIC_SUILEND_USE_BETA_MARKET || "false",
          ),
          // Keep the old process.env for compatibility but also expose via import.meta.env
          VITE_SUI_RPC_URL: JSON.stringify(env.VITE_SUI_RPC_URL || ""),
        },
      },
    },
    resolve: {
      alias: {
        // Replace @sentry/nextjs with stub to avoid build errors
        "@sentry/nextjs": path.resolve(__dirname, "src/sentry-stub.js"),
      },
    },
    optimizeDeps: {
      include: ["@suilend/sdk"],
    },
  };
});
