/* SPDX-License-Identifier: AGPL-3.0-only */

import { handbookLocaleForSegment } from './handbook-locales.mjs';

const PRODUCTS = new Set(['soundscaper', 'framescaper', 'motionscaper']);
const NESTED_PRODUCTS = ['framescaper', 'motionscaper'];
const DOCUMENT_EXTENSIONS = '{markdown,mdown,mkdn,mkd,mdwn,md,mdx}';

function assertProduct(productId) {
	if (!PRODUCTS.has(productId)) throw new Error(`Unsupported handbook product: ${String(productId)}.`);
}

function normalizedSegments(entry) {
	return String(entry).replaceAll('\\', '/').split('/').filter(Boolean);
}

function productSegmentIndex(segments) {
	return handbookLocaleForSegment(segments[0]) ? 1 : 0;
}

function isProductEntry(entry, productId) {
	const segments = normalizedSegments(entry);
	return segments[productSegmentIndex(segments)] === productId;
}

function isSharedEditorChooser(entry) {
	const segments = normalizedSegments(entry);
	const relative = segments.slice(productSegmentIndex(segments)).join('/');
	return relative.replace(/\.[^.]+$/u, '') === 'start/choose-an-editor';
}

/** Map a product-owned source path onto the route space of its own handbook. */
export function handbookProductEntryId(entry, productId) {
	assertProduct(productId);
	const segments = normalizedSegments(entry);
	const productIndex = productSegmentIndex(segments);
	if (NESTED_PRODUCTS.includes(productId)) {
		if (segments[productIndex] !== productId) {
			throw new Error(`${entry} does not belong to the ${productId[0].toUpperCase()}${productId.slice(1)} handbook.`);
		}
		segments.splice(productIndex, 1);
	}
	segments[segments.length - 1] = segments.at(-1).replace(/\.[^.]+$/u, '');
	if (segments.at(-1) === 'index' && segments.length > 1) segments.pop();
	return segments.join('/');
}

/** The source boundary and loader options for one product handbook build. */
export function handbookContentPlan(productId) {
	assertProduct(productId);
	const nested = NESTED_PRODUCTS.includes(productId);
	const includes = nested
		? (entry) => isProductEntry(entry, productId)
		: (entry) => !NESTED_PRODUCTS.some(product => isProductEntry(entry, product)) && !isSharedEditorChooser(entry);
	const patterns = nested
		? [
			`${productId}/**/[^_]*.${DOCUMENT_EXTENSIONS}`,
			`*/${productId}/**/[^_]*.${DOCUMENT_EXTENSIONS}`,
		]
		: [
			`**/[^_]*.${DOCUMENT_EXTENSIONS}`,
			...NESTED_PRODUCTS.flatMap(product => [`!${product}/**`, `!*/${product}/**`]),
			`!start/choose-an-editor.${DOCUMENT_EXTENSIONS}`,
			`!*/start/choose-an-editor.${DOCUMENT_EXTENSIONS}`,
		];
	return Object.freeze({
		includes,
		patterns: Object.freeze(patterns),
		generateId: nested
			? ({ entry }) => handbookProductEntryId(entry, productId)
			: undefined,
	});
}
