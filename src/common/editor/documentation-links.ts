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

/**
 * The languages the handbook is published in, as the path segment each is
 * served under.
 *
 * The handbook publishes a language by having a directory of pages for it, and
 * a link into a language it does not publish is a 404 rather than a fallback,
 * so the editor has to know which ones exist. The list is short and changes
 * only when a language is translated;
 * `tests/audio-editor-documentation-links.test.ts` holds it to the directories
 * under `handbook/src/content/docs`, so a language cannot be published without
 * the editor learning to link into it.
 */
export const HANDBOOK_LANGUAGES: readonly string[] = Object.freeze([]);

export type DocumentationDestination = 'manual' | 'tutorials';

const DOCUMENTATION_DESTINATION_PATHS = Object.freeze({
	manual: '',
	tutorials: 'first-project/',
} satisfies Record<DocumentationDestination, string>);

/**
 * The handbook's path segment for a reader's language, or nothing for the
 * English pages, which are served at the base path itself.
 *
 * A language the handbook does not publish takes the reader to English rather
 * than to a page that does not exist.
 */
export function handbookLanguagePath(locale: string | undefined): string {
	const segment = String(locale ?? '').toLowerCase();
	return HANDBOOK_LANGUAGES.includes(segment) ? `/${segment}` : '';
}

export function documentationUrl(
	productId: string,
	destination: DocumentationDestination,
	locale?: string,
): string {
	const normalizedProductId = normalizeProductId(productId);
	if (!Object.hasOwn(DOCUMENTATION_DESTINATION_PATHS, destination)) {
		throw new RangeError(`Unsupported documentation destination: ${destination}.`);
	}

	return `${DOCUMENTATION_BASE_URL}${handbookLanguagePath(locale)}/${normalizedProductId}/${DOCUMENTATION_DESTINATION_PATHS[destination]}`;
}
