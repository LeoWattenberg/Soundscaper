/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { BRUSH_MASK_RESOURCE_LIMITS_V1, normalizeBrushMaskResourceReferenceV1,
	type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1, PhotoLibraryDevelopMaskRasterAcknowledgementV1 } from '../../common/editor/photo-library-develop-mask-raster-port-v1.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from '../storage/photo-media-mask-raster-resources-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';

interface Host {
	readonly source: Readonly<MaskRasterSourcePortV1>;
	readonly resources: () => Promise<Readonly<PhotoMediaMaskRasterResourcesV1>>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>,
		signal?: AbortSignal, admit?: () => void) => Promise<Result>;
}
const REFERENCE_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);
const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;

/** Borrows the current Session's single writer, selected readiness and lease.
 * The writer claims before reflection/copy; no queue or storage owner is added.
 * The one private encoded body is bounded by 1MiB+16 and wiped on the entire
 * mutation's settlement, including admission/readiness failures before run. */
export function createPhotoLibraryDevelopMaskRasterSessionV1(host: Host): Readonly<PhotoLibraryDevelopMaskRasterPortV1> {
	const source = host.source, resources = host.resources, mutate = host.mutate;
	if (typeof resources !== 'function' || typeof mutate !== 'function') throw new TypeError('Develop brush installation requires selected Session capabilities.');
	return Object.freeze<PhotoLibraryDevelopMaskRasterPortV1>({ schemaVersion: 1, source,
		install(referenceValue, bytesValue, options) {
			let signal: AbortSignal | undefined;
			try { signal = readPhotoDevelopSignalOptionsV2(options === undefined ? {} : options).signal; }
			catch (error) { return Promise.reject(error); }
			const captured: { reference?: Readonly<BrushMaskResourceReferenceV1>; bytes?: Uint8Array<ArrayBuffer>;
				backing?: ArrayBuffer; completed?: Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1> } = {};
			const wipe = () => {
				if (captured.bytes && captured.backing && Reflect.apply(SIZE, captured.backing, []) > 0) Reflect.apply(FILL, captured.bytes, [0]);
			};
			let work: Promise<Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1>>;
			try {
				work = Reflect.apply(mutate, host, [async (catalogId: string, admitted: AbortSignal) => {
					const selected: unknown = await Reflect.apply(resources, host, []); check(admitted);
					if (selected === null || typeof selected !== 'object') throw new TypeError('Selected brush resources are unavailable.');
					const descriptor = Object.getOwnPropertyDescriptor(selected, 'put');
					if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
						throw new TypeError('Selected brush storage requires an own callable installation method.');
					}
					check(admitted);
					const stored: unknown = await Reflect.apply(descriptor.value, selected, [captured.reference!, captured.bytes!, { signal: admitted }]);
					// Native immutable insertion has completed. Capture its ACK before
					// the surrounding selected lease can reject during cleanup.
					const receipt = record(stored, 'stored brush acknowledgement', ['reference', 'created']);
					const reference = admitReference(field(receipt, 'reference', 'stored brush acknowledgement'));
					for (const key of REFERENCE_FIELDS) if (reference[key as keyof BrushMaskResourceReferenceV1] !== captured.reference![key as keyof BrushMaskResourceReferenceV1]) {
						throw new TypeError('Stored brush acknowledgement differs from the admitted reference.');
					}
					const created = field(receipt, 'created', 'stored brush acknowledgement');
					if (typeof created !== 'boolean') throw new TypeError('Stored brush acknowledgement requires an insertion result.');
					captured.completed = Object.freeze({ schemaVersion: 1, catalogId, reference, created, notices: Object.freeze([]) });
					return captured.completed;
				}, signal, () => {
					captured.reference = admitReference(referenceValue);
					captured.bytes = copyBytes(bytesValue, captured.reference.byteLength);
					captured.backing = Reflect.apply(BUFFER, captured.bytes, []) as ArrayBuffer;
				}]) as Promise<Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1>>;
			} catch (error) { wipe(); return Promise.reject(error); }
			// Attach synchronously, even when admission reenters Close. The wipe
			// runs before Close's joined-operation continuation releases resources.
			return work.then(result => { wipe(); return result; }, error => {
				wipe();
				if (!captured.completed) throw error;
				return Object.freeze({ ...captured.completed, notices: Object.freeze(['cleanup-failed'] as const) });
			});
		},
	});
}

function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	if (typeof value === 'string') return normalizeBrushMaskResourceReferenceV1(value);
	const input = record(value, 'Develop brush reference', REFERENCE_FIELDS);
	const canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'Develop brush reference'));
	for (const key of REFERENCE_FIELDS) if (field(input, key, 'Develop brush reference') !== canonical[key as keyof BrushMaskResourceReferenceV1]) {
		throw new TypeError('Develop brush reference differs from its canonical storage key.');
	}
	return canonical;
}
function copyBytes(value: unknown, length: number): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('Develop brush bodies require native bytes.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value as object, key)) throw new TypeError('Develop brush bytes may not shadow geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	if (length < 1 || length > BRUSH_MASK_RESOURCE_LIMITS_V1.maximumBodyBytes || Reflect.apply(RESIZABLE, buffer, []) !== false
		|| Reflect.apply(SIZE, buffer, []) !== length || Reflect.apply(LENGTH, value, []) !== length || Reflect.apply(OFFSET, value, []) !== 0) {
		throw new RangeError('Develop brush bytes require their exact bounded fixed backing.');
	}
	const bytes = new NativeBytes(length); Reflect.apply(SET, bytes, [new NativeBytes(buffer)]); return bytes;
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
