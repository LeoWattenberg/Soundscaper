/* SPDX-License-Identifier: AGPL-3.0-only */

import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

export interface PhotoCubeLutArchiveSourceV1 {
	withBytes<T>(reference: Readonly<VideoCubeLutReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<T>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeBytes = Uint8Array, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Pin the callable and receiver before any await. Every delivered body is
 * authenticated independently, even if the source claims metadata reuse.
 * One detached raw snapshot is borrowed by the writer and wiped after both
 * source and consumer settle. Parsed arrays have the existing V27 lifetime. */
export function borrowPhotoCubeLutArchiveSourceV1(source: PhotoCubeLutArchiveSourceV1 | undefined, signal?: AbortSignal) {
	const withBytes = source?.withBytes;
	if (withBytes !== undefined && typeof withBytes !== 'function') throw new TypeError('A LUT body capability is required.');
	return async (reference: Readonly<VideoCubeLutReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>): Promise<void> => {
		if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		if (!source || typeof withBytes !== 'function') throw new ReferenceError('The archive requires exact LUT bodies.');
		let live = true, called = false, work: Promise<void> | undefined;
		let raw: Uint8Array<ArrayBuffer> | undefined, backing: ArrayBuffer | undefined;
		const accept = (bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
			if (!live || called) return Promise.reject(new Error('LUT body delivery is retired or repeated.'));
			called = true;
			work = withCubeLutResourceV1({ reference, bytes, signal }, async () => {
				raw = new NativeBytes(photoPackByteView(bytes)); backing = raw.buffer;
				await consume(raw);
			});
			void work.catch(() => undefined); return work;
		};
		try {
			const sourceResult = await Promise.resolve().then(() => Reflect.apply(withBytes, source, [reference, accept, { signal }]))
				.then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
			live = false;
			const bodyResult = work === undefined ? undefined : await work.then(() => ({ failed: false as const }),
				(error: unknown) => ({ failed: true as const, error }));
			if (sourceResult.failed && bodyResult?.failed && !Object.is(sourceResult.error, bodyResult.error)) {
				throw new AggregateError([bodyResult.error, sourceResult.error], 'LUT body delivery and source retirement failed.', { cause: bodyResult.error });
			}
			if (bodyResult?.failed) throw bodyResult.error;
			if (sourceResult.failed) throw sourceResult.error;
			if (!called) throw new Error('The LUT source completed without its body.');
			if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		} finally {
			live = false;
			if (raw && backing && Reflect.apply(SIZE, backing, []) !== 0) Reflect.apply(FILL, new NativeBytes(backing), [0]);
		}
	};
}
