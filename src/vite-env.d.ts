/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly PUBLIC_FFMPEG_CORE_BASE_URL?: string;
	readonly PUBLIC_TRANSLATIONS_BASE_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare const __SCAPE_PRODUCT__: 'soundscaper' | 'framescaper';
