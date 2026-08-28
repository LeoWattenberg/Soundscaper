/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser, type SaxesTagPlain } from 'saxes';

const MAX_IXML_BYTES = 4 * 1024 * 1024;
const MAX_IXML_ELEMENTS = 100_000;
const MAX_IXML_DEPTH = 128;

export interface IxmlTrack { readonly channelIndex: number; readonly name: string; readonly function: string; }
export interface IxmlSyncPoint { readonly type: 'RELATIVE' | 'ABSOLUTE'; readonly sampleCount: string; readonly function: string; }
export interface IxmlMetadata {
	readonly project: string;
	readonly scene: string;
	readonly take: string;
	readonly tape: string;
	readonly note: string;
	readonly circled: boolean;
	readonly timecodeRate: string;
	readonly timecodeFlag: 'NDF' | 'DF' | '';
	readonly fileSetId: string;
	readonly tracks: readonly IxmlTrack[];
	readonly syncPoints: readonly IxmlSyncPoint[];
	readonly rawXml: string;
}

export type IxmlMetadataInput = Partial<Omit<IxmlMetadata, 'tracks' | 'syncPoints'>> & {
	readonly tracks?: readonly Partial<IxmlTrack>[];
	readonly syncPoints?: readonly Partial<IxmlSyncPoint>[];
};

export function normalizeIxmlMetadata(input: IxmlMetadataInput = {}): IxmlMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('iXML metadata must be an object.');
	return Object.freeze({
		project: string(input.project), scene: string(input.scene), take: string(input.take), tape: string(input.tape),
		note: string(input.note), circled: Boolean(input.circled), timecodeRate: string(input.timecodeRate),
		timecodeFlag: input.timecodeFlag === 'DF' || input.timecodeFlag === 'NDF' ? input.timecodeFlag : '',
		fileSetId: string(input.fileSetId),
		tracks: Object.freeze((input.tracks || []).map((track, index) => Object.freeze({
			channelIndex: positive(track.channelIndex ?? index + 1, 'iXML channel index'),
			name: string(track.name), function: string(track.function),
		}))),
		syncPoints: Object.freeze((input.syncPoints || []).map((point) => Object.freeze({
			type: point.type === 'ABSOLUTE' ? 'ABSOLUTE' : 'RELATIVE',
			sampleCount: uint64(point.sampleCount ?? '0'), function: string(point.function),
		}))),
		rawXml: string(input.rawXml),
	});
}

export function encodeIxmlPayload(input: IxmlMetadataInput = {}): Uint8Array {
	const value = normalizeIxmlMetadata(input);
	if (value.rawXml) return validatedXmlBytes(value.rawXml);
	const tracks = value.tracks.map((track) => `<TRACK><CHANNEL_INDEX>${track.channelIndex}</CHANNEL_INDEX><NAME>${escape(track.name)}</NAME><FUNCTION>${escape(track.function)}</FUNCTION></TRACK>`).join('');
	const points = value.syncPoints.map((point) => `<SYNC_POINT><POINT_TYPE>${point.type}</POINT_TYPE><SAMPLE_COUNT>${point.sampleCount}</SAMPLE_COUNT><FUNCTION>${escape(point.function)}</FUNCTION></SYNC_POINT>`).join('');
	return validatedXmlBytes(`<BWFXML><IXML_VERSION>1.5</IXML_VERSION><PROJECT>${escape(value.project)}</PROJECT><SCENE>${escape(value.scene)}</SCENE><TAKE>${escape(value.take)}</TAKE><TAPE>${escape(value.tape)}</TAPE><NOTE>${escape(value.note)}</NOTE><CIRCLED>${value.circled ? 'TRUE' : 'FALSE'}</CIRCLED><SPEED><TIMECODE_RATE>${escape(value.timecodeRate)}</TIMECODE_RATE><TIMECODE_FLAG>${value.timecodeFlag}</TIMECODE_FLAG></SPEED><FILE_SET><FAMILY_UID>${escape(value.fileSetId)}</FAMILY_UID></FILE_SET><TRACK_LIST>${tracks}</TRACK_LIST><SYNC_POINT_LIST>${points}</SYNC_POINT_LIST></BWFXML>`);
}

export function createRiffIxmlChunk(input: IxmlMetadataInput | null | undefined): Uint8Array {
	if (input == null) return new Uint8Array(0);
	const payload = encodeIxmlPayload(input);
	const result = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	result.set(new TextEncoder().encode('iXML'));
	new DataView(result.buffer).setUint32(4, payload.byteLength, true);
	result.set(payload, 8);
	return result;
}

