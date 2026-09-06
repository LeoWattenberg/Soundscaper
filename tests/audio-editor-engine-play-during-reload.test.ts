/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { EngineRealtimeContextFactory } from '../src/common/editor/engine/runtime-types.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

function editorProject(title: string): EngineProject {
	return {
		id: 'project-1',
		title,
		sampleRate: 48_000,
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: 48_000,
			gain: 1,
		}],
		tracks: [{ id: 'track-1', clipIds: ['clip-1'], gain: 1, pan: 0, mute: false, solo: false, effects: [] }],
		master: { gain: 1, effects: [] },
	};
}

function loadedEngine() {
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({
		audioContextFactory: (() => context) as unknown as EngineRealtimeContextFactory,
	});
	const sources = new Map<string, AudioBuffer>([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]);
	engine.loadProject(editorProject('original'), sources);
	return { engine, sources };
}

// The editable-copy handoff spec pressed Play in the receiving editor a tenth of
// a second after it reported ready, while the copied source was still being
// applied to the engine. The reload replaced the request's scrub generation and
// play() returned without ever reaching the playing state.
test('a play request in flight while the project is reapplied still starts playback', async () => {
	const { engine, sources } = loadedEngine();
	const request = engine.play();
	await engine.applyProject(editorProject('reloaded'), sources);
	await request;
	assert.equal(engine.getState().state, 'playing');
	await engine.dispose();
});

test('a reapplied project does not start playback once the request has settled', async () => {
	const { engine, sources } = loadedEngine();
	await engine.play();
	assert.equal(engine.getState().state, 'playing');
	engine.stop();
	await engine.applyProject(editorProject('reloaded'), sources);
	assert.equal(engine.getState().state, 'stopped');
	await engine.dispose();
});

test('a play request withdrawn by stop does not resurface through a later reload', async () => {
	const { engine, sources } = loadedEngine();
	const request = engine.play();
	engine.stop();
	await request;
	assert.equal(engine.getState().state, 'stopped');
	await engine.applyProject(editorProject('reloaded'), sources);
	assert.equal(engine.getState().state, 'stopped');
	await engine.dispose();
});
