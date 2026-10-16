/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState, useSyncExternalStore } from 'react';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { DEFAULT_PLAYBACK_METER_SETTINGS, type MeterSettings } from '../src/common/editor/ui/meter-settings.ts';
import { useWorkspaceMeterPanels } from '../src/common/editor/ui/workspace/useWorkspaceMeterPanels.ts';
import { useWorkspaceViewDefaults } from '../src/common/editor/ui/workspace/useWorkspaceViewDefaults.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('a successful pending meter save reconciles the newer Audacity workspace intent', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	type Preferences = ReturnType<typeof createAudioEditorPreferencesV1>;
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
	});
	let release: () => void = () => { throw new Error('The storage gate is not initialized'); };
	const gate = new Promise<void>(resolve => { release = resolve; });
	let released = false;
	let held = 0;
	const saveSetting = store.saveSetting.bind(store);
	store.saveSetting = async (key: string, value: unknown) => {
		const preferences = value as Partial<Preferences>;
		if (!released && key === 'audio-editor-preferences-v1'
			&& preferences.workspace?.activeId === 'audacity'
			&& preferences.workspace.panels['recording-meter']?.visible) {
			held += 1;
			await gate;
		}
		await saveSetting(key, value);
	};
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const pending: Promise<unknown>[] = [];
	const errors: unknown[] = [];
	const run = (operation: () => unknown): unknown => {
		const result = operation();
		pending.push(Promise.resolve(result).catch((error: unknown) => { errors.push(error); }));
		return result;
	};
	function Harness(): React.JSX.Element {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		const preferences = snapshot.preferences as Preferences;
		const [playback, setPlayback] = useState<MeterSettings>({ ...DEFAULT_PLAYBACK_METER_SETTINGS });
		const [recording, setRecording] = useState<MeterSettings>({ ...DEFAULT_PLAYBACK_METER_SETTINGS });
		// Preserve the production lifecycle's hook order: preset defaults first,
		// then automatic panel synchronization, sharing the same render snapshot.
		useWorkspaceViewDefaults({ activeWorkspaceId: preferences.workspace.activeId, ready: true,
			controller, run, setPlaybackMeterSettings: setPlayback, setRecordingMeterSettings: setRecording });
		useWorkspaceMeterPanels({ ready: true, controller, run, meterPanels: preferences.workspace.panels,
			playbackMeterSettings: playback, recordingMeterSettings: recording,
			setPlaybackMeterSettings: setPlayback, setRecordingMeterSettings: setRecording });
		return <span data-recording-position={recording.position}
			data-recording-panel={String(preferences.workspace.panels['recording-meter'].visible)} />;
	}
	async function settle(): Promise<void> {
		for (let tick = 0; tick < 3; tick += 1) await act(async () => { await Promise.all(pending); });
	}
	try {
		await controller.ready;
		await act(async () => { root.render(<Harness />); });
		await settle();
		assert.equal(dom.one('[data-recording-position]').getAttribute('data-recording-position'), 'panel');
		assert.equal(dom.one('[data-recording-panel]').getAttribute('data-recording-panel'), 'true');
		await act(async () => { await controller.actions.preferences.setWorkspace('audacity'); });
		assert.equal(held, 1, 'the real preference service is persisting the old panel position');
		assert.equal(dom.one('[data-recording-position]').getAttribute('data-recording-position'), 'flyout');
		assert.equal(dom.one('[data-recording-panel]').getAttribute('data-recording-panel'), 'true');
		released = true;
		release();
		await settle();
		assert.equal(dom.one('[data-recording-panel]').getAttribute('data-recording-panel'), 'false',
			'the newer preset flyout must close the stale automatic panel after storage settles');
		assert.equal(dom.one('[data-recording-position]').getAttribute('data-recording-position'), 'flyout');
		assert.equal((controller.getSnapshot().preferences as Preferences).workspace.activeId, 'audacity');
		assert.deepEqual(errors, []);
	} finally {
		released = true;
		release();
		await act(async () => { root.unmount(); });
		await Promise.all(pending);
		await controller.dispose();
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
