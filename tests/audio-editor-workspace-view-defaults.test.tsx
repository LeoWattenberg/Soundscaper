/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';

import {
	DEFAULT_PLAYBACK_METER_SETTINGS,
	DEFAULT_RECORDING_METER_SETTINGS,
	type MeterSettings,
} from '../src/common/editor/ui/meter-settings.ts';
import {
	resolveWorkspaceViewTransition,
	useWorkspaceViewDefaults,
	type WorkspaceViewControllerPort,
} from '../src/common/editor/ui/workspace/useWorkspaceViewDefaults.ts';
import { workspaceViewDefaults } from '../src/common/editor/workspace-layout-defaults.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const ROOT = new URL('../', import.meta.url);

test('workspace view transitions only carry a preset view block across a real switch', () => {
	assert.deepEqual(resolveWorkspaceViewTransition(null, 'audacity'), {});
	assert.deepEqual(resolveWorkspaceViewTransition(null, 'modern'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('audacity', 'audacity'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('modern', 'modern'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('modern', 'audacity'), {
		verticalRulers: false,
		playbackMeterPosition: 'side',
		recordingMeterPosition: 'flyout',
	});
	assert.deepEqual(resolveWorkspaceViewTransition('modern', 'audacity'), workspaceViewDefaults('audacity'));
	assert.deepEqual(resolveWorkspaceViewTransition('audacity', 'modern'), workspaceViewDefaults('modern'));
	assert.deepEqual(resolveWorkspaceViewTransition('audacity', 'classic'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('classic', 'music'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('modern', 'video-editor'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('modern', 'custom-1'), {});
	assert.deepEqual(resolveWorkspaceViewTransition('audacity', ''), {});
});

test('switching from Soundscaper to Audacity hides the rulers once and moves only the recording meter', async () => {
	const fixture = await mountedViewDefaultsFixture({
		showVerticalRulers: true,
		recording: { dbRange: 84, style: 'rms' },
	});
	try {
		await fixture.render('modern');
		assert.equal(fixture.toggles, 0);
		assert.equal(fixture.playbackCalls, 0);
		assert.equal(fixture.recordingCalls, 0);
		const playbackBefore = fixture.playback;

		await fixture.render('audacity');
		assert.equal(fixture.toggles, 1);
		assert.equal(fixture.runs, 1);
		assert.equal(fixture.showVerticalRulers, false);
		assert.equal(fixture.playback, playbackBefore, 'a matching playback position keeps the settings object');
		assert.equal(fixture.playback.position, 'side');
		assert.deepEqual(fixture.recording, {
			...DEFAULT_RECORDING_METER_SETTINGS, dbRange: 84, style: 'rms', position: 'flyout',
		});
	} finally {
		await fixture.cleanup();
	}
});

test('switching from Audacity back to Soundscaper restores the rulers and the side recording meter', async () => {
	const fixture = await mountedViewDefaultsFixture({
		showVerticalRulers: false,
		recording: { position: 'flyout' },
	});
	try {
		await fixture.render('audacity');
		await fixture.render('modern');
		assert.equal(fixture.toggles, 1);
		assert.equal(fixture.showVerticalRulers, true);
		assert.equal(fixture.playback.position, 'side');
		assert.equal(fixture.recording.position, 'side');
	} finally {
		await fixture.cleanup();
	}
});

test('a ruler state that already matches the preset is left alone while meters still move', async () => {
	const fixture = await mountedViewDefaultsFixture({
		showVerticalRulers: false,
		playback: { position: 'top' },
		recording: { position: 'flyout' },
	});
	try {
		await fixture.render('modern');
		const recordingBefore = fixture.recording;
		await fixture.render('audacity');
		assert.equal(fixture.toggles, 0);
		assert.equal(fixture.runs, 0);
		assert.equal(fixture.showVerticalRulers, false);
		assert.equal(fixture.playback.position, 'side');
		assert.equal(fixture.recording, recordingBefore);
	} finally {
		await fixture.cleanup();
	}
});

test('presets without a view block and custom workspaces apply nothing', async () => {
	const fixture = await mountedViewDefaultsFixture({ showVerticalRulers: true });
	try {
		await fixture.render('modern');
		await fixture.render('custom-1');
		await fixture.render('classic');
		await fixture.render('music');
		await fixture.render('video-editor');
		assert.equal(fixture.toggles, 0);
		assert.equal(fixture.playbackCalls, 0);
		assert.equal(fixture.recordingCalls, 0);
	} finally {
		await fixture.cleanup();
	}
});

test('the first mount and dependency identity changes never apply a preset view', async () => {
	const fixture = await mountedViewDefaultsFixture({
		showVerticalRulers: true,
		playback: { position: 'top' },
	});
	try {
		await fixture.render('audacity');
		assert.equal(fixture.toggles, 0);
		assert.equal(fixture.playbackCalls, 0);
		assert.equal(fixture.recordingCalls, 0);
		assert.equal(fixture.showVerticalRulers, true);
		assert.equal(fixture.playback.position, 'top');

		await fixture.render('audacity', { freshRun: true });
		assert.equal(fixture.toggles, 0);
		assert.equal(fixture.playbackCalls, 0);
		assert.equal(fixture.recordingCalls, 0);
	} finally {
		await fixture.cleanup();
	}
});

test('the workspace lifecycle applies view defaults through the shared hook', async () => {
	const lifecycle = await readFile(
		new URL('src/common/editor/ui/workspace/useAudioEditorWorkspaceLifecycle.js', ROOT),
		'utf8',
	);
	assert.match(lifecycle, /import \{ useWorkspaceViewDefaults \} from '\.\/useWorkspaceViewDefaults\.ts';/u);
	assert.match(lifecycle, /useWorkspaceViewDefaults\(\{/u);
	assert.match(lifecycle, /activeWorkspaceId: preferences\?\.workspace\?\.activeId \|\| product\.defaultWorkspace,/u);
	assert.doesNotMatch(lifecycle, /meterWorkspaceRef/u);
	assert.doesNotMatch(lifecycle, /activeWorkspaceId !== 'modern'/u);
	assert.doesNotMatch(lifecycle, /position === 'side'/u);
});

test('the Audacity preset narrows the side playback meter to the beta.4 panel width', async () => {
	const css = await readFile(
		new URL('src/common/editor/ui/audio-editor-design-system/03-shell-toolbars-meters.css', ROOT),
		'utf8',
	);
	const panel = /#kw-audio-editor-design-system:where\(\[data-workspace-preset='audacity'\]\) \.kw-audio-editor__side-playback-meter \{([^}]*)\}/u.exec(css);
	assert.ok(panel, 'the Audacity side playback meter panel rule is present');
	assert.match(panel[1]!, /width: 56px;/u);
	assert.match(panel[1]!, /min-width: 56px;/u);
	assert.match(panel[1]!, /flex-basis: 56px;/u);
	const meter = /#kw-audio-editor-design-system:where\(\[data-workspace-preset='audacity'\]\) \.kw-audio-editor__side-playback-meter \.kw-audio-editor__master-meter \{([^}]*)\}/u.exec(css);
	assert.ok(meter, 'the Audacity side playback meter bar rule is present');
	assert.match(meter[1]!, /width: 44px;/u);
	assert.match(meter[1]!, /min-width: 44px;/u);
	assert.doesNotMatch(css, /\[data-workspace-preset='audacity'\][^{]*side-recording-meter/u);
});

async function mountedViewDefaultsFixture(initial: Readonly<{
	showVerticalRulers: boolean;
	playback?: Partial<MeterSettings>;
	recording?: Partial<MeterSettings>;
}>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const state = {
		showVerticalRulers: initial.showVerticalRulers,
		toggles: 0,
		runs: 0,
		playbackCalls: 0,
		recordingCalls: 0,
		playback: { ...DEFAULT_PLAYBACK_METER_SETTINGS, ...initial.playback } as MeterSettings,
		recording: { ...DEFAULT_RECORDING_METER_SETTINGS, ...initial.recording } as MeterSettings,
	};
	const controller: WorkspaceViewControllerPort = {
		getSnapshot: () => ({ timeline: { showVerticalRulers: state.showVerticalRulers } }),
		actions: {
			timeline: {
				toggleVerticalRulers: () => {
					state.toggles += 1;
					state.showVerticalRulers = !state.showVerticalRulers;
					return state.showVerticalRulers;
				},
			},
		},
	};
	const makeRun = () => (action: () => unknown) => {
		state.runs += 1;
		return action();
	};
	let run = makeRun();
	const setPlaybackMeterSettings = (update: (settings: MeterSettings) => MeterSettings) => {
		state.playbackCalls += 1;
		state.playback = update(state.playback);
	};
	const setRecordingMeterSettings = (update: (settings: MeterSettings) => MeterSettings) => {
		state.recordingCalls += 1;
		state.recording = update(state.recording);
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		get toggles() { return state.toggles; },
		get runs() { return state.runs; },
		get playbackCalls() { return state.playbackCalls; },
		get recordingCalls() { return state.recordingCalls; },
		get showVerticalRulers() { return state.showVerticalRulers; },
		get playback() { return state.playback; },
		get recording() { return state.recording; },
		render: async (activeWorkspaceId: string, options: Readonly<{ freshRun?: boolean }> = {}) => {
			if (options.freshRun) run = makeRun();
			await act(async () => root.render(<ViewDefaultsHarness
				activeWorkspaceId={activeWorkspaceId}
				controller={controller}
				run={run}
				setPlaybackMeterSettings={setPlaybackMeterSettings}
				setRecordingMeterSettings={setRecordingMeterSettings}
			/>));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

function ViewDefaultsHarness(input: Parameters<typeof useWorkspaceViewDefaults>[0]): null {
	useWorkspaceViewDefaults(input);
	return null;
}
