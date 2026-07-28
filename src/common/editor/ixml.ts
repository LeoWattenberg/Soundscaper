/* SPDX-License-Identifier: AGPL-3.0-only */

const MAX_IXML_BYTES = 4 * 1024 * 1024;

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
	validatedXmlBytes(xml);
	if (!/<BWFXML(?:\s|>)/u.test(xml)) throw new Error('The iXML payload has no BWFXML root.');
	const tracks = blocks(xml, 'TRACK').map((block) => ({ channelIndex: Number(tag(block, 'CHANNEL_INDEX')) || 1, name: tag(block, 'NAME'), function: tag(block, 'FUNCTION') }));
	const syncPoints = blocks(xml, 'SYNC_POINT').map((block) => ({ type: tag(block, 'POINT_TYPE') === 'ABSOLUTE' ? 'ABSOLUTE' as const : 'RELATIVE' as const, sampleCount: tag(block, 'SAMPLE_COUNT') || '0', function: tag(block, 'FUNCTION') }));
	return normalizeIxmlMetadata({
		project: tag(xml, 'PROJECT'), scene: tag(xml, 'SCENE'), take: tag(xml, 'TAKE'), tape: tag(xml, 'TAPE'),
		note: tag(xml, 'NOTE'), circled: tag(xml, 'CIRCLED').toUpperCase() === 'TRUE', timecodeRate: tag(xml, 'TIMECODE_RATE'),
		timecodeFlag: tag(xml, 'TIMECODE_FLAG') as IxmlMetadata['timecodeFlag'], fileSetId: tag(xml, 'FAMILY_UID'), tracks, syncPoints, rawXml: xml,
	});
}

function validatedXmlBytes(xml: string): Uint8Array {
	if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/iu.test(xml)) throw new Error('Active XML constructs are not allowed in iXML.');
	const bytes = new TextEncoder().encode(xml);
	if (bytes.byteLength > MAX_IXML_BYTES) throw new RangeError('The iXML payload exceeds 4 MiB.');
	return bytes;
}
function tag(xml: string, name: string): string { const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'iu').exec(xml); return unescape(match?.[1]?.trim() || ''); }
function blocks(xml: string, name: string): string[] { return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'giu'))].map((match) => match[1]); }
function escape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function unescape(value: string): string { return value.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&'); }
function string(value: unknown): string { if (value == null) return ''; if (typeof value !== 'string') throw new TypeError('iXML text fields must be strings.'); if (value.includes('\0')) throw new RangeError('iXML text cannot contain NUL.'); return value; }
function positive(value: unknown, name: string): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be positive.`); return number; }
function uint64(value: unknown): string { const text = String(value); if (!/^\d+$/u.test(text) || BigInt(text) > 0xffff_ffff_ffff_ffffn) throw new RangeError('iXML sample counts must be unsigned 64-bit integers.'); return BigInt(text).toString(); }
