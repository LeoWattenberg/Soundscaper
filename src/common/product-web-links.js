/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProductId } from './product-identities.js';
import { BUILT_PRODUCT_ID } from './site/route.js';

/**
 * Where a cross-product link points.
 *
 * Each product owns the root of one origin, and one web build serves one
 * deployment. A link to the built product is same-origin; a link to its peer is
 * always an absolute URL to the peer's origin.
 *
 * This is the navigation mirror of `resolveWebRoute` in `site/route.js`: that
 * function decides which product a path names, this one decides which path (or
 * URL) names a product, and both take the built product as the authority.
 */
export const PRODUCT_WEB_ORIGINS = Object.freeze({
	soundscaper: 'https://soundscaper.org',
	framescaper: 'https://framescaper.org',
});

/** The origin a product is served from once it owns one, refusing an unknown product. */
export function productWebOrigin(product) {
	const productId = normalizeProductId(product);
	const origin = PRODUCT_WEB_ORIGINS[productId];
	if (!origin) throw new Error(`No web origin is configured for product: ${productId}.`);
	return origin;
}

/**
 * The href that reaches one product's editor from the build currently running.
 *
 * @param {string} product the product being linked to
 * @param {string} locale the route locale
 * @param {{ builtProductId?: string, embedded?: boolean }} [options]
 * @returns {string} a same-origin path when this build serves that product, an absolute URL otherwise
 */
export function productHref(product, locale, options = {}) {
	const built = normalizeProductId(options.builtProductId ?? BUILT_PRODUCT_ID);
	const target = normalizeProductId(product);
	const suffix = localeSuffix(locale, options.embedded === true);
	if (target === built) return suffix;
	return `${productWebOrigin(target)}${suffix}`;
}

function localeSuffix(locale, embedded) {
	return `${embedded ? '/embed' : ''}/${encodeURIComponent(String(locale || 'en'))}/`;
}
