/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';
import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

function spectralFixture() {
	const fixture = createTransportFixture();
	const frequencyRange = { minimumFrequency: 300, maximumFrequency: 1_000 };
	fixture.setProject({
		...fixture.project(),
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track'], clipIds: [], frequencyRange },
	});
	const ranges: unknown[] = [];
	Object.assign(fixture.engine, { setPlaybackFrequencyRange: (range: unknown) => { ranges.push(range); } });
	return { ...fixture, ranges, frequencyRange };
}

test('spectral playback uses the explicit time and frequency selection at normal speed without an edit', async () => {
	const fixture = spectralFixture();
	fixture.state.playAtSpeedRate = 1.5;
	const before = structuredClone(fixture.project());
	await fixture.service.handleTransport('play-spectral-selection');
	assert.deepEqual(fixture.ranges, [fixture.frequencyRange]);
	assert.deepEqual(fixture.calls.playRanges, [{ startFrame: 10, endFrame: 30 }]);
	assert.deepEqual(fixture.calls.seeks, [10]);
	assert.equal(fixture.calls.plays, 1);
	assert.equal(fixture.calls.playAtSpeed.length, 0);
	assert.deepEqual(fixture.project(), before);
	assert.deepEqual(fixture.calls.commits, []);
});

test('the spectral audition remains bound to its time selection even with an enabled loop', async () => {
	const fixture = spectralFixture();
	fixture.setProject({ ...fixture.project(), loop: { enabled: true, startFrame: 100, endFrame: 200 } });
	await fixture.service.handleTransport('play-spectral-selection');
	assert.deepEqual(fixture.calls.playRanges, [{ startFrame: 10, endFrame: 30 }]);
	assert.deepEqual(fixture.calls.loops, []);
});

test('spectral playback validates the explicit selection before preparing audio', async () => {
	for (const frequencyRange of [undefined, null, {}, { minimumFrequency: -1, maximumFrequency: 1_000 },
		{ minimumFrequency: 300, maximumFrequency: 300 }, { minimumFrequency: 300, maximumFrequency: NaN }]) {
		const fixture = spectralFixture();
		fixture.setProject({ ...fixture.project(), selection: { ...fixture.project().selection!, frequencyRange } });
		await assert.rejects(fixture.service.handleTransport('play-spectral-selection'), /Select frequencies/u);
		assert.equal(fixture.calls.begins.length, 0);
		assert.deepEqual(fixture.ranges, []);
	}
	const empty = spectralFixture();
	empty.setProject({ ...empty.project(), selection: { ...empty.project().selection!, endFrame: 10 } });
	await assert.rejects(empty.service.handleTransport('play-spectral-selection'), /Select time/u);
});

test('spectral playback refuses recording and missing audio, and stops project-bin preview first', async () => {
	const fixture = spectralFixture();
	fixture.state.recorder = {};
	await fixture.service.handleTransport('play-spectral-selection');
	assert.equal(fixture.calls.begins.length, 0);
	fixture.state.recorder = null;
	fixture.setMissingSources(true);
	await assert.rejects(fixture.service.handleTransport('play-spectral-selection'), /Sources missing/u);
	fixture.setMissingSources(false);
	fixture.state.projectBinPreview = {};
	await fixture.service.handleTransport('play-spectral-selection');
	assert.equal(fixture.calls.previewStops, 1);
});

test('stopped or superseded spectral preparation cannot start playback or install a listening filter', async () => {
	for (const cancellation of ['stop', 'retire', 'project-switch']) {
		const fixture = spectralFixture();
		let finish!: () => void;
		fixture.setBeginPreparation(() => new Promise<void>((resolve) => { finish = resolve; }));
		const playing = fixture.service.handleTransport('play-spectral-selection');
		if (cancellation === 'stop') await fixture.service.handleTransport('stop');
		else if (cancellation === 'retire') fixture.service.retireTimelinePlayback();
		else fixture.setProject({ ...fixture.project(), id: 'replacement' });
		finish();
		await playing;
		assert.equal(fixture.calls.plays, 0, cancellation);
		assert.deepEqual(fixture.ranges, [], cancellation);
	}
});

test('failed spectral playback clears its temporary listening filter', async () => {
	const fixture = spectralFixture();
	Object.assign(fixture.engine, { play: async () => { throw new Error('playback failed'); } });
	await assert.rejects(fixture.service.handleTransport('play-spectral-selection'), /playback failed/u);
	assert.deepEqual(fixture.ranges, [fixture.frequencyRange, null]);
});

test('the action facade dispatches the spectral playback command', async () => {
	const commands: string[] = [];
	const runtime = new Proxy(createActionFacadeRuntime(), {
		get(target, key, receiver) {
			if (key === 'capabilities') return { videoCompositing: false, audioSpectralEditing: true };
			if (key === 'handleTransport') return (command: string) => { commands.push(command); };
			return Reflect.get(target, key, receiver) as unknown;
		},
	});
	const transport = createGroupedEditorActions(runtime).transport;
	await transport.playSpectralSelection();
	assert.deepEqual(commands, ['play-spectral-selection']);
});

