/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BEXT_FIXED_BODY_BYTES,
	BEXT_MAX_PAYLOAD_BYTES,
	appendPcmCodingHistory,
	createPcmCodingHistoryRow,
	createRiffBextChunk,
	encodeBextPayload,
	normalizeBextMetadata,
	parseBextPayload,
	parseRiffBextChunk,
} from '../src/common/editor/broadcast-wave.ts';

const UMID_32_BYTES = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('');
const MAX_UINT64 = '18446744073709551615';

test('BEXT v2 encoding writes the exact fixed-field layout and preserves uint64 precision', () => {
	const payload = encodeBextPayload({
		description: 'Morning bulletin',
		originator: 'Soundscaper',
		originatorReference: 'DE-SCP-20260728-0001',
		originationDate: '2026-07-28',
		originationTime: '12:34:56',
		timeReference: MAX_UINT64,
		umid: UMID_32_BYTES.toUpperCase(),
		loudnessValue: -23,
		loudnessRange: 7.25,
		maxTruePeakLevel: -1.005,
		maxMomentaryLoudness: -18.125,
		maxShortTermLoudness: null,
	});
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

	assert.equal(payload.byteLength, BEXT_FIXED_BODY_BYTES);
	assert.equal(ascii(payload, 0, 16), 'Morning bulletin');
	assert.equal(payload[16], 0);
	assert.equal(ascii(payload, 256, 11), 'Soundscaper');
	assert.equal(ascii(payload, 288, 20), 'DE-SCP-20260728-0001');
	assert.equal(ascii(payload, 320, 10), '2026-07-28');
	assert.equal(ascii(payload, 330, 8), '12:34:56');
	assert.equal(view.getUint32(338, true), 0xffff_ffff);
	assert.equal(view.getUint32(342, true), 0xffff_ffff);
	assert.equal(view.getUint16(346, true), 2);
	assert.equal(hex(payload.subarray(348, 380)), UMID_32_BYTES);
	assert.equal(hex(payload.subarray(380, 412)), '0'.repeat(64));
	assert.equal(view.getInt16(412, true), -2300);
	assert.equal(view.getInt16(414, true), 725);
	assert.equal(view.getInt16(416, true), -101, 'ties round away from zero despite binary floating-point error');
	assert.equal(view.getInt16(418, true), -1813);
	assert.equal(view.getUint16(420, true), 0x7fff);
	assert.equal(payload.subarray(422, 602).every((byte) => byte === 0), true);

	const parsed = parseBextPayload(payload);
	assert.deepEqual(parsed.warnings, []);
	assert.equal(parsed.metadata?.timeReference, MAX_UINT64);
	assert.equal(parsed.metadata?.umid, `${UMID_32_BYTES}${'0'.repeat(64)}`);
	assert.equal(parsed.metadata?.maxTruePeakLevel, -1.01);
});

test('BEXT text fields allow their full width, reject unsafe ASCII, and validate date and time', () => {
	const normalized = normalizeBextMetadata({
		description: 'D'.repeat(256),
		originator: 'O'.repeat(32),
		originatorReference: 'R'.repeat(32),
		originationDate: '2000-02-29',
		originationTime: '23:59:59',
	});
	assert.equal(normalized.description.length, 256);
	assert.equal(normalized.version, 2);
	assert.equal(normalized.timeReference, '0');
	assert.equal(normalizeBextMetadata({ timeReference: '00042' }).timeReference, '42');

	assert.throws(() => normalizeBextMetadata({ description: 'D'.repeat(257) }), /at most 256/u);
	assert.throws(() => normalizeBextMetadata({ originator: 'M\u00fcnchen' }), /ASCII/u);
	assert.throws(() => normalizeBextMetadata({ originatorReference: 'unsafe\0value' }), /ASCII/u);
	assert.throws(() => normalizeBextMetadata({ originationDate: '2025-02-29' }), /date/u);
	assert.throws(() => normalizeBextMetadata({ originationDate: '2026 07 28' }), /date/u);
	assert.throws(() => normalizeBextMetadata({ originationTime: '24:00:00' }), /time/u);
	assert.throws(() => normalizeBextMetadata({ timeReference: '9007199254740992.0' }), /unsigned 64-bit/u);
	assert.throws(() => normalizeBextMetadata({ timeReference: '18446744073709551616' }), /unsigned 64-bit/u);
});

