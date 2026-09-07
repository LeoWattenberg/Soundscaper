/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { demuxMatroskaVideoTiming } from '../src/common/editor/video-timing-demux-matroska.ts';
import { createVideoTimingDemuxReader } from '../src/common/editor/video-timing-demux-reader.ts';

test('a live-written Matroska segment cut inside a declared block refuses to state partial timing', async () => {
	const whole = liveMatroskaFixture([block(0), block(10), block(20)]);
	const complete = await demuxMatroskaVideoTiming(readerFor(whole));
	assert.deepEqual([...(complete?.presentationTicks ?? [])], [0n, 10n, 20n],
		'the fixture itself has to parse, so the truncated case can only fail for truncation');

	// Two bytes short of the last SimpleBlock's declared payload: its header still
	// parses and names a body the source does not contain, which is what an
	// interrupted recording leaves behind.
	const truncated = whole.subarray(0, whole.byteLength - 2);
	await assert.rejects(
		demuxMatroskaVideoTiming(readerFor(truncated)),
		(error: unknown) => error instanceof Error,
		'a segment that ends inside a block it declared must fail rather than index the blocks before it',
	);
});

function readerFor(bytes: Uint8Array): ReturnType<typeof createVideoTimingDemuxReader> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return createVideoTimingDemuxReader(new Blob([copy.buffer]));
}

/**
 * A segment shaped the way a recorder writes one: the cluster declares no size,
 * so its content runs to the end of the source and the walk has to scan forward
 * through it.
 */
function liveMatroskaFixture(blocks: readonly Uint8Array[]): Uint8Array {
	return bytes(
		element([0x1a, 0x45, 0xdf, 0xa3], Uint8Array.of(1)),
		element([0x16, 0x54, 0xae, 0x6b], element([0xae],
			element([0xd7], Uint8Array.of(1)),
			element([0x83], Uint8Array.of(1)),
		)),
		unknownSizeElement([0x1f, 0x43, 0xb6, 0x75],
			element([0xe7], Uint8Array.of(0)),
			...blocks,
		),
	);
}

function block(timestamp: number): Uint8Array {
	return element([0xa3], Uint8Array.of(0x81, timestamp >> 8 & 0xff, timestamp & 0xff, 0));
}

function element(id: readonly number[], ...parts: readonly Uint8Array[]): Uint8Array {
	const payload = bytes(...parts);
	assert.ok(payload.byteLength < 127);
	return bytes(Uint8Array.from(id), Uint8Array.of(0x80 | payload.byteLength), payload);
}

function unknownSizeElement(id: readonly number[], ...parts: readonly Uint8Array[]): Uint8Array {
	return bytes(Uint8Array.from(id), Uint8Array.of(0xff), bytes(...parts));
}

function bytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
	return result;
}
