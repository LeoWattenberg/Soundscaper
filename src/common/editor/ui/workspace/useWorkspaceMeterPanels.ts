/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';

import type { MeterSettings } from '../meter-settings.ts';

type MeterSettingsSetter = (update: (settings: MeterSettings) => MeterSettings) => void;

interface MeterPanelsControllerPort {
	readonly actions: Readonly<{ preferences: Readonly<{
		setPanelVisibility(panelId: string, visible: boolean): unknown;
	}> }>;
}

/** Keep the shared meter position authoritative across workspace changes. */
export function useWorkspaceMeterPanels(input: Readonly<{
	ready: boolean;
	controller: MeterPanelsControllerPort;
	run(action: () => unknown, options?: Readonly<{ clearError?: boolean }>): unknown;
	meterPanels: Readonly<Record<string, Readonly<{ visible?: boolean }> | undefined>>;
	playbackMeterSettings: Readonly<MeterSettings>;
	recordingMeterSettings: Readonly<MeterSettings>;
	setPlaybackMeterSettings: MeterSettingsSetter;
	setRecordingMeterSettings: MeterSettingsSetter;
}>): void {
	const {
		ready, controller, run, meterPanels, playbackMeterSettings, recordingMeterSettings,
		setPlaybackMeterSettings, setRecordingMeterSettings,
	} = input;
	const initializedRef = useRef(false);
	const playbackVisible = meterPanels['playback-meter']?.visible === true;
	const recordingVisible = meterPanels['recording-meter']?.visible === true;
	useEffect(() => {
		if (!ready) return;
		const firstReady = !initializedRef.current;
		initializedRef.current = true;
		synchronize('playback-meter', playbackMeterSettings.position, playbackVisible, setPlaybackMeterSettings);
		synchronize('recording-meter', recordingMeterSettings.position, recordingVisible, setRecordingMeterSettings);

		function synchronize(panelId: string, position: MeterSettings['position'], visible: boolean, setSettings: MeterSettingsSetter): void {
			// Old versions could open a panel while retaining the standalone meter
			// position. Preserve that choice once the saved workspace has loaded.
			if (firstReady && visible && position !== 'panel') {
				setSettings((settings) => ({ ...settings, position: 'panel' }));
				return;
			}
			if (visible !== (position === 'panel')) {
				run(() => controller.actions.preferences.setPanelVisibility(panelId, position === 'panel'), { clearError: false });
			}
		}
	}, [controller, playbackMeterSettings.position, playbackVisible, ready, recordingMeterSettings.position,
		recordingVisible, run, setPlaybackMeterSettings, setRecordingMeterSettings]);
}
