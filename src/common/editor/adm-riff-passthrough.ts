/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeBextMetadata, type BextMetadataInput } from './broadcast-wave.ts';
import type { AdmPassthroughMetadata } from './adm-project-metadata.ts';
import {
	inspectAdmAxml,
	parseChnaPayload,
	validateAdmCommonDefinitionChna,
	validateAdmChnaConsistency,
} from './adm-metadata.ts';
import { validateAdmSxmlPayload } from './adm-sxml.ts';
import { inspectBxmlAdmPayload } from './wav-adm-import.ts';
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

/**
 * Revalidates the exact stored ADM carriers and derives renderer order only
 * from the reparsed raw CHNA bytes. CHNA-less serial ADM has no RIFF channel
 * labels, so its validated order is empty.
 */
export function validateAdmPassthroughPayload(metadata: AdmPassthroughMetadata): readonly string[] {
	if (metadata.serialPayload) {
		validateAdmSxmlPayload(decodeBase64(metadata.serialPayload.base64));
	}
	const rawChna = metadata.chna.rawBase64
		? parseChnaPayload(decodeBase64(metadata.chna.rawBase64))
		: null;
	if (rawChna && rawChna.numTracks !== metadata.geometry.channelCount) {
		throw new Error('Persisted ADM CHNA track count does not match its source geometry.');
	}
	if (Boolean(rawChna) !== (metadata.chna.entries.length > 0)) {
		throw new Error('Persisted ADM CHNA bytes and normalized entries disagree.');
	}
	if (rawChna && !sameAdmChnaEntries(rawChna.entries, metadata.chna.entries)) {
		throw new Error('Persisted ADM CHNA bytes and normalized entries disagree.');
	}
	const staticPayloads = [
		...(metadata.payload.kind === 'sxml' ? [] : [metadata.payload]),
		...(metadata.auxiliaryPayloads ?? []),
	];
	const classifiedStatic = staticPayloads.map((payload) => {
		const bytes = decodeBase64(payload.kind === 'axml' ? payload.rawBase64 : payload.base64);
		return {
			payload,
			empty: payload.kind === 'axml' && bytes.byteLength === 0,
			document: payload.kind === 'axml'
				? bytes.byteLength === 0 ? null : inspectAdmAxml(bytes)
				: inspectBxmlAdmPayload(bytes),
		};
	});
	const documentedStatic = classifiedStatic.filter(({ document }) => document);
	if (documentedStatic.length > 1) throw new Error('Persisted AXML and BXML both carry static ADM.');
	const carrier = documentedStatic[0] ?? classifiedStatic.find(({ empty }) => empty);
	if (metadata.payload.kind === 'sxml') {
		if (carrier) throw new Error('Persisted ADM payload selection disagrees with its static XML chunks.');
		validateAdmSxmlPayload(decodeBase64(metadata.payload.base64));
		return admChnaChannelOrder(rawChna);
	}
	if (!rawChna) throw new Error('Static ADM passthrough requires CHNA metadata.');
	if (!carrier || carrier.payload !== metadata.payload) {
		throw new Error('Persisted ADM payload selection disagrees with its static XML chunks.');
	}
	if (carrier.empty) validateAdmCommonDefinitionChna(rawChna, metadata.geometry.channelCount);
	else {
		if (!carrier.document) throw new Error('Persisted ADM payload selection has no static ADM document.');
		validateAdmChnaConsistency(carrier.document, rawChna, metadata.geometry.channelCount);
	}
	return admChnaChannelOrder(rawChna);
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

function admChnaChannelOrder(chna: ReturnType<typeof parseChnaPayload> | null): readonly string[] {
	if (!chna) return Object.freeze([]);
	const channelOrder = Array.from({ length: chna.numTracks }, () => '');
	for (const { trackIndex, trackRef } of chna.entries) {
		if (!channelOrder[trackIndex - 1]) channelOrder[trackIndex - 1] = trackRef;
	}
	return Object.freeze(channelOrder);
}

function sameAdmChnaEntries(
	rawEntries: ReturnType<typeof parseChnaPayload>['entries'],
	normalizedEntries: AdmPassthroughMetadata['chna']['entries'],
): boolean {
	return rawEntries.length === normalizedEntries.length && rawEntries.every((raw, index) => {
		const normalized = normalizedEntries[index];
		return normalized
			&& raw.trackIndex === normalized.trackIndex
			&& equalAdmId(raw.uid, normalized.audioTrackUid)
			&& equalAdmId(raw.trackRef, normalized.audioTrackFormatIdRef)
			&& equalAdmId(raw.packRef, normalized.audioPackFormatIdRef);
	});
}

function equalAdmId(left: string, right: string): boolean {
	return left.toUpperCase() === right.toUpperCase();
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
