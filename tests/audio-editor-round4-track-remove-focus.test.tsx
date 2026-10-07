/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useControllerOwnedActionRuntime } from '../src/common/editor/ui/workspace/useControllerOwnedActionRuntime.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const scenario of ['survivor', 'empty', 'deliberate'] as const) test(`whole-track removal keeps its keyboard subject: ${scenario}`, async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const frames: FrameRequestCallback[] = [];
	context.mock.method(globalThis, 'requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round4-remove-focus-${scenario}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => root.unmount()); await controller.dispose();
		globals.IS_REACT_ACT_ENVIRONMENT = oldAct; dom.restore();
	});
	await controller.ready;
	if (scenario !== 'empty') { controller.actions.track.add(); controller.actions.track.add(); }
	let remove: (() => unknown) | null = null;
	function Probe() {
		const runtime = useControllerOwnedActionRuntime(controller, 'soundscaper', 'en');
		remove = runtime.actions.track.removeSelected;
		const tracks = projectRuntime.projectForCommandConsumers(controller.project).tracks;
		return <main data-audio-editor="">
			{tracks.map(track => <div key={track.id} data-track-row="" data-track-id={track.id}>
				<div className="track" role="group" tabIndex={0}>{track.name}</div>
			</div>)}
			<div data-ruler-focus="" role="slider" tabIndex={0} />
			<button type="button" data-other-control="">Other</button>
		</main>;
	}
	await act(async () => root.render(<Probe />));
	const tracks = dom.container.querySelectorAll('.track');
	const removed = tracks.at(-1);
	assert.ok(removed);
	removed.focus();
	await act(async () => { assert.ok(remove); remove(); root.render(<Probe />); });
	assert.equal(removed.isConnected, false);
	const other = dom.one('[data-other-control]');
	if (scenario === 'deliberate') other.focus();
	await act(async () => { for (const callback of frames.splice(0)) callback(0); });
	const expected = scenario === 'deliberate' ? other : scenario === 'empty'
		? dom.one('[data-ruler-focus]') : dom.container.querySelectorAll('.track').at(-1);
	assert.ok(expected);
	assert.equal(dom.container.ownerDocument.activeElement, expected);
	if (scenario === 'survivor') {
		assert.equal(controller.getSnapshot().selectedTrackId, expected.closest('[data-track-row]')?.getAttribute('data-track-id'));
		await act(async () => { assert.ok(remove); remove(); root.render(<Probe />); });
		assert.equal(expected.isConnected, false);
	}
});
