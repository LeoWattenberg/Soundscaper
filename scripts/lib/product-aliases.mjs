/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check
import { dirname, resolve } from 'node:path';

/**
 * The product substitution table the browser build resolves through.
 *
 * Each entry names the source files eligible for substitution and the stand-in
 * another product uses. `find` records the historical import spellings for
 * parity tests; Vite and the product compiler host resolve by source path so
 * a same-named file in another directory cannot be substituted accidentally.
 * The table lives here so those tests read the same rows as the build.
 *
 * `product` names the built product the row applies to, or is `null` when the
 * row applies to both. `desktopCodecRuntime` is `true` for rows that only apply
 * to the desktop renderer composition (`SCAPE_DESKTOP_CODEC_RUNTIME`), and
 * `null` for rows that apply either way. A source file may occur in more than
 * one row only when all applicable rows select the same stand-in.
 *
 * @typedef {Readonly<{
 *   find: RegExp,
 *   sourcePaths: readonly string[],
 *   standIn: string,
 *   product: 'soundscaper' | 'framescaper' | null,
 *   desktopCodecRuntime: boolean | null,
 * }>} ProductStandInAlias
 */

/** @type {readonly ProductStandInAlias[]} */
export const PRODUCT_STAND_IN_ALIASES = Object.freeze([
	{
		find: /^(?:\.\/|\.\.\/)soundscaper-workflow-product-runtime\.tsx$/u,
		sourcePaths: ['src/common/editor/ui/soundscaper-workflow-product-runtime.tsx'],
		standIn: 'src/framescaper/editor-soundscaper-workflow-product-runtime.tsx',
		product: 'framescaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/framescaper-capture-copy\.js$/u,
		sourcePaths: ['src/common/i18n/framescaper-capture-copy.js'],
		standIn: 'src/soundscaper/framescaper-capture-copy.js',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^(?:\.\/|\.\.\/)framescaper-(?:finishing-menu|selected-visual-authoring-menu|video-proxy-application-menu)\.ts$/u,
		sourcePaths: [
			'src/common/editor/ui/framescaper-finishing-menu.ts',
			'src/common/editor/ui/framescaper-selected-visual-authoring-menu.ts',
			'src/common/editor/ui/framescaper-video-proxy-application-menu.ts',
		],
		standIn: 'src/soundscaper/editor-framescaper-overlay-model.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/FramescaperCaptureRecordControl\.tsx$/u,
		sourcePaths: ['src/common/editor/ui/toolbar/FramescaperCaptureRecordControl.tsx'],
		standIn: 'src/soundscaper/editor-capture-toolbar-control.tsx',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/framescaper-video-proxy-pressure\.ts$/u,
		sourcePaths: ['src/common/editor/ui/workspace/framescaper-video-proxy-pressure.ts'],
		standIn: 'src/soundscaper/editor-video-preview-product-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/video-preview-(?:external-display|freeze-capture)\.ts$/u,
		sourcePaths: [
			'src/common/editor/ui/workspace/video-preview-external-display.ts',
			'src/common/editor/ui/workspace/video-preview-freeze-capture.ts',
		],
		standIn: 'src/soundscaper/editor-video-preview-product-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/application-menu-product-runtime\.js$/u,
		sourcePaths: ['src/common/editor/ui/application-menu-product-runtime.js'],
		standIn: 'src/soundscaper/editor-application-menu-product-runtime.js',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/\.\.\/local-assistance-guided-framescaper-acceptance\.ts$/u,
		sourcePaths: ['src/common/editor/controller/assistance/local-assistance-guided-framescaper-acceptance.ts'],
		standIn: 'src/soundscaper/local-assistance-deferred-publication.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/framescaper\/editor-local-assistance-(?:reframe|highlight)-publication\.ts$/u,
		sourcePaths: [
			'src/framescaper/editor-local-assistance-reframe-publication.ts',
			'src/framescaper/editor-local-assistance-highlight-publication.ts',
		],
		standIn: 'src/soundscaper/local-assistance-deferred-publication.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/workspace-product-application-menu-runtime\.ts$/u,
		sourcePaths: ['src/common/editor/ui/workspace/workspace-product-application-menu-runtime.ts'],
		standIn: 'src/soundscaper/editor-workspace-application-menu-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/workspace-product-panel-runtime\.ts$/u,
		sourcePaths: ['src/common/editor/ui/workspace/workspace-product-panel-runtime.ts'],
		standIn: 'src/soundscaper/editor-workspace-panel-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\/workspace\/workspace-product-panel-runtime\.ts$/u,
		sourcePaths: ['src/common/editor/ui/workspace/workspace-product-panel-runtime.ts'],
		standIn: 'src/soundscaper/editor-workspace-panel-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/workspace\/workspace-product-panel-runtime\.ts$/u,
		sourcePaths: ['src/common/editor/ui/workspace/workspace-product-panel-runtime.ts'],
		standIn: 'src/soundscaper/editor-workspace-panel-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: null,
	},
	{
		find: /^\.\.\/document\/cross-product-handoff-action-facade\.ts$/u,
		sourcePaths: ['src/common/editor/controller/document/cross-product-handoff-action-facade.ts'],
		standIn: 'src/soundscaper/editor-foreign-family-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\.\/transfer\/transfer-page-entry\.ts$/u,
		sourcePaths: ['src/common/transfer/transfer-page-entry.ts'],
		standIn: 'src/soundscaper/editor-foreign-family-runtime.ts',
		product: 'soundscaper',
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\/editor-framescaper-(?:native-services|finishing-additional|visual-inspector-additional|menus-additional|finishing-surface)-copy\.ts$/u,
		sourcePaths: [
			'src/common/i18n/editor-framescaper-native-services-copy.ts',
			'src/common/i18n/editor-framescaper-finishing-additional-copy.ts',
			'src/common/i18n/editor-framescaper-visual-inspector-additional-copy.ts',
			'src/common/i18n/editor-framescaper-menus-additional-copy.ts',
			'src/common/i18n/editor-framescaper-finishing-surface-copy.ts',
		],
		standIn: 'src/common/i18n/editor-desktop-copy.ts',
		product: 'soundscaper',
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\.\/\.\.\/(?:\.\.\/)?i18n\/editor-framescaper-(?:native-services|finishing-additional|visual-inspector-additional|menus-additional|finishing-surface)-copy\.ts$/u,
		sourcePaths: [
			'src/common/i18n/editor-framescaper-native-services-copy.ts',
			'src/common/i18n/editor-framescaper-finishing-additional-copy.ts',
			'src/common/i18n/editor-framescaper-visual-inspector-additional-copy.ts',
			'src/common/i18n/editor-framescaper-menus-additional-copy.ts',
			'src/common/i18n/editor-framescaper-finishing-surface-copy.ts',
		],
		standIn: 'src/common/i18n/editor-desktop-copy.ts',
		product: 'soundscaper',
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\.\/\.\.\/editor-codec-runtime\.ts$/u,
		sourcePaths: ['src/common/editor/editor-codec-runtime.ts'],
		standIn: 'src/common/editor/editor-codec-runtime.desktop.ts',
		product: null,
		desktopCodecRuntime: true,
	},
	{
		find: /^\.\/browser-streamed-wavpack-decoder\.ts$/u,
		sourcePaths: ['src/common/editor/browser-streamed-wavpack-decoder.ts'],
		standIn: 'src/common/editor/browser-streamed-wavpack-decoder.desktop.ts',
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
 * Select by the file the importer names, rather than by a relative spelling
 * that may refer to an unrelated file from another directory.
 *
 * @param {string} specifier
 * @param {string | undefined | null} importer
 * @param {Readonly<{productId: string, desktopCodecComposition?: boolean, repositoryRoot: string}>} composition
 * @returns {string | null}
 */
export function productSubstitutionForImport(specifier, importer, composition) {
	return createProductSubstitutionResolver(
		composition.repositoryRoot, productStandInAliasesFor(composition),
	)(specifier, importer);
}

/**
 * @param {string} repositoryRoot
 * @param {readonly Pick<ProductStandInAlias, 'sourcePaths' | 'standIn'>[]} rows
 * @returns {(specifier: string, importer: string | undefined | null) => string | null}
 */
export function createProductSubstitutionResolver(repositoryRoot, rows) {
	/** @type {Map<string, string>} */
	const replacements = new Map();
	for (const row of rows) {
		const standIn = resolve(repositoryRoot, row.standIn);
		for (const path of row.sourcePaths) {
			const source = resolve(repositoryRoot, path);
			const previous = replacements.get(source);
			if (previous && previous !== standIn) {
				throw new Error(`Conflicting product substitutions for ${path}.`);
			}
			replacements.set(source, standIn);
		}
	}
	return (specifier, importer) => {
		if (!importer || !/^\.\.?\//u.test(specifier)) return null;
		const importerPath = importer.split('?')[0];
		const sourcePath = resolve(dirname(importerPath), specifier);
		const standIn = replacements.get(sourcePath) ?? null;
		// A stand-in imports the original seam's type contract. Rewriting that
		// import back to the stand-in creates a self-referential type cycle.
		return importerPath === standIn ? null : standIn;
	};
}

/** @param {Readonly<{productId: string, desktopCodecComposition?: boolean, repositoryRoot: string}>} composition */
export function productSubstitutionPlugin(composition) {
	const resolveSubstitution = createProductSubstitutionResolver(
		composition.repositoryRoot, productStandInAliasesFor(composition),
	);
	return {
		name: 'scape-product-substitutions',
		enforce: /** @type {const} */ ('pre'),
		/** @param {string} specifier @param {string | undefined} importer */
		resolveId(specifier, importer) {
			return resolveSubstitution(specifier, importer);
		},
	};
}

/**
 * Public design-system package aliases. Product substitutions use a plugin so
 * they can inspect the importer's resolved source path.
 *
 * @param {Readonly<{
 *   productId: string,
 *   desktopCodecComposition?: boolean,
 *   repositoryRoot: string,
 * }>} composition
 * @returns {{ find: RegExp | string, replacement: string }[]}
 */
export function productResolveAliases({
	repositoryRoot,
}) {
	const vendoredDesignSystem = resolve(repositoryRoot, 'vendor/audacity-design-system');
	return [
		{
			find: /^@soundscaper\/design-system\/(.+)$/u,
			replacement: resolve(vendoredDesignSystem, 'components/src/$1'),
		},
		{ find: '@audacity-ui/components', replacement: resolve(vendoredDesignSystem, 'components/src/index.ts') },
		{ find: '@audacity-ui/core', replacement: resolve(vendoredDesignSystem, 'core/src/index.ts') },
		{ find: '@audacity-ui/tokens', replacement: resolve(vendoredDesignSystem, 'tokens/src/index.ts') },
	];
}
