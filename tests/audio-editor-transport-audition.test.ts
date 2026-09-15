/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import { applyAudacityParityToMenus } from '../src/common/editor/audacity-action-parity.js';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';
import { AUDACITY_SHORTCUT_BINDINGS_BY_ACTION } from '../src/common/editor/audacity-shortcut-profile.ts';

const decorateMenus = applyAudacityParityToMenus as unknown as (
	menus: Array<{ id: string; label: string; onClick: () => void }>,
	options: { shortcuts: Record<string, string[]> },
) => Array<{ shortcut?: string }>;

test('C and X default bindings resolve to the new transport actions', () => {
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['play-cut-preview'], ['C']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['play-stop-select'], ['X']);
});

test('P transport play/pause pauses and resumes the active recording instead of starting playback', () => {
	const calls: string[] = [];
	const base = createActionFacadeRuntime();
	const runtime = new Proxy(base, {
		get(target, name, receiver) {
			if (name === 'capabilities') return { videoCompositing: false };
			if (name === 'state') return { ...target.state, recorder: {} };
			if (name === 'toggleRecordingPause') return () => { calls.push('recording-pause'); };
			if (name === 'handleTransport') return (action: string) => { calls.push(action); };
			return Reflect.get(target, name, receiver);
		},
	});
	const transport = createGroupedEditorActions(runtime).transport;
	void transport.playPause();
	void transport.playPause();
	assert.deepEqual(calls, ['recording-pause', 'recording-pause']);
});

test('pause menu actions show the canonical configurable P binding without duplicate defaults', () => {
	const menus = decorateMenus([
		{ id: 'action://playback/pause', label: 'Pause', onClick: () => undefined },
		{ id: 'action://record/pause', label: 'Pause recording', onClick: () => undefined },
	], { shortcuts: { 'action://playback/play': ['P'] } });
	assert.deepEqual(menus.map((item) => item.shortcut), ['P', 'P']);
	const remapped = decorateMenus([
		{ id: 'action://record/pause', label: 'Pause recording', onClick: () => undefined },
	], { shortcuts: { 'action://playback/play': ['Alt+P'] } });
	assert.equal(remapped[0]?.shortcut, 'Alt+P');
});

test('X stops at the audible position and collapses the time selection into an editing cursor', async () => {
	const fixture = createTransportFixture();
	fixture.setPlaybackState({ state: 'playing' });
	fixture.setPositionFrame(12_345);
	await fixture.service.handleTransport('play-stop-select');
	assert.deepEqual(fixture.calls.seeks, [12_345]);
	assert.deepEqual(fixture.calls.exactSelections, [[12_345, 12_345]]);
	assert.deepEqual(fixture.calls.exactSelectionDetails, [{ trackIds: ['track'], clipIds: [], frequencyRange: null }]);
	assert.deepEqual(fixture.calls.selections, [], 'the grid-snapped selection setter must not move the stop point');
	assert.equal(fixture.calls.commits.length, 0);
});

test('X starts ordinary playback when stopped', async () => {
	const fixture = createTransportFixture();
	await fixture.service.handleTransport('play-stop-select');
	assert.equal(fixture.calls.plays, 1);
	assert.deepEqual(fixture.calls.selections, []);
});

test('X stops paused playback and retains its exact audible cursor position', async () => {
	const fixture = createTransportFixture();
	fixture.setPlaybackState({ state: 'paused' });
	fixture.setPositionFrame(12_345);
	await fixture.service.handleTransport('play-stop-select');
	assert.equal(fixture.calls.plays, 0);
	assert.deepEqual(fixture.calls.seeks, [12_345]);
	assert.deepEqual(fixture.calls.exactSelections, [[12_345, 12_345]]);
});

test('cut preview prepares the selected gap without editing the document or its loop', async () => {
	const fixture = createTransportFixture();
	const previews: unknown[] = [];
	Object.assign(fixture.engine, { playCutPreview: async (selection: unknown) => { previews.push(selection); } });
	const before = structuredClone(fixture.project());
	await fixture.service.handleTransport('cut-preview');
	assert.deepEqual(previews, [{ startFrame: 10, endFrame: 30, trackIds: ['track'] }]);
	assert.equal(fixture.calls.begins.length, 1);
	assert.deepEqual(fixture.project(), before);
	assert.deepEqual(fixture.calls.commits, []);
	assert.deepEqual(fixture.calls.selections, []);
	assert.deepEqual(fixture.calls.loops, []);
});

test('cut preview requires a nonempty time selection and refuses recording', async () => {
	const fixture = createTransportFixture();
	fixture.setProject({ ...fixture.project(), selection: null });
	await assert.rejects(fixture.service.handleTransport('cut-preview'), /Select time/u);
	fixture.state.recorder = {};
	await fixture.service.handleTransport('cut-preview');
	assert.equal(fixture.calls.begins.length, 0);
});

for (const playbackState of ['playing', 'paused']) {
	test(`P ${playbackState === 'playing' ? 'pauses' : 'resumes'} a cut audition even when the stored speed slider is non-neutral`, async () => {
		const fixture = createTransportFixture();
		fixture.state.playAtSpeedRate = 1.5;
		fixture.setPlaybackState({ state: playbackState, cutPreview: true });
		await fixture.service.handleTransport('play');
		assert.equal(fixture.calls.playAtSpeed.length, 0);
		assert.equal(fixture.calls.pauses, playbackState === 'playing' ? 1 : 0);
		assert.equal(fixture.calls.plays, playbackState === 'paused' ? 1 : 0);
	});
}
