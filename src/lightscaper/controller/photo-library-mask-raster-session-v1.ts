/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { captureMaskRasterSourceV1 } from '../../common/editor/imaging/mask-raster-source-scope-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from '../storage/photo-media-mask-raster-resources-v1.ts';
import type { PhotoLibrarySessionLifetime } from './photo-library-session-lifetime.ts';

interface Host {
	readonly ready: () => Promise<string>;
	readonly operation: PhotoLibrarySessionLifetime['operation'];
	readonly resources?: (() => Promise<Readonly<PhotoMediaMaskRasterResourcesV1>>) | undefined;
}
const REFERENCE_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Read-only forwarding through the existing selected Session operation and
 * readiness owners. No borrower, connection, queue or closing owner is added.
 * Capture the loader before readiness and each actual source before borrowing. */
export function createPhotoLibraryMaskRasterSourceV1(host: Host): Readonly<MaskRasterSourcePortV1> {
	const ready = host.ready, operation = host.operation, resources = host.resources;
	if (typeof ready !== 'function' || typeof operation !== 'function'
		|| (resources !== undefined && typeof resources !== 'function')) throw new TypeError('Selected brush source requires callable Session capabilities.');
	return Object.freeze<MaskRasterSourcePortV1>({ withBytes<Result>(input: Readonly<BrushMaskResourceReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
		let signal: AbortSignal | undefined;
		try { signal = readPhotoDevelopSignalOptionsV2(options === undefined ? {} : options).signal; }
		catch (error) { return Promise.reject(error); }
		let reference!: Readonly<BrushMaskResourceReferenceV1>;
		return Reflect.apply(operation, host, [async (admitted: AbortSignal) => {
			await (Reflect.apply(ready, host, []) as Promise<string>); check(admitted);
			if (!resources) throw new Error('Selected brush resources are unavailable.');
			const selected: unknown = await Reflect.apply(resources, host, []); check(admitted);
			const source = captureSelectedSource(selected); check(admitted);
			const result = await source.withBytes(reference, consume, { signal: admitted }); check(admitted); return result;
		}, signal, () => {
			if (typeof consume !== 'function') throw new TypeError('Selected brush bytes require a callable consumer.');
			const value = record(input, 'selected brush reference', REFERENCE_FIELDS);
			const canonical = normalizeBrushMaskResourceReferenceV1(field(value, 'storageKey', 'selected brush reference'));
			for (const key of REFERENCE_FIELDS) if (field(value, key, 'selected brush reference') !== canonical[key as keyof BrushMaskResourceReferenceV1]) {
				throw new TypeError('Selected brush reference differs from its canonical storage key.');
			}
			reference = canonical;
		}]) as Promise<Result>;
	} });
}

function captureSelectedSource(value: unknown): Readonly<MaskRasterSourcePortV1> {
	if (value === null || typeof value !== 'object') throw new TypeError('Selected brush resources require their own source.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'source');
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Selected brush resources require an own data source.');
	return captureMaskRasterSourceV1(descriptor.value);
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
