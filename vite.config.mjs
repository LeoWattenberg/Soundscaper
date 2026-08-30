// @ts-check
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { chunkGroups, workerChunkGroups } from './scripts/lib/build-chunk-groups.mjs';
import {
	emitDesktopRendererProductPublicAssets,
	enforceDesktopRendererProductIsolation,
} from './scripts/lib/desktop-renderer-product-isolation.mjs';
import {
	readProductReleaseLinesSync,
	resolveProductApplicationVersion,
} from './scripts/lib/product-release-lines.mjs';
import { enforceStartupGraphBudgets } from './scripts/lib/startup-graph-budget.mjs';
import scopeAudacityDesignSystemCss, {
	getScopedDesignSystemFiles,
	isDesignSystemCssFile,
	normalizeDesignSystemCssFile,
	resetScopedDesignSystemFileCount,
} from './scripts/postcss-audacity-design-system.mjs';
import { createPffftNodeModuleBrowserShim } from './scripts/vite-pffft-browser-shim.mjs';
import { PRODUCT_IDS, normalizeProductId } from './src/common/product-identities.js';

const productId = resolveBuiltProductId(process.env.SCAPE_PRODUCT);
const applicationVersion = resolveProductApplicationVersion(
	productId, readProductReleaseLinesSync(import.meta.dirname),
);
const vendoredDesignSystem = resolve(import.meta.dirname, 'vendor/audacity-design-system');
const desktopCodecComposition = process.env.SCAPE_DESKTOP_CODEC_RUNTIME === 'main-process';

/**
 * The one product this build emits, named by SCAPE_PRODUCT.
 *
 * Each product is deployed from its own Cloudflare Pages project built from this
 * one repository, so the product is a build input rather than a runtime guess. An
 * unset value still means Soundscaper, because that is what every existing
 * invocation of `npm run build` means. Anything else that is not a registered
 * product id fails here: a two-way ternary would answer an unrecognized value by
 * quietly emitting a Soundscaper bundle and deploying it to the other origin.
 *
 * @param {string | undefined} value
 * @returns {'soundscaper' | 'framescaper'}
 */
function resolveBuiltProductId(value) {
	const requested = value === undefined || value === '' ? 'soundscaper' : value;
	if (!PRODUCT_IDS.includes(requested)) {
		throw new Error(
			`SCAPE_PRODUCT must name a built product (${PRODUCT_IDS.join(', ')}); received ${JSON.stringify(value)}.`,
		);
	}
	// `normalizeProductId` re-admits the id against the shared product table; the
	// cast only narrows its `string` return to the two ids just checked above.
	return /** @type {'soundscaper' | 'framescaper'} */ (normalizeProductId(requested));
}

