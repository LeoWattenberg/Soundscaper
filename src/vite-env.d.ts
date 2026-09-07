/// <reference types="vite/client" />

declare module '*?raw' {
	const source: string;
	export default source;
}

declare const __SCAPE_PRODUCT__: 'soundscaper' | 'framescaper';
declare const __SCAPE_VERSION__: string;
