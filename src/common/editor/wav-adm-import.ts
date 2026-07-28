/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ADM_AXML_MAX_BYTES,
	CHNA_MAX_PAYLOAD_BYTES,
	inspectAdmAxml,
	parseChnaPayload,
	validateAdmCommonDefinitionChna,
	validateAdmChnaConsistency,
	type AdmAxmlDocument,
	type ChnaMetadata,
} from './adm-metadata.ts';
import { validateAdmSxmlPayload, AdmSxmlFormatUnsupportedError } from './adm-sxml.ts';
import { AdmXmlExpandedSizeError, gunzipAdmXmlBounded } from './adm-xml-compression.ts';
import type {
	WavOpaqueRiffChunk,
	WavRiffChunkSequenceEntry,
} from './wav-opaque-chunks.ts';

export const WAV_ADM_PAYLOAD_MAX_BYTES = ADM_AXML_MAX_BYTES;
export const WAV_ADM_CHNA_MAX_BYTES = CHNA_MAX_PAYLOAD_BYTES;

export type WavAdmPayloadKind = 'axml' | 'bxml' | 'sxml';

export interface WavAdmCapturedPayload {
	readonly kind: WavAdmPayloadKind;
	readonly bytes: Uint8Array;
}

export interface WavAdmWarning {
	readonly code: string;
	readonly message: string;
}

type WavAdmStaticMetadataPayload = Readonly<{ kind: 'axml'; xml: string; rawBase64: string }>
	| Readonly<{ kind: 'bxml'; base64: string }>;

interface ClassifiedStaticPayload {
	readonly payload: WavAdmStaticMetadataPayload;
	readonly document: AdmAxmlDocument | null;
	readonly empty: boolean;
	readonly invalid: boolean;
}

export interface WavAdmImportMetadata {
	readonly container: 'bw64' | 'rf64' | 'riff';
	readonly payload: WavAdmStaticMetadataPayload | Readonly<{ kind: 'sxml'; base64: string }>;
	readonly serialPayload?: Readonly<{ kind: 'sxml'; base64: string }>;
	readonly auxiliaryPayloads?: readonly WavAdmStaticMetadataPayload[];
	readonly riffChunkSequence?: readonly WavRiffChunkSequenceEntry[];
	readonly opaqueRiffChunks?: readonly WavOpaqueRiffChunk[];
	readonly chna: Readonly<{
		numTracks: number;
		entries: readonly Readonly<{ trackIndex: number; uid: string; trackRef: string; packRef: string }>[];
		rawBase64: string;
	}>;
	readonly valid: boolean;
	readonly warnings: readonly string[];
}

