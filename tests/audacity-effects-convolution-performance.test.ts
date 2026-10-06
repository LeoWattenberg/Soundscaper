import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { convolveSame } from '../src/common/editor/audacity-effects/spectral-equalization-curves.js';
import { applyAudacityFilterCurveEq } from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const fixtures = [
	[17, 47, '8c7f34bb3447edfd6b52341c8d32498ce69a1c3e0c7175ef646d1d8dd58582c6'],
	[17, 48, '49a36fe59028317e3300ebfcb05a6e9ebaca60754923b93f1769015ffe17f449'],
	[17, 49, '174fc69eacde5b5ac84587d42a83a8887009111c7f9e376b653fffb3b4021f30'],
	[17, 3_017, 'ebd18e056a0cbf6275b82937ead02ddbdc1be817994c251882c1e5e6cc18ffd8'],
	[101, 155, '2bafc98256b3dd9169c255d01a7f3081344a3245b099a85da510fdc7446fc038'],
	[101, 156, 'ef4d219910425d69f4688f65e9e148729f0facfa5bb6ca6d8f38e5b23b2930d7'],
	[101, 157, 'fb7a5c5c5edffdfbd0bb5698be279c6e7ec74b17043423e79d53a45125099690'],
	[101, 3_017, '67454152892183ab68a0e92dbbfe362948064afea43b797f26e98104ca2eb511'],
	[257, 767, 'c5a980597dc01bdbcd7644de2563289126509b8713979cc86c5a8ebec476e661'],
	[257, 768, '236bcb1938fbf7233902ba15c53bc4936b4de04b1af6727db952086cfd8f516c'],
	[257, 769, '4b720c08f5a4d4a43b165a3358edd6fbfb77d9b87448fc42094e3e284361030b'],
	[257, 3_017, '9820e42e0b9b082e066044db78fa35ba4e8458e019800f9339fb109b38ae98ee'],
] as const;

test('bounded convolution preserves the original Float64 addition order and centred output', () => {
	for (const [kernelLength, length, expected] of fixtures) {
		const input = Float32Array.from({ length }, (_, frame) => Math.sin(frame * 0.17) * 0.7);
		const kernel = Float64Array.from({ length: kernelLength }, (_, tap) => Math.cos(tap * 0.29) * 0.01);
		const output = convolveSame(input, kernel);
		const hash = createHash('sha256').update(new Uint8Array(output.buffer)).digest('hex');
		assert.equal(hash, expected, `kernel ${kernelLength}, input ${length}`);
	}
});

test('EQ prepares its kernel once and bounds Float64 scratch independently of selection length and channels', () => {
	const input = Array.from({ length: 4 }, (_, channel) => Float32Array.from({ length: 40_003 }, (_, frame) => (
		Math.sin(frame * 0.031 + channel) * 0.2
	)));
	const original = globalThis.Float64Array;
	const lengths: number[] = [];
	globalThis.Float64Array = new Proxy(original, {
		construct(target, argumentsList, newTarget) {
			const result: Float64Array = Reflect.construct(target, argumentsList, newTarget);
			lengths.push(result.length);
			return result;
		},
	});
	try {
		const output = applyAudacityFilterCurveEq(input, 8_000, {
			filterLength: 101, points: [{ frequency: 20, gain: -3 }, { frequency: 4_000, gain: 6 }],
		});
		assert.equal(output.length, 4);
		assert.equal(lengths.filter((length) => length === 256).length, 5);
		assert.ok(lengths.every((length) => length <= 16_384), 'the accumulator must not grow with the selection');
		assert.deepEqual(input[0], Float32Array.from({ length: 40_003 }, (_, frame) => Math.sin(frame * 0.031) * 0.2));
	} finally {
		globalThis.Float64Array = original;
	}
});
