/* SPDX-License-Identifier: AGPL-3.0-only */
import { isSkinId, type SkinId } from '../skin-preferences.ts';

export interface SkinPreviewBrowser {
	readonly location: { readonly href: string };
	readonly history: {
		readonly state: unknown;
		replaceState: (state: unknown, title: string, url: string) => void;
	};
	readonly addEventListener: (type: 'popstate', listener: () => void) => void;
	readonly removeEventListener: (type: 'popstate', listener: () => void) => void;
}

/** URL overrides never enter persisted preferences, including during unrelated saves. */
export function createSkinPreview(browser?: SkinPreviewBrowser) {
	const listeners = new Set<() => void>();
	const publish = () => { for (const listener of listeners) listener(); };
	function getSnapshot(): SkinId | null {
		if (!browser) return null;
		const value = new URL(browser.location.href).searchParams.get('useskin');
		return isSkinId(value) ? value : null;
	}
	function end() {
		if (!browser) return;
		const address = new URL(browser.location.href);
		address.searchParams.delete('useskin');
		browser.history.replaceState(browser.history.state, '', address.href);
		publish();
	}
	return {
		getSnapshot,
		subscribe(listener: () => void) {
			if (!listeners.size) browser?.addEventListener('popstate', publish);
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				if (!listeners.size) browser?.removeEventListener('popstate', publish);
			};
		},
		end,
		async adopt(skin: SkinId, persist: (skin: SkinId) => unknown) {
			const address = browser?.location.href;
			await persist(skin);
			if (browser?.location.href === address) end();
		},
	};
}
