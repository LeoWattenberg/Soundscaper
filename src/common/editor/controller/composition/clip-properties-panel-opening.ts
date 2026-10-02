/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ClipPropertiesFocusRequest {
	readonly clipId: string | null;
	readonly field: 'pitchCents' | 'speedRatio' | null;
	readonly projectId?: string | null;
	readonly onHandled?: () => void;
}

interface ClipPropertiesPanelOpeningPorts {
	readonly closeSurface: () => void;
	readonly showPanel: () => void;
	readonly requestFocus: (request: ClipPropertiesFocusRequest) => void;
}

/** Route existing inspector commands to one live panel, without toggling it closed. */
export function openClipPropertiesPanel(
	surface: unknown,
	clipId: string | null,
	ports: ClipPropertiesPanelOpeningPorts,
): boolean {
	if (surface !== 'clip' && surface !== 'clip-pitch' && surface !== 'clip-speed') return false;
	ports.closeSurface();
	ports.showPanel();
	ports.requestFocus({
		clipId,
		field: surface === 'clip-pitch' ? 'pitchCents' : surface === 'clip-speed' ? 'speedRatio' : null,
	});
	return true;
}
