/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { gzipSync } from 'fflate';

import {
	createAdmChna,
	encodeChnaPayload,
	generateAdmAxml,
} from '../src/common/editor/adm-metadata.ts';
import { WAV_ADM_PAYLOAD_MAX_BYTES } from '../src/common/editor/wav-adm-import.ts';
import { WAV_OPAQUE_RIFF_MAX_BYTES } from '../src/common/editor/wav-opaque-chunks.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

const UINT32_SENTINEL = 0xffff_ffff;

test('BW64 inspection parses bounded static AXML and consistent CHNA without reading PCM', async () => {
	const xml = generateAdmAxml({ programmeName: 'Documentary', language: 'eng', layout: 'stereo' });
	const xmlBytes = new Uint8Array(3 + new TextEncoder().encode(xml).byteLength);
	xmlBytes.set([0xef, 0xbb, 0xbf]);
	xmlBytes.set(new TextEncoder().encode(xml), 3);
	const chna = encodeChnaPayload(createAdmChna({ layout: 'stereo' }));
	const tracked = trackingBlob(createBw64({
		channelCount: 2,
		data: int16Bytes([1, -1, 2, -2]),
		metadata: [
			{ id: 'chna', bytes: chna },
			{ id: 'axml', bytes: xmlBytes, afterData: true },
		],
	}));
	const descriptor = await inspectWavBlobPcm(tracked);

	assert.equal(descriptor.frameCount, 2);
	assert.deepEqual(descriptor.metadataWarnings, []);
	assert.deepEqual(descriptor.adm, {
		container: 'bw64',
		payload: { kind: 'axml', xml, rawBase64: Buffer.from(xmlBytes).toString('base64') },
		riffChunkSequence: [
			{ id: 'chna', placement: 'before-data', rawBase64: Buffer.from(riffChunk('chna', chna)).toString('base64') },
			{ id: 'axml', placement: 'after-data', rawBase64: Buffer.from(riffChunk('axml', xmlBytes)).toString('base64') },
		],
		chna: {
			numTracks: 2,
			entries: [
				{ trackIndex: 1, uid: 'ATU_00000001', trackRef: 'AC_00010001', packRef: 'AP_00010002' },
				{ trackIndex: 2, uid: 'ATU_00000002', trackRef: 'AC_00010002', packRef: 'AP_00010002' },
			],
			rawBase64: Buffer.from(chna).toString('base64'),
		},
		valid: true,
		warnings: [],
	});
	assert.equal(tracked.reads.some(({ start }) => start === descriptor.dataOffset), false);

	const decoded: number[][] = [];
	await streamWavBlobPcm(tracked, {
		descriptor,
		onChunk(channels: Float32Array[]) { decoded.push(channels.map((channel) => channel[0])); },
	});
	assert.deepEqual(decoded, [[1 / 32_768, -1 / 32_768]]);
});

test('BW64 inspection preserves complete unmodeled RIFF chunks in placement order', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const chna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const beforeOdd = riffChunk('JUNK', Uint8Array.of(1, 2, 3), false, 0xa5);
	const beforeList = riffChunk('LIST', Uint8Array.of(0x56, 0x45, 0x4e, 0x44, 9));
	const afterOdd = riffChunk('PEAK', Uint8Array.of(4, 5, 6), false, 0x7f);
	const afterId3 = riffChunk('id3 ', Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0));
	const afterEven = riffChunk('MD5 ', Uint8Array.of(7, 8));
	const descriptor = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'JUNK', bytes: Uint8Array.of(1, 2, 3), padByte: 0xa5 },
			{ id: 'LIST', bytes: Uint8Array.of(0x56, 0x45, 0x4e, 0x44, 9) },
			{ id: 'chna', bytes: chna },
			{ id: 'axml', bytes: new TextEncoder().encode(xml), afterData: true },
			{ id: 'PEAK', bytes: Uint8Array.of(4, 5, 6), padByte: 0x7f, afterData: true },
			{ id: 'id3 ', bytes: Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0), afterData: true },
			{ id: 'MD5 ', bytes: Uint8Array.of(7, 8), afterData: true },
		],
	}));

	assert.equal(descriptor.adm?.valid, true);
	assert.deepEqual(descriptor.adm?.opaqueRiffChunks, [
		{ id: 'JUNK', placement: 'before-data', rawBase64: Buffer.from(beforeOdd).toString('base64') },
		{ id: 'LIST', placement: 'before-data', rawBase64: Buffer.from(beforeList).toString('base64') },
		{ id: 'PEAK', placement: 'after-data', rawBase64: Buffer.from(afterOdd).toString('base64') },
		{ id: 'id3 ', placement: 'after-data', rawBase64: Buffer.from(afterId3).toString('base64') },
		{ id: 'MD5 ', placement: 'after-data', rawBase64: Buffer.from(afterEven).toString('base64') },
	]);
	assert.deepEqual(descriptor.metadataWarnings, []);
});

