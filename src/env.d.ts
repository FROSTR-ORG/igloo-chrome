interface ImportMetaEnv {
  readonly VITE_DEFAULT_RELAYS?: string;
  readonly VITE_BIFROST_EVENT_KIND?: string;
  readonly VITE_IGLOO_VERBOSE?: string;
  readonly VITE_IGLOO_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.woff' {
  const src: string;
  export default src;
}

declare module '*.woff2' {
  const src: string;
  export default src;
}