test('UMIDs accept formatted 32-byte and 64-byte hexadecimal values and reject other lengths', () => {
	const formatted = `0x${UMID_32_BYTES.match(/../gu)?.join(':')}`;
	assert.equal(normalizeBextMetadata({ umid: formatted }).umid, `${UMID_32_BYTES}${'0'.repeat(64)}`);
	assert.equal(normalizeBextMetadata({ umid: `${UMID_32_BYTES}${UMID_32_BYTES}` }).umid,
		`${UMID_32_BYTES}${UMID_32_BYTES}`);
	assert.equal(normalizeBextMetadata({ umid: '' }).umid, '');
	assert.equal(normalizeBextMetadata({ umid: '00'.repeat(64) }).umid, '');
	assert.throws(() => normalizeBextMetadata({ umid: 'ab'.repeat(31) }), /32 or 64 bytes/u);
	assert.throws(() => normalizeBextMetadata({ umid: 'gg'.repeat(32) }), /hexadecimal/u);
});

test('loudness normalization applies EBU ties-away rounding, sentinels, and field ranges', () => {
	const payload = encodeBextPayload({
		loudnessValue: -22.645,
		loudnessRange: 12.765,
		maxTruePeakLevel: null,
		maxMomentaryLoudness: 99.99,
		maxShortTermLoudness: -99.99,
	});
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	assert.equal(view.getInt16(412, true), -2265);
	assert.equal(view.getInt16(414, true), 1277);
	assert.equal(view.getUint16(416, true), 0x7fff);
	assert.equal(view.getInt16(418, true), 9999);
	assert.equal(view.getInt16(420, true), -9999);
	assert.throws(() => normalizeBextMetadata({ loudnessRange: -0.01 }), /loudnessRange/u);
	assert.throws(() => normalizeBextMetadata({ loudnessValue: 100 }), /loudnessValue/u);
	assert.throws(() => normalizeBextMetadata({ maxTruePeakLevel: Number.NaN }), /maxTruePeakLevel/u);
});

test('CodingHistory has an LF model, emits CRLF rows, and appends a canonical R 98 PCM row', () => {
	const history = appendPcmCodingHistory('A=ANALOGUE,M=stereo,T=Tape\rOld deck\n', {
		sampleRate: 48_000,
		bitDepth: 24,
		channelCount: 2,
		product: 'Soundscaper',
	});
	assert.equal(history,
		'A=ANALOGUE,M=stereo,T=Tape\nOld deck\nA=PCM,F=48000,W=24,M=stereo,T=Soundscaper\n');
	assert.equal(createPcmCodingHistoryRow({
		sampleRate: 96_000,
		bitDepth: 16,
		channelCount: 1,
		product: 'Framescaper',
	}), 'A=PCM,F=96000,W=16,M=mono,T=Framescaper\n');
	assert.throws(() => createPcmCodingHistoryRow({
		sampleRate: 48_000,
		bitDepth: 24,
		channelCount: 2,
		product: 'Bad,Product',
	}), /comma/u);
	assert.throws(() => createPcmCodingHistoryRow({
		sampleRate: 48_000,
		bitDepth: 24,
		channelCount: 2,
		product: 'Bad\nProduct',
	}), /ASCII/u);

	const payload = encodeBextPayload({ codingHistory: history });
	assert.equal(ascii(payload, 602, payload.byteLength - 602), history.replaceAll('\n', '\r\n'));
	assert.equal(parseBextPayload(payload).metadata?.codingHistory, history);
});

test('RIFF bext chunks carry their payload size, include odd padding, and enforce the 64 KiB bound', () => {
	const chunk = createRiffBextChunk({ codingHistory: 'even row' });
	const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	assert.equal(ascii(chunk, 0, 4), 'bext');
	assert.equal(view.getUint32(4, true), 612);
	assert.equal(chunk.byteLength, 620);
	assert.equal(parseRiffBextChunk(chunk).metadata?.codingHistory, 'even row\n');

	const oddChunk = createRiffBextChunk({ codingHistory: 'odd row!!' });
	const oddView = new DataView(oddChunk.buffer, oddChunk.byteOffset, oddChunk.byteLength);
	assert.equal(oddView.getUint32(4, true), 613);
	assert.equal(oddChunk.byteLength, 622);
	assert.equal(oddChunk.at(-1), 0);
	assert.equal(parseRiffBextChunk(oddChunk.subarray(0, -1)).warnings.at(-1)?.code, 'invalid-padding');

	const maximumHistory = 'x'.repeat(BEXT_MAX_PAYLOAD_BYTES - BEXT_FIXED_BODY_BYTES - 2);
	assert.equal(encodeBextPayload({ codingHistory: maximumHistory }).byteLength, BEXT_MAX_PAYLOAD_BYTES);
	assert.throws(
		() => encodeBextPayload({ codingHistory: `${maximumHistory}x` }),
		/64 KiB/u,
	);
});

