/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisRenderer } from '../src/common/editor/controller/analysis-renderer.ts';

interface MixerStripFixture {
	id: string;
	name: string;
	gain: number;
	pan: number;
	mute: boolean;
	solo: boolean;
	effects: string[];
}

function bus(id: string, overrides: Partial<MixerStripFixture> = {}): MixerStripFixture {
	return { id, name: id, gain: 0.75, pan: -0.25, mute: false, solo: false, effects: ['compressor'], ...overrides };
}

function buildProject() {
	return {
		tracks: [
			{ id: 'vox', type: 'audio', mute: false, solo: false },
			{ id: 'drums', type: 'audio', mute: false, solo: false },
		],
		master: { gain: 0.5, effects: ['limiter'] },
		mixer: {
			groups: [bus('drum-bus', { solo: true })],
			sends: [bus('reverb', { mute: true })],
			cues: [bus('headphones', { solo: true, mute: true })],
			routes: { drums: { groupId: 'drum-bus', sends: {} } },
		},
	};
}

type AnalysisProjectFixture = ReturnType<typeof buildProject>;

function fixture() {
	const project = buildProject();
	const calls: { project: AnalysisProjectFixture; options: unknown; signal: AbortSignal | null }[] = [];
	const buffers = new Map<string, unknown>();
	const audio = { sampleRate: 48000, numberOfChannels: 1, length: 1, getChannelData: () => new Float32Array(1) };
	const render = createAnalysisRenderer({
		getProject: () => project,
		getSelectedTrackId: () => 'vox',
		cloneProject: structuredClone,
		projectSampleRate: () => 48000,
		hasMissingTimelineSources: () => false,
		sourceBuffers: buffers,
		copy: {
			localSourcesMissing: 'Missing sources',
			audioTrackRequired: 'Audio track required',
			analysisScopeInvalid: 'Invalid scope',
		},
		renderSnapshot: async (snapshot, options, _sourceBuffers, signal) => {
			calls.push({ project: snapshot, options, signal });
			return audio;
		},
	});
	return { project, calls, render, audio };
}

test('track analysis clears bus solo so a soloed bus elsewhere cannot silence the isolated track', async () => {
	const f = fixture();
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	const snapshot = f.calls[0]?.project;
	assert.ok(snapshot, 'the analysis renderer must render a snapshot');
	assert.deepEqual(snapshot.mixer.groups.map((strip) => [strip.id, strip.solo, strip.mute]), [['drum-bus', false, false]]);
	assert.deepEqual(snapshot.mixer.sends.map((strip) => [strip.id, strip.solo, strip.mute]), [['reverb', false, false]]);
	assert.deepEqual(snapshot.mixer.cues.map((strip) => [strip.id, strip.solo, strip.mute]), [['headphones', false, false]]);
	assert.deepEqual(snapshot.tracks, [
		{ id: 'vox', type: 'audio', mute: false, solo: false },
		{ id: 'drums', type: 'audio', mute: true, solo: false },
	]);
});

test('track analysis keeps bus gain, pan, effects and routing while neutralizing audibility flags', async () => {
	const f = fixture();
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	const snapshot = f.calls[0]?.project;
	assert.ok(snapshot, 'the analysis renderer must render a snapshot');
	assert.deepEqual(snapshot.mixer.groups[0], { ...bus('drum-bus'), solo: false, mute: false });
	assert.deepEqual(snapshot.mixer.routes, { drums: { groupId: 'drum-bus', sends: {} } });
});

test('the live document keeps its mixer solo and master analysis renders the mix as authored', async () => {
	const f = fixture();
	const before = structuredClone(f.project);
	await f.render('track', { startFrame: 0, endFrame: 48000 });
	assert.deepEqual(f.project, before);
	await f.render('master', { startFrame: 0, endFrame: 48000 });
	assert.deepEqual(f.calls[1]?.project, before);
	assert.notEqual(f.calls[1]?.project, f.project);
});
