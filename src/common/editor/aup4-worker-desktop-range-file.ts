/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertDesktopSelectedRangeDescriptor, type DesktopSelectedRangeDescriptor } from './desktop-selected-range-blob.ts';
import { readDesktopLinkedOriginalRange, DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES } from './storage/desktop-linked-original-range-reader.ts';
import type { DesktopReadFetch } from './desktop-read-materialization.ts';

/** Rebuild only bounded slice reads after postMessage strips Blob subclass methods. */
export function createAup4DesktopRangeFile(descriptor: DesktopSelectedRangeDescriptor, fetchRange: DesktopReadFetch = fetch): Readonly<{
	name: string; size: number; slice(start: number, end: number): Pick<Blob, 'arrayBuffer'>;
	arrayBuffer(): Promise<ArrayBuffer>;
}> {
	assertDesktopSelectedRangeDescriptor(descriptor);
	if (!/\.(?:aup3|aup4)$/iu.test(descriptor.name)) throw new TypeError('An Audacity selected range is required.');
	const read = async (offset: number, length: number): Promise<ArrayBuffer> => {
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0
			|| offset > descriptor.size - length || length > DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES) {
			throw new RangeError('Audacity selected range reads must be bounded and within the file.');
		}
		if (!length) return new ArrayBuffer(0);
		const bytes = await readDesktopLinkedOriginalRange(descriptor, { offset, length }, fetchRange, 'selected');
		return bytes.slice().buffer;
	};
	return Object.freeze({
		name: descriptor.name, size: descriptor.size,
		slice(start: number, end: number) { return Object.freeze({ arrayBuffer: () => read(start, end - start) }); },
		async arrayBuffer() {
			const bytes = new Uint8Array(descriptor.size);
			for (let offset = 0; offset < bytes.byteLength; offset += DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES) {
				bytes.set(new Uint8Array(await read(offset,
					Math.min(DESKTOP_LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES, bytes.byteLength - offset))), offset);
			}
			return bytes.buffer;
		},
	});
}
