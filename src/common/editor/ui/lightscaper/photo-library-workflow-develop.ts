/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortV2 } from '../../photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import { capturePhotoLibraryDevelopMaskRasterPortV1 } from '../../photo-library-develop-mask-raster-port-v1.ts';

export interface PhotoDevelopExecutionContextCurrent {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<Readonly<PhotoLibraryDevelopPortV2>>;
	readonly isCurrent: () => boolean;
	readonly refresh: () => Promise<unknown>;
}
export type ExecutePhotoDevelopCurrent = (action: (context: PhotoDevelopExecutionContextCurrent) => Promise<void>, signal?: AbortSignal) => Promise<unknown>;
const nativeCheck = AbortSignal.prototype.throwIfAborted;

/** Detach capability fields once; callable metadata is never part of admission. */
export function capturePhotoLibraryDevelopPortV2(owner: Readonly<PhotoLibraryDevelopPortV2>, signal?: AbortSignal): Readonly<PhotoLibraryDevelopPortV2> {
	const check = () => { if (signal) Reflect.apply(nativeCheck, signal, []); };
	check();
	try {
		if (owner.schemaVersion !== 2) throw new RangeError('Photo develop requires the fixed current contract.');
		const read = pin(owner, 'read'), apply = pin(owner, 'apply');
		const settings = owner.settings, presets = owner.presets, original = owner.original, maskRasters = owner.maskRasters;
		const port = Object.freeze({ schemaVersion: 2 as const, read, apply,
			...(maskRasters === undefined ? {} : { maskRasters: capturePhotoLibraryDevelopMaskRasterPortV1(maskRasters) }),
			...(settings ? { settings: Object.freeze({ copy: pin(settings, 'copy'), merge: pin(settings, 'merge'),
				adjust: pin(settings, 'adjust'), applyBatch: pin(settings, 'applyBatch') }) } : {}),
			...(presets ? { presets: Object.freeze({ create: pin(presets, 'create'), parse: pin(presets, 'parse'), serialize: pin(presets, 'serialize'),
				list: pin(presets, 'list'), read: pin(presets, 'read'), write: pin(presets, 'write') }) } : {}),
			...(original ? { original: Object.freeze({ withFrame: pin(original, 'withFrame') }) } : {}) });
		check(); return port;
	} catch (error) { check(); throw error; }
}

export function capturePhotoLibraryDevelopOriginalPortV1(owner: Readonly<PhotoLibraryDevelopOriginalPortV1>): Readonly<PhotoLibraryDevelopOriginalPortV1> {
	return Object.freeze({ withFrame: pin(owner, 'withFrame') });
}

function pin<Owner, Key extends keyof Owner>(owner: Owner, key: Key): Owner[Key] {
	const method = owner[key];
	if (typeof method !== 'function') throw new TypeError('Photo develop capability is unavailable.');
	return ((...args: unknown[]) => Reflect.apply(method, owner, args) as unknown) as unknown as Owner[Key];
}
