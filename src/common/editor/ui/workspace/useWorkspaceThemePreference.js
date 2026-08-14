import { useEffect } from 'react';

/** Applies the persisted editor appearance preference to the document palette. */
export function useWorkspaceThemePreference(appearanceTheme = 'system') {
	useEffect(() => {
		const root = document.documentElement;
		const systemTheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
		const applyTheme = () => {
			const dark = appearanceTheme === 'system'
				? Boolean(systemTheme?.matches)
				: appearanceTheme.endsWith('dark');
			root.dataset.theme = dark ? 'dark' : 'light';
			root.style.colorScheme = dark ? 'dark' : 'light';
		};
		applyTheme();
		if (appearanceTheme !== 'system' || !systemTheme) return undefined;
		systemTheme.addEventListener('change', applyTheme);
		return () => systemTheme.removeEventListener('change', applyTheme);
	}, [appearanceTheme]);
}
