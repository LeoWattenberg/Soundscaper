/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseRiffAxmlChunk,
	parseRiffChnaChunk,
	validateAdmChnaConsistency,
} from '../src/common/editor/adm-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createAudioEditorProjectV7 } from '../src/common/editor/project-v7.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

const CHANNEL_ORDER = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const;
const UINT32_SENTINEL = 0xffff_ffff;

test('authored 5.1 plan encodes an inspectable BW64 with consistent CHNA and AXML', async () => {
	const project = createAudioEditorProjectV7({
		id: 'bw64-export-e2e',
		title: 'International drama',
		now: '2026-07-28T12:00:00.000Z',
		masterChannels: 6,
		sources: [{
			id: 'source', storageKey: 'pcm/source', name: '5.1 bed', mimeType: 'audio/wav',
			frameCount: 3, channelCount: 6, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 3 }],
		tracks: [{ type: 'audio', id: 'bed', name: 'Bed', clipIds: ['clip'] }],
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Drama programme', language: 'en-GB' },
				content: { name: 'German mix', language: 'de-DE' },
				bed: {
					name: 'Main 5.1 bed',
					layout: '5.1',
					assignments: CHANNEL_ORDER.map((bedChannel, sourceChannel) => ({
						stripKind: 'track' as const, stripId: 'bed', sourceChannel, bedChannel,
					})),
				},
			},
		},
	});
	const plan = createExportPlan(project, { format: 'bw64', dither: 'none' });
	assert.ok(plan.bext && plan.preDataChunks && plan.trailingChunks);
	const bytes = encodeWav(
		Array.from({ length: 6 }, (_, channel) => Float32Array.of(channel / 10, 0, -channel / 10)),
		{
			container: 'bw64', sampleRate: plan.sampleRate, bitDepth: 24, dither: 'none',
			bext: plan.bext, preDataChunks: plan.preDataChunks, trailingChunks: plan.trailingChunks,
		},
	);

	assert.equal(ascii(bytes, 0, 4), 'BW64');
	assert.equal(new DataView(bytes.buffer).getUint32(4, true), UINT32_SENTINEL);
	const chunks = riffChunks(bytes);
	assert.equal(chunks[0]?.id, 'ds64');
	const formatIndex = chunks.findIndex(({ id }) => id === 'fmt ');
	const chnaIndex = chunks.findIndex(({ id }) => id === 'chna');
	const dataIndex = chunks.findIndex(({ id }) => id === 'data');
	const axmlIndex = chunks.findIndex(({ id }) => id === 'axml');
	assert.equal(chnaIndex, formatIndex + 1, 'CHNA immediately follows the PCM format chunk');
	assert.ok(chnaIndex < dataIndex, 'CHNA precedes PCM essence');
	assert.ok(axmlIndex > dataIndex, 'AXML follows PCM essence');

	const ownedBytes = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(ownedBytes).set(bytes);
	const descriptor = await inspectWavBlobPcm(new Blob([ownedBytes], { type: 'audio/wav' }));
	assert.equal(descriptor.channelCount, 6);
	assert.equal(descriptor.frameCount, 3);
	assert.equal(descriptor.sampleFormat, 'int24');
	assert.equal(descriptor.bext?.version, 2);
	assert.equal(descriptor.adm?.valid, true);

	const chna = parseRiffChnaChunk(completeChunk(bytes, chunks[chnaIndex]));
	const axml = parseRiffAxmlChunk(completeChunk(bytes, chunks[axmlIndex]));
	assert.equal(chna.numTracks, 6);
	assert.equal(chna.entries.length, 6);
	assert.equal(validateAdmChnaConsistency(axml, chna, 6), true);
	assert.equal(axml.programmes[0]?.language, 'en-GB');
	assert.equal(axml.contents[0]?.language, 'de-DE');
});

interface RiffChunkLocation {
	readonly id: string;
	readonly offset: number;
	readonly payloadBytes: number;
}

function riffChunks(bytes: Uint8Array): RiffChunkLocation[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const dataBytes = Number(view.getBigUint64(28, true));
	const chunks: RiffChunkLocation[] = [];
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const id = ascii(bytes, offset, 4);
		const declaredBytes = view.getUint32(offset + 4, true);
		const payloadBytes = id === 'data' && declaredBytes === UINT32_SENTINEL ? dataBytes : declaredBytes;
		chunks.push({ id, offset, payloadBytes });
		offset += 8 + payloadBytes + (payloadBytes & 1);
	}
	assert.equal(offset, bytes.byteLength);
	return chunks;
}

function completeChunk(bytes: Uint8Array, location: RiffChunkLocation | undefined): Uint8Array {
	assert.ok(location);
	return bytes.subarray(location.offset, location.offset + 8 + location.payloadBytes + (location.payloadBytes & 1));
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length));
}
