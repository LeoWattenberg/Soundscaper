/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm, type BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { embedAudioFileMetadata } from '../src/common/editor/audio-container-metadata.ts';
import { isFileBackedAudioExport, registerFileBackedExport } from '../src/common/editor/file-backed-audio-export.ts';
import { readApeMetadataTags, wavPackAudioBlob } from '../src/common/editor/ape-metadata-reader.ts';
import { createApeFileMetadata } from '../src/common/editor/ape-file-metadata.ts';
import { openStreamedWavPackImportSession } from '../src/common/editor/browser-streamed-wavpack-import.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
const metadata = { title: '東京 — Episode', artist: 'Élodie', genre: 'Ambient', composer: 'Renée', comments: 'Line one\nLine two', trackNumber: '2/9', copyright: '2026 Owner',
	id3Artwork: JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Cover', data: PNG }]) };
const dependencies = { loadPayload: async (_format: BrowserDedicatedAudioFormat, url: URL) => new Uint8Array(await readFile(url)) };
const cases: readonly { format: BrowserDedicatedAudioFormat; settings: Readonly<Record<string, number>> }[] = [
	{ format: 'mp3', settings: { bitrateKbps: 128 } },
	{ format: 'mp2', settings: { bitrateKbps: 192 } },
	{ format: 'flac', settings: { compressionLevel: 5 } },
	{ format: 'ogg-vorbis', settings: { quality: 5 } },
	{ format: 'opus', settings: { bitrateKbps: 128, vbrMode: 1 } },
	{ format: 'wavpack', settings: { compressionLevel: 2 } },
];

for (const { format, settings } of cases) test(`browser ${format} writes metadata without changing encoded audio`, async () => {
	const raw = await encodeFixture(format, settings);
	const original = registerFileBackedExport(new Blob([raw]));
	const result = await embedAudioFileMetadata(original, format, metadata);
	assert.equal(isFileBackedAudioExport(result), true);
	const bytes = new Uint8Array(await result.arrayBuffer());
	if (format === 'wavpack') {
		assert.deepEqual(bytes.subarray(0, raw.length), raw);
		assert.equal(new TextDecoder().decode(bytes.subarray(-32, -24)), 'APETAGEX');
		assert.ok(Buffer.from(bytes).includes(Buffer.from(metadata.genre)));
		assert.deepEqual(new Uint8Array(await (await wavPackAudioBlob(result)).arrayBuffer()), raw);
		const inspection = await inspectImportedMediaMetadata(result);
		assert.deepEqual(inspection.warnings, []);
		assert.equal(inspection.metadata.normalized?.genre, metadata.genre);
		assert.equal(inspection.metadata.raw?.COMPOSER, metadata.composer);
		assert.ok(inspection.attachments.some(attachment => attachment.byteLength === Buffer.from(PNG, 'base64').length));
		const session = await openStreamedWavPackImportSession(result, undefined, {
			async decode(file) {
				const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await file.arrayBuffer()), maximumOutputBytes: 2 * 1024 ** 2 }, dependencies);
				return { sampleRate: decoded.sampleRate, channels: [new Float32Array(decoded.interleaved.buffer)] };
			},
		});
		try {
			let frames = 0;
			for await (const sample of session.samples()) { frames += sample.numberOfFrames; sample.close(); }
			assert.equal(frames, 4608);
		} finally { session.dispose(); }
	} else if (format === 'mp2') {
		assert.equal(new TextDecoder().decode(bytes.subarray(0, 3)), 'ID3');
		assert.deepEqual(bytes.subarray(bytes.length - raw.length), raw);
		assert.ok(Buffer.from(bytes).includes(Buffer.from('TCON')));
	} else {
		const input = new Input({ source: new BlobSource(result), formats: ALL_FORMATS });
		try {
			const tags = await input.getMetadataTags();
			assert.equal(tags.title, metadata.title);
			assert.equal(tags.artist, metadata.artist);
			assert.equal(tags.genre, metadata.genre);
			assert.equal(tags.trackNumber, 2);
			assert.equal(tags.tracksTotal, 9);
			assert.deepEqual(Buffer.from(tags.images![0]!.data), Buffer.from(PNG, 'base64'));
			if (format === 'mp3') assert.equal(tags.raw?.TCOM, metadata.composer);
			else assert.equal(tags.raw?.COMPOSER, metadata.composer);
		} finally { input.dispose(); }
		if (format === 'mp3') assert.deepEqual(bytes.subarray(bytes.length - raw.length), raw);
		if (format === 'flac') assert.deepEqual(flacAudioBytes(bytes), flacAudioBytes(raw));
		if (format === 'opus' || format === 'ogg-vorbis') assert.deepEqual(oggPayloads(bytes), oggPayloads(raw));
	}
});

