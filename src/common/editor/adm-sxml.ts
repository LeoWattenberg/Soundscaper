/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser } from 'saxes';
import { ADM_AXML_MAX_BYTES, ADM_AXML_MAX_DEPTH, ADM_AXML_MAX_ELEMENTS } from './adm-metadata.ts';
import { AdmXmlExpandedSizeError, gunzipAdmXmlBounded } from './adm-xml-compression.ts';

const SXML_FIXED_HEADER_BYTES = 10;
const SXML_SUBCHUNK_COUNT_BYTES = 4;
const SXML_SUBCHUNK_HEADER_BYTES = 8;
const SXML_ALIGNMENT_COUNT_BYTES = 4;
const SXML_ALIGNMENT_POINT_BYTES = 16;

export interface AdmSxmlMetadata {
	readonly formatType: 0 | 1;
	readonly subChunkCount: number;
	readonly alignmentPointCount: number;
	readonly totalSamples: bigint;
}

export class AdmSxmlFormatUnsupportedError extends Error {}

export function validateAdmSxmlPayload(bytes: Uint8Array): AdmSxmlMetadata {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('The SXML payload must be bytes.');
	if (bytes.byteLength > ADM_AXML_MAX_BYTES) throw new RangeError('The SXML payload exceeds the 16 MiB safety limit.');
	if (bytes.byteLength < SXML_FIXED_HEADER_BYTES + SXML_SUBCHUNK_COUNT_BYTES + SXML_ALIGNMENT_COUNT_BYTES) {
		throw new Error('The SXML payload is truncated before its sub-chunk and alignment tables.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const formatType = view.getUint16(0, true);
	if (formatType !== 0 && formatType !== 1) {
		throw new AdmSxmlFormatUnsupportedError(`The SXML compression format type 0x${formatType.toString(16).padStart(4, '0')} is not supported.`);
	}
	const tableSize = uint64Size(view.getUint32(2, true), view.getUint32(6, true), 'SXML sub-chunk table');
	if (tableSize < SXML_SUBCHUNK_COUNT_BYTES) throw new Error('The SXML sub-chunk table size omits its entry count.');
	const tableEnd = SXML_FIXED_HEADER_BYTES + tableSize;
	if (tableEnd + SXML_ALIGNMENT_COUNT_BYTES > bytes.byteLength) throw new Error('The SXML sub-chunk table is truncated.');
	const subChunkCount = view.getUint32(SXML_FIXED_HEADER_BYTES, true);
	if (subChunkCount > Math.floor((tableSize - SXML_SUBCHUNK_COUNT_BYTES) / SXML_SUBCHUNK_HEADER_BYTES)) {
		throw new Error('The SXML sub-chunk count exceeds its declared table size.');
	}
	const sampleByChunkOffset = new Map<number, bigint>();
	let offset = SXML_FIXED_HEADER_BYTES + SXML_SUBCHUNK_COUNT_BYTES;
	let totalSamples = 0n;
	let expandedBytes = 0;
	for (let index = 0; index < subChunkCount; index += 1) {
		if (offset + SXML_SUBCHUNK_HEADER_BYTES > tableEnd) throw new Error(`SXML sub-chunk ${index + 1} has a truncated header.`);
		const chunkOffset = offset;
		const xmlBytes = view.getUint32(offset, true);
		const sampleCount = view.getUint32(offset + 4, true);
		offset += SXML_SUBCHUNK_HEADER_BYTES;
		if (xmlBytes > tableEnd - offset) throw new Error(`SXML sub-chunk ${index + 1} is truncated.`);
		const encodedXml = bytes.subarray(offset, offset + xmlBytes);
		const decodedXml = formatType === 0
			? encodedXml
			: gunzipAdmXmlBounded(encodedXml, ADM_AXML_MAX_BYTES - expandedBytes);
		if (decodedXml.byteLength > ADM_AXML_MAX_BYTES - expandedBytes) {
			throw new AdmXmlExpandedSizeError(ADM_AXML_MAX_BYTES);
		}
		expandedBytes += decodedXml.byteLength;
		validateXmlDocument(decodedXml, index);
		sampleByChunkOffset.set(chunkOffset, totalSamples);
		totalSamples += BigInt(sampleCount);
		offset += xmlBytes;
	}
	if (offset !== tableEnd) throw new Error('The SXML sub-chunk table size does not match its entries.');
	const alignmentPointCount = view.getUint32(tableEnd, true);
	const alignmentBytes = alignmentPointCount * SXML_ALIGNMENT_POINT_BYTES;
	if (!Number.isSafeInteger(alignmentBytes)
		|| tableEnd + SXML_ALIGNMENT_COUNT_BYTES + alignmentBytes !== bytes.byteLength) {
		throw new Error('The SXML alignment-point table size does not match the payload.');
	}
	for (let index = 0; index < alignmentPointCount; index += 1) {
		const entryOffset = tableEnd + SXML_ALIGNMENT_COUNT_BYTES + (index * SXML_ALIGNMENT_POINT_BYTES);
		const chunkOffset = uint64Size(view.getUint32(entryOffset, true), view.getUint32(entryOffset + 4, true), 'SXML alignment offset');
		const timestamp = uint64(view.getUint32(entryOffset + 8, true), view.getUint32(entryOffset + 12, true));
		const expectedTimestamp = sampleByChunkOffset.get(chunkOffset);
		if (expectedTimestamp === undefined) throw new Error(`SXML alignment point ${index + 1} does not identify a sub-chunk boundary.`);
		if (timestamp !== expectedTimestamp) throw new Error(`SXML alignment point ${index + 1} has an inconsistent sample timestamp.`);
	}
	return Object.freeze({
		formatType,
		subChunkCount,
		alignmentPointCount,
		totalSamples,
	});
}

function validateXmlDocument(bytes: Uint8Array, index: number): void {
	let xml: string;
	try {
		xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`SXML sub-chunk ${index + 1} is not valid UTF-8.`, { cause: error });
	}
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) throw new Error('Active or external XML declarations are not allowed in SXML.');
	if (/<\?(?!xml\s)/iu.test(xml)) throw new Error('Active XML processing instructions are not allowed in SXML.');
	let elements = 0;
	let depth = 0;
	const parser = new SaxesParser({ xmlns: true, position: false });
	parser.on('doctype', () => { throw new Error('DOCTYPE declarations are not allowed in SXML.'); });
	parser.on('processinginstruction', (instruction) => {
		if (instruction.target.toLowerCase() !== 'xml') throw new Error('Active XML processing instructions are not allowed in SXML.');
	});
	parser.on('opentag', () => {
		elements += 1;
		depth += 1;
		if (elements > ADM_AXML_MAX_ELEMENTS) throw new RangeError('SXML exceeds the element-count safety limit.');
		if (depth > ADM_AXML_MAX_DEPTH) throw new RangeError('SXML exceeds the maximum XML depth.');
	});
	parser.on('closetag', () => { depth -= 1; });
	try {
		parser.write(xml).close();
	} catch (error) {
		throw new Error(`SXML sub-chunk ${index + 1} does not contain a well-formed XML document.`, { cause: error });
	}
	if (elements === 0) throw new Error(`SXML sub-chunk ${index + 1} contains no XML document.`);
}

function uint64Size(low: number, high: number, field: string): number {
	const value = uint64(low, high);
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${field} size is not safely representable.`);
	return Number(value);
}

function uint64(low: number, high: number): bigint {
	return (BigInt(high) << 32n) | BigInt(low);
}
