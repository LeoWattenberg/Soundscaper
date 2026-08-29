/* SPDX-License-Identifier: AGPL-3.0-only */

const LAST_ACTIVE_PRODUCT_KEY = 'scape_last_active_product';
const SHARED_THEME_KEY = 'soundscaper_theme';

/** The storage key a product's own theme choice is remembered under. */
export function productThemeKey(productId) {
	return `${productId}_theme`;
}

/**
 * Remember the visited product and paint the document in its theme.
 *
 * Both halves touch storage, and a browser that refuses site data - a private
 * window, blocked site data, an exhausted quota - throws from the accessor
 * rather than answering with nothing. They are therefore guarded apart:
 * sharing one guard let a refused *write* skip the theme entirely, and because
 * the dark palette is reached only through `:root[data-theme='dark']`, that
 * left a visitor whose system asks for dark looking at the light one.
 */
export function applyDocumentTheme(root, productId, scope = globalThis) {
	rememberActiveProduct(productId, scope);
	const theme = resolveDocumentTheme(productId, scope);
	paintDocumentTheme(root, theme);
	return theme;
}

/**
 * The theme a visit resolves to: the choice this visitor stored, and only
 * failing that the system preference. Callers that repaint the document later -
 * the editor's own appearance preference among them - read it rather than the
 * media query alone, so a stored choice is never quietly discarded.
 */
export function resolveDocumentTheme(productId, scope = globalThis) {
	return storedDocumentTheme(productId, scope) || (prefersDarkTheme(scope) ? 'dark' : 'light');
}

/** Paint a resolved theme onto a document root. */
export function paintDocumentTheme(root, theme) {
	root.dataset.theme = theme;
	root.style.colorScheme = theme;
}

/**
 * Persist a chosen theme, reporting refusal instead of throwing. The caller has
 * already painted the choice, which is the half that must not depend on storage.
 */
export function storeDocumentTheme(productId, theme, scope = globalThis) {
	try {
		scope.localStorage?.setItem(productThemeKey(productId), theme);
		return true;
	} catch {
		return false;
	}
}

function rememberActiveProduct(productId, scope) {
	try {
		scope.localStorage?.setItem(LAST_ACTIVE_PRODUCT_KEY, productId);
	} catch {
		// A visit that cannot be remembered is still a visit worth painting.
	}
}

function storedDocumentTheme(productId, scope) {
	try {
		const stored = scope.localStorage?.getItem(productThemeKey(productId))
			|| scope.localStorage?.getItem(SHARED_THEME_KEY);
		return stored === 'light' || stored === 'dark' ? stored : null;
	} catch {
		return null;
	}
}

function prefersDarkTheme(scope) {
	try {
		return scope.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
	} catch {
		return false;
	}
}
