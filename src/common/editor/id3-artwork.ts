/* SPDX-License-Identifier: AGPL-3.0-only */

export interface Id3Artwork {
	readonly mimeType: 'image/png' | 'image/jpeg';
	readonly pictureType: number;
	readonly description: string;
	readonly data: string;
}

const MAXIMUM_IMAGE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_TOTAL_BYTES = 8 * 1024 * 1024;

/** Keep artwork JSON-safe for project history, storage and interchange. */
export function parseId3Artwork(value: unknown): readonly Id3Artwork[] {
	if (value == null || value === '') return [];
	const items: unknown = typeof value === 'string' ? JSON.parse(value) : value;
	if (!Array.isArray(items) || items.length > 16) throw new RangeError('ID3 artwork supports at most 16 pictures.');
	let total = 0;
	const descriptions = new Set<string>();
	const icons = new Set<number>();
	return items.map((item: unknown) => {
		if (!item || typeof item !== 'object') throw new TypeError('Artwork must be an object.');
		const picture = item as Record<string, unknown>;
		if (picture.mimeType !== 'image/png' && picture.mimeType !== 'image/jpeg') throw new RangeError('Artwork must be PNG or JPEG.');
		if (!Number.isInteger(picture.pictureType) || Number(picture.pictureType) < 0 || Number(picture.pictureType) > 20) throw new RangeError('Invalid artwork picture type.');
		// eslint-disable-next-line no-control-regex
		if (typeof picture.description !== 'string' || picture.description.length > 4096 || /[\u0000-\u001f\u007f]/u.test(picture.description)) throw new RangeError('Invalid artwork description.');
		if (descriptions.has(picture.description)) throw new RangeError('Each artwork picture requires a unique description.');
		descriptions.add(picture.description);
		if (typeof picture.data !== 'string' || picture.data.length > Math.ceil(MAXIMUM_IMAGE_BYTES / 3) * 4
			|| !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(picture.data)) throw new RangeError('Invalid artwork data.');
		const bytes = decodeArtworkData(picture.data);
		if (bytes.length < 4 || bytes.length > MAXIMUM_IMAGE_BYTES) throw new RangeError('Artwork exceeds the 4 MiB picture limit.');
		const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
		const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
		if (picture.mimeType === 'image/png' ? !png : !jpeg) throw new RangeError('Artwork bytes do not match their image type.');
		const type = Number(picture.pictureType);
		if (type === 1 || type === 2) {
			if (icons.has(type)) throw new RangeError('Only one artwork icon of each type is allowed.');
			icons.add(type);
			if (type === 1 && (!png || bytes.length < 24 || new DataView(bytes.buffer).getUint32(16) !== 32
				|| new DataView(bytes.buffer).getUint32(20) !== 32)) throw new RangeError('The ID3 file icon requires a 32 × 32 PNG.');
		}
		total += bytes.length;
		if (total > MAXIMUM_TOTAL_BYTES) throw new RangeError('Artwork exceeds the 8 MiB total limit.');
		return { mimeType: picture.mimeType, pictureType: Number(picture.pictureType), description: picture.description, data: picture.data };
	});
}

export function decodeArtworkData(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export async function createId3Artwork(file: File): Promise<Id3Artwork> {
	if (file.size > MAXIMUM_IMAGE_BYTES || (file.type !== 'image/png' && file.type !== 'image/jpeg')) throw new RangeError('Artwork must be PNG or JPEG, up to 4 MiB.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	return parseId3Artwork([{ mimeType: file.type, pictureType: 3, description: file.name, data: btoa(binary) }])[0]!;
}
