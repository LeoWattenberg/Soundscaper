import { normalizeProductId } from '../products.js';

/**
 * The handbook's public base URL.
 *
 * The handbook is served from a path on the Soundscaper origin rather than a
 * documentation subdomain, so it needs no DNS record or Pages project of its
 * own and ships in the same deployment as the editor. Framescaper links to the
 * same handbook across origins; there is one handbook, not one per product.
 *
 * `scripts/lib/product-web-routing.mjs` is the build-side authority for the
 * same base path and composes the Cloudflare rules it receives.
 */
export const DOCUMENTATION_BASE_URL = 'https://soundscaper.org/docs';

export type DocumentationDestination = 'manual' | 'tutorials';

const DOCUMENTATION_DESTINATION_PATHS = Object.freeze({
	manual: '',
	tutorials: 'first-project/',
} satisfies Record<DocumentationDestination, string>);

export function documentationUrl(productId: string, destination: DocumentationDestination): string {
	const normalizedProductId = normalizeProductId(productId);
	if (!Object.hasOwn(DOCUMENTATION_DESTINATION_PATHS, destination)) {
		throw new RangeError(`Unsupported documentation destination: ${destination}.`);
	}

	return `${DOCUMENTATION_BASE_URL}/${normalizedProductId}/${DOCUMENTATION_DESTINATION_PATHS[destination]}`;
}
