/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { normalizeSkin, type SkinId } from '../../skin-preferences.ts';
import { createSkinPreview } from '../../controller/skin-preview.ts';
import { resolveSkinTheme, type SkinMode } from './skin-themes.ts';

interface SkinController {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => { preferences?: { appearance?: { skin?: unknown; theme?: string } } };
}
const emptySnapshot: ReturnType<SkinController['getSnapshot']> = {};
const noSnapshot = () => emptySnapshot;
const noSubscribe = () => () => undefined;
const noPreview = () => null;
interface SkinContextValue {
	skin: SkinId;
	decoration: SkinId;
	mode: SkinMode;
	preview: SkinId | null;
	end: () => void;
	adopt: (skin: SkinId, persist: (skin: SkinId) => unknown) => Promise<void>;
}
const SkinContext = createContext<SkinContextValue>({
	skin: 'default', decoration: 'default', mode: 'light', preview: null,
	end: () => undefined,
	adopt: async (skin, persist) => { await persist(skin); },
});
export const useEditorSkin = () => useContext(SkinContext);

export function EditorSkinProvider({ controller, mode, children }: {
	controller?: SkinController;
	mode: SkinMode;
	children: ReactNode;
}) {
	const snapshot = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? noSnapshot, noSnapshot);
	const appearance = snapshot.preferences?.appearance;
	const runtime = useMemo(() => createSkinPreview(controller && typeof window !== 'undefined' ? window : undefined), [controller]);
	const preview = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, noPreview);
	const skin = preview ?? normalizeSkin(appearance?.skin);
	const highContrast = appearance?.theme?.startsWith('high-contrast') === true;
	const decoration = highContrast ? 'default' : skin;
	const theme = resolveSkinTheme(skin, mode, highContrast);
	const value = useMemo(() => ({ skin, decoration, mode, preview, end: runtime.end, adopt: runtime.adopt }), [skin, decoration, mode, preview, runtime]);
	useEffect(() => {
		if (!controller) return;
		const body = document.body;
		const previous = body.dataset.editorSkin;
		body.dataset.editorSkin = decoration;
		return () => {
			if (previous === undefined) delete body.dataset.editorSkin;
			else body.dataset.editorSkin = previous;
		};
	}, [controller, decoration]);
	return <SkinContext.Provider value={value}>
		<ThemeProvider theme={theme}>{children}</ThemeProvider>
	</SkinContext.Provider>;
}
