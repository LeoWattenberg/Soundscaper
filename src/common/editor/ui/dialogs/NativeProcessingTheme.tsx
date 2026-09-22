/* SPDX-License-Identifier: AGPL-3.0-only */
import { useSyncExternalStore, type ReactNode } from 'react';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { normalizeSkin } from '../../skin-preferences.ts';
import { resolveSkinTheme } from '../skins/skin-themes.ts';

/** Native service hosts use separate React roots, so mirror the workspace theme. */
export default function NativeProcessingTheme({ children }: { readonly children: ReactNode }) {
	const appearance = useSyncExternalStore(subscribe, readAppearance, () => 'light:default');
	const [mode, skin] = appearance.split(':');
	return <ThemeProvider theme={resolveSkinTheme(normalizeSkin(skin), mode === 'dark' ? 'dark' : 'light')}>
		{children}
	</ThemeProvider>;
}

function readAppearance(): string {
	if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return 'light:default';
	const editor = document.querySelector<HTMLElement>('[data-audio-editor]');
	return `${document.documentElement.dataset.theme ?? 'light'}:${editor?.dataset.editorSkin ?? document.body.dataset.editorSkin ?? 'default'}`;
}
function subscribe(onChange: () => void): () => void {
	if (typeof MutationObserver === 'undefined' || !document.documentElement) return () => undefined;
	const observer = new MutationObserver(onChange);
	for (const element of [document.documentElement, document.body, document.querySelector('[data-audio-editor]')]) {
		if (element) observer.observe(element, { attributes: true, attributeFilter: ['data-theme', 'data-editor-skin'] });
	}
	return () => observer.disconnect();
}
