/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord, readClosedDomainField } from '../../common/editor/closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { captureMaskRasterSourceV1 } from '../../common/editor/imaging/mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { photoPackByteView } from './pack-byte-chunk.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const NativeBytes = Uint8Array, FILL = NativeBytes.prototype.fill;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export function normalizePhotoMaskRasterArchiveReferenceV1(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	const input = readClosedDomainRecord(value, 'archive brush reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
	const reference = normalizeBrushMaskResourceReferenceV1(readClosedDomainField(input, 'storageKey', 'archive brush reference'));
	for (const key of ['sha256', 'width', 'height', 'byteLength'] as const) {
		if (readClosedDomainField(input, key, 'archive brush reference') !== reference[key]) throw new TypeError('Archive brush reference differs from its canonical identity.');
	}
	return reference;
}

/** The selected loader is pinned before yielding. A callback claims delivery
 * before touching its bytes; all child and source outcomes join before wiping.
 * Repeated delivery cannot be swallowed into an apparent source success. */
export function borrowPhotoMaskRasterArchiveSourceV1(source: MaskRasterSourcePortV1 | undefined, signal?: AbortSignal) {
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const captured = source === undefined ? undefined : captureMaskRasterSourceV1(source);
	return async (value: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>): Promise<void> => {
		if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		const reference = normalizePhotoMaskRasterArchiveReferenceV1(value);
		if (typeof consume !== 'function') throw new TypeError('A scoped mask body consumer is required.');
		if (!captured) throw new ReferenceError('The archive requires exact brush mask bodies.');
		let live = true, called = false, work: Promise<void> | undefined;
		let raw: Uint8Array<ArrayBuffer> | undefined, backing: ArrayBuffer | undefined;
		let repeated: Error | undefined;
		const accept = (bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
			if (!live || called) {
				const error = live ? repeated ??= new Error('Mask body delivery is repeated.') : new Error('Mask body delivery is retired.');
				const denied = Promise.reject(error); void denied.catch(() => undefined); return denied;
			}
			called = true;
			work = (async () => {
				if (signal !== undefined) Reflect.apply(CHECK, signal, []);
				const view = photoPackByteView(bytes);
				if (view.byteLength !== reference.byteLength) throw new RangeError('Mask body delivery differs from its exact length.');
				raw = new NativeBytes(view); backing = raw.buffer;
				await withBrushMaskResourceV1({ reference, bytes: raw, signal }, async () => { await consume(raw!); });
			})();
			void work.catch(() => undefined); return work;
		};
		try {
			const sourceResult = await Promise.resolve().then(() => captured.withBytes(reference, accept, { signal }))
				.then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
			live = false;
			const bodyResult = work === undefined ? undefined : await work.then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
			const errors: unknown[] = [];
			if (bodyResult?.failed) errors.push(bodyResult.error);
			if (repeated && !errors.some(error => Object.is(error, repeated))) errors.push(repeated);
			if (sourceResult.failed && !errors.some(error => Object.is(error, sourceResult.error))) errors.push(sourceResult.error);
			if (errors.length > 1) throw new AggregateError(errors, 'Mask body delivery and source retirement failed.', { cause: errors[0] });
			if (errors.length === 1) throw errors[0];
			if (!called) throw new Error('The mask source completed without its body.');
			if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		} finally {
			live = false;
			if (raw && backing && Reflect.apply(SIZE, backing, []) !== 0) Reflect.apply(FILL, new NativeBytes(backing), [0]);
		}
	};
}
