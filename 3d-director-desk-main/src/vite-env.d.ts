/// <reference types="vite/client" />

declare const __LOCAL_GUO_ASSETS_AVAILABLE__: boolean;

declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
}
