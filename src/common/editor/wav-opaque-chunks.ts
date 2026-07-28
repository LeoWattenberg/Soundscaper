/* SPDX-License-Identifier: AGPL-3.0-only */

export const WAV_OPAQUE_RIFF_MAX_BYTES = 16 * 1024 * 1024;
export const WAV_ADM_RIFF_SEQUENCE_MAX_BYTES = WAV_OPAQUE_RIFF_MAX_BYTES;

export type WavOpaqueRiffChunkPlacement = 'before-data' | 'after-data';

export interface WavRiffChunkSequenceEntry {
	readonly id: string;
	readonly placement: WavOpaqueRiffChunkPlacement;
	/** Complete RIFF chunk bytes: header, payload, and alignment byte when present. */
	readonly rawBase64: string;
}

export type WavOpaqueRiffChunk = WavRiffChunkSequenceEntry;

export interface WavOpaqueRiffCaptureWarning {
	readonly code: 'adm-opaque-chunk-preservation-incomplete';
	readonly message: string;
}

const UINT32_SENTINEL = 0xffff_ffff;
const MAX_RIFF_CHUNKS = 4_096;
const BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u;
const WRITER_OWNED_CHUNK_IDS = new Set([
	'RIFF', 'RF64', 'BW64', 'ds64', 'fmt ', 'data', 'fact',
	'bext', 'cue ', 'iXML', 'cart', 'axml', 'bxml', 'sxml', 'chna',
]);
const ADM_SEQUENCE_STRUCTURAL_CHUNK_IDS = new Set([
	'RIFF', 'RF64', 'BW64', 'ds64', 'fmt ', 'data', 'fact',
]);

export function shouldPreserveWavOpaqueRiffChunk(id: string, listType: string | null): boolean {
	if (WRITER_OWNED_CHUNK_IDS.has(id)) return false;
	return id !== 'LIST' || (listType !== 'adtl' && listType !== 'INFO');
}

export function shouldPreserveWavAdmRiffSequenceChunk(id: string): boolean {
	return !ADM_SEQUENCE_STRUCTURAL_CHUNK_IDS.has(id);
}

export function normalizeWavOpaqueRiffChunks(value: unknown): readonly WavOpaqueRiffChunk[] {
	return normalizeRiffChunkEntries(value, {
		name: 'ADM opaque RIFF chunks',
		accept: (id, listType) => shouldPreserveWavOpaqueRiffChunk(id, listType),
		rejection: (id) => `duplicates a structural or modeled ${printable(id)} chunk`,
	});
}

export function normalizeWavAdmRiffChunkSequence(value: unknown): readonly WavRiffChunkSequenceEntry[] {
	return normalizeRiffChunkEntries(value, {
		name: 'ADM RIFF chunk sequence',
		accept: (id) => shouldPreserveWavAdmRiffSequenceChunk(id),
		rejection: (id) => id === 'fact'
			? 'contains the forbidden BW64 fact chunk'
			: `duplicates the structural ${printable(id)} chunk`,
	});
}

function normalizeRiffChunkEntries(value: unknown, options: Readonly<{
	name: string;
	accept: (id: string, listType: string | null) => boolean;
	rejection: (id: string) => string;
}>): readonly WavRiffChunkSequenceEntry[] {
	if (!Array.isArray(value)) throw new TypeError(`${options.name} must be an array.`);
	if (value.length > MAX_RIFF_CHUNKS) throw new RangeError(`${options.name} has too many entries.`);
	let aggregateBytes = 0;
	const normalized = value.map((candidate, index) => {
		const entryName = `${options.name} entry ${index}`;
		const entry = record(candidate, entryName);
		if (typeof entry.id !== 'string' || !/^[\x20-\x7e]{4}$/u.test(entry.id)) {
			throw new RangeError(`${entryName} ID must contain four printable ASCII characters.`);
		}
		if (entry.placement !== 'before-data' && entry.placement !== 'after-data') {
			throw new RangeError(`${entryName} placement is unsupported.`);
		}
		const rawBase64 = canonicalBase64(entry.rawBase64, entryName);
		const raw = decodeBase64(rawBase64);
		aggregateBytes += raw.byteLength;
		if (aggregateBytes > WAV_OPAQUE_RIFF_MAX_BYTES) {
			throw new RangeError(`${options.name} exceed the 16 MiB preservation limit.`);
		}
		validateRawChunk(raw, entry.id, entryName, options);
		return Object.freeze({ id: entry.id, placement: entry.placement, rawBase64 });
	});
	return Object.freeze(normalized);
}

