import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Provide process.env for browser environment
    global: "globalThis",
    process: {
      env: {
        NODE_ENV: JSON.stringify(process.env.NODE_ENV || "development"),
        NEXT_PUBLIC_SUILEND_USE_BETA_MARKET: JSON.stringify(
          process.env.NEXT_PUBLIC_SUILEND_USE_BETA_MARKET || "false",
        ),
        VITE_SUI_RPC_URL: JSON.stringify(process.env.VITE_SUI_RPC_URL || ""),
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
});
