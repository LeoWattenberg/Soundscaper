/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFfmpegShotDetector,
	createWebCodecsShotDetector,
	detectShots,
} from '../src/common/editor/assistance/shot-detection.ts';

const RATE = 48_000;

function detector(id: string, result: unknown) {
	return { id, detect: () => Promise.resolve(result as never) };
}

function failing(id: string, message: string) {
	return { id, detect: () => Promise.reject(new Error(message)) };
}

function scoresWithCutAt(frame: number) {
	const scores = [];
	for (let position = 0; position < 60; position += 1) {
		const at = position * 1000;
		scores.push({ frame: at, score: at === frame ? 0.9 : 0.02 });
	}
	return scores;
}

const SOURCE = { sourceId: 'source-1' };

test('the first detector that succeeds produces the index', async () => {
	const resolved = await detectShots(new Blob(['x']), {
		...SOURCE,
		detectors: [detector('webcodecs', {
			scores: scoresWithCutAt(20_000), durationFrames: 60_000, sampleRate: RATE,
		})],
	});

	assert.equal(resolved.decision, 'shot-index');
	assert.equal(resolved.decision === 'shot-index' && resolved.backend, 'webcodecs');
	assert.deepEqual(
		resolved.decision === 'shot-index' ? resolved.index.shots.map(({ startFrame }) => startFrame) : null,
		[0, 20_000],
	);
	assert.equal(resolved.decision === 'shot-index' && resolved.index.detector, 'webcodecs');
});

test('an earlier failure is recorded and the next detector is tried', async () => {
	const resolved = await detectShots(new Blob(['x']), {
		...SOURCE,
		detectors: [
			failing('webcodecs', 'no hardware decoder'),
			detector('ffmpeg', { scores: scoresWithCutAt(30_000), durationFrames: 60_000, sampleRate: RATE }),
		],
	});

	assert.equal(resolved.decision === 'shot-index' && resolved.backend, 'ffmpeg');
});

test('no detector at all is an explicit outcome, not an empty index', async () => {
	// Assistance is optional, so a build without any decode path must say so
	// rather than silently report a source as one uncut shot.
	const resolved = await detectShots(new Blob(['x']), { ...SOURCE, detectors: [] });

	assert.equal(resolved.decision, 'unavailable');
	assert.equal(resolved.decision === 'unavailable' && resolved.reason, 'no-detector-succeeded');
	assert.deepEqual(resolved.decision === 'unavailable' ? resolved.failures : null, []);
});

test('every failure is recorded when none of them succeeds', async () => {
	const resolved = await detectShots(new Blob(['x']), {
		...SOURCE,
		detectors: [failing('webcodecs', 'unsupported codec'), failing('ffmpeg', 'out of memory')],
	});

	assert.equal(resolved.decision, 'unavailable');
	assert.deepEqual(
		resolved.decision === 'unavailable'
			? resolved.failures.map(({ backend, message }) => [backend, message])
			: null,
		[['webcodecs', 'unsupported codec'], ['ffmpeg', 'out of memory']],
	);
});

test('a source with no detected cut is one shot, which is a result not a failure', async () => {
	const flat = Array.from({ length: 40 }, (_unused, position) => ({ frame: position * 1000, score: 0.01 }));
	const resolved = await detectShots(new Blob(['x']), {
		...SOURCE,
		detectors: [detector('webcodecs', { scores: flat, durationFrames: 40_000, sampleRate: RATE })],
	});

	assert.equal(resolved.decision, 'shot-index');
	assert.deepEqual(
		resolved.decision === 'shot-index' ? resolved.index.shots.map(({ startFrame, endFrame }) => [startFrame, endFrame]) : null,
		[[0, 40_000]],
	);
});

test('cancellation propagates rather than being recorded as a backend failure', async () => {
	const controller = new AbortController();
	controller.abort(new Error('user cancelled'));

	await assert.rejects(
		detectShots(new Blob(['x']), {
			...SOURCE,
			signal: controller.signal,
			detectors: [detector('webcodecs', { scores: [], durationFrames: 1000, sampleRate: RATE })],
		}),
		/user cancelled/u,
	);
});

test('a malformed detector is refused rather than skipped', async () => {
	for (const bad of [{ id: '', detect: () => Promise.resolve() }, { id: 'x' }, null]) {
		await assert.rejects(
			detectShots(new Blob(['x']), { ...SOURCE, detectors: [bad as never] }),
			/detector/iu,
			JSON.stringify(bad),
		);
	}
});

test('a detector reporting an unusable source is a failure, not a bad index', async () => {
	const resolved = await detectShots(new Blob(['x']), {
		...SOURCE,
		detectors: [detector('webcodecs', { scores: [], durationFrames: 0, sampleRate: RATE })],
	});

	assert.equal(resolved.decision, 'unavailable');
	assert.ok(
		resolved.decision === 'unavailable' && /duration/iu.test(resolved.failures[0]?.message ?? ''),
		'the reason names what was wrong with the source',
	);
});

test('the minimum shot length reaches the collapse of a dissolve', async () => {
	const scores = [];
	for (let position = 0; position < 60; position += 1) {
		const at = position * 1000;
		const inBurst = at >= 20_000 && at <= 22_000;
		scores.push({ frame: at, score: inBurst ? 0.9 : 0.02 });
	}

	const collapsed = await detectShots(new Blob(['x']), {
		...SOURCE, minimumShotFrames: 10_000,
		detectors: [detector('webcodecs', { scores, durationFrames: 60_000, sampleRate: RATE })],
	});
	const uncollapsed = await detectShots(new Blob(['x']), {
		...SOURCE, minimumShotFrames: 0,
		detectors: [detector('webcodecs', { scores, durationFrames: 60_000, sampleRate: RATE })],
	});

	assert.equal(collapsed.decision === 'shot-index' && collapsed.index.shots.length, 2);
	assert.equal(uncollapsed.decision === 'shot-index' && uncollapsed.index.shots.length, 4);
});

test('the backend adapters mirror the timing-probe naming', () => {
	const webcodecs = createWebCodecsShotDetector(() => Promise.resolve() as never);
	assert.equal(webcodecs.id, 'webcodecs');

	const runtime = { detectSceneScores: () => Promise.resolve() as never };
	assert.equal(createFfmpegShotDetector(runtime)?.id, 'ffmpeg');
	assert.equal(createFfmpegShotDetector({}), null, 'a runtime without the port yields no detector');
	assert.throws(() => createWebCodecsShotDetector(null as never), /required/iu);
});