export function finalizeWavAdmImport(options: Readonly<{
	readonly container: WavAdmImportMetadata['container'];
	readonly staticPayloads: readonly WavAdmCapturedPayload[];
	readonly serialPayload: WavAdmCapturedPayload | null;
	readonly chna: Uint8Array | null;
	readonly channelCount: number;
	readonly priorWarnings?: readonly WavAdmWarning[];
	readonly riffChunkSequence?: readonly WavRiffChunkSequenceEntry[];
	readonly opaqueRiffChunks?: readonly WavOpaqueRiffChunk[];
	readonly opaqueWarnings?: readonly WavAdmWarning[];
}>): Readonly<{ metadata: WavAdmImportMetadata | null; warnings: readonly WavAdmWarning[] }> {
	const warnings: WavAdmWarning[] = [...(options.priorWarnings ?? [])];
	const addWarning = (code: string, error: unknown): void => {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(Object.freeze({ code, message }));
	};
	if (options.staticPayloads.length === 0 && !options.serialPayload) {
		if (options.chna) addWarning('adm-chna-orphaned', 'The CHNA chunk has no AXML, BXML, or SXML payload.');
		return Object.freeze({ metadata: null, warnings: Object.freeze(warnings) });
	}

	let payload: WavAdmImportMetadata['payload'] | null = null;
	let serialPayload: WavAdmImportMetadata['serialPayload'];
	const classifiedStatic: ClassifiedStaticPayload[] = [];
	for (const captured of options.staticPayloads) {
		if (captured.bytes.byteLength > WAV_ADM_PAYLOAD_MAX_BYTES) {
			addWarning('adm-payload-too-large', 'The ADM payload exceeds the 16 MiB safety limit.');
			continue;
		}
		if (captured.kind === 'axml') {
			const xml = decodeUtf8(captured.bytes);
			if (xml === null) {
				addWarning('adm-axml-invalid', 'The AXML payload is not valid UTF-8.');
				continue;
			}
			let document: AdmAxmlDocument | null = null;
			let invalid = false;
			const empty = captured.bytes.byteLength === 0;
			if (!empty) try { document = inspectAdmAxml(captured.bytes); }
			catch (error) { invalid = true; addWarning('adm-axml-invalid', error); }
			classifiedStatic.push(Object.freeze({
				payload: Object.freeze({ kind: 'axml', xml, rawBase64: bytesToBase64(captured.bytes) }),
				document,
				empty,
				invalid,
			}));
		} else if (captured.kind === 'bxml') {
			const staticPayload = Object.freeze({ kind: 'bxml' as const, base64: bytesToBase64(captured.bytes) });
			const decoded = decodeBxml(captured.bytes);
			let document: AdmAxmlDocument | null = null;
			let invalid = false;
			if ('error' in decoded) { invalid = true; addWarning(decoded.code, decoded.error); }
			else try { document = inspectAdmAxml(decoded.bytes); }
			catch (error) { invalid = true; addWarning('adm-bxml-invalid', error); }
			classifiedStatic.push(Object.freeze({ payload: staticPayload, document, empty: false, invalid }));
		}
	}
	const documentedStatic = classifiedStatic.filter(({ document }) => document !== null);
	if (documentedStatic.length > 1) {
		addWarning('adm-static-payload-conflict', 'AXML and BXML both carry static ADM in one BW64 file.');
	}
	const primaryStatic = documentedStatic[0]
		?? classifiedStatic.find(({ empty }) => empty)
		?? classifiedStatic.find(({ invalid }) => invalid)
		?? null;
	const auxiliaryPayloads = classifiedStatic
		.filter((candidate) => candidate !== primaryStatic)
		.map(({ payload: staticPayload }) => staticPayload);
	if (primaryStatic) payload = primaryStatic.payload;
	if (options.serialPayload) {
		const captured = Object.freeze({ kind: 'sxml' as const, base64: bytesToBase64(options.serialPayload.bytes) });
		if (payload) serialPayload = captured;
		else payload = captured;
		try {
			validateAdmSxmlPayload(options.serialPayload.bytes);
		} catch (error) {
			if (error instanceof AdmSxmlFormatUnsupportedError) addWarning('adm-sxml-format-unsupported', error);
			else if (error instanceof AdmXmlExpandedSizeError) addWarning('adm-sxml-decompressed-too-large', error);
			else addWarning('adm-sxml-invalid', error);
		}
	}
	if (!payload) {
		if (options.chna) addWarning('adm-chna-orphaned', 'The CHNA chunk has no ADM AXML, BXML, or SXML payload.');
		return Object.freeze({ metadata: null, warnings: Object.freeze(warnings) });
	}
	warnings.push(...(options.opaqueWarnings ?? []));

	let parsedChna: ChnaMetadata | null = null;
	let rawBase64 = '';
	if (options.chna) {
		rawBase64 = bytesToBase64(options.chna);
		try {
			parsedChna = parseChnaPayload(options.chna);
		} catch (error) {
			addWarning('adm-chna-invalid', error);
		}
	}
	const staticMetadata = primaryStatic !== null;
	if (staticMetadata && !options.chna) {
		addWarning('adm-chna-missing', 'Static ADM metadata requires a CHNA chunk.');
	} else if (staticMetadata && parsedChna && primaryStatic.document) {
		try {
			validateAdmChnaConsistency(primaryStatic.document, parsedChna, options.channelCount);
		} catch (error) {
			addWarning('adm-chna-inconsistent', error);
		}
	} else if (staticMetadata && primaryStatic.empty && parsedChna) {
		try {
			validateAdmCommonDefinitionChna(parsedChna, options.channelCount);
		} catch (error) {
			addWarning('adm-chna-inconsistent', error);
		}
	} else if (parsedChna && parsedChna.numTracks !== options.channelCount) {
		addWarning(
			'adm-chna-inconsistent',
			`CHNA declares ${parsedChna.numTracks} tracks but the PCM channel count is ${options.channelCount}.`,
		);
	}

	const entries = parsedChna?.entries.map((entry) => Object.freeze({ ...entry })) ?? [];
	const messages = warnings.map((warning) => warning.message);
	return Object.freeze({
		metadata: Object.freeze({
			container: options.container,
			payload,
			...(serialPayload ? { serialPayload } : {}),
			...(auxiliaryPayloads.length ? { auxiliaryPayloads: Object.freeze(auxiliaryPayloads) } : {}),
			...(options.riffChunkSequence?.length ? { riffChunkSequence: options.riffChunkSequence } : {}),
			...(options.opaqueRiffChunks?.length ? { opaqueRiffChunks: options.opaqueRiffChunks } : {}),
			chna: Object.freeze({
				numTracks: parsedChna?.numTracks ?? 0,
				entries: Object.freeze(entries),
				rawBase64,
			}),
			valid: warnings.length === 0,
			warnings: Object.freeze(messages),
		}),
		warnings: Object.freeze(warnings),
	});
}