test('BW64 leaves ADM source-scoped when opaque RIFF chunks exceed the preservation budget', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const oversized = new Uint8Array(WAV_OPAQUE_RIFF_MAX_BYTES);
	const tracked = trackingBlob(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'VEND', bytes: oversized },
			{ id: 'chna', bytes: encodeChnaPayload(createAdmChna({ layout: 'mono' })) },
			{ id: 'axml', bytes: new TextEncoder().encode(xml), afterData: true },
		],
	}));
	const descriptor = await inspectWavBlobPcm(tracked);

	assert.equal(descriptor.adm?.valid, false);
	assert.equal(descriptor.adm?.opaqueRiffChunks, undefined);
	assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-opaque-chunk-preservation-incomplete'));
	assert.equal(tracked.reads.some(({ byteLength }) => byteLength >= WAV_OPAQUE_RIFF_MAX_BYTES), false);
});

test('BW64 leaves ADM source-scoped for ds64-sized opaque chunks that cannot be re-emitted exactly', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const descriptor = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'VEND', bytes: Uint8Array.of(1, 2, 3, 4), sentinel: true },
			{ id: 'chna', bytes: encodeChnaPayload(createAdmChna({ layout: 'mono' })) },
			{ id: 'axml', bytes: new TextEncoder().encode(xml), afterData: true },
		],
	}));

	assert.equal(descriptor.adm?.valid, false);
	assert.equal(descriptor.adm?.opaqueRiffChunks, undefined);
	assert.ok(descriptor.metadataWarnings.some(({ code, message }) => (
		code === 'adm-opaque-chunk-preservation-incomplete' && /ds64 table size/u.test(message)
	)));
});

test('BW64 preserves an independent SXML stream alongside static AXML', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const xmlBytes = new TextEncoder().encode(xml);
	const sxml = sxmlPayload([{ samples: 1, xml: '<frame />' }]);
	const chna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const descriptor = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: chna },
			{ id: 'axml', bytes: xmlBytes },
			{ id: 'sxml', bytes: sxml },
		],
	}));
	assert.equal(descriptor.adm?.valid, true);
	assert.deepEqual(descriptor.adm?.payload, {
		kind: 'axml', xml, rawBase64: Buffer.from(xmlBytes).toString('base64'),
	});
	assert.deepEqual(descriptor.adm?.serialPayload, {
		kind: 'sxml', base64: Buffer.from(sxml).toString('base64'),
	});
	assert.deepEqual(descriptor.metadataWarnings, []);
});

test('BW64 rejects conflicting static payloads and duplicate SXML while preserving the first of each', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const xmlBytes = new TextEncoder().encode(xml);
	const firstSxml = sxmlPayload([{ samples: 1, xml: '<frame />' }]);
	const descriptor = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: encodeChnaPayload(createAdmChna({ layout: 'mono' })) },
			{ id: 'axml', bytes: xmlBytes },
			{ id: 'bxml', bytes: bxmlPayload(0, xmlBytes) },
			{ id: 'sxml', bytes: firstSxml },
			{ id: 'sxml', bytes: Uint8Array.of(0, 2) },
		],
	}));
	assert.equal(descriptor.adm?.valid, false);
	assert.equal(descriptor.adm?.payload.kind, 'axml');
	assert.deepEqual(descriptor.adm?.serialPayload, {
		kind: 'sxml', base64: Buffer.from(firstSxml).toString('base64'),
	});
	assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-static-payload-conflict'));
	assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-payload-duplicate'));
});