export function parseIxmlPayload(bytes: Uint8Array): IxmlMetadata {
	if (bytes.byteLength > MAX_IXML_BYTES) throw new RangeError('The iXML payload exceeds 4 MiB.');
	const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/u, '');
	const parsed = parseIxmlDocument(xml);
	const tracks = parsed.tracks.map((track) => ({
		channelIndex: Number(track.channelIndex?.trim()) || 1,
		name: track.name ?? '',
		function: track.function ?? '',
	}));
	const syncPoints = parsed.syncPoints.map((point) => ({
		type: point.type?.trim() === 'ABSOLUTE' ? 'ABSOLUTE' as const : 'RELATIVE' as const,
		sampleCount: point.sampleCount?.trim() || '0',
		function: point.function ?? '',
	}));
	return normalizeIxmlMetadata({
		project: parsed.document.project ?? '', scene: parsed.document.scene ?? '', take: parsed.document.take ?? '', tape: parsed.document.tape ?? '',
		note: parsed.document.note ?? '', circled: parsed.document.circled?.trim().toUpperCase() === 'TRUE', timecodeRate: parsed.document.timecodeRate ?? '',
		timecodeFlag: (parsed.document.timecodeFlag?.trim() ?? '') as IxmlMetadata['timecodeFlag'], fileSetId: parsed.document.fileSetId ?? '', tracks, syncPoints, rawXml: xml,
	});
}

function validatedXmlBytes(xml: string): Uint8Array {
	const bytes = new TextEncoder().encode(xml);
	if (bytes.byteLength > MAX_IXML_BYTES) throw new RangeError('The iXML payload exceeds 4 MiB.');
	parseIxmlDocument(xml);
	return bytes;
}

type DocumentField = 'project' | 'scene' | 'take' | 'tape' | 'note' | 'circled' | 'timecodeRate' | 'timecodeFlag' | 'fileSetId';
type TrackField = 'channelIndex' | 'name' | 'function';
type SyncPointField = 'type' | 'sampleCount' | 'function';
type TrackFields = Partial<Record<TrackField, string>>;
type SyncPointFields = Partial<Record<SyncPointField, string>>;
type TextCapture = {
	readonly depth: number;
	readonly parts: string[];
	readonly target:
		| { readonly kind: 'document'; readonly field: DocumentField }
		| { readonly kind: 'track'; readonly field: TrackField; readonly record: TrackFields }
		| { readonly kind: 'syncPoint'; readonly field: SyncPointField; readonly record: SyncPointFields };
};

