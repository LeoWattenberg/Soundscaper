/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { captureImageExportGraphicRequest, type ImageExportGraphicRequest } from '../../common/editor/image-export-graphic-request.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { canonicalMediaContentBlob, MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../../common/editor/storage/media-content-digest.ts';

/** Persisted placement and content identity confer no file or decoder authority. */
export interface PhotoRasterBatchGraphicIntentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-raster-batch-graphic';
	readonly contentSha256: string;
	readonly byteLength: number;
	readonly anchor: ImageExportGraphicRequest['anchor'];
	readonly widthFraction: number;
	readonly marginFraction: number;
	readonly opacity: number;
}
export interface PreparedPhotoRasterBatchGraphicV1 {
	readonly intent: Readonly<PhotoRasterBatchGraphicIntentV1>;
	readonly request: Readonly<ImageExportGraphicRequest>;
}
interface Options { readonly signal?: AbortSignal }
const PREPARED = new WeakMap<object, Readonly<PreparedPhotoRasterBatchGraphicV1>>();
const READ = Blob.prototype.arrayBuffer;
const SLICE = Blob.prototype.slice;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;
const CHECK = AbortSignal.prototype.throwIfAborted;
const SIGNAL_PROTOTYPE = AbortSignal.prototype;

export function normalizePhotoRasterBatchGraphicIntentV1(value: unknown): Readonly<PhotoRasterBatchGraphicIntentV1> {
	const label = 'Photo batch graphic intent', input = record(value, label,
		['schemaVersion', 'kind', 'contentSha256', 'byteLength', 'anchor', 'widthFraction', 'marginFraction', 'opacity']);
	if (field(input, 'schemaVersion', label) !== 1 || field(input, 'kind', label) !== 'photo-raster-batch-graphic') {
		throw new RangeError('Unsupported photo batch graphic intent.');
	}
	const contentSha256 = field(input, 'contentSha256', label), byteLength = field(input, 'byteLength', label), anchor = field(input, 'anchor', label);
	if (typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) throw new TypeError('Photo batch graphic requires a lowercase SHA-256 fingerprint.');
	if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes) {
		throw new RangeError('Photo batch graphic exceeds its nonempty image byte bound.');
	}
	if (typeof anchor !== 'string' || !/^(?:top|middle|bottom)-(?:left|center|right)$/u.test(anchor)) throw new RangeError('Unsupported photo batch graphic anchor.');
	const unit = (key: string, minimum: number, maximum: number) => {
		const value = field(input, key, label);
		if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError('Check the batch graphic size, margin and opacity.');
		return value;
	};
	return Object.freeze({ schemaVersion: 1, kind: 'photo-raster-batch-graphic', contentSha256, byteLength,
		anchor: anchor as ImageExportGraphicRequest['anchor'], widthFraction: unit('widthFraction', Number.MIN_VALUE, 1),
		marginFraction: unit('marginFraction', 0, 0.49), opacity: unit('opacity', 0, 1) });
}

/** Capture placement and immutable native bytes before the first hash read. */
export async function preparePhotoRasterBatchGraphicV1(requestValue: unknown, options: Options = {}): Promise<Readonly<PreparedPhotoRasterBatchGraphicV1>> {
	const signal = captureSignal(options), captured = captureImageExportGraphicRequest(requestValue);
	const request = Object.freeze({ ...captured, body: Object.freeze(canonicalMediaContentBlob(captured.body)) });
	const contentSha256 = await hash(request.body, signal);
	if (signal !== undefined) Reflect.apply(CHECK, signal, []);
	return issue(request, normalizePhotoRasterBatchGraphicIntentV1({ schemaVersion: 1, kind: 'photo-raster-batch-graphic', contentSha256,
		byteLength: Reflect.apply(SIZE, request.body, []) as number, anchor: request.anchor, widthFraction: request.widthFraction,
		marginFraction: request.marginFraction, opacity: request.opacity }));
}

/** Reselection proves bytes independently of filename and uses saved placement. */
export async function reselectPhotoRasterBatchGraphicV1(intentValue: unknown, body: Blob, options: Options = {}): Promise<Readonly<PreparedPhotoRasterBatchGraphicV1>> {
	const signal = captureSignal(options), intent = normalizePhotoRasterBatchGraphicIntentV1(intentValue);
	const request = captureImageExportGraphicRequest({ body: Object.freeze(canonicalMediaContentBlob(body)), anchor: intent.anchor,
		widthFraction: intent.widthFraction, marginFraction: intent.marginFraction, opacity: intent.opacity });
	if (Reflect.apply(SIZE, request.body, []) !== intent.byteLength) throw new Error('Reselected batch graphic length changed.');
	if (await hash(request.body, signal) !== intent.contentSha256) throw new Error('Reselected batch graphic SHA-256 fingerprint changed.');
	if (signal !== undefined) Reflect.apply(CHECK, signal, []);
	return issue(request, intent);
}

/** Only this owner's issued identity can authorize an ephemeral selected body.
 * Looking up identity invokes no getter or Proxy trap and never trusts a clone. */
export function capturePreparedPhotoRasterBatchGraphicV1(value: unknown): Readonly<PreparedPhotoRasterBatchGraphicV1> {
	const prepared = value && typeof value === 'object' ? PREPARED.get(value) : undefined;
	if (!prepared) throw new TypeError('Photo batch graphic requires an owner-prepared proof.');
	return prepared;
}

function issue(request: Readonly<ImageExportGraphicRequest>, intent: Readonly<PhotoRasterBatchGraphicIntentV1>): Readonly<PreparedPhotoRasterBatchGraphicV1> {
	const prepared = Object.freeze({ intent, request }); PREPARED.set(prepared, prepared); return prepared;
}

function captureSignal(value: unknown): AbortSignal | undefined {
	const input = record(value, 'Photo batch graphic options', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Photo batch graphic options') : undefined;
	if (signal === undefined) return undefined;
	if (!signal || typeof signal !== 'object' || Object.getPrototypeOf(signal) !== SIGNAL_PROTOTYPE
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Photo batch graphic requires unmodified native cancellation.');
	}
	Reflect.apply(CHECK, signal, []); return signal as AbortSignal;
}

async function hash(body: Blob, signal: AbortSignal | undefined): Promise<string> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); const size = Reflect.apply(SIZE, body, []) as number, digest = sha256.create();
	try {
		for (let start = 0; start < size; start += MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
			check(); const length = Math.min(MEDIA_CONTENT_DIGEST_CHUNK_BYTES, size - start);
			const part = Reflect.apply(SLICE, body, [start, start + length]) as Blob;
			let bytes: Uint8Array<ArrayBuffer> | undefined;
			try {
				let buffer: ArrayBuffer;
				try { buffer = await Reflect.apply(READ, part, []) as ArrayBuffer; } catch (error) { check(); throw error; }
				const actual = Reflect.apply(BUFFER_SIZE, buffer, []) as number;
				bytes = new Uint8Array(buffer); check();
				if (actual !== length) throw new Error('Native batch graphic hash read length changed.');
				digest.update(bytes);
			} finally { if (bytes && Number(Reflect.apply(BYTE_LENGTH, bytes, [])) > 0) Reflect.apply(FILL, bytes, [0]); }
			if (start + length < size) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); }
		}
		check(); return bytesToHex(digest.digest());
	} finally { digest.destroy(); }
}
