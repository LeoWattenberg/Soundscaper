/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useCallback, useState, useSyncExternalStore } from 'react';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { DEFAULT_PLAYBACK_METER_SETTINGS, type MeterSettings } from '../src/common/editor/ui/meter-settings.ts';
import { MeterSettingsFlyout } from '../src/common/editor/ui/toolbar/AudioEditorMeters.jsx';
import { resolveMeterPanelSettingsChange, type MeterSettingsUpdate } from '../src/common/editor/ui/workspace/meter-panel-settings.ts';
import { useWorkspaceMeterPanels } from '../src/common/editor/ui/workspace/useWorkspaceMeterPanels.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a meter Position choice does not continually retry a refused workspace save', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
	});
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let refused = false;
	let attempts = 0;
	const pending: Promise<unknown>[] = [];
	const errors: unknown[] = [];
	const saveSetting = store.saveSetting.bind(store);
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	store.saveSetting = async (key: string, value: unknown) => {
		if (refused && key === 'audio-editor-preferences-v1') {
			attempts += 1;
			if (attempts > 3) await gate;
			else await new Promise<void>((resolve) => setTimeout(resolve, 5));
			throw new DOMException('The device storage is full.', 'QuotaExceededError');
		}
		await saveSetting(key, value);
	};
	const run = (action: () => unknown): unknown => {
		const result = action();
		const settled = Promise.resolve(result).catch((error: unknown) => { errors.push(error); });
		pending.push(settled);
		return result;
	};
	function Harness(): React.JSX.Element {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		const preferences = snapshot.preferences as ReturnType<typeof createAudioEditorPreferencesV1>;
		const [playback, setPlayback] = useState<MeterSettings>({ ...DEFAULT_PLAYBACK_METER_SETTINGS, position: 'flyout' });
		const [recording, setRecording] = useState<MeterSettings>({ ...DEFAULT_PLAYBACK_METER_SETTINGS, position: 'flyout' });
		useWorkspaceMeterPanels({
			ready: true, controller, run, meterPanels: preferences.workspace.panels,
			playbackMeterSettings: playback, recordingMeterSettings: recording,
			setPlaybackMeterSettings: setPlayback, setRecordingMeterSettings: setRecording,
		});
		const onChange = useCallback((update: MeterSettingsUpdate) => {
			const next = resolveMeterPanelSettingsChange(playback, update, preferences.workspace.panels['playback-meter'].visible);
			setPlayback(next.settings);
			run(() => controller.actions.preferences.setPanelVisibility('playback-meter', next.panelVisible));
		}, [playback, preferences.workspace.panels]);
		return <MeterSettingsFlyout copy={{ ...COPY, position: 'Position' }} settings={playback} onChange={onChange} />;
	}
	async function choose(position: string): Promise<void> {
		await act(async () => { reactProps(radio(position)).onChange(); });
	}
	const radio = (position: string) => {
		const input = dom.container.querySelectorAll('input').find((candidate) => (
			candidate.name === 'meter-position-playback' && candidate.value === position
		));
		assert.ok(input, `the actual meter Position radio ${position} is mounted`);
		return input;
	};
	try {
		await controller.ready;
		await act(async () => { root.render(<Harness />); });
		await choose('panel');
		await Promise.all(pending);
		assert.equal((controller.getSnapshot().preferences as ReturnType<typeof createAudioEditorPreferencesV1>)
			.workspace.panels['playback-meter'].visible, true, 'a healthy Panel choice is saved');
		await choose('top');
		await Promise.all(pending);
		assert.equal(radio('top').checked, true);
		refused = true;
		await choose('panel');
		for (let tick = 0; tick < 10 && attempts < 4; tick += 1) {
			await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); });
		}
		assert.ok(errors.length > 0, 'the actual preference service refuses the choice');
		assert.ok(attempts <= 2, `a refused choice must settle instead of persisting repeatedly (${attempts} attempts)`);
		assert.equal(radio('top').checked, true);
		refused = false;
		await choose('panel');
		await Promise.all(pending);
		assert.equal((controller.getSnapshot().preferences as ReturnType<typeof createAudioEditorPreferencesV1>)
			.workspace.panels['playback-meter'].visible, true, 'an explicit Panel retry is saved');
		attempts = 0;
		refused = true;
		await choose('top');
		for (let tick = 0; tick < 10 && attempts < 4; tick += 1) {
			await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); });
		}
		assert.ok(attempts <= 2, `a refused Toolbar choice must also settle (${attempts} attempts)`);
		assert.equal(radio('panel').checked, true, 'refused panel closure restores the visible panel setting');
	} finally {
		await act(async () => { root.unmount(); });
		release?.();
		await Promise.all(pending);
		await controller.dispose();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
