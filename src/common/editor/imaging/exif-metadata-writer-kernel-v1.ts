/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { IMAGE_METADATA_LIMITS_V1 as LIMITS, type ImageExifMetadataV1 } from './image-metadata-model-v1.ts';
import { normalizeImageMetadataV1 } from './image-metadata-normalizer-v1.ts';

export interface ImageExifWriteOptionsV1 {
	readonly scope: 'capture' | 'descriptive' | 'all' | 'strip';
	readonly width: number;
	readonly height: number;
	readonly maximumOutputBytes: number;
}
interface Entry { readonly tag: number; readonly type: number; readonly count: number; readonly data: Uint8Array<ArrayBuffer>; }
const UINT32_MAX = 0xffffffff;

/** Fresh classic TIFF metadata, without an APP1 prefix or PNG chunk. The caller
 * owns container overhead. Rendered pixels are upright; only selected,
 * normalized read-model facts survive. No original IFD, thumbnail or opaque tag
 * bytes are admitted. JPEG dimensions use Exif's PixelX/YDimension, not IFD0's
 * uncompressed ImageWidth/Length. ASCII follows the existing bounded read model.
 * Layout/tag contracts: CIPA DC-008; PNG eXIf contains this TIFF directly.
 * https://www.cipa.jp/e/std/std-sec.html
 * https://www.w3.org/TR/png-3/#eXIf
 */
export function encodeImageExifTiffForColorSpaceV1(colorSpace: 1 | 65535, value: unknown, options: unknown): Uint8Array<ArrayBuffer> | null {
	if (colorSpace !== 1 && colorSpace !== 65535) throw new RangeError('Unsupported fixed Exif color declaration.');
	const input = record(options, 'Exif write options', ['scope', 'width', 'height', 'maximumOutputBytes']);
	const scope = field(input, 'scope', 'Exif write options');
	if (scope !== 'capture' && scope !== 'descriptive' && scope !== 'all' && scope !== 'strip') throw new RangeError('Unsupported Exif write scope.');
	const width = unsigned(field(input, 'width', 'Exif write options'), UINT32_MAX);
	const height = unsigned(field(input, 'height', 'Exif write options'), UINT32_MAX);
	const maximum = unsigned(field(input, 'maximumOutputBytes', 'Exif write options'), LIMITS.maximumMetadataBytes);
	const facts = normalizeImageMetadataV1({ schemaVersion: 1, container: 'tiff', exif: value, iptc: null, issues: [] }).exif;
	if (scope === 'strip') return null;
	const root: Entry[] = [], exif: Entry[] = [];
	let output: Uint8Array<ArrayBuffer> | undefined;
	try {
		root.push(integer(0x0112, 1, 3));
		exif.push({ tag: 0x9000, type: 7, count: 4, data: Uint8Array.of(48, 50, 51, 50) },
			integer(0xa001, colorSpace, 3), integer(0xa002, width, 4), integer(0xa003, height, 4));
		if (facts && (scope === 'capture' || scope === 'all')) capture(root, exif, facts);
		if (facts && (scope === 'descriptive' || scope === 'all')) {
			ascii(root, 0x010e, facts.description); ascii(root, 0x013b, facts.artist);
			if (facts.copyright !== null && facts.copyright.split('\n').length > 2) throw new RangeError('Exif copyright supports only a photographer/editor pair.');
			ascii(root, 0x8298, facts.copyright?.replace('\n', '\0') ?? null);
		}
		const subdirectory = 8 + directorySize(root.length + 1);
		root.push(integer(0x8769, subdirectory, 4));
		root.sort(byTag); exif.sort(byTag);
		const dataStart = subdirectory + directorySize(exif.length);
		const byteLength = [...root, ...exif].reduce((size, entry) => size + (entry.data.length > 4 ? aligned(entry.data.length) : 0), dataStart);
		if (byteLength > maximum) throw new RangeError('Exif output exceeds its byte ceiling.');
		output = new Uint8Array(byteLength); output.set([73, 73, 42, 0, 8, 0, 0, 0]);
		const view = new DataView(output.buffer);
		let body = dataStart;
		for (const [offset, entries] of [[8, root], [subdirectory, exif]] as const) {
			view.setUint16(offset, entries.length, true);
			entries.forEach((entry, index) => {
				const at = offset + 2 + index * 12;
				view.setUint16(at, entry.tag, true); view.setUint16(at + 2, entry.type, true); view.setUint32(at + 4, entry.count, true);
				if (entry.data.length <= 4) output!.set(entry.data, at + 8);
				else { view.setUint32(at + 8, body, true); output!.set(entry.data, body); body += aligned(entry.data.length); }
			});
		}
		return output;
	} catch (error) { output?.fill(0); throw error; }
	finally { for (const entry of [...root, ...exif]) entry.data.fill(0); }
}