test('BW64 permits AXML and BXML together when only one carries ADM', async () => {
	const xml = generateAdmAxml({ layout: 'mono' });
	const xmlBytes = new TextEncoder().encode(xml);
	const unrelatedBxml = bxmlPayload(0, new TextEncoder().encode('<vendorMetadata />'));
	const chna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const axmlPrimary = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: chna },
			{ id: 'axml', bytes: xmlBytes },
			{ id: 'bxml', bytes: unrelatedBxml },
		],
	}));
	assert.equal(axmlPrimary.adm?.valid, true);
	assert.equal(axmlPrimary.adm?.payload.kind, 'axml');
	assert.deepEqual(axmlPrimary.adm?.auxiliaryPayloads, [{
		kind: 'bxml', base64: Buffer.from(unrelatedBxml).toString('base64'),
	}]);

	const admBxml = bxmlPayload(0, xmlBytes);
	const bxmlPrimary = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: chna },
			{ id: 'axml', bytes: new Uint8Array() },
			{ id: 'bxml', bytes: admBxml },
		],
	}));
	assert.equal(bxmlPrimary.adm?.valid, true);
	assert.equal(bxmlPrimary.adm?.payload.kind, 'bxml');
	assert.deepEqual(bxmlPrimary.adm?.auxiliaryPayloads, [{ kind: 'axml', xml: '', rawBase64: '' }]);
	assert.ok(!bxmlPrimary.metadataWarnings.some(({ code }) => code === 'adm-static-payload-conflict'));
});

test('malformed or inconsistent static ADM warns without blocking usable BW64 PCM', async (t) => {
	const stereoChna = encodeChnaPayload(createAdmChna({ layout: 'stereo' }));
	await t.test('malformed AXML remains available for diagnostics', async () => {
		const xml = '<audioFormatExtended><broken></audioFormatExtended>';
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 2,
			metadata: [
				{ id: 'chna', bytes: stereoChna },
				{ id: 'axml', bytes: new TextEncoder().encode(xml) },
			],
		}));
		assert.equal(descriptor.frameCount, 1);
		assert.equal(descriptor.adm?.payload.kind, 'axml');
		assert.equal(descriptor.adm?.payload.kind === 'axml' ? descriptor.adm.payload.xml : null, xml);
		assert.equal(descriptor.adm?.valid, false);
		assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-axml-invalid'));
	});

	await t.test('missing CHNA invalidates static metadata', async () => {
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 2,
			metadata: [{ id: 'axml', bytes: new TextEncoder().encode(generateAdmAxml({ layout: 'stereo' })) }],
		}));
		assert.equal(descriptor.frameCount, 1);
		assert.equal(descriptor.adm?.valid, false);
		assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-chna-missing'));
	});

	await t.test('CHNA must match the PCM and AXML track allocation', async () => {
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 2,
			metadata: [
				{ id: 'chna', bytes: encodeChnaPayload(createAdmChna({ layout: 'mono' })) },
				{ id: 'axml', bytes: new TextEncoder().encode(generateAdmAxml({ layout: 'stereo' })) },
			],
		}));
		assert.equal(descriptor.frameCount, 1);
		assert.equal(descriptor.adm?.valid, false);
		assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-chna-inconsistent'));
	});

	await t.test('malformed CHNA is bounded metadata failure', async () => {
		const malformed = stereoChna.slice();
		malformed[43] = 1;
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 2,
			metadata: [
				{ id: 'chna', bytes: malformed },
				{ id: 'axml', bytes: new TextEncoder().encode(generateAdmAxml({ layout: 'stereo' })) },
			],
		}));
		assert.equal(descriptor.frameCount, 1);
		assert.equal(descriptor.adm?.valid, false);
		assert.ok(descriptor.metadataWarnings.some(({ code }) => code === 'adm-chna-invalid'));
	});
});

test('BW64 accepts zero-length AXML only when CHNA resolves through common definitions', async () => {
	const commonChna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const common = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: commonChna },
			{ id: 'axml', bytes: new Uint8Array() },
		],
	}));
	assert.equal(common.adm?.valid, true);
	assert.deepEqual(common.adm?.payload, { kind: 'axml', xml: '', rawBase64: '' });
	assert.deepEqual(common.metadataWarnings, []);

	const customChna = encodeChnaPayload({
		numTracks: 1,
		entries: [{
			trackIndex: 1,
			uid: 'ATU_00000001',
			trackRef: 'AC_00011000',
			packRef: 'AP_00011000',
		}],
	});
	const custom = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: customChna },
			{ id: 'axml', bytes: new Uint8Array() },
		],
	}));
	assert.equal(custom.adm?.valid, false);
	assert.ok(custom.metadataWarnings.some(({ code }) => code === 'adm-chna-inconsistent'));
	const unresolvedCustom = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: customChna },
			{ id: 'axml', bytes: new TextEncoder().encode('<audioFormatExtended />') },
		],
	}));
	assert.equal(unresolvedCustom.adm?.valid, false);
	assert.ok(unresolvedCustom.metadataWarnings.some(({ code }) => code === 'adm-chna-inconsistent'));

	const orphan = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [{ id: 'chna', bytes: commonChna }],
	}));
	assert.equal(orphan.adm, null);
	assert.ok(orphan.metadataWarnings.some(({ code }) => code === 'adm-chna-orphaned'));
});

