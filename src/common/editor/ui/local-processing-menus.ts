/* SPDX-License-Identifier: AGPL-3.0-only */
import { mergeAssistanceTaskMenus, type AssistanceDialogRequest, type AssistanceMenuEntry } from './assistance-task-catalog.ts';

export interface NativePreferenceEntry extends AssistanceMenuEntry {
	readonly section: 'audio' | 'media' | 'effects';
}
export function organizeNativePreferences(menus: readonly AssistanceMenuEntry[]): AssistanceMenuEntry[] {
	const preferences: NativePreferenceEntry[] = [];
	const sectionFor = (id: string): NativePreferenceEntry['section'] | null => {
		if (id === 'native-audio' || id.includes('audio-helper')) return 'audio';
		if (id === 'framescaper-native-media-preferences' || id.includes('probe-helper')) return 'media';
		if (id === 'desktop-discover-native-effects') return 'effects';
		return null;
	};
	return menus.map((menu) => {
		if (menu.id !== 'tools') return menu;
		const items: AssistanceMenuEntry[] = [];
		for (const item of menu.items ?? []) {
			const desktopServices = item.id === 'desktop-services';
			const retainedServices: AssistanceMenuEntry[] = [];
			const candidates = desktopServices ? item.items ?? [] : [item];
			for (const candidate of candidates) {
				const section = sectionFor(candidate.id ?? '');
				if (section) preferences.push({ ...candidate, section });
				else if ((typeof __SCAPE_DESKTOP_RENDERER__ === 'undefined' || __SCAPE_DESKTOP_RENDERER__)
					&& desktopServices) retainedServices.push(candidate);
				else items.push(candidate);
			}
			if ((typeof __SCAPE_DESKTOP_RENDERER__ === 'undefined' || __SCAPE_DESKTOP_RENDERER__)
				&& retainedServices.length) items.push({ ...item, items: retainedServices });
		}
		return { ...menu, items, nativePreferences: preferences };
	});
}

/** Apply local-processing destinations before shortcut annotation and product filtering. */
export function prepareLocalProcessingMenus(menus: readonly AssistanceMenuEntry[], input: {
	readonly productId: string;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly capabilities: { readonly assistanceAssets?: boolean };
	readonly snapshot: { readonly preferences?: { readonly effects?: { readonly menuOrganization?: string } } };
	readonly actions: { readonly openLocalAssistance?: (request: AssistanceDialogRequest) => unknown };
}): AssistanceMenuEntry[] {
	return organizeNativePreferences(mergeAssistanceTaskMenus(menus, {
		productId: input.productId, copy: input.copy, locale: input.locale,
		organization: input.snapshot.preferences?.effects?.menuOrganization,
		available: input.capabilities.assistanceAssets === true && typeof input.actions.openLocalAssistance === 'function',
		open: (request) => input.actions.openLocalAssistance?.(request),
	}));
}
