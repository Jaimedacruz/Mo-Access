import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = path.join(root, "public");
const outDir = path.resolve(root, "../../dist/extension");

const alias = {
  "@shared": path.resolve(root, "../../shared"),
  "@extension": path.join(root, "src")
};

await build({
  root,
  publicDir,
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.join(root, "popup.html")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});

await build({
  root,
  publicDir: false,
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: false,
    lib: {
      entry: path.join(root, "src/background/index.ts"),
      formats: ["iife"],
      name: "MoAccessBackground",
      fileName: () => "assets/background.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});

await build({
  root,
  publicDir: false,
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: false,
    lib: {
      entry: path.join(root, "src/content/index.ts"),
      formats: ["iife"],
      name: "MoAccessContent",
      fileName: () => "assets/content.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
