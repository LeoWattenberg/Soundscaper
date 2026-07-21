import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityWaveformChannelGeometry,
	audacityWaveformMode,
	audacityWaveformShowsPoints,
	drawAudacityWaveformChannel,
} from '../src/lib/tools/audio-editor/audacity-waveform-renderer.js';
import { prepareBoundedWaveformWindow } from '../src/lib/tools/audio-editor/design-system-adapters.js';

test('half-wave geometry expands the positive range across the full channel height', () => {
	assert.deepEqual(audacityWaveformChannelGeometry(10, 100), {
		centerY: 60,
		maxAmplitude: 48,
	});
	assert.deepEqual(audacityWaveformChannelGeometry(10, 100, true), {
		centerY: 108,
		maxAmplitude: 96,
	});
});

function clip(durationFrames, options = {}) {
	return {
		id: 'waveform-test-clip',
		sourceId: 'waveform-test-source',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		durationFrames,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
		...options,
	};
}

function recordingContext() {
	const calls = {
		arcs: [],
		fills: [],
		strokes: [],
	};
	let path = [];
	return {
		calls,
		beginPath() {
			path = [];
		},
		moveTo(x, y) {
			path.push(['moveTo', x, y]);
		},
		lineTo(x, y) {
			path.push(['lineTo', x, y]);
		},
		stroke() {
			calls.strokes.push(path);
		},
		arc(x, y, radius, startAngle, endAngle) {
			calls.arcs.push({ x, y, radius, startAngle, endAngle });
		},
		fill() {},
		fillRect(x, y, width, height) {
			calls.fills.push({ x, y, width, height });
		},
		set fillStyle(value) {},
		set lineCap(value) {},
		set lineJoin(value) {},
		set lineWidth(value) {},
		set strokeStyle(value) {},
	};
}

test('Audacity waveform modes switch at the half-pixel and four-pixel sample thresholds', () => {
	assert.equal(audacityWaveformMode(0.499), 'summary');
	assert.equal(audacityWaveformMode(0.5), 'connecting-dots');
	assert.equal(audacityWaveformMode(3.999), 'connecting-dots');
	assert.equal(audacityWaveformMode(4), 'stem');
	assert.equal(audacityWaveformShowsPoints(3.999), false);
	assert.equal(audacityWaveformShowsPoints(4), true);
	assert.throws(() => audacityWaveformMode(0), /must be positive/);
	assert.throws(() => audacityWaveformShowsPoints(Number.NaN), /must be positive/);
});

test('summary plans retain a continuous complete min/max column for every CSS pixel', () => {
	const source = Float32Array.from({ length: 28 }, (_, frame) => {
		const bucketValues = [-0.9, 0.8, -0.4, 0.6, -0.7, 0.3, -0.1];
		return bucketValues[Math.floor(frame / 4)];
	});
	const result = prepareBoundedWaveformWindow([source], clip(source.length), {
		maxSamples: 16,
		pixelWidth: 7.25,
	});

	assert.equal(result.rendering.mode, 'summary');
	const channel = result.rendering.channels[0];
	assert.equal(channel.minimum.length, 8);
	assert.equal(channel.maximum.length, 8);
	assert.equal(channel.rms.length, 8);
	assert.ok(Math.abs(channel.rms[0] - 0.9) < 1e-6, 'RMS remains an unsigned magnitude');
	for (let column = 0; column < 8; column += 1) {
		assert.ok(Number.isFinite(channel.minimum[column]));
		assert.ok(Number.isFinite(channel.maximum[column]));
		assert.ok(channel.minimum[column] <= channel.maximum[column]);
		if (!column) continue;
		assert.ok(
			channel.minimum[column - 1] <= channel.maximum[column],
			`column ${column} must reach the previous minimum`,
		);
		assert.ok(
			channel.maximum[column - 1] >= channel.minimum[column],
			`column ${column} must reach the previous maximum`,
		);
	}

	const context = recordingContext();
	drawAudacityWaveformChannel(context, result.rendering, {
		width: 7.25,
		centerY: 20,
		maxAmplitude: 18,
		sampleColor: '#000',
	});
	assert.deepEqual(context.calls.fills.map(({ x }) => x), [0, 1, 2, 3, 4, 5, 6, 7]);
	for (const fill of context.calls.fills) {
		assert.equal(fill.width, 1);
		assert.ok(fill.height >= 1);
	}
});

test('rendering reuse derives bounded compatibility samples without rescanning source PCM', () => {
	const frameCount = 256;
	const values = Array.from({ length: frameCount }, (_, frame) => {
		if (frame === 42) return 1;
		if (frame === 200) return -0.75;
		return Math.sin(frame / 9) * 0.25;
	});
	let indexedReads = 0;
	const source = new Proxy(values, {
		get(target, property, receiver) {
			if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1;
			return Reflect.get(target, property, receiver);
		},
	});
	const result = prepareBoundedWaveformWindow([source], clip(frameCount), {
		maxSamples: 32,
		pixelWidth: 16,
		reuseSummaryForCompatibility: true,
	});

	assert.equal(result.rendering.mode, 'summary');
	assert.equal(indexedReads, frameCount, 'the rendering pass must be the only source PCM traversal');
	assert.equal(result.sampleCount, 32);
	assert.equal(result.channels[0].length, 32);
	assert.ok(result.channels[0].includes(1));
	assert.ok(result.channels[0].includes(-0.75));
});

