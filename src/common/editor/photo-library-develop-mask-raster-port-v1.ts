/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { BrushMaskResourceReferenceV1 } from './imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';

export interface PhotoLibraryDevelopMaskRasterAcknowledgementV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly reference: Readonly<BrushMaskResourceReferenceV1>;
	readonly created: boolean;
	readonly notices: readonly 'cleanup-failed'[];
}

/** Immutable installation in the current selected media owner. The receipt
 * acknowledges that owner's storage profile, without promising native storage
 * for its degraded memory fallback. Photo history remains a separate Save. */
export interface PhotoLibraryDevelopMaskRasterPortV1 {
	readonly schemaVersion: 1;
	readonly source: Readonly<MaskRasterSourcePortV1>;
	install(reference: unknown, bytes: unknown, options?: Readonly<{ signal?: AbortSignal }>):
		Promise<Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1>>;
}

/** Pin own capabilities and their real receivers without inspecting callable
 * metadata or importing the resource parser into eager UI capture paths. */
export function capturePhotoLibraryDevelopMaskRasterPortV1(value: unknown): Readonly<PhotoLibraryDevelopMaskRasterPortV1> {
	const input = record(value, 'Develop brush capability', ['schemaVersion', 'source', 'install']);
	if (field(input, 'schemaVersion', 'Develop brush capability') !== 1) throw new RangeError('Unsupported Develop brush capability version.');
	const install = field(input, 'install', 'Develop brush capability');
	const receiver = field(input, 'source', 'Develop brush capability');
	const source = record(receiver, 'Develop brush source', ['withBytes']);
	const withBytes = field(source, 'withBytes', 'Develop brush source');
	if (typeof install !== 'function' || typeof withBytes !== 'function') throw new TypeError('Develop brush capabilities must be callable.');
	return Object.freeze<PhotoLibraryDevelopMaskRasterPortV1>({ schemaVersion: 1,
		source: Object.freeze<MaskRasterSourcePortV1>({ withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
			consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			return Reflect.apply(withBytes, receiver, [reference, consume, options]) as Promise<Result>;
		} }),
		install: (...args) => Reflect.apply(install, value, args) as Promise<Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1>>,
	});
}
