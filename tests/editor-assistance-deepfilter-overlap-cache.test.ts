/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeAssistanceDeepFilterChannelV1, createAssistanceDeepFilterChannelAnalyzerV1 } from '../src/common/editor/assistance/deepfilternet3-signal-v1.ts';

test('DeepFilter overlapping windows reuse only exact interior spectra within a byte budget', () => {
	const source = Float32Array.from({ length: 24_000 }, (_, frame) => Math.sin(frame * 0.013) * 0.2);
	const analyzer = createAssistanceDeepFilterChannelAnalyzerV1(64 * 1024);
	const first = source.subarray(0, 14_400);
	assert.deepEqual(analyzer.analyze(first, 0), analyzeAssistanceDeepFilterChannelV1(first));
	assert.ok(analyzer.cachedBytes <= 64 * 1024);
	const second = source.subarray(9_600, 24_000);
	const expected = analyzeAssistanceDeepFilterChannelV1(second);
	const actual = analyzer.analyze(second, 9_600);
	assert.deepEqual(actual, expected, 'recursive feature normalization must restart exactly as it did before reuse');
	assert.ok(analyzer.reusedFrames > 0);
	assert.ok(analyzer.cachedBytes <= 64 * 1024);
	first.fill(-0.75);
	actual.spectrumReal.fill(999);
	const changed = second.slice();
	changed[0] = 0.75;
	assert.deepEqual(analyzer.analyze(changed, 9_600), analyzeAssistanceDeepFilterChannelV1(changed));
});

test('DeepFilter spectrum cache rejects changed sample bits and retires after cancellation', () => {
	const analyzer = createAssistanceDeepFilterChannelAnalyzerV1(64 * 1024);
	const samples = new Float32Array(4_800).fill(0.25);
	analyzer.analyze(samples, 0);
	const changed = new Float32Array(4_800).fill(-0.5);
	assert.deepEqual(analyzer.analyze(changed, 0), analyzeAssistanceDeepFilterChannelV1(changed));
	assert.equal(analyzer.reusedFrames, 0);
	const abort = new AbortController();
	abort.abort(new Error('cancel spectrum admission'));
	assert.throws(() => analyzer.analyze(samples, 0, abort.signal), /cancel spectrum admission/iu);
	assert.equal(analyzer.cachedBytes, 0);
	assert.throws(() => createAssistanceDeepFilterChannelAnalyzerV1(32 * 1024 ** 2 + 1), /cache byte bound/iu);
});