function capture(root: Entry[], exif: Entry[], facts: Readonly<ImageExifMetadataV1>): void {
	ascii(root, 0x010f, facts.cameraMake); ascii(root, 0x0110, facts.cameraModel); ascii(exif, 0xa434, facts.lensModel);
	for (const [tag, value] of [[0x829a, facts.exposureSeconds], [0x829d, facts.aperture], [0x920a, facts.focalLengthMm]] as const) {
		if (value !== null) exif.push(rational(tag, value));
	}
	if (facts.iso !== null) exif.push(integer(0x8827, Math.min(facts.iso, 65_535), 3), integer(0x8830, 3, 3), integer(0x8833, facts.iso, 4));
	if (facts.captureTimeRaw) {
		ascii(exif, 0x9003, facts.captureTimeRaw.dateTimeOriginal); ascii(exif, 0x9011, facts.captureTimeRaw.offsetTimeOriginal);
		ascii(exif, 0x9291, facts.captureTimeRaw.subsecondOriginal);
	} else if (facts.captureTime) {
		const { local, offsetMinutes, subsecond } = facts.captureTime;
		ascii(exif, 0x9003, `${local.slice(0, 10).replaceAll('-', ':')} ${local.slice(11)}`);
		if (offsetMinutes !== null) ascii(exif, 0x9011, `${offsetMinutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`);
		ascii(exif, 0x9291, subsecond);
	}
}
function ascii(entries: Entry[], tag: number, value: string | null): void {
	if (value !== null) {
		const data = Uint8Array.from(`${value}\0`, character => character.charCodeAt(0));
		entries.push({ tag, type: 2, count: data.length, data });
	}
}
function integer(tag: number, value: number, type: 3 | 4): Entry {
	const data = new Uint8Array(type === 3 ? 2 : 4), view = new DataView(data.buffer);
	if (type === 3) view.setUint16(0, value, true); else view.setUint32(0, value, true);
	return { tag, type, count: 1, data };
}
function rational(tag: number, value: number): Entry {
	// Bounded continued fractions; accept only the exact original numeric value.
	// No approximation tolerance can turn a small positive exposure into zero.
	let previousN = 0, n = 1, previousD = 1, d = 0, remainder = value;
	for (let iteration = 0; iteration < 64; iteration++) {
		const whole = Math.floor(remainder), nextN = whole * n + previousN, nextD = whole * d + previousD;
		if (!Number.isSafeInteger(nextN) || !Number.isSafeInteger(nextD) || nextN > UINT32_MAX || nextD > UINT32_MAX) break;
		if (nextD > 0 && nextN / nextD === value) {
			const data = new Uint8Array(8), view = new DataView(data.buffer);
			view.setUint32(0, nextN, true); view.setUint32(4, nextD, true);
			return { tag, type: 5, count: 1, data };
		}
		previousN = n; n = nextN; previousD = d; d = nextD;
		const fractional = remainder - whole;
		if (fractional === 0) break;
		remainder = 1 / fractional;
	}
	throw new RangeError('Exif numeric fact cannot be represented as a bounded unsigned rational.');
}
function unsigned(value: unknown, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Exif write option exceeds its unsigned integer bounds.');
	return value;
}
function aligned(size: number): number { return size + size % 2; }
function directorySize(count: number): number { return 2 + 12 * count + 4; }
function byTag(left: Entry, right: Entry): number { return left.tag - right.tag; }
