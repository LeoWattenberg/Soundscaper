/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Desktop Speed warms the renderer's built feature modules after preferences
 * load. The build manifest names exactly the files Vite emitted for this
 * product; using it avoids a second source-level list that can drift as lazy
 * boundaries move. This module is invoked only by the desktop editor.
 */

type ProductId = 'soundscaper' | 'framescaper';
type OptimizeFor = 'speed' | 'memory';

export interface DesktopSpeedWarmupPlan {
	readonly files: readonly string[];
	readonly stylesheets: readonly string[];
	readonly excludedAi: readonly string[];
	readonly excludedWorkers: readonly string[];
	readonly excludedTranslations: readonly string[];
	readonly excludedOther: readonly string[];
}

export interface DesktopSpeedWarmupResult extends DesktopSpeedWarmupPlan {
	readonly loaded: number;
	readonly loadedStylesheets: number;
	readonly skipped: number;
	readonly failed: readonly Readonly<{ file: string; error: unknown }>[];
}

export interface DesktopSpeedWarmupOptions {
	readonly desktop: boolean;
	readonly productId: ProductId;
	readonly performance: Readonly<{ optimizeFor: OptimizeFor }>;
	readonly loadManifest?: () => Promise<unknown>;
	readonly importModule?: (path: string) => Promise<unknown>;
	readonly loadStylesheet?: (path: string) => Promise<void>;
}

const MANIFEST_PATH = '/.offline-build-manifest.json';
const MAX_MANIFEST_ENTRIES = 2_048;
const WARMUP_CONCURRENCY = 8;
const JS_ASSET_PATH = /^assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.js$/u;
const CSS_ASSET_PATH = /^assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.css$/u;
const AI_ENTRY = /(?:assistance|local[-_]?model|text[-_]?to[-_]?speech|mcp|onnx|whisper|llama|kokoro|sherpa)/iu;

/** Only entries for the selected product can be evaluated by its renderer. */
export function planDesktopSpeedWarmup(value: unknown, productId: ProductId): DesktopSpeedWarmupPlan {
	if (productId !== 'soundscaper' && productId !== 'framescaper') {
		throw new TypeError('Desktop speed warmup requires a known product.');
	}
	if (!plainRecord(value) || Object.keys(value).length > MAX_MANIFEST_ENTRIES) {
		throw new TypeError('Desktop speed warmup requires a bounded Vite manifest.');
	}
	const manifest = value;
	const bootstrap = `src/${productId}/ui/${productId === 'soundscaper'
		? 'Soundscaper' : 'Framescaper'}AudioEditorBootstrap.tsx`;
	const otherBootstrap = productId === 'soundscaper'
		? 'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx'
		: 'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx';
	if (!plainRecord(manifest[bootstrap]) || manifest[bootstrap].isDynamicEntry !== true
		|| Object.hasOwn(manifest, otherBootstrap)) {
		throw new TypeError('Desktop speed warmup manifest has the wrong product bootstrap.');
	}

	const files = new Set<string>();
	const stylesheets = new Set<string>();
	const excludedAi: string[] = [];
	const excludedWorkers: string[] = [];
	const excludedTranslations: string[] = [];
	const excludedOther: string[] = [];
	for (const [source, candidate] of Object.entries(manifest)) {
		if (!plainRecord(candidate) || candidate.isDynamicEntry !== true) continue;
		const file = candidate.file;
		if (typeof file !== 'string' || !safeAssetPath(file, JS_ASSET_PATH)) {
			throw new TypeError(`Desktop speed warmup manifest has an untrusted asset path for ${source}.`);
		}
		const cssValue = candidate.css;
		if (cssValue !== undefined && (!Array.isArray(cssValue) || cssValue.length > 32
			|| cssValue.some((path: unknown) => typeof path !== 'string'
				|| !safeAssetPath(path, CSS_ASSET_PATH)))) {
			throw new TypeError(`Desktop speed warmup manifest has an untrusted stylesheet asset path for ${source}.`);
		}
		if (source === bootstrap) continue; // Already evaluated before the editor is ready.
		if (source.includes('?worker') || source.includes('?sharedworker')) {
			excludedWorkers.push(source);
		} else if (source.startsWith('src/common/i18n/translations/')) {
			excludedTranslations.push(source);
		} else if (AI_ENTRY.test(source)) {
			excludedAi.push(source);
		} else if (source.startsWith('src/common/')
			|| source.startsWith('src/soundscaper/')
			|| source.startsWith('src/framescaper/')
			|| source.startsWith('node_modules/')
			|| source === 'soundscaper:pffft-node-module-browser-shim') {
			files.add(file);
			for (const stylesheet of cssValue as readonly string[] | undefined ?? []) {
				stylesheets.add(stylesheet);
			}
		} else {
			excludedOther.push(source);
		}
	}
	return Object.freeze({
		files: Object.freeze([...files].sort()),
		stylesheets: Object.freeze([...stylesheets].sort()),
		excludedAi: Object.freeze(excludedAi.sort()),
		excludedWorkers: Object.freeze(excludedWorkers.sort()),
		excludedTranslations: Object.freeze(excludedTranslations.sort()),
		excludedOther: Object.freeze(excludedOther.sort()),
	});
}