test('parsing accepts versions 0-2 and ignores fields introduced by later versions', () => {
	const versionZero = encodeBextPayload({ umid: UMID_32_BYTES, loudnessValue: -23 });
	new DataView(versionZero.buffer).setUint16(346, 0, true);
	const parsedZero = parseBextPayload(versionZero);
	assert.equal(parsedZero.metadata?.version, 0);
	assert.equal(parsedZero.metadata?.umid, '');
	assert.equal(parsedZero.metadata?.loudnessValue, null);
	assert.equal(parsedZero.warnings.some(({ code }) => code === 'nonzero-reserved'), true);

	const versionOne = encodeBextPayload({ umid: UMID_32_BYTES, loudnessValue: -23 });
	new DataView(versionOne.buffer).setUint16(346, 1, true);
	const parsedOne = parseBextPayload(versionOne);
	assert.equal(parsedOne.metadata?.version, 1);
	assert.equal(parsedOne.metadata?.umid, `${UMID_32_BYTES}${'0'.repeat(64)}`);
	assert.equal(parsedOne.metadata?.loudnessValue, null);
	assert.equal(parsedOne.warnings.some(({ code }) => code === 'nonzero-reserved'), true);

	const versionTwo = parseBextPayload(encodeBextPayload({ loudnessValue: -23 }));
	assert.equal(versionTwo.metadata?.version, 2);
	assert.equal(versionTwo.metadata?.loudnessValue, -23);
});

test('malformed BEXT fields produce warnings while usable metadata remains available', () => {
	const payload = encodeBextPayload({ description: 'usable', loudnessValue: -23, codingHistory: 'row' });
	payload[256] = 0xff;
	payload.set(new TextEncoder().encode('2025-02-29'), 320);
	payload[604] = 0x0a;
	new DataView(payload.buffer).setInt16(414, -1, true);
	payload[500] = 1;
	const parsed = parseBextPayload(payload);

	assert.equal(parsed.metadata?.description, 'usable');
	assert.equal(parsed.metadata?.originator, '?');
	assert.equal(parsed.metadata?.originationDate, '');
	assert.equal(parsed.metadata?.loudnessValue, -23);
	assert.equal(parsed.metadata?.loudnessRange, null);
	assert.equal(parsed.metadata?.codingHistory.endsWith('\n'), true);
	assert.deepEqual(new Set(parsed.warnings.map(({ code }) => code)), new Set([
		'invalid-ascii',
		'invalid-date',
		'invalid-loudness',
		'nonzero-reserved',
		'invalid-line-ending',
	]));
});

test('an unterminated CodingHistory row is retained canonically and reported', () => {
	const payload = new Uint8Array(BEXT_FIXED_BODY_BYTES + 3);
	new DataView(payload.buffer).setUint16(346, 2, true);
	payload.fill(0x7f, 412, 422);
	payload.set(new TextEncoder().encode('row'), BEXT_FIXED_BODY_BYTES);
	const parsed = parseBextPayload(payload);
	assert.equal(parsed.metadata?.codingHistory, 'row\n');
	assert.equal(parsed.warnings.some(({ code }) => code === 'unterminated-coding-history'), true);
});

test('structurally unsafe, truncated, and unsupported BEXT chunks are rejected with warnings', () => {
	const tooLarge = new Uint8Array(BEXT_MAX_PAYLOAD_BYTES + 1);
	assert.equal(parseBextPayload(tooLarge).metadata, null);
	assert.equal(parseBextPayload(tooLarge).warnings[0]?.code, 'payload-too-large');
	assert.equal(parseBextPayload(new Uint8Array(601)).warnings[0]?.code, 'truncated-payload');

	const unsupported = encodeBextPayload({});
	new DataView(unsupported.buffer).setUint16(346, 3, true);
	assert.equal(parseBextPayload(unsupported).metadata, null);
	assert.equal(parseBextPayload(unsupported).warnings[0]?.code, 'unsupported-version');

	const declaredHuge = new Uint8Array(8);
	declaredHuge.set(new TextEncoder().encode('bext'));
	new DataView(declaredHuge.buffer).setUint32(4, BEXT_MAX_PAYLOAD_BYTES + 1, true);
	assert.equal(parseRiffBextChunk(declaredHuge).warnings[0]?.code, 'payload-too-large');

	const truncated = new Uint8Array(12);
	truncated.set(new TextEncoder().encode('bext'));
	new DataView(truncated.buffer).setUint32(4, 602, true);
	assert.equal(parseRiffBextChunk(truncated).warnings[0]?.code, 'truncated-chunk');

	const wrongId = createRiffBextChunk({});
	wrongId.set(new TextEncoder().encode('JUNK'));
	assert.equal(parseRiffBextChunk(wrongId).warnings[0]?.code, 'invalid-chunk-id');
});

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
