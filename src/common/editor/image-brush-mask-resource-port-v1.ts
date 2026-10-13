/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { BrushMaskResourceReferenceV1 } from './imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';
import type { ImageDevelopStateCurrentV1 } from './imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopFrameViewV1 } from './imaging/image-develop-frame-core.ts';
import type { ImageDevelopMaskOverlaySelectionV1 } from './imaging/image-develop-mask-overlay-v1.ts';

/** Storage acknowledgement only; the selected product owns any recipe edit. */
export interface ImageBrushMaskResourceAcknowledgementV1 {
	readonly schemaVersion: 1;
	readonly reference: Readonly<BrushMaskResourceReferenceV1>;
	readonly created: boolean;
	readonly notices: readonly 'cleanup-failed'[];
}
export interface ImageBrushMaskResourcePortV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1 = ImageBrushMaskResourceAcknowledgementV1> {
	readonly schemaVersion: 1;
	readonly source: Readonly<MaskRasterSourcePortV1>;
	install(reference: unknown, bytes: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Receipt>>;
}
export interface ImageBrushMaskDraftFrameRequestV1 {
	readonly develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly reference: Readonly<BrushMaskResourceReferenceV1>;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
}
/** A temporary authenticated brush body is borrowed inside the callback scope;
 * it is never installed or serialized merely to present an unpublished stroke. */
export type WithImageBrushMaskDraftFrameV1 = <Result>(request: Readonly<ImageBrushMaskDraftFrameRequestV1>,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<Result>;
export type WithImageBrushDraftFrameV1 = WithImageBrushMaskDraftFrameV1;

/** Capture exact own data capabilities and their actual receivers before work
 * yields. Product-specific fields are validated by that product's adapter. */
export function captureImageBrushMaskResourcePortV1<Receipt extends ImageBrushMaskResourceAcknowledgementV1>(value: unknown): Readonly<ImageBrushMaskResourcePortV1<Receipt>> {
	const input = record(value, 'image brush capability', ['schemaVersion', 'source', 'install']);
	if (field(input, 'schemaVersion', 'image brush capability') !== 1) throw new RangeError('Unsupported image brush capability version.');
	const install = field(input, 'install', 'image brush capability'), receiver = field(input, 'source', 'image brush capability');
	const source = record(receiver, 'image brush source', ['withBytes']), withBytes = field(source, 'withBytes', 'image brush source');
	if (typeof install !== 'function' || typeof withBytes !== 'function') throw new TypeError('Image brush capabilities must be callable.');
	return Object.freeze<ImageBrushMaskResourcePortV1<Receipt>>({ schemaVersion: 1,
		source: Object.freeze<MaskRasterSourcePortV1>({ withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>,
			consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			return Reflect.apply(withBytes, receiver, [reference, consume, options]) as Promise<Result>;
		} }),
		install: (...args) => Reflect.apply(install, value, args) as Promise<Readonly<Receipt>>,
	});
}
