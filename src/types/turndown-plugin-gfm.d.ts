declare module "turndown-plugin-gfm" {
  export const gfm: (service: import("turndown")) => void;
  export const tables: (service: import("turndown")) => void;
  export const strikethrough: (service: import("turndown")) => void;
}
