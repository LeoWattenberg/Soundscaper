/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly PUBLIC_TRANSLATIONS_BASE_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare const __SCAPE_PRODUCT__: 'soundscaper' | 'framescaper';
declare const __SCAPE_VERSION__: string;
