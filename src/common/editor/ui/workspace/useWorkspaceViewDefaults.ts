/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

import { workspaceViewDefaults, type WorkspaceViewDefaults } from '../../workspace-layout-defaults.ts';
import type { MeterSettings } from '../meter-settings.ts';

export interface WorkspaceViewControllerPort {
	getSnapshot(): Readonly<{
		readonly timeline?: Readonly<{ readonly showVerticalRulers?: unknown }> | null;
	}>;
	readonly actions: Readonly<{
		readonly timeline: Readonly<{ toggleVerticalRulers(): unknown }>;
	}>;
}

type MeterSettingsUpdate = (update: (settings: MeterSettings) => MeterSettings) => void;
type MeterPosition = NonNullable<WorkspaceViewDefaults['playbackMeterPosition']>;

// A preset's view block is applied when the user moves onto that preset, never
// on first mount (the stored meter and ruler state is the user's), never when
// the id did not change, and never for presets and custom workspaces without one.
export function resolveWorkspaceViewTransition(previous: string | null, next: string): WorkspaceViewDefaults {
	if (previous === null || previous === next) return {};
	return workspaceViewDefaults(next) ?? {};
}

export function useWorkspaceViewDefaults(input: Readonly<{
	activeWorkspaceId: string;
	/**
	 * Whether the editor has finished booting. The tree mounts on the product
	 * default before the stored preferences arrive, so the first id seen while
	 * booting is not the user's and a later change to the stored id is not a
	 * switch the user made.
	 */
	ready?: boolean;
	controller: WorkspaceViewControllerPort;
	run(action: () => unknown): unknown;
	setPlaybackMeterSettings: MeterSettingsUpdate;
	setRecordingMeterSettings: MeterSettingsUpdate;
}>): void {
	const { activeWorkspaceId, ready = true, controller, run, setPlaybackMeterSettings, setRecordingMeterSettings } = input;
	const previousRef = useRef<Readonly<{ id: string; ready: boolean }> | null>(null);
	useEffect(() => {
		const previous = previousRef.current;
		previousRef.current = { id: activeWorkspaceId, ready };
		if (!previous || !previous.ready || !ready) return;
		const view = resolveWorkspaceViewTransition(previous.id, activeWorkspaceId);
		if (view.playbackMeterPosition) setPlaybackMeterSettings(meterPositionUpdate(view.playbackMeterPosition));
		if (view.recordingMeterPosition) setRecordingMeterSettings(meterPositionUpdate(view.recordingMeterPosition));
		if (typeof view.verticalRulers !== 'boolean') return;
		// The controller only exposes a toggle, so read the live state first and
		// flip it exactly when it differs from the preset.
		const shown = controller.getSnapshot().timeline?.showVerticalRulers !== false;
		if (shown !== view.verticalRulers) run(() => controller.actions.timeline.toggleVerticalRulers());
	}, [activeWorkspaceId, controller, ready, run, setPlaybackMeterSettings, setRecordingMeterSettings]);
}

function meterPositionUpdate(position: MeterPosition): (settings: MeterSettings) => MeterSettings {
	return (settings) => (settings.position === position ? settings : { ...settings, position });
}
