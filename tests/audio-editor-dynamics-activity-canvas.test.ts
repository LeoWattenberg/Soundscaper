/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { drawDynamicsActivityCanvas } from '../src/common/editor/ui/dynamics-activity-canvas.ts';

interface DrawnPath {
	readonly kind: 'stroke' | 'fill';
	readonly color: string;
	readonly points: readonly (readonly [number, number])[];
}

function drawing() {
	const paths: DrawnPath[] = [];
	let points: [number, number][] = [];
	let clears = 0;
	const context = {
		strokeStyle: '', fillStyle: '', lineWidth: 0, lineJoin: '',
		clearRect: () => { clears += 1; },
		beginPath: () => { points = []; },
		moveTo: (x: number, y: number) => { points.push([x, y]); },
		lineTo: (x: number, y: number) => { points.push([x, y]); },
		closePath: () => undefined,
		stroke: () => { paths.push({ kind: 'stroke', color: context.strokeStyle, points: [...points] }); },
		fill: () => { paths.push({ kind: 'fill', color: context.fillStyle, points: [...points] }); },
	};
	const canvas = {
		width: 300, height: 240,
		getBoundingClientRect: () => ({ width: 300, height: 240 }),
		getContext: () => context,
	} as unknown as HTMLCanvasElement;
	return { canvas, paths, clears: () => clears };
}

const TRAIL = [
	{ inputDb: -36, outputDb: -48, reductionDb: -30 },
	{ inputDb: -24, outputDb: -12, reductionDb: -48 },
];

test('Audacity live input and output use shaded areas with an output outline', () => {
	const result = drawing();
	drawDynamicsActivityCanvas(result.canvas, TRAIL, 3, { audacity: true, show: { compression: false } });
	assert.deepEqual(result.paths.map(path => [path.kind, path.color]), [
		['fill', '#56569580'], ['fill', '#56569580'], ['stroke', '#FFFFFF80'],
	]);
	assert.deepEqual(result.paths[0]!.points, [[100, 240], [100, 180], [200, 120], [200, 240]]);
});

test('Audacity compression is a yellow line using the full compressor dB scale', () => {
	const result = drawing();
	drawDynamicsActivityCanvas(result.canvas, TRAIL, 3, { audacity: true, show: { input: false, output: false } });
	assert.deepEqual(result.paths, [{ kind: 'stroke', color: '#FFD12C80', points: [[100, 150], [200, 240]] }]);
});

test('Audacity visibility toggles remove only their chosen traces and still clear stale pixels', () => {
	for (const [show, expected] of [
		[{ input: true, output: false, compression: false }, ['fill']],
		[{ input: false, output: true, compression: false }, ['fill', 'stroke']],
		[{ input: false, output: false, compression: false }, []],
	] as const) {
		const result = drawing();
		drawDynamicsActivityCanvas(result.canvas, TRAIL, 3, { audacity: true, show });
		assert.deepEqual(result.paths.map(path => path.kind), expected);
		assert.equal(result.clears(), 1);
	}
});

test('Audacity limiter applies its 12 dB scale and clips values at its graph boundaries', () => {
	const result = drawing();
	drawDynamicsActivityCanvas(result.canvas, [
		{ inputDb: 6, outputDb: 0, reductionDb: -6 },
		{ inputDb: -30, outputDb: -6, reductionDb: -24 },
	], 2, { audacity: true, limiter: true, show: { input: false, output: false } });
	assert.deepEqual(result.paths[0]!.points, [[0, 120], [150, 240]]);
});

test('an empty activity trail clears its canvas without drawing stale signal', () => {
	const result = drawing();
	drawDynamicsActivityCanvas(result.canvas, [], 3, { audacity: true });
	assert.equal(result.clears(), 1);
	assert.deepEqual(result.paths, []);
});
