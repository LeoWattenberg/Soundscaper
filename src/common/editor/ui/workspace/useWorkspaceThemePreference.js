import { useEffect } from 'react';

import { paintDocumentTheme, resolveDocumentTheme } from '../../../site/document-theme.js';

/**
 * The palette this appearance preference asks for.
 *
 * `system` defers to the theme the visit already resolved to - the choice
 * stored by the site's own theme toggle, and only failing that the system
 * preference - which is the same reading the preferences dialog gives it.
 * Consulting the media query alone discarded a stored choice on every load.
 */
export function resolveWorkspaceAppearanceTheme(appearanceTheme, productId, scope = globalThis) {
	if (appearanceTheme !== 'system') return String(appearanceTheme).endsWith('dark') ? 'dark' : 'light';
	return resolveDocumentTheme(productId, scope);
}

/** Applies the persisted editor appearance preference to the document palette. */
export function useWorkspaceThemePreference(appearanceTheme = 'system', productId = 'soundscaper') {
	useEffect(() => {
		const root = document.documentElement;
		const systemTheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
		const applyTheme = () => {
			paintDocumentTheme(root, resolveWorkspaceAppearanceTheme(appearanceTheme, productId));
		};
		applyTheme();
		if (appearanceTheme !== 'system' || !systemTheme) return undefined;
		systemTheme.addEventListener('change', applyTheme);
		return () => systemTheme.removeEventListener('change', applyTheme);
	}, [appearanceTheme, productId]);
}
