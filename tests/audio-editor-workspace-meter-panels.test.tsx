/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { DEFAULT_PLAYBACK_METER_SETTINGS, type MeterSettings } from '../src/common/editor/ui/meter-settings.ts';
import { useWorkspaceMeterPanels } from '../src/common/editor/ui/workspace/useWorkspaceMeterPanels.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('the former default sidebar becomes a visible panel after stored preferences finish loading', async () => {
	const fixture = await meterPanelsFixture({ playback: 'panel', recording: 'top' });
	try {
		await fixture.render(false);
		assert.deepEqual(fixture.visibilityChanges, []);
		await fixture.render(true);
		assert.deepEqual(fixture.visibilityChanges, [['playback-meter', true]]);
		await fixture.render(true);
		assert.equal(fixture.visibilityChanges.length, 1, 'matching visibility is not persisted twice');
		assert.equal(fixture.playback.position, 'panel');
		assert.equal(fixture.recording.position, 'top');
	} finally { await fixture.cleanup(); }
});

test('a previously opened dockable panel takes precedence over the old standalone position once at boot', async () => {
	const fixture = await meterPanelsFixture({ playback: 'top', recording: 'flyout', playbackVisible: true });
	try {
		await fixture.render();
		assert.equal(fixture.playback.position, 'panel');
		fixture.playback.position = 'top';
		await fixture.render();
		assert.deepEqual(fixture.visibilityChanges, [['playback-meter', false]]);
		assert.equal(fixture.playback.position, 'top', 'later position changes remain authoritative');
	} finally { await fixture.cleanup(); }
});

test('preset position changes and restored panel preferences use the same meter visibility', async () => {
	const fixture = await meterPanelsFixture({ playback: 'panel', recording: 'flyout' });
	try {
		await fixture.render();
		fixture.recording.position = 'panel';
		await fixture.render();
		assert.deepEqual(fixture.visibilityChanges, [['playback-meter', true], ['recording-meter', true]]);
		fixture.recording.position = 'flyout';
		await fixture.render();
		assert.deepEqual(fixture.visibilityChanges.at(-1), ['recording-meter', false]);
		fixture.panels['playback-meter'].visible = false;
		await fixture.render();
		assert.deepEqual(fixture.visibilityChanges.at(-1), ['playback-meter', true], 'a preset reset still displays its configured panel meter');
	} finally { await fixture.cleanup(); }
});

test('automatic meter visibility synchronization preserves a pending startup failure', async () => {
	const fixture = await meterPanelsFixture({
		playback: 'panel', recording: 'panel', startupFailure: 'Browser file limit reached',
	});
	try {
		await fixture.render(false);
		assert.equal(fixture.startupFailure, 'Browser file limit reached');
		await fixture.render(true);
		assert.deepEqual(fixture.visibilityChanges, [['playback-meter', true], ['recording-meter', true]]);
		assert.equal(fixture.startupFailure, 'Browser file limit reached');
		fixture.recording.position = 'flyout';
		await fixture.render();
		assert.deepEqual(fixture.visibilityChanges.at(-1), ['recording-meter', false]);
		assert.equal(fixture.startupFailure, 'Browser file limit reached');
	} finally { await fixture.cleanup(); }
});

async function meterPanelsFixture(initial: Readonly<{
	playback: MeterSettings['position'];
	recording: MeterSettings['position'];
	playbackVisible?: boolean;
	startupFailure?: string;
}>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const state = {
		playback: { ...DEFAULT_PLAYBACK_METER_SETTINGS, position: initial.playback },
		recording: { ...DEFAULT_PLAYBACK_METER_SETTINGS, position: initial.recording },
		panels: {
			'playback-meter': { visible: initial.playbackVisible ?? false },
			'recording-meter': { visible: false },
		},
		visibilityChanges: [] as [string, boolean][],
		startupFailure: initial.startupFailure ?? null,
	};
	const run = (action: () => unknown, { clearError = true }: { clearError?: boolean } = {}): unknown => {
		if (clearError) state.startupFailure = null;
		return action();
	};
	const controller = { actions: { preferences: {
		setPanelVisibility(panelId: string, visible: boolean) {
			state.visibilityChanges.push([panelId, visible]);
			state.panels[panelId as keyof typeof state.panels].visible = visible;
		},
	} } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		get playback() { return state.playback; },
		get recording() { return state.recording; },
		get panels() { return state.panels; },
		get visibilityChanges() { return state.visibilityChanges; },
		get startupFailure() { return state.startupFailure; },
		async render(ready = true) {
			await act(async () => root.render(<Harness
				ready={ready} controller={controller} run={run} meterPanels={{ ...state.panels }}
				playbackMeterSettings={{ ...state.playback }} recordingMeterSettings={{ ...state.recording }}
				setPlaybackMeterSettings={(update) => { state.playback = update(state.playback); }}
				setRecordingMeterSettings={(update) => { state.recording = update(state.recording); }}
			/>));
		},
		async cleanup() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		},
	};
}

function Harness(input: Parameters<typeof useWorkspaceMeterPanels>[0]): null {
	useWorkspaceMeterPanels(input);
	return null;
}
