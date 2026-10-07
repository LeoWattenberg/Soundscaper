/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedRange, failMetadata, matchesBytes, MetadataBudget } from './image-metadata-binary.ts';
import { IMAGE_METADATA_LIMITS_V1, type ImageIptcMetadataV1 } from './image-metadata-model-v1.ts';

// Adobe image resource blocks (APP13), resource 0x0404; IPTC IIM 4.2 data sets.
// https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
// https://www.iptc.org/std/IIM/4.2/specification/IIMV4.2.pdf
export const PHOTOSHOP_APP13_PREFIX = Object.freeze([80, 104, 111, 116, 111, 115, 104, 111, 112, 32, 51, 46, 48, 0]);
const RESOURCE_SIGNATURE = [56, 66, 73, 77] as const;
const UTF8_CHARACTER_SET = [27, 37, 71] as const;
type SingleField = 'objectName' | 'headline' | 'caption' | 'copyright' | 'city' | 'sublocation'
	| 'state' | 'country' | 'captureDate' | 'captureTime';
const TEXT_FIELDS = new Map<number, readonly [SingleField, number]>([
	[5, ['objectName', 64]], [105, ['headline', 256]], [120, ['caption', 2_000]], [116, ['copyright', 128]],
	[90, ['city', 32]], [92, ['sublocation', 32]], [95, ['state', 32]], [101, ['country', 64]],
	[55, ['captureDate', 8]], [60, ['captureTime', 11]],
]);

/** APP13 may contain many resources, but ambiguous IPTC resources are never merged. */
export function readPhotoshopIptcResources(bytes: Uint8Array, budget: MetadataBudget): readonly Uint8Array[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = PHOTOSHOP_APP13_PREFIX.length;
	const result: Uint8Array[] = [];
	while (offset < bytes.length) {
		budget.addRecord();
		checkedRange(bytes, offset, 7, 'malformed-iptc');
		if (!matchesBytes(bytes, offset, RESOURCE_SIGNATURE)) failMetadata('malformed-iptc');
		const id = view.getUint16(offset + 4);
		const nameLength = bytes[offset + 6] ?? 0;
		const nameBytes = Math.ceil((nameLength + 1) / 2) * 2;
		checkedRange(bytes, offset + 6, nameBytes + 4, 'malformed-iptc');
		const lengthOffset = offset + 6 + nameBytes;
		const length = view.getUint32(lengthOffset);
		const dataOffset = lengthOffset + 4;
		checkedRange(bytes, dataOffset, length + length % 2, 'malformed-iptc');
		if (id === 0x0404) result.push(bytes.subarray(dataOffset, dataOffset + length));
		offset = dataOffset + length + length % 2;
	}
	return result;
}

export function readIptcMetadataV1(bytes: Uint8Array): Readonly<ImageIptcMetadataV1> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const datasets: { record: number; tag: number; data: Uint8Array }[] = [];
	let offset = 0;
	let characterSet: Uint8Array | null = null;
	while (offset < bytes.length) {
		if (datasets.length >= IMAGE_METADATA_LIMITS_V1.maximumIptcDataSets) failMetadata('metadata-limit');
		checkedRange(bytes, offset, 5, 'malformed-iptc');
		if (bytes[offset] !== 0x1c) failMetadata('malformed-iptc');
		const record = bytes[offset + 1] ?? 0, tag = bytes[offset + 2] ?? 0;
		let length = view.getUint16(offset + 3);
		offset += 5;
		if (length & 0x8000) {
			const octets = length & 0x7fff;
			if (octets < 1 || octets > 4) failMetadata('malformed-iptc');
			checkedRange(bytes, offset, octets, 'malformed-iptc');
			length = 0;
			for (let index = 0; index < octets; index++) length = length * 256 + (bytes[offset + index] ?? 0);
			offset += octets;
		}
		checkedRange(bytes, offset, length, 'malformed-iptc');
		const data = bytes.subarray(offset, offset + length);
		if (record === 1 && tag === 90) {
			if (characterSet !== null) failMetadata('malformed-iptc');
			characterSet = data;
		}
		datasets.push({ record, tag, data });
		offset += length;
	}
	if (characterSet !== null && (characterSet.length !== 3 || !matchesBytes(characterSet, 0, UTF8_CHARACTER_SET))) {
		failMetadata('unsupported-text-encoding');
	}
	const encoding = characterSet === null ? 'ascii' : 'utf8';
	const creators: string[] = [], keywords: string[] = [];
	const result: { -readonly [K in keyof ImageIptcMetadataV1]: ImageIptcMetadataV1[K] } = {
		encoding, objectName: null, headline: null, caption: null, copyright: null,
		creators, keywords, city: null, sublocation: null, state: null, country: null, captureDate: null, captureTime: null,
	};
	const seen = new Set<number>();
	for (const { record, tag, data } of datasets) {
		if (record !== 2) continue;
		const field = TEXT_FIELDS.get(tag);
		if (!field && tag !== 25 && tag !== 80) continue;
		const maximumBytes = field?.[1] ?? (tag === 25 ? 64 : 32);
		if (data.length > maximumBytes) failMetadata('malformed-iptc');
		const text = decodeText(data, encoding, tag === 120);
		if (field) {
			if (seen.has(tag)) failMetadata('malformed-iptc');
			seen.add(tag);
			if (tag === 55) validateDate(text);
			if (tag === 60) validateTime(text);
			result[field[0]] = text;
		} else {
			const repeated = tag === 25 ? keywords : creators;
			if (repeated.length >= IMAGE_METADATA_LIMITS_V1.maximumRepeatedValues) failMetadata('metadata-limit');
			repeated.push(text);
		}
	}
	Object.freeze(creators); Object.freeze(keywords);
	return Object.freeze(result);
}

function decodeText(bytes: Uint8Array, encoding: 'ascii' | 'utf8', multiline: boolean): string {
	if (encoding === 'ascii' && bytes.some(byte => byte > 127)) failMetadata('unsupported-text-encoding');
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
	catch { failMetadata('unsupported-text-encoding'); }
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 32 && !(multiline && (code === 10 || code === 13)) || code === 127) failMetadata('malformed-iptc');
	}
	return text;
}

function validateDate(text: string): void {
	if (!/^\d{8}$/.test(text)) failMetadata('malformed-iptc');
	const month = Number(text.slice(4, 6)), day = Number(text.slice(6));
	if (month > 12 || day > 31 || month === 0 && day !== 0) failMetadata('malformed-iptc');
	const year = Number(text.slice(0, 4));
	const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (month !== 0 && day !== 0 && day > (days[month - 1] ?? 0)) failMetadata('malformed-iptc');
}

function validateTime(text: string): void {
	if (!/^\d{6}[+-]\d{4}$/.test(text)) failMetadata('malformed-iptc');
	if (Number(text.slice(0, 2)) > 23 || Number(text.slice(2, 4)) > 59 || Number(text.slice(4, 6)) > 59
		|| Number(text.slice(7, 9)) > 23 || Number(text.slice(9, 11)) > 59) failMetadata('malformed-iptc');
}
