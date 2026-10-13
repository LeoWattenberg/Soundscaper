/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { ImageBrushMaskAuthoringV1 } from './image-brush-mask-authoring-v1.ts';
import type { BrushMaskHistoryV1, BrushMaskStrokeV1 } from '../../imaging/brush-mask-plane-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../imaging/brush-mask-resource-v1.ts';
import { capturePhotoLibraryDevelopMaskRasterPortV1,
	type PhotoLibraryDevelopMaskRasterAcknowledgementV1, type PhotoLibraryDevelopMaskRasterPortV1 } from '../../photo-library-develop-mask-raster-port-v1.ts';

export interface PhotoLibraryBrushMaskAuthoringOptionsV1 {
	readonly port: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	readonly isCurrent: () => boolean;
	readonly signal?: AbortSignal;
}
export interface PhotoLibraryBrushMaskAuthoringOpenV1 {
	readonly width: number;
	readonly height: number;
	readonly reference?: Readonly<BrushMaskResourceReferenceV1>;
}
export interface PhotoLibraryBrushMaskAuthoringSnapshotV1 {
	readonly width: number;
	readonly height: number;
	readonly history: Readonly<BrushMaskHistoryV1>;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly closed: boolean;
	readonly receipt: Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1> | null;
}
export type PhotoLibraryBrushMaskDisplayV1 = Pick<PhotoLibraryBrushMaskAuthoringSnapshotV1, 'width' | 'height' | 'history'>;


const REF_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);

/** Permanent Photo facade: its capability and genuine catalog acknowledgement
 * remain strict while the neutral owner provides the same joined replay. */
export class PhotoLibraryBrushMaskAuthoringV1 {
	readonly #owner: ImageBrushMaskAuthoringV1<PhotoLibraryDevelopMaskRasterAcknowledgementV1>;
	constructor(options: PhotoLibraryBrushMaskAuthoringOptionsV1) {
		const input = record(options, 'brush authoring options', ['port', 'isCurrent', 'signal'], ['port', 'isCurrent']);
		const current = field(input, 'isCurrent', 'brush authoring options');
		if (typeof current !== 'function') throw new TypeError('Brush authoring requires a current entry check.');
		const port = capturePhotoLibraryDevelopMaskRasterPortV1(field(input, 'port', 'brush authoring options'));
		this.#owner = new ImageBrushMaskAuthoringV1({ port, isCurrent: () => Reflect.apply(current, options, []) === true,
			prepareAcknowledgement: preparePhotoLibraryBrushMaskAcknowledgementV1,
			...(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', 'brush authoring options') as AbortSignal | undefined } : {}) });
	}
	open(request: PhotoLibraryBrushMaskAuthoringOpenV1): Promise<void> { return this.#owner.open(request); }
	snapshot(): Readonly<PhotoLibraryBrushMaskAuthoringSnapshotV1> { return this.#owner.snapshot(); }
	subscribe(listener: (view: Readonly<PhotoLibraryBrushMaskAuthoringSnapshotV1>) => void): () => void { return this.#owner.subscribe(listener); }
	append(stroke: BrushMaskStrokeV1): void { this.#owner.append(stroke); }
	undo(): void { this.#owner.undo(); }
	redo(): void { this.#owner.redo(); }
	withDisplay<Result>(consume: (alpha: Uint8Array<ArrayBuffer>, view: Readonly<PhotoLibraryBrushMaskDisplayV1>) => Result | Promise<Result>): Promise<Result> {
		return this.#owner.withDisplay(consume);
	}
	install(): Promise<Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1>> { return this.#owner.install(); }
	cancelAndJoin(): Promise<void> { return this.#owner.cancelAndJoin(); }
}

function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	if (typeof value === 'string') return normalizeBrushMaskResourceReferenceV1(value);
	const input = record(value, 'brush authoring reference', REF_FIELDS);
	const canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'brush authoring reference'));
	for (const key of REF_FIELDS) if (field(input, key, 'brush authoring reference') !== canonical[key as keyof BrushMaskResourceReferenceV1]) throw new TypeError('Brush reference differs from its canonical identity.');
	return canonical;
}
export function preparePhotoLibraryBrushMaskAcknowledgementV1(value: unknown, expected: Readonly<BrushMaskResourceReferenceV1>): Readonly<PhotoLibraryDevelopMaskRasterAcknowledgementV1> {
	const input = record(value, 'brush installation acknowledgment', ['schemaVersion', 'catalogId', 'reference', 'created', 'notices']);
	const catalogId = field(input, 'catalogId', 'brush installation acknowledgment'), created = field(input, 'created', 'brush installation acknowledgment');
	if (field(input, 'schemaVersion', 'brush installation acknowledgment') !== 1 || typeof catalogId !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(catalogId) || typeof created !== 'boolean') throw new TypeError('Brush installation acknowledgment is invalid.');
	const reference = admitReference(field(input, 'reference', 'brush installation acknowledgment'));
	if (reference.storageKey !== expected.storageKey) throw new TypeError('Brush installation acknowledged another body.');
	const notices = array(field(input, 'notices', 'brush installation acknowledgment'), 'brush installation notices', 0, 1).map((value): 'cleanup-failed' => {
		if (value !== 'cleanup-failed') throw new TypeError('Brush installation notice is unsupported.'); return value;
	});
	return Object.freeze({ schemaVersion: 1, catalogId, reference, created, notices: Object.freeze(notices) });
}
