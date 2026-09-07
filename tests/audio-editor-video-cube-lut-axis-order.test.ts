/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseCubeLutV1,
	sampleCubeLut,
} from '../src/common/editor/video-color-cube-lut-v27.ts';
import {
	applyManagedSdrGradePixelV1,
	defaultVideoSourceColorInterpretationV1,
	normalizeVideoColorGradeV1,
} from '../src/common/editor/video-color-management-v27.ts';

/**
 * The Adobe/Iridas .cube format stores lattice entries with red varying
 * fastest and blue slowest, so the entry at flat index n is the lattice point
 * (r = n % size, g = floor(n / size) % size, b = floor(n / size ** 2)).
 */
const IDENTITY_CUBE = [
	'LUT_3D_SIZE 2',
	'DOMAIN_MIN 0 0 0',
	'DOMAIN_MAX 1 1 1',
	'0 0 0', '1 0 0', '0 1 0', '1 1 0',
	'0 0 1', '1 0 1', '0 1 1', '1 1 1',
].join('\n');

/** Identity in red and green; blue is discarded. Asymmetric in red and blue. */
const DROP_BLUE_CUBE = [
	'LUT_3D_SIZE 2',
	'DOMAIN_MIN 0 0 0',
	'DOMAIN_MAX 1 1 1',
	'0 0 0', '1 0 0', '0 1 0', '1 1 0',
	'0 0 0', '1 0 0', '0 1 0', '1 1 0',
].join('\n');

function close(actual: number, expected: number, tolerance = 1e-12): void {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('a spec-order identity cube LUT samples every corner unchanged', () => {
	const lut = parseCubeLutV1(IDENTITY_CUBE);
	for (const input of [
		[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
		[1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
	]) {
		const output = sampleCubeLut(lut, input);
		assert.deepEqual(output, input, `identity LUT moved ${JSON.stringify(input)}`);
	}
});

test('a spec-order identity cube LUT samples interior points unchanged', () => {
	const lut = parseCubeLutV1(IDENTITY_CUBE);
	const output = sampleCubeLut(lut, [0.25, 0.5, 0.75]);
	close(output[0]!, 0.25);
	close(output[1]!, 0.5);
	close(output[2]!, 0.75);
});

test('cube LUT sampling reads the red axis as the fastest-varying one', () => {
	// Under a blue-fastest reading this table would drop red instead of blue,
	// so pure red would sample to black and pure blue would sample to red.
	const lut = parseCubeLutV1(DROP_BLUE_CUBE);
	assert.deepEqual(sampleCubeLut(lut, [1, 0, 0]), [1, 0, 0]);
	assert.deepEqual(sampleCubeLut(lut, [0, 0, 1]), [0, 0, 0]);
	assert.deepEqual(sampleCubeLut(lut, [0, 1, 1]), [0, 1, 0]);
});

test('grading a red pixel through a spec-order identity LUT keeps it red', () => {
	const lut = parseCubeLutV1(IDENTITY_CUBE);
	const grade = normalizeVideoColorGradeV1({
		...normalizeVideoColorGradeV1(),
		lut: {
			storageKey: `lut-sha256:${lut.sha256}`,
			sha256: lut.sha256,
			byteLength: lut.byteLength,
			size: lut.size,
			domainMin: lut.domainMin,
			domainMax: lut.domainMax,
		},
	});
	const result = applyManagedSdrGradePixelV1({
		rgba: [1, 0, 0, 1],
		interpretation: defaultVideoSourceColorInterpretationV1('still', 'still-1'),
		grade,
		lut,
		outputSpace: 'linear-rec709-d65',
	});
	close(result[0], 1);
	close(result[1], 0);
	close(result[2], 0);
	close(result[3], 1);
});