export function decodeWavOpaqueRiffChunk(chunk: WavOpaqueRiffChunk): Uint8Array {
	return decodeBase64(chunk.rawBase64);
}

export function createWavOpaqueRiffCollector() {
	return createCollector(normalizeWavOpaqueRiffChunks, 'Unmodeled BW64 chunks');
}

export function createWavAdmRiffSequenceCollector() {
	return createCollector(normalizeWavAdmRiffChunkSequence, 'The BW64 nonstructural RIFF chunk sequence');
}

function createCollector(
	normalize: (value: unknown) => readonly WavRiffChunkSequenceEntry[],
	limitName: string,
) {
	const chunks: WavOpaqueRiffChunk[] = [];
	let aggregateBytes = 0;
	let incomplete = false;
	return Object.freeze({
		async capture(options: Readonly<{
			id: string;
			placement: WavOpaqueRiffChunkPlacement;
			declaredByteLength: number;
			rawByteLength: number;
			read: () => Promise<Uint8Array>;
		}>): Promise<WavOpaqueRiffCaptureWarning | null> {
			if (incomplete) return null;
			if (options.declaredByteLength === UINT32_SENTINEL) {
				incomplete = true;
				return warning(`The ${printable(options.id)} chunk uses a ds64 table size and cannot be re-emitted exactly.`);
			}
			if (aggregateBytes + options.rawByteLength > WAV_OPAQUE_RIFF_MAX_BYTES) {
				incomplete = true;
				return warning(`${limitName} exceed the 16 MiB preservation limit.`);
			}
			const raw = await options.read();
			try {
				const [normalized] = normalize([
					{ id: options.id, placement: options.placement, rawBase64: encodeBase64(raw) },
				]);
				if (!normalized) throw new Error('The opaque RIFF chunk could not be normalized.');
				chunks.push(normalized);
				aggregateBytes += raw.byteLength;
				return null;
			} catch (error) {
				incomplete = true;
				return warning(error instanceof Error ? error.message : String(error));
			}
		},
		snapshot(): readonly WavOpaqueRiffChunk[] {
			return Object.freeze(chunks.map((chunk) => Object.freeze({ ...chunk })));
		},
	});
}

function validateRawChunk(raw: Uint8Array, id: string, name: string, options: Readonly<{
	accept: (id: string, listType: string | null) => boolean;
	rejection: (id: string) => string;
}>): void {
	if (raw.byteLength < 8) throw new RangeError(`${name} is truncated.`);
	const rawId = String.fromCharCode(...raw.subarray(0, 4));
	if (rawId !== id) throw new RangeError(`${name} ID disagrees with its raw header.`);
	const payloadBytes = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(4, true);
	if (payloadBytes === UINT32_SENTINEL) throw new RangeError(`${name} cannot use a ds64 sentinel size.`);
	const expectedBytes = 8 + payloadBytes + (payloadBytes & 1);
	if (raw.byteLength !== expectedBytes) throw new RangeError(`${name} byte length is invalid.`);
	const listType = id === 'LIST' && payloadBytes >= 4 ? String.fromCharCode(...raw.subarray(8, 12)) : null;
	if (!options.accept(id, listType)) {
		throw new RangeError(`${name} ${options.rejection(id)}.`);
	}
}

function canonicalBase64(value: unknown, name: string): string {
	if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
		throw new RangeError(`${name} must use canonical base64.`);
	}
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	if ((value.length / 4 * 3) - padding > WAV_OPAQUE_RIFF_MAX_BYTES) {
		throw new RangeError(`${name} exceeds the 16 MiB preservation limit.`);
	}
	return value;
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
	let binary = '';
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function warning(message: string): WavOpaqueRiffCaptureWarning {
	return Object.freeze({ code: 'adm-opaque-chunk-preservation-incomplete', message });
}

export function wavOpaqueRiffPreservationWarning(message: string): WavOpaqueRiffCaptureWarning {
	return warning(message);
}

function printable(value: string): string {
	return JSON.stringify(value.replace(/[^\x20-\x7e]/gu, '?'));
}
