/* SPDX-License-Identifier: AGPL-3.0-only */

import { PRODUCT_IDS } from '../../../src/common/product-identities.js';

export const BROWSER_PRODUCT_ORIGINS_VARIABLE = 'SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS';

/**
 * Resolve an editor route only when a test harness declares independent
 * product origins. Explicit URLs remain authoritative for packaged Electron
 * and the dedicated dual-origin suite.
 */
export function resolveBrowserProductTestUrl(path, environment = process.env) {
	if (typeof path !== 'string') throw new TypeError('A browser product test URL must be a string.');
	if (/^https?:\/\//u.test(path)) return path;
	const encoded = environment[BROWSER_PRODUCT_ORIGINS_VARIABLE];
	if (encoded === undefined || encoded === '') return path;
	const origins = browserProductOrigins(encoded);
	for (const productId of PRODUCT_IDS.filter((product) => product !== 'soundscaper')) {
		const prefix = `/${productId}`;
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			return productUrl(path.slice(prefix.length) || '/', productId, origins);
		}
	}
	if (path.startsWith('/')) return productUrl(path, 'soundscaper', origins);
	return path;
}

function productUrl(path, productId, origins) {
	if (!origins[productId]) throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} omits ${productId}.`);
	return new URL(path, origins[productId]).href;
}

function browserProductOrigins(encoded) {
	let value;
	try {
		value = JSON.parse(encoded);
	} catch (error) {
		throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must be valid JSON.`, { cause: error });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
		throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name loopback product origins.`);
	}
	const origins = {};
	for (const productId of Object.keys(value)) {
		if (!PRODUCT_IDS.includes(productId)) {
			throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name registered products.`);
		}
		let url;
		try {
			url = new URL(value[productId]);
		} catch (error) {
			throw new Error(
				`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name loopback product origins.`,
				{ cause: error },
			);
		}
		if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
			|| !url.port || url.pathname !== '/' || url.search || url.hash) {
			throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name loopback product origins.`);
		}
		origins[productId] = url.origin;
	}
	if (new Set(Object.values(origins)).size !== Object.keys(origins).length) {
		throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name distinct product origins.`);
	}
	return origins;
}
