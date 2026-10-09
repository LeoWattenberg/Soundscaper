/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { id } from '../catalog/value-validation.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { normalizePhotoDevelopPresetRowV1, PHOTO_DEVELOP_PRESETS_LIMITS_V1, type PhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

export const PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1 = Object.freeze({ maximumPackBytes: PHOTO_DEVELOP_PRESETS_LIMITS_V1.maximumRowBytes,
	maximumChunkBytes: 4 * 1024 * 1024, outputChunkBytes: 64 * 1024 });
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Eager closed admission detaches the row before the first borrowed asynchronous write. */
export function encodePhotoDevelopPresetPackV1(value: unknown, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): AsyncIterable<Uint8Array> {
	const { signal } = readPhotoStackSignalOptionsV1(options); check(signal);
	const row = normalizePhotoDevelopPresetRowV1(value, catalogId), bytes = new TextEncoder().encode(JSON.stringify(row));
	return emit();
	async function* emit() {
		for (let offset = 0; offset < bytes.byteLength; offset += PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1.outputChunkBytes) {
			check(signal); yield bytes.slice(offset, offset + PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1.outputChunkBytes);
		}
		check(signal);
	}
}

/** One at-most10MiB row, strict streaming UTF8, intrinsic chunks and joined source retirement. */
export async function readPhotoDevelopPresetPackV1(source: AsyncIterable<Uint8Array>, catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDevelopPresetRowV1> {
	const catalog = id(catalogId, 'preset pack catalog ID'), { signal } = readPhotoStackSignalOptionsV1(options); check(signal);
	const iterate = source?.[Symbol.asyncIterator];
	if (typeof iterate !== 'function') throw new TypeError('Develop preset pack requires an asynchronous byte source.');
	const iterator = iterate.call(source), next = iterator.next.bind(iterator), leave = iterator.return?.bind(iterator);
	const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
	let total = 0, text = '', done = false, failed = false, failure: unknown, result: PhotoDevelopPresetRowV1 | undefined;
	try {
		for (;;) {
			check(signal); const item = await next(); check(signal);
			if (item.done) { done = true; break; }
			const bytes = photoPackByteView(item.value);
			if (bytes.byteLength < 1 || bytes.byteLength > PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1.maximumChunkBytes) throw new RangeError('Develop preset pack emission exceeds its chunk bound.');
			if (bytes.byteLength > PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1.maximumPackBytes - total) throw new RangeError('Develop preset pack exceeds its byte bound.');
			total += bytes.byteLength; text += decoder.decode(bytes, { stream: true });
		}
		text += decoder.decode();
		result = normalizePhotoDevelopPresetRowV1(JSON.parse(text) as unknown, catalog);
		check(signal);
	} catch (error) { failed = true; failure = error; }
	const cleanup: unknown[] = [];
	if (!done && leave) { try { await leave(); } catch (error) { cleanup.push(error); } }
	const primaryIsAbort = signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true && Object.is(failure, Reflect.apply(nativeReason, signal, []));
	if (failed) throw aggregateScapeErrors(failure, cleanup, 'Develop preset pack decoding and source retirement failed.',
		primaryIsAbort ? { primaryIsAbort: true } : undefined);
	if (cleanup.length) throw cleanup[0]; return result!;
}
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeAbort, signal, []); }
