/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudacityPhaser,
	applyAudacityWahwah,
} from '../src/common/editor/audacity-effects/realtime.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

const SAMPLE_RATE = 48_000;

/**
 * Audacity builds one effect instance per channel and marks every channel after
 * the first `ChannelNameFrontRight`, which adds pi to the modulator phase
 * (PhaserBase.cpp ProcessInitialize, WahWahBase.cpp ProcessInitialize). A
 * stereo selection therefore sweeps counter-phased, not mono-centred.
 */
const RIGHT_CHANNEL_OFFSET_DEGREES = 180;

function mixedSignal(frames = 5_000): Float32Array {
	return Float32Array.from({ length: frames }, (_, index) => (
		0.55 * Math.sin(2 * Math.PI * 317 * index / SAMPLE_RATE)
		+ 0.25 * Math.sin(2 * Math.PI * 5_731 * index / SAMPLE_RATE)
	));
}

interface LfoEffectCase {
	readonly name: string;
	readonly liveType: string;
	readonly apply: (
		channels: Float32Array[],
		sampleRate: number,
		params: Record<string, number>,
	) => Float32Array[];
	readonly params: Record<string, number>;
}

const CASES: readonly LfoEffectCase[] = [
	{
		name: 'Phaser',
		liveType: 'audacity-phaser',
		apply: applyAudacityPhaser,
		params: {
			stages: 8,
			dryWet: 255,
			frequency: 0.4,
			phaseDegrees: 0,
			depth: 255,
			feedbackPercent: 30,
			outputGainDb: 0,
		},
	},
	{
		name: 'Wahwah',
		liveType: 'audacity-wahwah',
		apply: applyAudacityWahwah,
		params: {
			frequency: 1.5,
			phaseDegrees: 0,
			depthPercent: 100,
			resonance: 2.5,
			frequencyOffsetPercent: 30,
			outputGainDb: 0,
		},
	},
];

function processStream(
	processor: { process: (input: Float32Array[], output: Float32Array[]) => unknown },
	channels: Float32Array[],
): Float32Array[] {
	const blockSizes = [17, 128, 61, 257, 3, 911];
	const frameCount = channels[0].length;
	const output = channels.map(() => new Float32Array(frameCount));
	let position = 0;
	let blockIndex = 0;
	while (position < frameCount) {
		const frames = Math.min(blockSizes[blockIndex % blockSizes.length], frameCount - position);
		const inputBlock = channels.map((channel) => channel.slice(position, position + frames));
		const outputBlock = output.map(() => new Float32Array(frames));
		processor.process(inputBlock, outputBlock);
		for (let channel = 0; channel < output.length; channel += 1) {
			output[channel].set(outputBlock[channel], position);
		}
		position += frames;
		blockIndex += 1;
	}
	return output;
}

test('Phaser and Wahwah invert the LFO phase of every channel after the first', () => {
	const mono = mixedSignal();
	for (const { name, apply, params } of CASES) {
		const stereo = apply([mono, mono], SAMPLE_RATE, params);
		const left = apply([mono], SAMPLE_RATE, params)[0];
		const right = apply([mono], SAMPLE_RATE, {
			...params,
			phaseDegrees: params.phaseDegrees + RIGHT_CHANNEL_OFFSET_DEGREES,
		})[0];

		assert.deepEqual(stereo[0], left, `${name} left channel`);
		assert.deepEqual(stereo[1], right, `${name} right channel`);
		assert.notDeepEqual(stereo[1], stereo[0], `${name} channels must not be identical`);

		// MakeChannelMap marks every channel index other than zero FrontRight,
		// so a third channel carries the same offset as the second.
		const surround = apply([mono, mono, mono], SAMPLE_RATE, params);
		assert.deepEqual(surround[2], right, `${name} third channel`);
	}
});

test('live Phaser and Wahwah stay sample-identical to the counter-phased stereo render', () => {
	const mono = mixedSignal();
	for (const { name, liveType, apply, params } of CASES) {
		const expected = apply([mono, mono], SAMPLE_RATE, params);
		const actual = processStream(
			createAudacityLiveProcessor(liveType, SAMPLE_RATE, params),
			[mono, mono],
		);
		assert.deepEqual(actual[0], expected[0], `${name} live left channel`);
		assert.deepEqual(actual[1], expected[1], `${name} live right channel`);
	}
});
