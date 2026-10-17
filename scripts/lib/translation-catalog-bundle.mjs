/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];
const ORIGIN_DECLARATIONS = ['machine', 'audacity', 'human']
	.map((origin) => `const __catalogOrigin_${origin} = ${JSON.stringify(origin)};`);

/** @param {unknown} value */
function compactCatalogValue(value) {
	return JSON.stringify(value)
		.replace(/\["(machine|audacity|human)",/gu, '[__catalogOrigin_$1,')
		.replaceAll('"__proto__":', '["__proto__"]:');
}

/** @param {Record<string, unknown>} catalog */
function catalogExports(catalog) {
	return [
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	];
}

/** @param {string} key */
function isMotionTranslation(key) {
	return key.startsWith('ui.motionscaper.') || key.startsWith('ui.motionscaper-')
		|| key.startsWith('ui.motionLinkBridge.');
}

/** @param {Record<string, unknown>} entries @param {string} owner */
function renderCatalogPart(entries, owner) {
	const values = Object.fromEntries(Object.entries(entries)
		.filter(([key]) => isMotionTranslation(key) === (owner === 'motion')));
	return [...ORIGIN_DECLARATIONS, `export default ${compactCatalogValue(values)};`].join('\n');
}

/**
 * Keep the committed JSON and its runtime shape intact, but emit each origin
 * tag once instead of repeating "machine" thousands of times in a JS chunk.
 * Only tuple prefixes are substituted; quoted text stays JSON-escaped.
 *
 * @param {Record<string, unknown>} catalog
 */
export function renderTranslationCatalogModule(catalog) {
	return [
		...ORIGIN_DECLARATIONS,
		`const catalog = ${compactCatalogValue(catalog)};`,
		...catalogExports(catalog),
	].join('\n');
}

/**
 * Substitute the generated index's lazy imports. A locale facade assembles its
 * core and Motion entries so the expanded catalog keeps both semantic owners
 * below the production chunk ceiling without changing the committed catalog.
 */
export function createTranslationCatalogBundlePlugin() {
	/** @type {Map<string, { path: string, owner: string }>} */
	const parts = new Map();
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (parts.has(source)) return source;
			if (!importer?.replaceAll('\\', '/').endsWith(CATALOG_INDEX_SUFFIX)
				|| !/^\.\/[^/\\]+\.json$/u.test(source)) return null;
			return `${VIRTUAL_PREFIX}${resolve(dirname(importer), source)}${VIRTUAL_EXTENSION}`;
		},
		/** @this {{ addWatchFile(path: string): void }} @param {string} id */
		async load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const part = parts.get(id);
			if (part) {
				this.addWatchFile(part.path);
				const catalog = JSON.parse(await readFile(part.path, 'utf8'));
				return renderCatalogPart(catalog.entries, part.owner);
			}
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			const catalog = JSON.parse(await readFile(path, 'utf8'));
			if (!Object.keys(catalog.entries).some(isMotionTranslation)) return renderTranslationCatalogModule(catalog);
			const imports = [];
			for (const owner of ['core', 'motion']) {
				const partId = `${VIRTUAL_PREFIX}${path}.${owner}${VIRTUAL_EXTENSION}`;
				parts.set(partId, { path, owner });
				imports.push(`import(${JSON.stringify(partId)})`);
			}
			return [
				// The selected locale awaits its fragments. Static imports here would
				// put every locale's fragment URLs in the initial Vite preload list.
				`const [core, motion] = await Promise.all([${imports.join(', ')}]);`,
				...ORIGIN_DECLARATIONS,
				`const catalog = { ...${compactCatalogValue({ ...catalog, entries: undefined })}, entries: { ...core.default, ...motion.default } };`,
				...catalogExports(catalog),
			].join('\n');
		},
		/** @param {import('rolldown').OutputOptions} options */
		outputOptions(options) {
			if (options.codeSplitting === false) return null;
			const splitting = typeof options.codeSplitting === 'object' ? options.codeSplitting : {};
			return { ...options, codeSplitting: {
				...splitting,
				groups: [
					...(splitting.groups ?? []),
					{
						// Output options run before loading the graph; resolve registered
						// virtual owners when the bundler assigns each module to a chunk.
						/** @param {string} id */
						name(id) {
							const part = parts.get(id);
							return part ? `translation-${basename(part.path, '.json')}-${part.owner}` : null;
						},
						priority: 200, minSize: 0, includeDependenciesRecursively: false,
					},
				],
			} };
		},
	};
}
