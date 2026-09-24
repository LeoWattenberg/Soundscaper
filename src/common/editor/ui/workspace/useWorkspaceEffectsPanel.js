/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useState } from 'react';

export function useWorkspaceEffectsPanel({
	controller, run, setActiveSurface, selectedTrackId, effectsVisible, workspaceRef,
}) {
	const [effectsPanelTarget, setEffectsPanelTarget] = useState(null);
	const openEffects = useCallback((trackId, _anchorRect = null, scope = 'track', toggle = false) => {
		if (!trackId && scope !== 'master') return;
		if (toggle && effectsVisible) {
			run(() => controller.actions.preferences.setPanelVisibility('effects', false));
			return;
		}
		setActiveSurface(null);
		setEffectsPanelTarget({ trackId: scope === 'master' ? null : trackId, scope });
		run(() => {
			if (scope === 'track' && trackId !== selectedTrackId) controller.actions.timeline.selectTrack(trackId);
			controller.actions.preferences.setPanelVisibility('effects', true);
		});
		requestAnimationFrame(() => {
			const panel = workspaceRef.current?.querySelector('[data-workspace-panel="effects"]');
			if (!panel) return;
			panel.tabIndex = -1;
			panel.focus({ preventScroll: false });
		});
	}, [controller, run, setActiveSurface, selectedTrackId, effectsVisible, workspaceRef]);
	return { effectsPanelTarget, openEffects };
}