test('BW64 validates uncompressed and gzip BXML while preserving its raw payload', async (t) => {
	const chna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const xml = new TextEncoder().encode(generateAdmAxml({ layout: 'mono' }));
	for (const [name, bxml] of [
		['uncompressed', bxmlPayload(0, xml)],
		['gzip', bxmlPayload(1, gzipSync(xml))],
	] as const) await t.test(name, async () => {
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 1,
			metadata: [{ id: 'chna', bytes: chna }, { id: 'bxml', bytes: bxml }],
		}));
		assert.deepEqual(descriptor.adm?.payload, { kind: 'bxml', base64: Buffer.from(bxml).toString('base64') });
		assert.equal(descriptor.adm?.valid, true);
		assert.deepEqual(descriptor.metadataWarnings, []);
	});
});

test('unsupported or malformed BXML warns without blocking usable PCM', async (t) => {
	const chna = encodeChnaPayload(createAdmChna({ layout: 'mono' }));
	const malformedXml = new TextEncoder().encode('<audioFormatExtended><broken></audioFormatExtended>');
	const oversizedGzip = gzipSync(new Uint8Array(WAV_ADM_PAYLOAD_MAX_BYTES + 1));
	new DataView(oversizedGzip.buffer, oversizedGzip.byteOffset, oversizedGzip.byteLength)
		.setUint32(oversizedGzip.byteLength - 4, 1, true);
	for (const [name, bxml, warningCode] of [
		['unsupported format', bxmlPayload(2, Uint8Array.of(1, 2, 3)), 'adm-bxml-format-unsupported'],
		['malformed gzip', bxmlPayload(1, Uint8Array.of(1, 2, 3)), 'adm-bxml-invalid'],
		['malformed uncompressed XML', bxmlPayload(0, malformedXml), 'adm-bxml-invalid'],
		['malformed compressed XML', bxmlPayload(1, gzipSync(malformedXml)), 'adm-bxml-invalid'],
		[
			'oversized expanded XML with a false gzip size',
			bxmlPayload(1, oversizedGzip),
			'adm-bxml-decompressed-too-large',
		],
	] as const) await t.test(name, async () => {
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 1,
			metadata: [{ id: 'chna', bytes: chna }, { id: 'bxml', bytes: bxml }],
		}));
		assert.equal(descriptor.frameCount, 1);
		assert.deepEqual(descriptor.adm?.payload, { kind: 'bxml', base64: Buffer.from(bxml).toString('base64') });
		assert.equal(descriptor.adm?.valid, false);
		assert.ok(descriptor.metadataWarnings.some(({ code }) => code === warningCode));
	});
});

test('BW64 preserves SXML payloads opaquely without requiring CHNA', async () => {
	const sxml = sxmlPayload([{ samples: 1, xml: '<frame />' }]);
	const serial = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [{ id: 'sxml', bytes: sxml }],
	}));
	assert.deepEqual(serial.adm?.payload, { kind: 'sxml', base64: Buffer.from(sxml).toString('base64') });
	assert.deepEqual(serial.adm?.chna.entries, []);
	assert.equal(serial.adm?.valid, true);
});

test('BW64 accepts SXML track identifiers in CHNA and verifies their PCM geometry', async () => {
	const sxml = sxmlPayload([{ samples: 1, xml: '<frame />' }]);
	const stereoChna = encodeChnaPayload(createAdmChna({ layout: 'stereo' }));
	const valid = await inspectWavBlobPcm(createBw64({
		channelCount: 2,
		metadata: [
			{ id: 'chna', bytes: stereoChna },
			{ id: 'sxml', bytes: sxml },
		],
	}));
	assert.equal(valid.adm?.valid, true);
	assert.equal(valid.adm?.chna.numTracks, 2);
	assert.deepEqual(valid.adm?.chna.rawBase64, Buffer.from(stereoChna).toString('base64'));
	assert.deepEqual(valid.metadataWarnings, []);

	const inconsistent = await inspectWavBlobPcm(createBw64({
		channelCount: 1,
		metadata: [
			{ id: 'chna', bytes: stereoChna },
			{ id: 'sxml', bytes: sxml },
		],
	}));
	assert.equal(inconsistent.adm?.valid, false);
	assert.ok(inconsistent.metadataWarnings.some(({ code }) => code === 'adm-chna-inconsistent'));
});

