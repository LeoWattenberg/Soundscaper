/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeLegacyAupProject,
	LegacyAupError,
} from '../src/common/editor/aup-legacy.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';

test('legacy AUP progress failures propagate without being relabeled as corrupt blocks', async () => {
	const calls = { blockReads: 0 };
	const progressFailure = new Error('progress reporting failed');
	const xml = projectXml([
		wavetrackXml('e0000.au', 1),
	]);

	await assert.rejects(
		decodeLegacyAupProject(
			projectFile(xml),
			[blockFile('e0000.au', [0.25], calls)],
			{
				onProgress() {
					throw progressFailure;
				},
			},
		),
		(error: unknown) => error === progressFailure,
	);
	assert.equal(calls.blockReads, 1);
});

test('legacy AUP rejects unequal paired linked clips before reading either block', async () => {
	const calls = { blockReads: 0 };
	const xml = projectXml([
		wavetrackXml('left.au', 1, ' linked="1" channel="0"'),
		wavetrackXml('right.au', 2, ' channel="1"'),
	]);

	await assert.rejects(
		decodeLegacyAupProject(
			projectFile(xml),
			[
				blockFile('left.au', [0.25], calls),
				blockFile('right.au', [-0.25, 0.5], calls),
			],
		),
		(error: unknown) => {
			assert.ok(error instanceof LegacyAupError);
			assert.equal(error.code, 'CORRUPT_LINKED_TRACK');
			assert.match(error.message, /linked.*length|length.*linked/iu);
			assert.deepEqual(error.details, {
				clipIndex: 0,
				leftFrames: 1,
				rightFrames: 2,
			});
			return true;
		},
	);
	assert.equal(calls.blockReads, 0);
});

test('legacy AUP conversion retains admitted equal-length linked channel arrays', async () => {
	const calls = { blockReads: 0 };
	const xml = projectXml([
		wavetrackXml('left.au', 2, ' linked="1" channel="0"'),
		wavetrackXml('right.au', 2, ' channel="1"'),
	]);
	const decoded = await decodeLegacyAupProject(
		projectFile(xml),
		[
			blockFile('left.au', [0.25, 0.5], calls),
			blockFile('right.au', [-0.25, -0.5], calls),
		],
	);
	const admittedChannels = decoded.tracks[0].clips[0].channels;
	let nextId = 0;
	const converted = convertLegacyAupToProject(decoded, {
		idFactory: (prefix: string) => `${prefix}-${nextId += 1}`,
	});

	assert.equal(calls.blockReads, 2);
	assert.strictEqual(converted.sources[0].channels[0], admittedChannels[0]);
	assert.strictEqual(converted.sources[0].channels[1], admittedChannels[1]);
});

test('legacy AUP conversion retains an admitted zero-padded linked channel', async () => {
	const calls = { blockReads: 0 };
	const xml = projectXml([
		wavetrackXml('left.au', 2, ' linked="1" channel="0"'),
		'<wavetrack channel="1"/>',
	]);
	const decoded = await decodeLegacyAupProject(
		projectFile(xml),
		[blockFile('left.au', [0.25, 0.5], calls)],
	);
	const admittedChannels = decoded.tracks[0].clips[0].channels;
	let nextId = 0;
	const converted = convertLegacyAupToProject(decoded, {
		idFactory: (prefix: string) => `${prefix}-${nextId += 1}`,
	});

	assert.equal(calls.blockReads, 1);
	assert.deepEqual([...admittedChannels[1]], [0, 0]);
	assert.strictEqual(converted.sources[0].channels[0], admittedChannels[0]);
	assert.strictEqual(converted.sources[0].channels[1], admittedChannels[1]);
});

function projectXml(wavetracks: string[]): string {
	return `<project rate="44100">${wavetracks.join('')}</project>`;
}

function wavetrackXml(filename: string, frames: number, attributes = ''): string {
	return `<wavetrack${attributes}>
		<waveclip><sequence numsamples="${frames}"><waveblock start="0">
			<simpleblockfile filename="${filename}" len="${frames}"/>
		</waveblock></sequence></waveclip>
	</wavetrack>`;
}

function projectFile(xml: string): {
	readonly name: string;
	readonly size: number;
	text(): Promise<string>;
} {
	return {
		name: 'compatibility.aup',
		size: new TextEncoder().encode(xml).byteLength,
		async text() {
			return xml;
		},
	};
}

function blockFile(
	name: string,
	samples: number[],
	calls: { blockReads: number },
): {
	readonly name: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
} {
	const bytes = floatAuBlock(samples);
	return {
		name,
		size: bytes.byteLength,
		async arrayBuffer() {
			calls.blockReads += 1;
			return bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
		},
	};
}

function floatAuBlock(samples: number[]): Uint8Array {
	const bytes = new Uint8Array(24 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x2e736e64, false);
	view.setUint32(4, 24, false);
	view.setUint32(8, samples.length * Float32Array.BYTES_PER_ELEMENT, false);
	view.setUint32(12, 6, false);
	view.setUint32(16, 44_100, false);
	view.setUint32(20, 1, false);
	for (let index = 0; index < samples.length; index += 1) {
		view.setFloat32(24 + index * Float32Array.BYTES_PER_ELEMENT, samples[index], false);
	}
	return bytes;
}
