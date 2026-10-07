/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceControlTrackRenderer } from '../src/common/editor/controller/effects/internal/source-control-track-renderer.ts';
import type { EffectSelectionProject, EffectTarget } from '../src/common/editor/controller/effects/effect-selection-service.ts';

function fixture(sourceRate = 48_000, changes: Readonly<Record<string, unknown>> = {}) {
	const project: EffectSelectionProject = {
		id: 'placed-recording', schemaVersion: 1, sampleRate: 48_000,
		sources: [{ id: 'recording', frameCount: 8, sampleRate: sourceRate, channelCount: 1 }],
		tracks: [{ id: 'music', type: 'audio', name: 'Music', clipIds: ['phrase'] }],
		clips: [{ id: 'phrase', kind: 'audio', sourceId: 'recording', timelineStartFrame: 48_000,
			sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8 * 48_000 / sourceRate, ...changes }],
	};
	const target: EffectTarget = { sourceId: 'recording', sourceClipId: 'phrase', sourceSampleRate: sourceRate,
		startFrame: 0, endFrame: 8, durationFrames: 8, channelCount: 1, hasAudio: true, track: project.tracks[0]! };
	const calls: Array<readonly [string, number, number]> = [];
	const render = createSourceControlTrackRenderer(() => project, async (trackId, start, end) => {
		calls.push([trackId, start, end]);
		return [Float32Array.from({ length: end - start }, (_, frame) => (start + frame) / 1000)];
	});
	return { render, target, calls };
}

for (const sourceRate of [8000, 48_000]) {
	test(`source Auto Duck aligns the control at the placed clip using its ${sourceRate} Hz source clock`, async () => {
		const { render, target, calls } = fixture(sourceRate);
		const output = await render('voice', target);
		assert.equal(output.length, 1);
		assert.equal(output[0]!.length, 8);
		for (let frame = 0; frame < 8; frame++) {
			assert.ok(Math.abs(output[0]![frame]! - (48_000 + frame * 48_000 / sourceRate) / 1000) < 0.00001);
		}
		assert.ok(calls.every(([trackId, start, end]) => trackId === 'voice' && end - start <= 16_385));
	});
}

test('source control follows reversed playback coordinates', async () => {
	const { render, target } = fixture(48_000, { reversed: true });
	const output = await render('voice', target);
	for (let frame = 0; frame < 8; frame++) assert.ok(Math.abs(output[0]![frame]! - (48_008 - frame) / 1000) < 0.00001);
});

test('source control follows each authored warp segment', async () => {
	const { render, target } = fixture(48_000, { durationFrames: 12, warpMap: {
		feature: 'audio-warp', points: [
			{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
			{ outer: { num: 8, den: 1 }, source: { num: 4, den: 1 }, mode: 'forward' },
			{ outer: { num: 12, den: 1 }, source: { num: 8, den: 1 }, mode: 'forward' },
		],
	} });
	const output = await render('voice', target);
	for (let frame = 0; frame < 8; frame++) {
		const offset = frame < 4 ? frame * 2 : 8 + frame - 4;
		assert.ok(Math.abs(output[0]![frame]! - (48_000 + offset) / 1000) < 0.00001);
	}
});

test('ordinary timeline Auto Duck retains its original control render range', async () => {
	const { render, target, calls } = fixture();
	const { sourceClipId: _sourceClipId, ...timelineTarget } = target;
	await render('voice', timelineTarget);
	assert.deepEqual(calls, [['voice', 0, 8]]);
});
