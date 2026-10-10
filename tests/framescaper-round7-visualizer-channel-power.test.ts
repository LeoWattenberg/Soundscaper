/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioSpectrum } from '../src/common/editor/analysis.js';
import { createFramescaperSoundVisualizerWindowReader } from '../src/framescaper/sound-visualizer-window.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';

const RATE = 48_000;
const FREQUENCY = 468.75;

function entry(mode: 'spectrum' | 'waveform'): UnifiedExactRenderVisualFrameEntryV13 {
	return { nodeId: 'visual-node', modelId: 'visual-clip', modelKind: 'sound-visualizer', trackId: 'visual',
		opacity: 1, blendMode: 'normal', masks: [], authoredState: {
			source: { schemaVersion: 1, kind: 'generator', id: 'visual-source', name: 'Sound Visualizer',
				width: 320, height: 180, frameRate: { num: 30, den: 1 }, frameCount: 30,
				generator: { kind: 'sound-visualizer', mode, sourceIds: ['recording'], windowSeconds: .25,
					backgroundColor: '#00000000', foregroundColor: '#ffffffff' } },
			clip: { schemaVersion: 1, kind: 'generator', id: 'visual-clip', sourceId: 'visual-source',
				sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 30 },
		} };
}

function fixture(amplitudes: readonly number[]) {
	const channels = amplitudes.map(amplitude => Float32Array.from({ length: RATE },
		(_, frame) => amplitude * Math.sin(2 * Math.PI * FREQUENCY * frame / RATE)));
	const project = { sampleRate: RATE, primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: ['audio', 'visual'] }],
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['recording-clip'] },
			{ id: 'visual', type: 'video', clipIds: ['visual-clip'] }],
		sources: [{ id: 'recording', kind: 'audio', storageKey: 'recording', sampleRate: RATE,
			frameCount: RATE, channelCount: amplitudes.length, chunkFrames: RATE }],
		clips: [{ id: 'recording-clip', kind: 'audio', sourceId: 'recording', timelineStartFrame: 0,
			durationFrames: RATE, sourceStartFrame: 0, sourceDurationFrames: RATE }],
	};
	let reads = 0;
	const reader = createFramescaperSoundVisualizerWindowReader({ project,
		store: { readSourceChunk(sourceId: string, index: number) {
			assert.equal(sourceId, 'recording'); assert.equal(index, 0); reads++;
			return { index: 0, frames: RATE, channels };
		} },
	});
	return { channels, reader, reads: () => reads };
}

for (const amplitudes of [[.5, -.5], [.5, -.5, .5, -.5], [.5, 0, 0, 0, 0, 0],
	Array.from({ length: 32 }, (_, channel) => channel % 2 ? -.5 : .5)]) {
	test(`visualizer spectrum retains channel power for a ${String(amplitudes.length)}-channel recording`, async context => {
		const f = fixture(amplitudes);
		const stored = f.channels[0]!.slice(0, 128);
		context.after(() => f.reader.dispose());
		const window = await f.reader.window(entry('spectrum'), 19_200, 12, new AbortController().signal);
		assert.ok(window.channels);
		const actual = calculateAudioSpectrum(window.channels, RATE, { size: 1_024 }).bins[10]!.amplitude;
		const expected = calculateAudioSpectrum(f.channels.map(channel => channel.subarray(13_200, 14_224)),
			RATE, { size: 1_024 }).bins[10]!.amplitude;
		assert.ok(expected > .08, 'the independent per-channel reference contains an audible tone');
		assert.ok(Math.abs(actual - expected) < .000_001, `${String(actual)} differs from channel power ${String(expected)}`);
		assert.equal(f.reads(), 1);
		assert.ok(window.channels.reduce((bytes, channel) => bytes + channel.byteLength, 0) <= 8 * 1_024 * 1_024);
		assert.deepEqual(f.channels[0]!.subarray(0, 128), stored, 'window preparation does not mutate stored recording samples');
	});
}

test('the existing surround waveform mean remains the authored waveform projection', async context => {
	const f = fixture([.5, -.5, .5, -.5]);
	context.after(() => f.reader.dispose());
	const window = await f.reader.window(entry('waveform'), 19_200, 12, new AbortController().signal);
	assert.equal(window.channels?.length, 1);
	assert.ok(window.channels![0]!.every(sample => sample === 0));
});