test('connecting-dot rendering includes the sample at the visible end boundary', () => {
	const source = Float32Array.from({ length: 12 }, (_, frame) => frame / 12);
	const result = prepareBoundedWaveformWindow([source], clip(source.length), {
		startFrame: 3,
		endFrame: 7,
		maxSamples: 16,
		pixelWidth: 8,
	});

	assert.equal(result.rendering.mode, 'connecting-dots');
	assert.equal(result.rendering.channels[0].firstSample, 3);
	assert.equal(result.rendering.channels[0].firstSampleX, 0);
	assert.equal(result.rendering.channels[0].samples.length, 5);
	const context = recordingContext();
	drawAudacityWaveformChannel(context, result.rendering, {
		width: 8,
		centerY: 20,
		maxAmplitude: 18,
		sampleColor: '#000',
		centerLineColor: '#888',
	});

	assert.equal(context.calls.strokes.length, 5);
	assert.deepEqual(context.calls.strokes[0], [['moveTo', 0, 20], ['lineTo', 8, 20]]);
	assert.deepEqual(context.calls.strokes.slice(1).map((path) => path[0][1]), [0, 2, 4, 6]);
	assert.deepEqual(context.calls.strokes.slice(1).map((path) => path[1][1]), [2, 4, 6, 8]);
});

test('stem rendering includes the end boundary and adds a sample head to each point', () => {
	const source = Float32Array.from({ length: 8 }, (_, frame) => frame / 8);
	const result = prepareBoundedWaveformWindow([source], clip(source.length), {
		startFrame: 3,
		endFrame: 5,
		maxSamples: 16,
		pixelWidth: 8,
	});

	assert.equal(result.rendering.mode, 'stem');
	const context = recordingContext();
	drawAudacityWaveformChannel(context, result.rendering, {
		width: 8,
		centerY: 20,
		maxAmplitude: 18,
		sampleColor: '#000',
		centerLineColor: '#888',
	});

	assert.deepEqual(context.calls.strokes.slice(0, -1).map((path) => path[0][1]), [0, 4, 8]);
	assert.deepEqual(context.calls.strokes.at(-1), [['moveTo', 0, 20], ['lineTo', 8, 20]]);
	assert.deepEqual(context.calls.arcs.map(({ x }) => x), [0, 4, 8]);
	assert.ok(context.calls.arcs.every(({ radius }) => radius === 2));
});

test('compressed clips retain source peaks in the summary plan without changing legacy output', () => {
	const source = Float32Array.of(0, 1, 0, -1, 0, 0.8, 0, -0.8);
	const result = prepareBoundedWaveformWindow([source], clip(4, { sourceDurationFrames: 8 }), {
		maxSamples: 16,
		pixelWidth: 2,
	});

	assert.equal(result.rendering.mode, 'summary');
	assert.deepEqual([...result.rendering.channels[0].minimum].map((value) => Math.round(value * 10) / 10), [-1, -0.8]);
	assert.deepEqual([...result.rendering.channels[0].maximum].map((value) => Math.round(value * 10) / 10), [1, 0.8]);
	assert.deepEqual([...result.channels[0]], [0, 0, 0, 0]);
});

test('compressed and slow-stretched clips choose modes and x positions from source samples', () => {
	const compressedSource = Float32Array.of(0, 1, 2, 3, 4, 5, 6, 7);
	const compressed = prepareBoundedWaveformWindow(
		[compressedSource],
		clip(4, { sourceDurationFrames: 8 }),
		{ maxSamples: 16, pixelWidth: 4 },
	);
	assert.equal(compressed.rendering.mode, 'connecting-dots');
	assert.equal(compressed.rendering.pixelsPerSample, 0.5);
	assert.deepEqual([...compressed.rendering.channels[0].samples], [...compressedSource]);

	const stretchedSource = Float32Array.of(1, 2, 3, 4);
	const stretched = prepareBoundedWaveformWindow(
		[stretchedSource],
		clip(8, { sourceDurationFrames: 4 }),
		{ maxSamples: 16, pixelWidth: 2 },
	);
	assert.equal(stretched.rendering.mode, 'connecting-dots');
	assert.equal(stretched.rendering.pixelsPerSample, 0.5);
	assert.deepEqual([...stretched.rendering.channels[0].samples], [...stretchedSource]);
	assert.deepEqual([...stretched.channels[0]], [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('trimmed reversed clips map visual source ordinals without losing boundary samples', () => {
	const source = Float32Array.of(99, 10, 20, 30, 40, 88);
	const result = prepareBoundedWaveformWindow([source], clip(8, {
		sourceStartFrame: 1,
		sourceDurationFrames: 4,
		reversed: true,
	}), {
		startFrame: 3,
		endFrame: 7,
		maxSamples: 16,
		pixelWidth: 4,
	});

	assert.equal(result.rendering.mode, 'connecting-dots');
	assert.equal(result.rendering.channels[0].firstSample, 1);
	assert.equal(result.rendering.channels[0].firstSampleX, -1);
	assert.deepEqual([...result.rendering.channels[0].samples], [30, 20, 10]);
});
