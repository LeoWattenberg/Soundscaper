/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionSustainedOpusOracle, readMotionSustainedOpusPreSkip } from '../scripts/performance/motionscaper-sustained-opus.ts';

const count = 300 * 1600;
function run(mode: 'source' | 'inverted' | 'other' | 'drift', delay = 312) {
	const oracle = new MotionSustainedOpusOracle(count, delay);
	for (let start = 0; start < count + delay; start += 960) {
		const size = Math.min(960, count + delay - start), left = new Float32Array(size), right = new Float32Array(size);
		for (let at = 0; at < size; at++) {
			const index = start + at - delay + (mode === 'drift' && start > 24000 ? 30 : 0);
			const original = index < 0 || index >= count ? 0 : ((index % 127) - 63) / 128;
			const value = mode === 'other' ? Math.sin(index * 0.037) * 0.4 : mode === 'inverted' ? -original : original;
			left[at] = value; right[at] = -value;
		}
		oracle.write(left, right, start / 48000);
	}
	return oracle.finish();
}
test('Motionscaper sustained Opus binds one priming alignment to both retained source channels', () => {
	const result = run('source');
	assert.equal(result.sourceAlignmentSamples, 312);
	assert.deepEqual(result.sourceCorrelation, [1, 1]);
	assert.deepEqual(result.normalizedSourceError, [0, 0]);
	assert.equal(result.comparedSamples, count);
	assert.equal(result.leadingUncomparedSamples, 312);
	assert.equal(result.trailingUncomparedSamples, 0);
});
test('Motionscaper sustained Opus refuses swapped/inverted channels, unrelated opposite tones and changing alignment', () => {
	for (const mode of ['inverted', 'other', 'drift'] as const) assert.throws(() => run(mode), /source waveform/);
});
test('Motionscaper sustained Opus refuses absent or ambiguous header, gaps and oversized windows', () => {
	const header = new Uint8Array(19); header.set(new TextEncoder().encode('OpusHead')); header[8] = 1; header[9] = 2;
	new DataView(header.buffer).setUint16(10, 312, true);
	assert.equal(readMotionSustainedOpusPreSkip(header), 312);
	assert.throws(() => readMotionSustainedOpusPreSkip(header.subarray(1)), /Opus/);
	header[18] = 1; assert.throws(() => readMotionSustainedOpusPreSkip(header), /Opus/);
	const oracle = new MotionSustainedOpusOracle(count, 312);
	assert.throws(() => oracle.write(new Float32Array(8193), new Float32Array(8193), 0), /window/);
	oracle.write(new Float32Array(960), new Float32Array(960), 0);
	assert.throws(() => oracle.write(new Float32Array(960), new Float32Array(960), 1), /timestamp/);
});
