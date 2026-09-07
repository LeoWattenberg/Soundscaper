/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisRenderer } from '../src/common/editor/controller/analysis-renderer.ts';

function fixture() {
	const project = { tracks: [
		{ id: 'voice', type: 'audio', mute: true, solo: true },
		{ id: 'music', type: 'audio', mute: false, solo: true },
		{ id: 'labels', type: 'label', mute: false, solo: false },
	], master: { gain: 0.5, effects: ['limiter'] } };
	const calls: unknown[][] = [];
	const buffers = new Map<string, unknown>();
	const audio = { sampleRate: 48000, numberOfChannels: 1, length: 1, getChannelData: () => new Float32Array(1) };
	let missing = false;
	const render = createAnalysisRenderer({
		getProject: () => project, getSelectedTrackId: () => 'voice',
		cloneProject: structuredClone, projectSampleRate: () => 48000,
		hasMissingTimelineSources: () => missing, sourceBuffers: buffers,
		copy: { localSourcesMissing: 'Missing sources', audioTrackRequired: 'Audio track required', analysisScopeInvalid: 'Invalid scope' },
		renderSnapshot: async (...args) => { calls.push(args); return audio; },
	});
	return { project, calls, buffers, render, audio, setMissing() { missing = true; } };
}

test('track analysis isolates its render without changing the document or label tracks', async () => {
	const f = fixture(), before = structuredClone(f.project), signal = new AbortController().signal;
	assert.equal(await f.render('track', { startFrame: 600000, endFrame: 650000 }, signal), f.audio);
	assert.deepEqual(f.project, before);
	assert.deepEqual(f.calls[0], [{
		tracks: [
			{ id: 'voice', type: 'audio', mute: false, solo: false },
			{ id: 'music', type: 'audio', mute: true, solo: false },
			before.tracks[2],
		], master: { gain: 1, effects: [] },
	}, { startFrame: 600000, endFrame: 650000, includeTail: false, preRollFrames: 480000 }, f.buffers, signal]);
});

test('master analysis preserves the mix and bounds pre-roll by the available prefix', async () => {
	const f = fixture();
	await f.render('master', { startFrame: 100, endFrame: 1000 });
	assert.deepEqual(f.calls[0], [f.project, { startFrame: 100, endFrame: 1000, includeTail: false, preRollFrames: 100 }, f.buffers, null]);
	assert.notEqual(f.calls[0]?.[0], f.project);
});

test('missing media, non-audio targets and unknown scopes are refused before rendering', async () => {
	const f = fixture();
	await assert.rejects(f.render('unknown', { startFrame: 0, endFrame: 1 }), /Invalid scope/u);
	f.project.tracks[0]!.type = 'label';
	await assert.rejects(f.render('track', { startFrame: 0, endFrame: 1 }), /Audio track required/u);
	f.setMissing();
	await assert.rejects(f.render('master', { startFrame: 0, endFrame: 1 }), /Missing sources/u);
	assert.deepEqual(f.calls, []);
});
