/* SPDX-License-Identifier: AGPL-3.0-only */

// This bounds generated source before minification; emitted chunks retain the
// repository's independent 500 KB ceiling. Committed catalogs stay whole.
export const TRANSLATION_CATALOG_MODULE_BYTES = 200_000;
export const TRANSLATION_CATALOG_PART_PREFIX = '\0scape:translation-catalog-part:';
const ENTRY_PAYLOAD_BYTES = 180_000;

/** @param {string} path @param {number} index */
export function translationCatalogPartId(path, index) {
	return `${TRANSLATION_CATALOG_PART_PREFIX}${path}:${index}.mjs`;
}

/**
 * Partition only the generated entries object. Keep the complete JSON snapshot,
 * field order, attribution and tuple contents; small catalogs use one module.
 * The renderer is supplied by the owning plugin so compaction has one owner.
 *
 * @param {Record<string, unknown>} catalog
 * @param {(value: Record<string, unknown>) => string} render
 * @returns {{ root: string, parts: string[] }}
 */
export function partitionTranslationCatalog(catalog, render) {
	const snapshot = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(catalog)));
	const source = render(snapshot);
	if (Buffer.byteLength(source) <= TRANSLATION_CATALOG_MODULE_BYTES) return { root: source, parts: [] };
	const entries = snapshot.entries;
	if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return { root: source, parts: [] };
	const rows = Object.entries(entries);
	if (!rows.length) return { root: source, parts: [] };
	const root = render({ ...snapshot, entries: {} });
	if (Buffer.byteLength(root) > TRANSLATION_CATALOG_MODULE_BYTES) {
		throw new Error('Translation catalog metadata exceeds the generated module budget.');
	}
	/** @type {string[]} */
	const parts = [];
	/** @type {[string, unknown][]} */
	let pending = [];
	let bytes = 0;
	function flush() {
		if (!pending.length) return;
		const part = render({ entries: Object.fromEntries(pending) });
		if (Buffer.byteLength(part) > TRANSLATION_CATALOG_MODULE_BYTES) {
			throw new Error('Translation catalog entry exceeds the generated module budget.');
		}
		parts.push(part); pending = []; bytes = 0;
	}
	for (const row of rows) {
		const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
		if (pending.length && bytes + rowBytes > ENTRY_PAYLOAD_BYTES) flush();
		pending.push(row); bytes += rowBytes;
	}
	flush();
	return { root, parts };
}

/**
 * Populate the renderer's existing entries object rather than replacing it, so
 * its named export remains the same object. Define data properties to preserve
 * prototype-like keys without invoking Object.prototype's legacy setter.
 *
 * @param {{ root: string, parts: string[] }} partition
 * @param {string} path
 */
export function assembleTranslationCatalogModule(partition, path) {
	if (!partition.parts.length) return partition.root;
	return [
		...partition.parts.map((_, index) =>
			`import {entries as $p${index}} from ${JSON.stringify(translationCatalogPartId(path, index))};`),
		partition.root,
		...partition.parts.map((_, index) =>
			`Object.defineProperties(catalog.entries,Object.getOwnPropertyDescriptors($p${index}));`),
	].join('\n');
}
