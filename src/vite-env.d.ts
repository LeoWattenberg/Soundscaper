/// <reference types="vite/client" />

declare module '*?raw' {
	const source: string;
	export default source;
}

declare const __SCAPE_PRODUCT__: 'soundscaper' | 'framescaper' | 'motionscaper';
declare const __SCAPE_FRAMESCAPER_LINE__: 'baseline' | 'successor';
declare const __SCAPE_VERSION__: string;
declare const __SCAPE_DESKTOP_RENDERER__: boolean;
