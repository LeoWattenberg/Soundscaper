/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_METADATA_LIMITS_V1, type ImageMetadataIssueV1 } from './image-metadata-model-v1.ts';

export class MetadataReadError extends Error {
	constructor(readonly issue: ImageMetadataIssueV1) { super(issue); }
}

export function failMetadata(issue: ImageMetadataIssueV1): never { throw new MetadataReadError(issue); }

/** Read intrinsic geometry only, then expose an ordinary private view of borrowed bytes. */
export function readMetadataInput(value: unknown): Uint8Array<ArrayBuffer> {
	if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		throw new TypeError('Image metadata requires an intrinsic Uint8Array.');
	}
	for (const field of ['buffer', 'length', 'byteLength', 'byteOffset']) {
		if (Object.hasOwn(value, field)) throw new TypeError('Metadata bytes may not shadow intrinsic geometry.');
	}
	const typed = value as Uint8Array;
	const buffer = typed.buffer;
	const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
	if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || resizable?.call(buffer) === true) {
		throw new TypeError('Image metadata requires a fixed ArrayBuffer.');
	}
	let view: Uint8Array<ArrayBuffer>;
	try { view = new Uint8Array(buffer as ArrayBuffer, typed.byteOffset, typed.byteLength); }
	catch { throw new TypeError('Image metadata buffer is detached.'); }
	if (view.length > IMAGE_METADATA_LIMITS_V1.maximumInputBytes) throw new RangeError('Image metadata input exceeds its byte ceiling.');
	return view;
}

export function checkedRange(bytes: Uint8Array, offset: number, length: number, issue: ImageMetadataIssueV1): void {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > bytes.length - offset) {
		failMetadata(issue);
	}
}

export function matchesBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
	return expected.length <= bytes.length - offset && expected.every((value, index) => bytes[offset + index] === value);
}

export class MetadataBudget {
	private bytes = 0;
	private records = 0;
	addBytes(length: number): void {
		this.bytes += length;
		if (this.bytes > IMAGE_METADATA_LIMITS_V1.maximumMetadataBytes) failMetadata('metadata-limit');
	}
	addRecord(): void {
		this.records++;
		if (this.records > IMAGE_METADATA_LIMITS_V1.maximumContainerRecords) failMetadata('metadata-limit');
	}
}

/** PNG's CRC covers chunk type and data; image decompression is outside this reader. */
export function metadataCrc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
