/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];
const MINIMUM_STRING_SAVING_BYTES = 32;

/**
 * Keep the committed JSON and its runtime shape intact. Repeated string values
 * share a literal only when their declarations and references save bytes.
 * The JSON snapshot preserves serialization semantics; keys are never interned.
 *
 * @param {Record<string, unknown>} catalog
 */
export function renderTranslationCatalogModule(catalog) {
	const snapshot = /** @type {unknown} */ (JSON.parse(JSON.stringify(catalog)));
	/** @type {Map<string, number>} */
	const counts = new Map();
	countStrings(snapshot, counts);
	/** @type {Map<string, string>} */
	const references = new Map();
	const declarations = [];
	for (const [value, count] of counts) {
		const literal = JSON.stringify(value);
		const reference = `$t${references.size}`;
		const declaration = `const ${reference}=${literal};`;
		const literalBytes = Buffer.byteLength(literal);
		const saving = count * literalBytes - Buffer.byteLength(declaration) - count * reference.length;
		if (saving <= MINIMUM_STRING_SAVING_BYTES) continue;
		references.set(value, reference);
		declarations.push(declaration);
	}
	const source = renderJsonValue(snapshot, references);
	return [
		...declarations,
		`const catalog = ${source};`,
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	].join('\n');
}

/** @param {unknown} value @param {Map<string, number>} counts */
function countStrings(value, counts) {
	if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
	else if (Array.isArray(value)) for (const item of value) countStrings(item, counts);
	else if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) countStrings(item, counts);
	}
}

/** @param {unknown} value @param {Map<string, string>} references @returns {string} */
function renderJsonValue(value, references) {
	if (typeof value === 'string') return references.get(value) ?? JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(item => renderJsonValue(item, references)).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value).map(([key, item]) => {
			const property = key === '__proto__' ? '["__proto__"]' : JSON.stringify(key);
			return `${property}:${renderJsonValue(item, references)}`;
		}).join(',')}}`;
	}
	return JSON.stringify(value);
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
