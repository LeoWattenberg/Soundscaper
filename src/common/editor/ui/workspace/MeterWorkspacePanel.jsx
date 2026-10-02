/* SPDX-License-Identifier: AGPL-3.0-only */

import { DEFAULT_PLAYBACK_METER_SETTINGS, DEFAULT_RECORDING_METER_SETTINGS } from '../meter-settings.ts';
import { SidePlaybackMeter, SideRecordingMeter } from '../toolbar/AudioEditorMeterControls.jsx';

export default function MeterWorkspacePanel({
	kind,
	dock,
	panelActive = true,
	controller,
	copy,
	snapshot,
	settings,
	onSettingsChange = /** @type {((update: import('./meter-panel-settings.ts').MeterSettingsUpdate) => void) | undefined} */ (undefined),
	clippingEnabled = false,
	run,
}) {
	const recording = kind === 'recording';
	const Meter = recording ? SideRecordingMeter : SidePlaybackMeter;
	const defaults = recording ? DEFAULT_RECORDING_METER_SETTINGS : DEFAULT_PLAYBACK_METER_SETTINGS;
	const panelSettings = { ...(settings || defaults), position: 'panel' };
	const orientation = dock === 'top' || dock === 'bottom' ? 'horizontal' : 'vertical';
	const changePanelSettings = (change) => onSettingsChange?.((current) => (
		typeof change === 'function' ? change({ ...current, position: 'panel' }) : change
	));
	return <div className="kw-audio-editor__meter-workspace-panel" data-meter-workspace-panel={kind}>
		{panelActive && <Meter
			controller={controller}
			copy={copy}
			snapshot={snapshot}
			settings={panelSettings}
			onSettingsChange={changePanelSettings}
			clippingEnabled={clippingEnabled}
			orientation={orientation}
			run={run}
		/>}
	</div>;
}