test('BW64 validates SXML structure, compression, sample coverage, and alignment points', async () => {
	const data = int16Bytes([1, 2]);
	for (const [name, sxml] of [
		['partial coverage', sxmlPayload([{ samples: 1, xml: '<frame />' }])],
		['plain', sxmlPayload([
			{ samples: 1, xml: '<frame id="one" />' },
			{ samples: 1, xml: '<frame id="two" />' },
		], 0, [0, 1])],
		['gzip', sxmlPayload([
			{ samples: 1, xml: '<frame id="one" />' },
			{ samples: 1, xml: '<frame id="two" />' },
		], 1, [1])],
	] as const) {
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 1,
			data,
			metadata: [{ id: 'sxml', bytes: sxml }],
		}));
		assert.equal(descriptor.adm?.valid, true, name);
		assert.deepEqual(descriptor.metadataWarnings, [], name);
	}

	const malformedAlignment = sxmlPayload([{ samples: 2, xml: '<frame />' }], 0, [0]);
	new DataView(malformedAlignment.buffer).setUint32(malformedAlignment.byteLength - 16, 15, true);
	for (const [name, sxml, warningCode] of [
		['opaque bytes', Uint8Array.of(0, 1, 2, 3), 'adm-sxml-invalid'],
		['unsupported compression', withUint16(sxmlPayload([{ samples: 2, xml: '<frame />' }]), 0, 2), 'adm-sxml-format-unsupported'],
		['bad alignment offset', malformedAlignment, 'adm-sxml-invalid'],
	] as const) {
		const descriptor = await inspectWavBlobPcm(createBw64({
			channelCount: 1,
			data,
			metadata: [{ id: 'sxml', bytes: sxml }],
		}));
		assert.equal(descriptor.adm?.valid, false, name);
		assert.ok(descriptor.metadataWarnings.some(({ code }) => code === warningCode), name);
	}
});

interface MetadataChunk {
	readonly id: string;
	readonly bytes: Uint8Array;
	readonly afterData?: boolean;
	readonly padByte?: number;
	readonly sentinel?: boolean;
}

function sxmlPayload(
	chunks: readonly Readonly<{ samples: number; xml: string }>[],
	formatType: 0 | 1 = 0,
	alignmentChunkIndexes: readonly number[] = [],
): Uint8Array {
	const encoded = chunks.map(({ xml }) => {
		const bytes = new TextEncoder().encode(xml);
		return formatType === 1 ? gzipSync(bytes) : bytes;
	});
	const tableSize = 4 + encoded.reduce((size, bytes) => size + 8 + bytes.byteLength, 0);
	const output = new Uint8Array(10 + tableSize + 4 + (alignmentChunkIndexes.length * 16));
	const view = new DataView(output.buffer);
	view.setUint16(0, formatType, true);
	view.setUint32(2, tableSize, true);
	view.setUint32(10, chunks.length, true);
	const offsets: number[] = [];
	const sampleOffsets: number[] = [];
	let offset = 14;
	let samples = 0;
	chunks.forEach((chunk, index) => {
		offsets.push(offset);
		sampleOffsets.push(samples);
		view.setUint32(offset, encoded[index]?.byteLength ?? 0, true);
		view.setUint32(offset + 4, chunk.samples, true);
		output.set(encoded[index] ?? new Uint8Array(), offset + 8);
		offset += 8 + (encoded[index]?.byteLength ?? 0);
		samples += chunk.samples;
	});
	view.setUint32(offset, alignmentChunkIndexes.length, true);
	offset += 4;
	alignmentChunkIndexes.forEach((chunkIndex) => {
		view.setUint32(offset, offsets[chunkIndex] ?? 0, true);
		view.setUint32(offset + 8, sampleOffsets[chunkIndex] ?? 0, true);
		offset += 16;
	});
	return output;
}

