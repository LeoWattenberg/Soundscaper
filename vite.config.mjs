// @ts-check
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import scopeAudacityDesignSystemCss, {
	getScopedDesignSystemFileCount,
	resetScopedDesignSystemFileCount,
} from './scripts/postcss-audacity-design-system.mjs';
import { createPffftNodeModuleBrowserShim } from './scripts/vite-pffft-browser-shim.mjs';

const productId = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const vendoredDesignSystem = resolve(import.meta.dirname, 'vendor/audacity-design-system');

// The vendored design system ships ~100 component stylesheets through the
// scoping plugin on every build. A build that scopes far fewer has silently
// stopped matching the vendored path (the plugin fails open), which would
// leak unscoped design-system CSS into the whole site.
const MIN_SCOPED_DESIGN_SYSTEM_FILES = 50;

/** @returns {import('vite').Plugin} */
function assertDesignSystemCssScoped() {
	return {
		name: 'kw-assert-design-system-css-scoped',
		apply: 'build',
		buildStart() {
			resetScopedDesignSystemFileCount();
		},
		closeBundle() {
			const scoped = getScopedDesignSystemFileCount();
			if (scoped < MIN_SCOPED_DESIGN_SYSTEM_FILES) {
				throw new Error(
					`Design-system CSS scoping matched only ${scoped} stylesheets `
					+ `(expected >= ${MIN_SCOPED_DESIGN_SYSTEM_FILES}). The path key in `
					+ 'scripts/postcss-audacity-design-system.mjs no longer matches the vendored tree.',
				);
			}
		},
	};
}
const editorPath = String.raw`src[\\/]common[\\/]editor[\\/]`;
/** @type {import('rolldown').CodeSplittingGroup[]} */
const chunkGroups = [
	{
		name: 'vendor-react',
		test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
		priority: 100,
		maxSize: 400_000,
	},
	{
		name: 'vendor-design-system',
		test: /[\\/]vendor[\\/]audacity-design-system[\\/]/,
		priority: 95,
		maxSize: 400_000,
	},
	{
		name: 'editor-engine',
		test: new RegExp(`${editorPath}(?:engine(?:\\.js|[\\/])|recording(?:\\.js|[\\/])|playback-meter\\.js)`),
		priority: 90,
		maxSize: 400_000,
	},
	{
		name: 'editor-storage-model',
		test: new RegExp(`${editorPath}(?:storage(?:\\.js|[\\/])|project(?:-[^\\/]+)?\\.js|migration\\.js|retention\\.js|history\\.js|session\\.js|stable-id\\.js|preferences\\.js)`),
		priority: 85,
		maxSize: 400_000,
	},
	{
		name: 'editor-timeline',
		test: new RegExp(`${editorPath}(?:ui[\\/](?:AudioEditorTimeline|AudioEditorSampleTools)|video-timeline\\.js|audacity-waveform-renderer\\.js)`),
		priority: 80,
		maxSize: 400_000,
	},
	{
		name: 'editor-controller-core',
		test: new RegExp(`${editorPath}(?:app\\.js|controller[\\/]|commands(?:\\.js|[\\/])|facade\\.ts|index\\.js)`),
		priority: 75,
		maxSize: 400_000,
	},
	{
		name: 'editor-shell',
		test: new RegExp(`${editorPath}ui[\\/](?!(?:dialogs|inspector)[\\/])`),
		priority: 70,
		maxSize: 400_000,
		includeDependenciesRecursively: false,
	},
	{
		name: 'vendor',
		test: /node_modules[\\/]/,
		priority: 60,
		maxSize: 400_000,
	},
	{
		name: 'application',
		tags: ['$initial'],
		priority: 10,
		maxSize: 400_000,
	},
];
/** @type {import('rolldown').CodeSplittingGroup[]} */
const workerChunkGroups = [
	{
		name: 'vendor-sqlite-worker',
		test: /node_modules[\\/]@sqlite\.org[\\/]sqlite-wasm[\\/]/,
		priority: 100,
		maxSize: 400_000,
	},
];

export default defineConfig({
	appType: 'spa',
	plugins: [createPffftNodeModuleBrowserShim(), react(), assertDesignSystemCssScoped()],
	resolve: {
		// File-targeted aliases into the vendored design system; deep subpath
		// imports of these specifiers are unsupported. Mirrored in
		// tsconfig.base.json "paths" for tsc, editors, and tsx-run node tests.
		alias: {
			'@dilsonspickles/components': resolve(vendoredDesignSystem, 'components/src/index.ts'),
			'@audacity-ui/core': resolve(vendoredDesignSystem, 'core/src/index.ts'),
			'@audacity-ui/tokens': resolve(vendoredDesignSystem, 'tokens/src/index.ts'),
		},
	},
	envPrefix: ['VITE_', 'PUBLIC_'],
	define: {
		__SCAPE_PRODUCT__: JSON.stringify(productId),
	},
	worker: {
		format: 'es',
		plugins: () => [createPffftNodeModuleBrowserShim()],
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: workerChunkGroups,
					minSize: 20_000,
				},
				strictExecutionOrder: true,
			},
		},
	},
	build: {
		assetsInlineLimit: 0,
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: chunkGroups,
					minSize: 20_000,
				},
				strictExecutionOrder: true,
			},
		},
	},
	css: {
		postcss: {
			plugins: [scopeAudacityDesignSystemCss()],
		},
	},
});
