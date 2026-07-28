/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBextMetadata, type BextMetadataInput } from './broadcast-wave.ts';
import type { AdmPassthroughMetadata } from './adm-project-metadata.ts';
import { decodeWavOpaqueRiffChunk } from './wav-opaque-chunks.ts';

type StoredAdmPayload = AdmPassthroughMetadata['payload']
	| NonNullable<AdmPassthroughMetadata['serialPayload']>
	| NonNullable<AdmPassthroughMetadata['auxiliaryPayloads']>[number];

export interface PreservedAdmRiffKinds {
	readonly bext: boolean;
	readonly markers: boolean;
	readonly ixml: boolean;
	readonly cart: boolean;
	readonly id3: boolean;
	readonly info: boolean;
}

export function inspectPreservedAdmRiffChunks(metadata: AdmPassthroughMetadata): PreservedAdmRiffKinds {
	const chunks = metadata.riffChunkSequence ?? metadata.opaqueRiffChunks ?? [];
	const result = { bext: false, markers: false, ixml: false, cart: false, id3: false, info: false };
	for (const entry of chunks) {
		const lowerId = entry.id.toLowerCase();
		if (lowerId === 'bext') result.bext = true;
		else if (entry.id === 'cue ') result.markers = true;
		else if (entry.id === 'iXML') result.ixml = true;
		else if (lowerId === 'cart') result.cart = true;
		else if (lowerId === 'id3 ') result.id3 = true;
		else if (entry.id === 'LIST') {
			const raw = decodeWavOpaqueRiffChunk(entry);
			const listType = raw.byteLength >= 12 ? String.fromCharCode(...raw.subarray(8, 12)) : '';
			if (listType === 'adtl') result.markers = true;
			else if (listType === 'INFO') result.info = true;
		}
	}
	return Object.freeze(result);
}

export function validateAdmRiffChunkSequence(metadata: AdmPassthroughMetadata): void {
	if (!metadata.riffChunkSequence?.length) return;
	const payloads: readonly StoredAdmPayload[] = [
		metadata.payload,
		...(metadata.auxiliaryPayloads ?? []),
		...(metadata.serialPayload ? [metadata.serialPayload] : []),
	];
	const expected = [
		...(metadata.chna.rawBase64 ? [{ id: 'chna', bytes: decodeBase64(metadata.chna.rawBase64) }] : []),
		...payloads.map((payload) => ({ id: payload.kind, bytes: storedPayloadBytes(payload) })),
	];
	const actual = metadata.riffChunkSequence
		.filter(({ id }) => id === 'chna' || id === 'axml' || id === 'bxml' || id === 'sxml')
		.map((entry) => ({ id: entry.id, bytes: riffChunkPayload(decodeWavOpaqueRiffChunk(entry)) }));
	if (actual.length !== expected.length) {
		throw new Error('ADM RIFF chunk sequence disagrees with its normalized ADM payload set.');
	}
	for (const candidate of expected) {
		const matches = actual.filter(({ id }) => id === candidate.id);
		const match = matches[0];
		if (matches.length !== 1 || !match || !sameBytes(match.bytes, candidate.bytes)) {
			throw new Error(`ADM RIFF chunk sequence ${candidate.id.toUpperCase()} bytes disagree with normalized ADM metadata.`);
		}
	}
}

export function splitAdmRiffChunkSequence(metadata: AdmPassthroughMetadata): Readonly<{
	preDataChunks: readonly Uint8Array[];
	trailingChunks: readonly Uint8Array[];
}> {
	const sequence = metadata.riffChunkSequence ?? [];
	return Object.freeze({
		preDataChunks: Object.freeze(sequence
			.filter(({ placement }) => placement === 'before-data')
			.map(decodeWavOpaqueRiffChunk)),
		trailingChunks: Object.freeze(sequence
			.filter(({ placement }) => placement === 'after-data')
			.map(decodeWavOpaqueRiffChunk)),
	});
}

export function sameBextMetadata(left: BextMetadataInput, right: BextMetadataInput | null): boolean {
	if (right == null) return false;
	try {
		return JSON.stringify(normalizeBextMetadata(left, { version: 2 }))
			=== JSON.stringify(normalizeBextMetadata(right, { version: 2 }));
	} catch {
		return false;
	}
}

function storedPayloadBytes(payload: StoredAdmPayload): Uint8Array {
	return decodeBase64(payload.kind === 'axml' ? payload.rawBase64 : payload.base64);
}

function riffChunkPayload(chunk: Uint8Array): Uint8Array {
	const byteLength = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true);
	return chunk.subarray(8, 8 + byteLength);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