function withUint16(bytes: Uint8Array, offset: number, value: number): Uint8Array {
	const changed = bytes.slice();
	new DataView(changed.buffer).setUint16(offset, value, true);
	return changed;
}

function createBw64(options: {
	readonly channelCount: number;
	readonly data?: Uint8Array;
	readonly metadata?: readonly MetadataChunk[];
}): Blob {
	const data = options.data ?? int16Bytes(Array.from({ length: options.channelCount }, () => 0));
	const metadata = options.metadata ?? [];
	const before = metadata.filter((chunk) => !chunk.afterData)
		.map((chunk) => riffChunk(chunk.id, chunk.bytes, chunk.sentinel, chunk.padByte));
	const after = (options.metadata ?? []).filter((chunk) => chunk.afterData)
		.map((chunk) => riffChunk(chunk.id, chunk.bytes, chunk.sentinel, chunk.padByte));
	const format = riffChunk('fmt ', formatBytes(options.channelCount));
	const dataChunk = riffChunk('data', data, true);
	const sentinelChunks = metadata.filter((chunk) => chunk.sentinel);
	const ds64 = riffChunk('ds64', new Uint8Array(28 + (sentinelChunks.length * 12)));
	const byteLength = 12 + ds64.byteLength + format.byteLength
		+ before.reduce((sum, chunk) => sum + chunk.byteLength, 0)
		+ dataChunk.byteLength + after.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const output = new Uint8Array(byteLength);
	const view = new DataView(output.buffer);
	writeAscii(output, 0, 'BW64');
	view.setUint32(4, UINT32_SENTINEL, true);
	writeAscii(output, 8, 'WAVE');
	let offset = 12;
	output.set(ds64, offset);
	view.setBigUint64(offset + 8, BigInt(byteLength - 8), true);
	view.setBigUint64(offset + 16, BigInt(data.byteLength), true);
	view.setBigUint64(offset + 24, 0n, true);
	view.setUint32(offset + 32, sentinelChunks.length, true);
	sentinelChunks.forEach((chunk, index) => {
		const entryOffset = offset + 36 + (index * 12);
		writeAscii(output, entryOffset, chunk.id);
		view.setBigUint64(entryOffset + 4, BigInt(chunk.bytes.byteLength), true);
	});
	offset += ds64.byteLength;
	for (const chunk of [format, ...before, dataChunk, ...after]) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new Blob([output], { type: 'audio/wav' });
}

function riffChunk(id: string, payload: Uint8Array, sentinel = false, padByte = 0): Uint8Array {
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeAscii(output, 0, id);
	new DataView(output.buffer).setUint32(4, sentinel ? UINT32_SENTINEL : payload.byteLength, true);
	output.set(payload, 8);
	if (payload.byteLength & 1) output[output.byteLength - 1] = padByte;
	return output;
}

function formatBytes(channelCount: number): Uint8Array {
	const output = new Uint8Array(16);
	const view = new DataView(output.buffer);
	view.setUint16(0, 1, true);
	view.setUint16(2, channelCount, true);
	view.setUint32(4, 48_000, true);
	view.setUint32(8, 48_000 * channelCount * 2, true);
	view.setUint16(12, channelCount * 2, true);
	view.setUint16(14, 16, true);
	return output;
}

function int16Bytes(values: readonly number[]): Uint8Array {
	const output = new Uint8Array(values.length * 2);
	const view = new DataView(output.buffer);
	values.forEach((value, index) => view.setInt16(index * 2, value, true));
	return output;
}

function bxmlPayload(format: number, payload: Uint8Array): Uint8Array {
	const output = new Uint8Array(2 + payload.byteLength);
	new DataView(output.buffer).setUint16(0, format, true);
	output.set(payload, 2);
	return output;
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) output[offset + index] = value.charCodeAt(index);
}

function trackingBlob(blob: Blob): Blob & { readonly reads: Array<{ start: number; byteLength: number }> } {
	const reads: Array<{ start: number; byteLength: number }> = [];
	return {
		size: blob.size,
		type: blob.type,
		reads,
		slice(start = 0, end = blob.size) {
			const part = blob.slice(start, end);
			return {
				size: part.size,
				type: part.type,
				slice: part.slice.bind(part),
				arrayBuffer: async () => {
					reads.push({ start, byteLength: end - start });
					return part.arrayBuffer();
				},
			};
		},
	} as unknown as Blob & { readonly reads: Array<{ start: number; byteLength: number }> };
}