test('spectral playback resumes from inside the selection and pauses active playback', async () => {
	const fixture = spectralFixture();
	fixture.setPlaybackState({ state: 'playing' });
	await fixture.service.handleTransport('play-spectral-selection');
	assert.equal(fixture.calls.pauses, 1);
	assert.deepEqual(fixture.ranges, []);
	fixture.setPlaybackState({ state: 'paused' });
	fixture.setPositionFrame(20);
	await fixture.service.handleTransport('play-spectral-selection');
	assert.deepEqual(fixture.calls.seeks, []);
	assert.deepEqual(fixture.ranges, [fixture.frequencyRange]);
});

test('spectral playback retires a paused cut preview before starting the selected band', async () => {
	const fixture = spectralFixture();
	fixture.setPlaybackState({ state: 'paused', cutPreview: true });
	let stops = 0;
	Object.assign(fixture.engine, { stop: () => { stops += 1; } });
	await fixture.service.handleTransport('play-spectral-selection');
	assert.equal(stops, 1);
	assert.deepEqual(fixture.ranges, [fixture.frequencyRange]);
	assert.deepEqual(fixture.calls.playRanges, [{ startFrame: 10, endFrame: 30 }]);
});

test('ordinary Play during spectral engine startup retires the listening filter', async () => {
	const fixture = spectralFixture();
	let finish!: () => void;
	let starts = 0;
	Object.assign(fixture.engine, { play: () => {
		starts += 1;
		return starts === 1 ? new Promise<void>((resolve) => { finish = resolve; }) : undefined;
	} });
	const spectral = fixture.service.handleTransport('play-spectral-selection');
	await Promise.resolve();
	await Promise.resolve();
	await fixture.service.handleTransport('play');
	finish();
	await spectral;
	assert.equal(starts, 2);
	assert.deepEqual(fixture.ranges, [fixture.frequencyRange, null]);
});

test('a superseded failed spectral start cannot clear a newer audition', async () => {
	const fixture = spectralFixture();
	let fail!: (error: Error) => void;
	let starts = 0;
	Object.assign(fixture.engine, { play: () => {
		starts += 1;
		return starts === 1 ? new Promise<void>((_resolve, reject) => { fail = reject; }) : undefined;
	} });
	const first = fixture.service.handleTransport('play-spectral-selection');
	await Promise.resolve();
	await Promise.resolve();
	await fixture.service.handleTransport('play-spectral-selection');
	fail(new Error('retired start failed'));
	await assert.rejects(first, /retired start failed/u);
	assert.deepEqual(fixture.ranges, [fixture.frequencyRange, fixture.frequencyRange]);
});

test('the metronome follows the audition timeline when playback suppresses a saved loop', async () => {
	const fixture = spectralFixture();
	fixture.setProject({ ...fixture.project(), loop: { enabled: true, startFrame: 100, endFrame: 200 } });
	fixture.setPositionFrame(10);
	fixture.state.metronomeEnabled = true;
	fixture.state.transportState = 'playing';
	Object.assign(fixture.engine, { getState: () => ({
		state: 'playing', playbackRate: 1, loop: { enabled: false, startFrame: 100, endFrame: 200 },
	}) });
	fixture.setAudioContext({
		currentTime: 0, destination: {},
		createOscillator: () => ({
			frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {},
		}),
		createGain: () => ({
			gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {},
		}),
	});
	try {
		fixture.service.syncMetronome();
		await Promise.resolve();
		await Promise.resolve();
		const first = fixture.calls.metronomeSchedules[0] as { positionFrame: number };
		assert.equal(first.positionFrame, 10);
	} finally {
		fixture.service.stopMetronome();
	}
});

test('repeating Play cancels spectral cache preparation before a listening filter is installed', async () => {
	const fixture = spectralFixture();
	let finish!: () => void;
	fixture.state.playbackCacheAbort = new AbortController();
	fixture.setBeginPreparation(() => new Promise<void>((resolve) => { finish = resolve; }));
	const first = fixture.service.handleTransport('play-spectral-selection');
	await fixture.service.handleTransport('play-spectral-selection');
	finish();
	await first;
	assert.equal(fixture.calls.begins.length, 1);
	assert.equal(fixture.calls.plays, 0);
	assert.deepEqual(fixture.ranges, []);
});

test('Stop while retiring project-bin preview cancels the pending spectral audition', async () => {
	const fixture = spectralFixture();
	fixture.state.projectBinPreview = {};
	let finish!: () => void;
	fixture.setStopPreview(() => new Promise<void>((resolve) => { finish = resolve; }));
	const first = fixture.service.handleTransport('play-spectral-selection');
	await fixture.service.handleTransport('stop');
	finish();
	await first;
	assert.equal(fixture.calls.begins.length, 0);
	assert.equal(fixture.calls.plays, 0);
	assert.deepEqual(fixture.ranges, []);
});

test('moving the playhead while ordinary Play prepares audio preserves the requested playback', async () => {
	for (const action of ['jump-start', 'jump-end', 'rewind', 'forward']) {
		const fixture = createTransportFixture();
		let finish!: () => void;
		fixture.setBeginPreparation(() => new Promise<void>((resolve) => { finish = resolve; }));
		const first = fixture.service.handleTransport('play');
		await fixture.service.handleTransport(action);
		finish();
		await first;
		assert.equal(fixture.calls.plays, 1, action);
		assert.equal(fixture.calls.seeks.length, 1, action);
	}
});
