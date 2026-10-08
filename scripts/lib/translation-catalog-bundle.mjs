/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { transformSync } from 'esbuild';

const VIRTUAL_PREFIX = '\0scape:translation-catalog:';
const VIRTUAL_EXTENSION = '.mjs';
const CATALOG_INDEX_SUFFIX = '/src/common/i18n/translations/index.js';
const CATALOG_FIELDS = ['schemaVersion', 'locale', 'provenance', 'entries', 'community'];
const TUPLE_FACTORY = 'const $e=(o,r)=>Array.from({length:r.length/3},(_,i)=>[r[i*3],[o,r[i*3+1],r[i*3+2]]]);';
/** @typedef {{ origin: string, rows: [string, string, string][] }} OriginRun */
/** @typedef {{ entries: object, runs: OriginRun[] }} OriginTable */

/**
 * Keep the committed JSON and its runtime shape intact. Repeated string values
 * share a literal only when their declarations and references save bytes.
 * The JSON snapshot preserves serialization semantics; keys are never interned.
 *
 * @param {Record<string, unknown>} catalog
 */
export function renderTranslationCatalogModule(catalog) {
	const snapshot = /** @type {unknown} */ (JSON.parse(JSON.stringify(catalog)));
	const baseline = renderModule(snapshot, catalog, null), table = originTable(snapshot);
	if (!table) return baseline;
	const candidate = renderModule(snapshot, catalog, table);
	// Charge the complete factory, table calls, literals, declarations and exports.
	if (Buffer.byteLength(candidate) >= Buffer.byteLength(baseline)) return baseline;
	// Array-table keys stay quoted; object keys and reference names may shrink.
	// Compare actual standalone minification too, rather than estimating that loss.
	const options = { minify: true, charset: /** @type {const} */ ('utf8') };
	return Buffer.byteLength(transformSync(candidate, options).code) < Buffer.byteLength(transformSync(baseline, options).code)
		? candidate : baseline;
}

/** @param {unknown} snapshot @param {Record<string, unknown>} catalog @param {OriginTable | null} table */
function renderModule(snapshot, catalog, table) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	countStrings(snapshot, counts, table);
	/** @type {Map<string, string>} */
	const references = new Map();
	const declarations = [];
	for (const [value, count] of counts) {
		if (count < 2) continue;
		const literal = JSON.stringify(value);
		const reference = `$t${references.size}`;
		const declaration = `const ${reference}=${literal};`;
		const literalBytes = Buffer.byteLength(literal);
		// Charge the exact emitted declaration, its separating newline, and every
		// ASCII reference. Even a small positive saving pays its complete source cost.
		const saving = count * literalBytes - Buffer.byteLength(`${declaration}\n`) - count * reference.length;
		if (saving <= 0) continue;
		references.set(value, reference);
		declarations.push(declaration);
	}
	const source = renderJsonValue(snapshot, references, table);
	return [
		...declarations,
		...(table ? [TUPLE_FACTORY] : []),
		`const catalog = ${source};`,
		...CATALOG_FIELDS.filter((key) => Object.hasOwn(catalog, key))
			.map((key) => `export const ${key} = catalog.${key};`),
		'export default catalog;',
	].join('\n');
}

/** @param {unknown} snapshot @returns {OriginTable | null} */
function originTable(snapshot) {
	if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
	const entries = /** @type {Record<string, unknown>} */ (snapshot).entries;
	if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return null;
	/** @type {OriginRun[]} */
	const runs = [];
	for (const [key, tuple] of Object.entries(entries)) {
		if (!translationTuple(tuple)) return null;
		let run = runs.at(-1);
		if (!run || run.origin !== tuple[0]) { run = { origin: tuple[0], rows: [] }; runs.push(run); }
		run.rows.push([key, tuple[1], tuple[2]]);
	}
	return runs.length ? { entries, runs } : null;
}

/** @param {unknown} value @returns {value is [string, string, string]} */
function translationTuple(value) {
	return Array.isArray(value) && value.length === 3 && typeof value[0] === 'string'
		&& typeof value[1] === 'string' && typeof value[2] === 'string';
}

/** @param {unknown} value @param {Map<string, number>} counts @param {OriginTable | null} table */
function countStrings(value, counts, table) {
	if (table && value === table.entries) {
		for (const run of table.runs) {
			countStrings(run.origin, counts, null);
			for (const [, english, translation] of run.rows) {
				countStrings(english, counts, null); countStrings(translation, counts, null);
			}
		}
		return;
	}
	if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
	else if (Array.isArray(value)) for (const item of value) countStrings(item, counts, table);
	else if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) countStrings(item, counts, table);
	}
}

/** @param {unknown} value @param {Map<string, string>} references @param {OriginTable | null} table @returns {string} */
function renderJsonValue(value, references, table) {
	if (table && value === table.entries) {
		const runs = table.runs.map(run => {
			const cells = run.rows.flatMap(([key, english, translation]) => [JSON.stringify(key),
				renderJsonValue(english, references, null), renderJsonValue(translation, references, null)]).join(',');
			return `...$e(${renderJsonValue(run.origin, references, null)},[${cells}])`;
		}).join(',');
		return `Object.fromEntries([${runs}])`;
	}
	if (typeof value === 'string') return references.get(value) ?? JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(item => renderJsonValue(item, references, table)).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value).map(([key, item]) => {
			const property = key === '__proto__' ? '["__proto__"]' : JSON.stringify(key);
			return `${property}:${renderJsonValue(item, references, table)}`;
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
