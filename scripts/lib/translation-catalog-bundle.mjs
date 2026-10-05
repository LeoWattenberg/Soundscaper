/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];

/**
 * Keep the committed JSON and its runtime shape intact, but emit each origin
 * tag once instead of repeating "machine" thousands of times in a JS chunk.
 * Only tuple prefixes are substituted; quoted text stays JSON-escaped.
 *
 * @param {Record<string, unknown>} catalog
 */
export function renderTranslationCatalogModule(catalog) {
	const source = JSON.stringify(catalog)
		.replace(/\["(machine|audacity|human)",/gu, '[__catalogOrigin_$1,')
		.replaceAll('"__proto__":', '["__proto__"]:');
	return [
		'const __catalogOrigin_machine = "machine";',
		'const __catalogOrigin_audacity = "audacity";',
		'const __catalogOrigin_human = "human";',
		`const catalog = ${source};`,
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	].join('\n');
}

/** Substitute only the generated index's lazy catalog imports during builds. */
export function createTranslationCatalogBundlePlugin() {
	return {
		name: 'scape:compact-translation-catalogs',
		enforce: /** @type {const} */ ('pre'),
		apply: /** @type {const} */ ('build'),
		/** @param {string} source @param {string | undefined} importer */
		resolveId(source, importer) {
			if (!importer?.replaceAll('\\', '/').endsWith(CATALOG_INDEX_SUFFIX)
				|| !/^\.\/[^/\\]+\.json$/u.test(source)) return null;
			return `${VIRTUAL_PREFIX}${resolve(dirname(importer), source)}${VIRTUAL_EXTENSION}`;
		},
		/** @this {{ addWatchFile(path: string): void }} @param {string} id */
		async load(id) {
			if (!id.startsWith(VIRTUAL_PREFIX)) return null;
			const path = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_EXTENSION.length);
			this.addWatchFile(path);
			return renderTranslationCatalogModule(JSON.parse(await readFile(path, 'utf8')));
		},
	};
}
