/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { demuxIsobmffVideoTiming } from '../src/common/editor/video-timing-demux-isobmff.ts';
import { createVideoTimingDemuxReader } from '../src/common/editor/video-timing-demux-reader.ts';

const MEDIA_TIMESCALE = 600;
const SAMPLE_COUNT = 10;
const SAMPLE_TICKS = 60;
const UNIT_RATE = 0x0001_0000;

interface EditEntry {
	readonly movieTicks: number;
	readonly mediaTicks: number;
	readonly rate?: number;
}

/** The coded grid every fixture below carries, before any edit list applies. */
function codedTicks(offsetSamples = 0, count = SAMPLE_COUNT): readonly bigint[] {
	return Array.from({ length: count }, (_value, index) => BigInt((index + offsetSamples) * SAMPLE_TICKS));
}

function timingOf(movieTimescale: number, edits: readonly EditEntry[] | null) {
	return demuxIsobmffVideoTiming(createVideoTimingDemuxReader(fixture(movieTimescale, edits)));
}

test('a trimming edit list drops the samples it skips and rebases the grid on the edit', async () => {
	// `ffmpeg -ss -c copy` keeps the pre-roll samples in `mdat` and states the trim
	// in `elst` alone. Reading the sample tables without the edit reports frames the
	// media element never presents, and a first frame two samples too early.
	const track = await timingOf(MEDIA_TIMESCALE, [{ movieTicks: 480, mediaTicks: 120 }]);
	assert.deepEqual([...track?.presentationTicks ?? []], [...codedTicks(0, 8)],
		'the edit starts the presentation timeline, so the kept frames count from zero');
	assert.equal(track?.finalFrameDurationTicks, BigInt(SAMPLE_TICKS));
});

test('an initial empty edit holds the presentation grid back by its own duration', async () => {
	// The A/V sync offset an iPhone MOV writes: nothing is presented for the empty
	// edit's span, so every frame lands one edit-duration later than it is coded.
	const track = await timingOf(1000, [
		{ movieTicks: 100, mediaTicks: -1 },
		{ movieTicks: 1000, mediaTicks: 0 },
	]);
	assert.equal(track?.presentationTicks.length, SAMPLE_COUNT);
	assert.equal(track?.presentationTicks[0], 60n,
		'100 movie ticks of a 1000 movie timescale is 60 ticks of the 600 media timescale');
	assert.deepEqual([...track?.presentationTicks ?? []], [...codedTicks(1)]);
});

test('a track with no edit list keeps the whole coded grid from zero', async () => {
	const track = await timingOf(MEDIA_TIMESCALE, null);
	assert.deepEqual([...track?.presentationTicks ?? []], [...codedTicks()]);
	assert.equal(track?.finalFrameDurationTicks, BigInt(SAMPLE_TICKS));
});

test('an edit list this cannot express exactly is refused rather than guessed at', async () => {
	assert.equal(await timingOf(MEDIA_TIMESCALE, [{ movieTicks: 480, mediaTicks: 90 }]), null,
		'an edit starting inside a frame has no exact whole-frame timeline to report');
	assert.equal(
		await timingOf(MEDIA_TIMESCALE, [{ movieTicks: 600, mediaTicks: 0, rate: UNIT_RATE / 2 }]),
		null, 'a half-rate edit is a speed change these sample tables do not state');
	assert.equal(await timingOf(MEDIA_TIMESCALE, [
		{ movieTicks: 300, mediaTicks: 0 },
		{ movieTicks: 300, mediaTicks: 420 },
	]), null, 'two non-contiguous segments are not one presentation grid');
});

/** A minimal `moov` whose single video track carries `edits`, or none for null. */
function fixture(movieTimescale: number, edits: readonly EditEntry[] | null): Blob {
	const moov = box('moov',
		fullBox('mvhd', u32(0), u32(0), u32(movieTimescale), u32(movieTimescale)),
		box('trak',
			...(edits === null ? [] : [box('edts', editList(edits))]),
			box('mdia',
				fullBox('mdhd', u32(0), u32(0), u32(MEDIA_TIMESCALE), u32(SAMPLE_COUNT * SAMPLE_TICKS)),
				fullBox('hdlr', u32(0), ascii('vide')),
				box('minf', box('stbl',
					fullBox('stts', u32(1), u32(SAMPLE_COUNT), u32(SAMPLE_TICKS)),
				)),
			),
		),
	);
	return new Blob([bytes(box('ftyp', ascii('isom')), moov).buffer]);
}

function editList(edits: readonly EditEntry[]): Uint8Array {
	return fullBox('elst', u32(edits.length), ...edits.map((edit) => bytes(
		u32(edit.movieTicks), i32(edit.mediaTicks), u32(edit.rate ?? UNIT_RATE),
	)));
}

function box(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
	const payload = bytes(...parts);
	return bytes(u32(payload.byteLength + 8), ascii(type), payload);
}

function fullBox(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
	return box(type, u32(0), ...parts);
}

function u32(value: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, value);
	return out;
}

function i32(value: number): Uint8Array {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setInt32(0, value);
	return out;
}

function ascii(value: string): Uint8Array {
	return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function bytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
	return result;
}