for (const format of ['opus', 'ogg-vorbis'] as const) test(`browser ${format} carries comments across Ogg pages without changing audio or checksums`, async () => {
	const raw = await encodeFixture(format, format === 'opus' ? { bitrateKbps: 128, vbrMode: 1 } : { quality: 5 });
	const lyrics = 'é'.repeat(65_536);
	const tagged = await embedAudioFileMetadata(new Blob([raw]), format, { ...metadata, lyrics });
	const bytes = new Uint8Array(await tagged.arrayBuffer());
	assert.deepEqual(oggPayloads(bytes), oggPayloads(raw));
	const input = new Input({ source: new BlobSource(tagged), formats: ALL_FORMATS });
	try { assert.equal((await input.getMetadataTags()).lyrics, lyrics); } finally { input.dispose(); }
	const corrupted = Uint8Array.from(raw);
	corrupted[22] = corrupted[22]! ^ 1;
	await assert.rejects(embedAudioFileMetadata(new Blob([corrupted]), format, metadata), /checksum/u);
});

test('malformed APE trailers are rejected before the WavPack decoder sees their bytes', async () => {
	const raw = await encodeFixture('wavpack', { compressionLevel: 2 });
	const tagged = new Uint8Array(await (await embedAudioFileMetadata(new Blob([raw]), 'wavpack', metadata)).arrayBuffer());
	const view = new DataView(tagged.buffer);
	view.setUint32(tagged.length - 20, tagged.length + 32, true);
	await assert.rejects(wavPackAudioBlob(new Blob([tagged])), /exceeds/u);
});

test('APEv2 accepts the export field and artwork limits including separate track and disc totals', async () => {
	const maximum = { ...Object.fromEntries(Array.from({ length: 125 }, (_value, index) => [`field${index}`, 'Value'])), trackNumber: '2/9', discNumber: '1/3',
		id3Artwork: JSON.stringify(Array.from({ length: 16 }, (_value, index) => ({ mimeType: 'image/png', pictureType: 3, description: `Cover ${index}`, data: PNG }))) };
	const file = new Blob([new Uint8Array(64), createApeFileMetadata(maximum)]);
	const tags = await readApeMetadataTags(file);
	assert.equal(tags.trackNumber, 2);
	assert.equal(tags.tracksTotal, 9);
	assert.equal(tags.discsTotal, 3);
	assert.equal((tags.images as readonly unknown[]).length, 16);
	assert.throws(() => createApeFileMetadata({ x: 'Invalid single-character APE key' }), /field name/u);
});

test('empty metadata preserves the original file and cancellation interrupts packaging', async () => {
	const blob = new Blob([Uint8Array.of(1, 2, 3)]);
	assert.equal(await embedAudioFileMetadata(blob, 'mp3', {}), blob);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(embedAudioFileMetadata(blob, 'mp3', metadata, controller.signal), { name: 'AbortError' });
});

async function encodeFixture(format: BrowserDedicatedAudioFormat, settings: Readonly<Record<string, number>>): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = new Float32Array(4608);
	for (let frame = 0; frame < pcm.length; frame++) pcm[frame] = Math.sin(frame / 10) * 0.2;
	return encodeDedicatedAudioPcm({ format, settings, input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, maximumOutputBytes: 2 * 1024 ** 2 }, dependencies);
}

function flacAudioBytes(bytes: Uint8Array): Uint8Array {
	let offset = 4;
	for (;;) {
		const last = Boolean(bytes[offset]! & 128);
		offset += 4 + bytes[offset + 1]! * 65536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
		if (last) return bytes.subarray(offset);
	}
}

function oggPayloads(bytes: Uint8Array): Readonly<{ packets: readonly Buffer[]; granules: readonly bigint[] }> {
	const packets: Buffer[] = [];
	const granules: bigint[] = [];
	let pending: Buffer[] = [];
	let sequence = 0;
	for (let offset = 0; offset < bytes.length;) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		const laces = bytes.subarray(offset + 27, offset + 27 + bytes[offset + 26]!);
		let body = offset + 27 + laces.length;
		const end = body + laces.reduce((sum, lace) => sum + lace, 0);
		assert.equal(view.getUint32(18, true), sequence++);
		assert.equal(view.getUint32(22, true), oggPageCrc(bytes.subarray(offset, end)));
		const granule = view.getBigUint64(6, true);
		if (granule !== 0n && granule !== 0xffff_ffff_ffff_ffffn) granules.push(granule);
		for (const lace of laces) {
			pending.push(Buffer.from(bytes.subarray(body, body + lace)));
			body += lace;
			if (lace < 255) { packets.push(Buffer.concat(pending)); pending = []; }
		}
		offset = end;
	}
	assert.equal(pending.length, 0);
	return { packets: packets.filter((_packet, index) => index !== 1), granules };
}
