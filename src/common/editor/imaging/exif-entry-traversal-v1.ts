/* SPDX-License-Identifier: AGPL-3.0-only */

import { checkedRange, failMetadata, MetadataBudget } from './image-metadata-binary.ts';
import { IMAGE_METADATA_LIMITS_V1 } from './image-metadata-model-v1.ts';

export interface ExifEntryV1 {
	readonly scope: 'root' | 'exif' | 'interop' | 'other';
	readonly tag: number;
	readonly type: number;
	readonly count: number;
	readonly dataOffset: number;
	readonly byteLength: number;
}

// Classic TIFF IFD layout and Exif tag types: CIPA DC-008, not RAW admission.
const TYPE_BYTES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8] as const;
const POINTERS = new Set([0x8769, 0x8825, 0xa005]);

/** Visit bounded borrowed TIFF entries; the synchronous trusted visitor owns interpretation. */
export function visitExifEntriesV1(bytes: Uint8Array,
	visit: (entry: Readonly<ExifEntryV1>, view: DataView, little: boolean) => void): void {
	checkedRange(bytes, 0, 8, 'malformed-exif');
	const little = bytes[0] === 0x49 && bytes[1] === 0x49;
	if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) failMetadata('malformed-exif');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(2, little) !== 42) failMetadata('malformed-exif');
	const pending: { offset: number; scope: ExifEntryV1['scope'] }[] = [{ offset: view.getUint32(4, little), scope: 'root' }];
	const seen = new Set<number>(), budget = new MetadataBudget();
	let entriesRead = 0;
	while (pending.length) {
		const directory = pending.shift();
		if (!directory) break;
		const offset = directory.offset;
		if (offset < 8 || seen.has(offset)) failMetadata('malformed-exif');
		seen.add(offset);
		if (seen.size > IMAGE_METADATA_LIMITS_V1.maximumIfdDirectories) failMetadata('metadata-limit');
		checkedRange(bytes, offset, 2, 'malformed-exif');
		const count = view.getUint16(offset, little);
		entriesRead += count;
		if (entriesRead > IMAGE_METADATA_LIMITS_V1.maximumIfdEntries) failMetadata('metadata-limit');
		checkedRange(bytes, offset, 2 + count * 12 + 4, 'malformed-exif');
		budget.addBytes(2 + count * 12 + 4);
		const tags = new Set<number>();
		for (let index = 0; index < count; index++) {
			const position = offset + 2 + index * 12, tag = view.getUint16(position, little);
			if (tags.has(tag)) failMetadata('malformed-exif');
			tags.add(tag);
			const type = view.getUint16(position + 2, little), size = TYPE_BYTES[type], samples = view.getUint32(position + 4, little);
			if (!size || samples === 0) failMetadata('malformed-exif');
			const length = size * samples, dataOffset = length <= 4 ? position + 8 : view.getUint32(position + 8, little);
			checkedRange(bytes, dataOffset, length, 'malformed-exif');
			budget.addBytes(length);
			if (POINTERS.has(tag)) {
				if (type !== 4 || samples !== 1) failMetadata('malformed-exif');
				const scope = directory.scope === 'root' && tag === 0x8769 ? 'exif'
					: directory.scope === 'exif' && tag === 0xa005 ? 'interop' : 'other';
				pending.push({ offset: view.getUint32(dataOffset, little), scope });
				continue;
			}
			visit(Object.freeze({ scope: directory.scope, tag, type, count: samples, dataOffset, byteLength: length }), view, little);
		}
		const next = view.getUint32(offset + 2 + count * 12, little);
		if (next) pending.push({ offset: next, scope: 'other' });
	}
}