/** Warm feature modules without opening any menu surface or starting any native engine. */
export async function warmDesktopSpeedFeatures(
	options: DesktopSpeedWarmupOptions,
): Promise<DesktopSpeedWarmupResult | null> {
	if (!options.desktop || options.performance.optimizeFor !== 'speed') return null;
	const manifest = await (options.loadManifest ?? loadManifest)();
	const plan = planDesktopSpeedWarmup(manifest, options.productId);
	const importModule = options.importModule ?? loadModule;
	const loadStylesheet = options.loadStylesheet ?? loadStyle;
	let next = 0;
	let nextStylesheet = 0;
	let loaded = 0;
	let loadedStylesheets = 0;
	const failed: { file: string; error: unknown }[] = [];
	const modules = Array.from({ length: Math.min(WARMUP_CONCURRENCY, plan.files.length) }, async () => {
		while (next < plan.files.length) {
			const file = plan.files[next++];
			try {
				await importModule(`/${file}`);
				loaded += 1;
			} catch (error) {
				failed.push({ file, error });
			}
		}
	});
	const styles = Array.from({ length: Math.min(WARMUP_CONCURRENCY, plan.stylesheets.length) }, async () => {
		while (nextStylesheet < plan.stylesheets.length) {
			const file = plan.stylesheets[nextStylesheet++];
			try {
				await loadStylesheet(`/${file}`);
				loadedStylesheets += 1;
			} catch (error) {
				failed.push({ file, error });
			}
		}
	});
	await Promise.all([...modules, ...styles]);
	return Object.freeze({
		...plan,
		loaded,
		loadedStylesheets,
		skipped: plan.excludedAi.length + plan.excludedWorkers.length
			+ plan.excludedTranslations.length + plan.excludedOther.length,
		failed: Object.freeze(failed),
	});
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function safeAssetPath(path: string, pattern: RegExp): boolean {
	return path.length <= 256 && pattern.test(path)
		&& path.split('/').every((segment) => segment !== '.' && segment !== '..');
}

async function loadManifest(): Promise<unknown> {
	const response = await fetch(MANIFEST_PATH, { cache: 'no-store' });
	if (!response.ok) throw new Error(`Desktop speed warmup manifest failed to load (${response.status}).`);
	return await response.json() as unknown;
}

async function loadModule(path: string): Promise<unknown> {
	return await import(/* @vite-ignore */ path);
}

function loadStyle(path: string): Promise<void> {
	const href = new URL(path, document.baseURI).href;
	if ([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
		.some((link) => link.href === href)) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = path;
		link.addEventListener('load', () => resolve(), { once: true });
		link.addEventListener('error', () => {
			link.remove();
			reject(new Error(`Desktop speed stylesheet failed to load: ${path}`));
		}, { once: true });
		document.head.append(link);
	});
}
