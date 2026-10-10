import { normalizeProductId } from '../products.js';

/**
 * The handbook's public base URL.
 *
 * Each product serves a filtered handbook from the same path on its own origin.
 * Keeping the origin product-owned prevents one editor's tutorials from being
 * published, searched, or canonicalized by the other editor's site.
 *
 * `scripts/lib/product-web-routing.mjs` is the build-side authority for the
 * same base path and composes the Cloudflare rules it receives.
 */
const DOCUMENTATION_BASE_PATH = '/docs';
const DOCUMENTATION_ORIGINS = Object.freeze({
	soundscaper: 'https://soundscaper.org',
	framescaper: 'https://framescaper.org',
});
type DocumentationProductId = keyof typeof DOCUMENTATION_ORIGINS;

function normalizeDocumentationProductId(productId: string): DocumentationProductId {
	const normalized = normalizeProductId(productId);
	if (normalized === 'soundscaper' || normalized === 'framescaper') return normalized;
	throw new RangeError(`Unsupported documentation product: ${normalized}.`);
}

export function documentationBaseUrl(productId: string): string {
	return `${DOCUMENTATION_ORIGINS[normalizeDocumentationProductId(productId)]}${DOCUMENTATION_BASE_PATH}`;
}

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
export const HANDBOOK_LANGUAGES: readonly string[] = Object.freeze([
	'de', 'ar', 'cs', 'el', 'en-gb', 'es', 'fa',
	'fi', 'fr', 'gl', 'he', 'hi', 'hy', 'id', 'it', 'ja',
	'ko', 'nl', 'pl', 'pt-br', 'pt-pt', 'ro', 'ru', 'tr', 'uk', 'vi', 'zh-cn', 'zh-tw',
]);

export type DocumentationDestination = 'manual' | 'tutorials';

const DOCUMENTATION_DESTINATION_PATHS = Object.freeze({
	soundscaper: Object.freeze({
		manual: '',
		tutorials: 'tutorials/your-first-project/',
	}),
	framescaper: Object.freeze({
		manual: '',
		tutorials: 'first-project/',
	}),
} satisfies Record<'soundscaper' | 'framescaper', Record<DocumentationDestination, string>>);

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
	const normalizedProductId = normalizeDocumentationProductId(productId);
	if (!Object.hasOwn(DOCUMENTATION_DESTINATION_PATHS[normalizedProductId], destination)) {
		throw new RangeError(`Unsupported documentation destination: ${destination}.`);
	}

	return `${documentationBaseUrl(normalizedProductId)}${handbookLanguagePath(locale)}/${DOCUMENTATION_DESTINATION_PATHS[normalizedProductId][destination]}`;
}

/** Names a fixed desktop destination without passing a renderer URL to the host. */
export function desktopDocumentationDestination(url: string): string | null {
	for (const productId of ['soundscaper', 'framescaper']) {
		for (const destination of ['manual', 'tutorials'] as const) {
			for (const locale of ['', ...HANDBOOK_LANGUAGES]) {
				if (url === documentationUrl(productId, destination, locale)) {
					return locale ? `${destination}-${locale}` : destination;
				}
			}
		}
	}
	return null;
}
