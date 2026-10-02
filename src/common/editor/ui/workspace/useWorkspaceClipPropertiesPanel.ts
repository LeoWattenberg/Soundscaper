/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useState } from 'react';
import { openClipPropertiesPanel, type ClipPropertiesFocusRequest } from '../../controller/composition/clip-properties-panel-opening.ts';

interface ClipPropertiesPanelOptions {
	readonly controller: { readonly actions: { readonly preferences: {
		readonly setPanelVisibility: (panelId: string, visible: boolean) => unknown;
	} } };
	readonly run: (operation: () => unknown) => unknown;
	readonly setActiveSurface: (surface: string | null) => void;
	readonly selectedClipId: string | null;
	readonly projectId: string | null;
	readonly panelVisible: boolean;
}

export function useWorkspaceClipPropertiesPanel({ controller, run, setActiveSurface, selectedClipId, projectId, panelVisible }: ClipPropertiesPanelOptions) {
	const [pendingFocus, setFocusRequest] = useState<ClipPropertiesFocusRequest | null>(null);
	useEffect(() => setFocusRequest(null), [projectId]);
	useEffect(() => {
		if (!panelVisible) setFocusRequest(null);
	}, [panelVisible]);
	const openClipPropertiesSurface = useCallback((surface: unknown, requestedClipId = selectedClipId) => (
		openClipPropertiesPanel(surface, requestedClipId, {
			closeSurface: () => setActiveSurface(null),
			showPanel: () => { run(() => controller.actions.preferences.setPanelVisibility('clip-properties', true)); },
			requestFocus: (request) => {
				const scopedRequest: ClipPropertiesFocusRequest = {
					...request, projectId,
					onHandled: () => setFocusRequest((current) => current === scopedRequest ? null : current),
				};
				setFocusRequest(scopedRequest);
			},
		})
	), [controller, projectId, run, selectedClipId, setActiveSurface]);
	const clipPropertiesFocusRequest = panelVisible && pendingFocus?.projectId === projectId ? pendingFocus : null;
	return { clipPropertiesFocusRequest, openClipPropertiesSurface };
}
