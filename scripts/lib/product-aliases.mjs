/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check
import { resolve } from 'node:path';

/**
 * The product substitution table the browser build resolves through.
 *
 * Each entry names a default module by the literal specifier its importers
 * wrote, and the stand-in the other product swaps in for it. The table lives
 * here rather than inline in `vite.config.mjs` so a test can read exactly the
 * rows the build uses instead of re-transcribing them: an export-parity guard
 * that reads its own copy of the table proves nothing about the build.
 *
 * `product` names the built product the row applies to, or is `null` when the
 * row applies to both. `desktopCodecRuntime` is `true` for rows that only apply
 * to the desktop renderer composition (`SCAPE_DESKTOP_CODEC_RUNTIME`), and
 * `null` for rows that apply either way. Order is significant: Vite takes the
 * first matching alias, so this array must stay in the order the build wants.
 *
 * @typedef {Readonly<{
 *   find: RegExp,
 *   standIn: string,
 *   product: 'soundscaper' | 'framescaper' | null,
 *   desktopCodecRuntime: boolean | null,
 * }>} ProductStandInAlias
 */

/** @type {readonly ProductStandInAlias[]} */
export const PRODUCT_STAND_IN_ALIASES = Object.freeze([
	{
		find: /^(?:\.\/|\.\.\/)soundscaper-workflow-product-runtime\.tsx$/u,
		standIn: 'src/framescaper/editor-soundscaper-workflow-product-runtime.tsx',
		product: 'framescaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/framescaper-capture-copy\.js$/u,
		standIn: 'src/soundscaper/framescaper-capture-copy.js',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/framescaper-(?:finishing-menu|selected-visual-authoring-menu|video-proxy-application-menu)\.ts$/u,
		standIn: 'src/soundscaper/editor-framescaper-overlay-model.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/FramescaperCaptureRecordControl\.tsx$/u,
		standIn: 'src/soundscaper/editor-capture-toolbar-control.tsx',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/framescaper-video-proxy-pressure\.ts$/u,
		standIn: 'src/soundscaper/editor-video-preview-product-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/video-preview-(?:external-display|freeze-capture)\.ts$/u,
		standIn: 'src/soundscaper/editor-video-preview-product-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/application-menu-product-runtime\.js$/u,
		standIn: 'src/soundscaper/editor-application-menu-product-runtime.js',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/local-assistance-guided-framescaper-acceptance\.ts$/u,
		standIn: 'src/soundscaper/local-assistance-deferred-publication.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/\.\.\/\.\.\/framescaper\/editor-local-assistance-(?:reframe|highlight)-publication\.ts$/u,
		standIn: 'src/soundscaper/local-assistance-deferred-publication.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/workspace-product-application-menu-runtime\.ts$/u,
		standIn: 'src/soundscaper/editor-workspace-application-menu-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/workspace-product-panel-runtime\.ts$/u,
		standIn: 'src/soundscaper/editor-workspace-panel-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/workspace\/workspace-product-panel-runtime\.ts$/u,
		standIn: 'src/soundscaper/editor-workspace-panel-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/workspace\/workspace-product-panel-runtime\.ts$/u,
		standIn: 'src/soundscaper/editor-workspace-panel-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/cross-product-handoff-action-facade\.ts$/u,
		standIn: 'src/soundscaper/editor-foreign-family-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\.\/transfer\/transfer-page-entry\.ts$/u,
		standIn: 'src/soundscaper/editor-foreign-family-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\/editor-codec-runtime\.ts$/u,
		standIn: 'src/common/editor/editor-codec-runtime.desktop.ts',
		product: null,
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\/OfflineRuntimePreferencePanel\.tsx$/u,
		standIn: 'src/common/editor/ui/dialogs/OfflineRuntimePreferencePanel.desktop.tsx',
		product: null,
		desktopCodecRuntime: true,
	},
]);

/**
 * The rows of {@link PRODUCT_STAND_IN_ALIASES} one build composition applies.
 *
 * @param {Readonly<{ productId: string, desktopCodecComposition?: boolean }>} composition
 * @returns {readonly ProductStandInAlias[]}
 */
export function productStandInAliasesFor({ productId, desktopCodecComposition = false }) {
	return PRODUCT_STAND_IN_ALIASES.filter((entry) => (
		(entry.product === null || entry.product === productId)
		&& (entry.desktopCodecRuntime === null || entry.desktopCodecRuntime === desktopCodecComposition)
	));
}

/**
 * Every `resolve.alias` entry the browser build installs, in build order.
 *
 * The design-system rows are not product substitutions — they are the public
 * package specifiers the vendored design system is served from — so they follow
 * the substitution table rather than living in it.
 *
 * @param {Readonly<{
 *   productId: string,
 *   desktopCodecComposition?: boolean,
 *   repositoryRoot: string,
 * }>} composition
 * @returns {{ find: RegExp | string, replacement: string }[]}
 */
export function productResolveAliases({
	productId,
	desktopCodecComposition = false,
	repositoryRoot,
}) {
	const vendoredDesignSystem = resolve(repositoryRoot, 'vendor/audacity-design-system');
	return [
		...productStandInAliasesFor({ productId, desktopCodecComposition }).map((entry) => ({
			/** @type {RegExp | string} */
			find: entry.find,
			replacement: resolve(repositoryRoot, entry.standIn),
		})),
		{
			find: /^@soundscaper\/design-system\/(.+)$/u,
			replacement: resolve(vendoredDesignSystem, 'components/src/$1'),
		},
		{ find: '@audacity-ui/components', replacement: resolve(vendoredDesignSystem, 'components/src/index.ts') },
		{ find: '@audacity-ui/core', replacement: resolve(vendoredDesignSystem, 'core/src/index.ts') },
		{ find: '@audacity-ui/tokens', replacement: resolve(vendoredDesignSystem, 'tokens/src/index.ts') },
	];
}