export function wavAdmWarning(code: string, message: string): WavAdmWarning {
	return Object.freeze({ code, message });
}

export function parseBxmlAdmPayload(bytes: Uint8Array): AdmAxmlDocument {
	const document = inspectBxmlAdmPayload(bytes);
	if (!document) throw new Error('ADM BXML must contain exactly one audioFormatExtended element.');
	return document;
}

export function inspectBxmlAdmPayload(bytes: Uint8Array): AdmAxmlDocument | null {
	const decoded = decodeBxml(bytes);
	if ('error' in decoded) throw new Error(decoded.error);
	return inspectAdmAxml(decoded.bytes);
}

function decodeUtf8(bytes: Uint8Array): string | null {
	try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { return null; }
}

type BxmlDecodeResult = Readonly<{ bytes: Uint8Array }>
	| Readonly<{ code: string; error: string }>;

function decodeBxml(bytes: Uint8Array): BxmlDecodeResult {
	if (bytes.byteLength < 2) {
		return Object.freeze({ code: 'adm-bxml-invalid', error: 'The BXML payload has no two-byte compression format type.' });
	}
	const formatType = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true);
	if (formatType === 0) return Object.freeze({ bytes: bytes.subarray(2) });
	if (formatType !== 1) {
		return Object.freeze({
			code: 'adm-bxml-format-unsupported',
			error: `The BXML compression format type 0x${formatType.toString(16).padStart(4, '0')} is not supported.`,
		});
	}
	try {
		return Object.freeze({ bytes: gunzipAdmXmlBounded(bytes.subarray(2), WAV_ADM_PAYLOAD_MAX_BYTES) });
	} catch (error) {
		if (error instanceof AdmXmlExpandedSizeError) {
			return Object.freeze({ code: 'adm-bxml-decompressed-too-large', error: error.message });
		}
		const detail = error instanceof Error ? error.message : String(error);
		return Object.freeze({ code: 'adm-bxml-invalid', error: `The BXML gzip payload is invalid: ${detail}` });
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let output = '';
	for (let chunkOffset = 0; chunkOffset < bytes.byteLength; chunkOffset += 12_288) {
		let chunk = '';
		const end = Math.min(bytes.byteLength, chunkOffset + 12_288);
		for (let offset = chunkOffset; offset < end; offset += 3) {
			const first = bytes[offset] ?? 0;
			const second = bytes[offset + 1] ?? 0;
			const third = bytes[offset + 2] ?? 0;
			chunk += alphabet[first >> 2];
			chunk += alphabet[((first & 3) << 4) | (second >> 4)];
			chunk += offset + 1 < bytes.byteLength ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
			chunk += offset + 2 < bytes.byteLength ? alphabet[third & 63] : '=';
		}
		output += chunk;
	}
	return output;
}
