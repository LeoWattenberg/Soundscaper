/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import { nativeRackEffectCommit } from '../src/common/editor/ui/inspector/live-rack-effect-gesture.ts';
import { nativeEffectParamRange } from '../src/common/editor/ui/inspector/native-effect-param-range.ts';

test('native atomic edits await gesture acquisition and commit all current numeric and choice parameters', async () => {
	const effect = createEffect('tremolo');
	const calls: unknown[] = [];
	let releaseBegin: (() => void) | undefined;
	const begin = new Promise<void>((resolve) => { releaseBegin = resolve; });
	const commit = nativeRackEffectCommit(effect, { depth: 80, waveform: 'square' }, () => {
		calls.push('begin');
		return begin;
	}, (params) => { calls.push(params); });
	assert.ok(commit);
	const pending = commit();
	assert.deepEqual(calls, ['begin']);
	assert.ok(releaseBegin);
	releaseBegin();
	await pending;
	assert.deepEqual(calls, ['begin', { ...effect.params, depth: 80, waveform: 'square' }]);
});

test('all converted effects can atomically commit a preset through their live gesture callbacks', async () => {
	for (const type of ['multi-tap-delay', 'highpass-filter', 'lowpass-filter', 'noise-gate',
		'notch-filter', 'shelf-filter', 'tremolo', 'vocoder']) {
		const effect = createEffect(type);
		let committed: unknown;
		const commit = nativeRackEffectCommit(effect, effect.params, () => undefined, (params) => { committed = params; });
		assert.ok(commit, type);
		await commit();
		assert.deepEqual(committed, effect.params);
	}
});

test('failed gesture acquisition does not commit parameters and preserves the caller error path', async () => {
	let commits = 0;
	let cancels = 0;
	const cause = new Error('Playback stopped before gesture acquisition');
	const commit = nativeRackEffectCommit(createEffect('vocoder'), { bands: 20 }, () => Promise.reject(cause),
		() => { commits++; }, () => { cancels++; });
	assert.ok(commit);
	await assert.rejects(commit, cause);
	assert.equal(commits, 0);
	assert.equal(cancels, 1);
});

test('rejected parameter commits cancel the gesture and retain the rejection even if cancellation fails', async () => {
	const cause = new RangeError('Filter frequency must be below Nyquist.');
	const calls: string[] = [];
	const commit = nativeRackEffectCommit(createEffect('notch-filter'), { frequency: 24_000 },
		() => { calls.push('begin'); }, () => Promise.reject(cause), () => {
			calls.push('cancel');
			return Promise.reject(new Error('Playback already stopped'));
		});
	assert.ok(commit);
	await assert.rejects(commit, (error: unknown) => error === cause);
	assert.deepEqual(calls, ['begin', 'cancel']);
});

test('selection editors and legacy effects retain ordinary atomic parameter updates', () => {
	const begin = () => undefined;
	const commit = () => undefined;
	assert.equal(nativeRackEffectCommit(createEffect('tremolo'), {}, null, commit), null);
	assert.equal(nativeRackEffectCommit(createEffect('tremolo'), {}, begin, undefined), null);
	assert.equal(nativeRackEffectCommit(null, {}, begin, commit), null);
	for (const type of ['delay', 'reverb', 'gate', 'highpass']) {
		assert.equal(nativeRackEffectCommit(createEffect(type), {}, begin, commit), null);
	}
});

test('native cutoff controls respect both descriptor limits and project Nyquist with an editable step', () => {
	for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter']) {
		assert.deepEqual(nativeEffectParamRange(type, 'frequency', [.1, 24_000], 48_000, .1), [.1, 23_999.9]);
		assert.deepEqual(nativeEffectParamRange(type, 'frequency', [.1, 24_000], 8_000, .1), [.1, 3_999.9]);
	}
	assert.deepEqual(nativeEffectParamRange('shelf-filter', 'frequency', [10, 10_000], 48_000, 1), [10, 10_000]);
	assert.deepEqual(nativeEffectParamRange('shelf-filter', 'frequency', [10, 10_000], 8_000, 1), [10, 3_999]);
	assert.deepEqual(nativeEffectParamRange('noise-gate', 'gateFrequency', [0, 10_000], 8_000, 1), [0, 3_999]);
	for (const sampleRate of [Number.NaN, 0, 1_000, Number.POSITIVE_INFINITY]) {
		assert.deepEqual(nativeEffectParamRange('notch-filter', 'frequency', [.1, 24_000], sampleRate, .1), [.1, 23_999.9]);
	}
});

test('modulation rates, legacy effects, and non-frequency native controls keep their descriptor ranges', () => {
	const range = [.001, 1_000];
	assert.equal(nativeEffectParamRange('tremolo', 'frequency', range, 8_000, .001), range);
	assert.equal(nativeEffectParamRange('highpass', 'frequency', range, 8_000, 1), range);
	assert.equal(nativeEffectParamRange('notch-filter', 'q', range, 8_000, .1), range);
	assert.equal(nativeEffectParamRange('noise-gate', 'threshold', range, 8_000, .1), range);
	assert.equal(nativeEffectParamRange('notch-filter', 'frequency', null, 8_000, .1), null);
});