function parseIxmlDocument(xml: string): {
	readonly document: Partial<Record<DocumentField, string>>;
	readonly tracks: readonly TrackFields[];
	readonly syncPoints: readonly SyncPointFields[];
} {
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) {
		throw new IxmlValidationError('Active XML and external declarations are not allowed in iXML.');
	}
	const document: Partial<Record<DocumentField, string>> = {};
	const tracks: TrackFields[] = [];
	const syncPoints: SyncPointFields[] = [];
	const elementNames: string[] = [];
	let activeTrack: { readonly depth: number; readonly fields: TrackFields } | null = null;
	let activeSyncPoint: { readonly depth: number; readonly fields: SyncPointFields } | null = null;
	let capture: TextCapture | null = null;
	let elementCount = 0;
	let attributeCount = 0;
	const parser = new SaxesParser({ xmlns: false, position: false });

	parser.on('doctype', () => {
		throw new IxmlValidationError('Active XML and external declarations are not allowed in iXML.');
	});
	parser.on('processinginstruction', () => {
		throw new IxmlValidationError('Active XML processing instructions are not allowed in iXML.');
	});
	parser.on('opentag', (tag: SaxesTagPlain) => {
		if (capture !== null) throw new IxmlValidationError('iXML metadata fields must contain text only.');
		elementCount += 1;
		if (elementCount > MAX_IXML_ELEMENTS) throw new RangeError('iXML exceeds the element-count safety limit.');
		if (elementNames.length >= MAX_IXML_DEPTH) throw new RangeError('iXML exceeds the maximum XML depth.');
		attributeCount += Object.keys(tag.attributes).length;
		if (attributeCount > MAX_IXML_ELEMENTS * 4) throw new RangeError('iXML exceeds the attribute-count safety limit.');
		if (elementNames.length === 0 && tag.name !== 'BWFXML') {
			throw new IxmlValidationError('The iXML payload has no BWFXML root.');
		}
		elementNames.push(tag.name);
		const name = tag.name.toUpperCase();
		if (name === 'TRACK') {
			if (activeTrack !== null || activeSyncPoint !== null) throw new IxmlValidationError('iXML record elements cannot be nested.');
			activeTrack = { depth: elementNames.length, fields: {} };
		} else if (name === 'SYNC_POINT') {
			if (activeTrack !== null || activeSyncPoint !== null) throw new IxmlValidationError('iXML record elements cannot be nested.');
			activeSyncPoint = { depth: elementNames.length, fields: {} };
		}
		const target = captureTarget(name, document, activeTrack?.fields ?? null, activeSyncPoint?.fields ?? null);
		if (target !== null) capture = { depth: elementNames.length, parts: [], target };
	});
	const appendText = (text: string): void => {
		if (capture !== null) capture.parts.push(text);
	};
	parser.on('text', appendText);
	parser.on('cdata', appendText);
	parser.on('closetag', () => {
		const depth = elementNames.length;
		if (capture?.depth === depth) {
			applyCapturedText(capture, document);
			capture = null;
		}
		if (activeTrack?.depth === depth) {
			tracks.push(activeTrack.fields);
			activeTrack = null;
		}
		if (activeSyncPoint?.depth === depth) {
			syncPoints.push(activeSyncPoint.fields);
			activeSyncPoint = null;
		}
		elementNames.pop();
	});
	try {
		parser.write(xml).close();
	} catch (error) {
		if (error instanceof IxmlValidationError || error instanceof RangeError) throw error;
		throw new Error('The iXML payload does not contain a well-formed XML document.', { cause: error });
	}
	if (elementCount === 0) throw new IxmlValidationError('The iXML payload has no BWFXML root.');
	return { document, tracks, syncPoints };
}

function captureTarget(
	name: string,
	document: Partial<Record<DocumentField, string>>,
	track: TrackFields | null,
	syncPoint: SyncPointFields | null,
): TextCapture['target'] | null {
	const documentField = ixmlDocumentField(name);
	if (documentField !== null && document[documentField] === undefined) return { kind: 'document', field: documentField };
	if (track !== null) {
		const field = name === 'CHANNEL_INDEX' ? 'channelIndex' : name === 'NAME' ? 'name' : name === 'FUNCTION' ? 'function' : null;
		if (field !== null && track[field] === undefined) return { kind: 'track', field, record: track };
	}
	if (syncPoint !== null) {
		const field = name === 'POINT_TYPE' ? 'type' : name === 'SAMPLE_COUNT' ? 'sampleCount' : name === 'FUNCTION' ? 'function' : null;
		if (field !== null && syncPoint[field] === undefined) return { kind: 'syncPoint', field, record: syncPoint };
	}
	return null;
}

function ixmlDocumentField(name: string): DocumentField | null {
	if (name === 'PROJECT') return 'project';
	if (name === 'SCENE') return 'scene';
	if (name === 'TAKE') return 'take';
	if (name === 'TAPE') return 'tape';
	if (name === 'NOTE') return 'note';
	if (name === 'CIRCLED') return 'circled';
	if (name === 'TIMECODE_RATE') return 'timecodeRate';
	if (name === 'TIMECODE_FLAG') return 'timecodeFlag';
	if (name === 'FAMILY_UID') return 'fileSetId';
	return null;
}

function applyCapturedText(capture: TextCapture, document: Partial<Record<DocumentField, string>>): void {
	const value = capture.parts.join('');
	if (capture.target.kind === 'document') document[capture.target.field] = value;
	else if (capture.target.kind === 'track') capture.target.record[capture.target.field] = value;
	else capture.target.record[capture.target.field] = value;
}

class IxmlValidationError extends Error {}

function escape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function string(value: unknown): string { if (value == null) return ''; if (typeof value !== 'string') throw new TypeError('iXML text fields must be strings.'); if (value.includes('\0')) throw new RangeError('iXML text cannot contain NUL.'); return value; }
function positive(value: unknown, name: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be positive.`); return number; }
function uint64(value: unknown): string { const text = String(value); if (!/^\d+$/u.test(text) || BigInt(text) > 0xffff_ffff_ffff_ffffn) throw new RangeError('iXML sample counts must be unsigned 64-bit integers.'); return BigInt(text).toString(); }
