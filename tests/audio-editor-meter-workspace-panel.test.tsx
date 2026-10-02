/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';
import { DEFAULT_PLAYBACK_METER_SETTINGS, normalizeMeterSettings } from '../src/common/editor/ui/meter-settings.ts';
import MeterWorkspacePanel from '../src/common/editor/ui/workspace/MeterWorkspacePanel.jsx';
import { WORKSPACE_DISCOVERABLE_PANEL_IDS, workspacePanelLabel } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('meter and clock panels remain hidden until selected through a menu', () => {
	const preferences = createAudioEditorPreferencesV1();
	for (const id of ['playback-meter', 'recording-meter', 'clock']) {
		assert.equal(DEFAULT_PANELS[id as keyof typeof DEFAULT_PANELS]?.visible, false, id);
		assert.equal(preferences.workspace.panels[id]?.visible, false, id);
		assert.ok(WORKSPACE_DISCOVERABLE_PANEL_IDS.includes(id), id);
	}
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'playback-meter'), 'Playback meter');
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'recording-meter'), 'Recording meter');
	assert.equal(normalizeMeterSettings({ position: 'panel' }, DEFAULT_PLAYBACK_METER_SETTINGS).position, 'panel');
	assert.equal(normalizeMeterSettings({ position: 'side' }, DEFAULT_PLAYBACK_METER_SETTINGS).position, 'side');
});

test('docked meters use their entire orientation and release telemetry in an inactive tab', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let subscriptions = 0;
	const telemetry = { meters: { master: { peak: 0.5, rms: 0.25, dbfs: -6 } }, inputMeterDb: -12 };
	const controller = {
		getTelemetrySnapshot: () => telemetry,
		subscribeTelemetry: () => {
			subscriptions += 1;
			return () => { subscriptions -= 1; };
		},
	};
	const snapshot = { audioDevices: { playbackGain: 1 }, recordingOptions: { inputGain: 1 }, recordingInputs: {} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (kind: string, dock: string, panelActive = true) => act(async () => root.render(
		<MeterWorkspacePanel kind={kind} dock={dock} panelActive={panelActive} copy={ENGLISH_COPY}
			controller={controller} snapshot={snapshot} settings={DEFAULT_PLAYBACK_METER_SETTINGS}
			onSettingsChange={() => undefined} run={() => undefined} />,
	));
	try {
		for (const dock of ['left', 'right', 'floating', 'top', 'bottom']) {
			await render('playback', dock);
			assert.equal(dom.one('[data-audio-meter]').getAttribute('data-meter-orientation'),
				dock === 'top' || dock === 'bottom' ? 'horizontal' : 'vertical', dock);
			assert.equal(dom.one('[data-audio-meter]').getAttribute('data-meter-position'), 'panel');
			assert.equal(subscriptions, 1);
		}
		await render('recording', 'top');
		assert.equal(dom.one('[data-audio-meter]').getAttribute('data-meter-kind'), 'recording');
		assert.equal(dom.one('[role="meter"]').getAttribute('aria-valuenow'), '-12');
		assert.equal(subscriptions, 1);
		await render('recording', 'top', false);
		assert.equal(dom.find('[data-audio-meter]'), null);
		assert.equal(subscriptions, 0, 'hidden meter tabs do not paint or subscribe');
		await render('recording', 'bottom');
		assert.equal(subscriptions, 1, 'returning to a meter tab resumes live values');
	} finally {
		await act(async () => root.unmount());
		assert.equal(subscriptions, 0);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
});