/** @returns {import('vite').Plugin} */
function assertDesignSystemCssScoped() {
	const transformed = new Set();
	return {
		name: 'kw-assert-design-system-css-scoped',
		apply: 'build',
		buildStart() {
			transformed.clear();
			resetScopedDesignSystemFileCount();
		},
		transform(_code, id) {
			if (isDesignSystemCssFile(id)) transformed.add(normalizeDesignSystemCssFile(id));
			return null;
		},
		closeBundle() {
			const expected = [...transformed].sort();
			const scoped = getScopedDesignSystemFiles();
			if (!expected.length || JSON.stringify(scoped) !== JSON.stringify(expected)) {
				const missing = expected.filter((file) => !scoped.includes(file));
				const unexpected = scoped.filter((file) => !transformed.has(file));
				throw new Error(
					'Design-system CSS scoping did not match Vite\'s exact transformed inventory. '
					+ `Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`,
				);
			}
		},
	};
}
export default defineConfig({
	appType: 'spa',
	publicDir: productId === 'soundscaper' && desktopCodecComposition ? false : 'public',
	plugins: [
		createPffftNodeModuleBrowserShim(),
		react(),
		assertDesignSystemCssScoped(),
		enforceStartupGraphBudgets(productId),
		...(productId === 'soundscaper' && desktopCodecComposition
			? [emitDesktopRendererProductPublicAssets(import.meta.dirname, productId)]
			: []),
		...(desktopCodecComposition ? [enforceDesktopRendererProductIsolation(productId)] : []),
	],
	resolve: {
		// File-targeted public aliases plus an app-internal deep component alias.
		// Public deep subpath imports remain unsupported. Mirrored in
		// tsconfig.base.json "paths" for tsc, editors, and tsx-run node tests.
		alias: [
			...(productId === 'soundscaper' ? [
				{
					find: /^\.\/framescaper-capture-copy\.js$/u,
					replacement: resolve(import.meta.dirname, 'src/soundscaper/framescaper-capture-copy.js'),
				},
				{
					find: /^\.\.\/framescaper-(?:finishing-menu|selected-visual-authoring-menu|video-proxy-application-menu)\.ts$/u,
					replacement: resolve(import.meta.dirname, 'src/soundscaper/editor-framescaper-overlay-model.ts'),
				},
				{
					find: /^\.\/FramescaperCaptureRecordControl\.tsx$/u,
					replacement: resolve(import.meta.dirname, 'src/soundscaper/editor-capture-toolbar-control.tsx'),
				},
				{
					find: /^\.\/framescaper-video-proxy-pressure\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-video-preview-product-runtime.ts',
					),
				},
				{
					find: /^\.\/video-preview-(?:external-display|freeze-capture)\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-video-preview-product-runtime.ts',
					),
				},
				{
					find: /^\.\/application-menu-product-runtime\.js$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-application-menu-product-runtime.js',
					),
				},
				{
					find: /^\.\/local-assistance-guided-framescaper-acceptance\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/local-assistance-deferred-publication.ts',
					),
				},
				{
					find: /^\.\.\/\.\.\/\.\.\/framescaper\/editor-local-assistance-(?:reframe|highlight)-publication\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/local-assistance-deferred-publication.ts',
					),
				},
				{
					find: /^\.\/workspace-product-application-menu-runtime\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-workspace-application-menu-runtime.ts',
					),
				},
				{
					find: /^\.\/workspace-product-panel-runtime\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-workspace-panel-runtime.ts',
					),
				},
				{
					find: /^\.\/workspace\/workspace-product-panel-runtime\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-workspace-panel-runtime.ts',
					),
				},
				{
					find: /^\.\.\/workspace\/workspace-product-panel-runtime\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-workspace-panel-runtime.ts',
					),
				},
			] : []),
			...(desktopCodecComposition ? [
				...(productId === 'soundscaper' ? [{
					find: /^\.\/cross-product-handoff-action-facade\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-foreign-family-runtime.ts',
					),
				}, {
					find: /^\.\.\/transfer\/transfer-page-entry\.ts$/u,
					replacement: resolve(
						import.meta.dirname,
						'src/soundscaper/editor-foreign-family-runtime.ts',
					),
				}] : []),
				{
					find: /^\.\/editor-codec-runtime\.ts$/u,
					replacement: resolve(import.meta.dirname, 'src/common/editor/editor-codec-runtime.desktop.ts'),
				},
				{
					find: /^\.\/OfflineRuntimePreferencePanel\.tsx$/u,
					replacement: resolve(import.meta.dirname, 'src/common/editor/ui/dialogs/OfflineRuntimePreferencePanel.desktop.tsx'),
				},
			] : []),
			{
				find: /^@soundscaper\/design-system\/(.+)$/u,
				replacement: resolve(vendoredDesignSystem, 'components/src/$1'),
			},
			{ find: '@dilsonspickles/components', replacement: resolve(vendoredDesignSystem, 'components/src/index.ts') },
			{ find: '@audacity-ui/core', replacement: resolve(vendoredDesignSystem, 'core/src/index.ts') },
			{ find: '@audacity-ui/tokens', replacement: resolve(vendoredDesignSystem, 'tokens/src/index.ts') },
		],
	},
	envPrefix: ['VITE_', 'PUBLIC_'],
	define: {
		__SCAPE_PRODUCT__: JSON.stringify(productId),
		__SCAPE_VERSION__: JSON.stringify(applicationVersion),
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
		manifest: '.offline-build-manifest.json',
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
