/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import type { StorageRepositoryPort } from '../../common/editor/storage/repository-port.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../catalog/photo-mask-raster-reachability-v1.ts';
import { PhotoMaskRasterRepositoryV1, type PhotoMaskRasterOptionsV1, type PhotoMaskRasterReceiptV1 } from './photo-mask-raster-repository-v1.ts';

export interface PhotoMediaMaskRasterResourcesV1 {
	readonly source: Readonly<MaskRasterSourcePortV1>;
	put(reference: unknown, bytes: unknown, options?: PhotoMaskRasterOptionsV1): Promise<Readonly<PhotoMaskRasterReceiptV1>>;
	verifyPhoto(photo: unknown, signal?: AbortSignal): Promise<void>;
	verifyPreset(preset: unknown, signal?: AbortSignal): Promise<void>;
	readonly verifyReferencesV1?: (references: readonly Readonly<BrushMaskResourceReferenceV1>[], signal?: AbortSignal) => Promise<void>;
}
export interface PhotoMediaMaskRasterResourceOwnerV1 {
	readonly resources: Readonly<PhotoMediaMaskRasterResourcesV1>;
	close(): Promise<void>;
}
type Own = <Result>(operation: () => Promise<Result>) => Promise<Result>;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Three fixed borrowers use the selected owner's guarded media DB2 port.
 * Rendering may hold a scope while installation or catalog verification uses
 * its independent single slot. The parent latches and joins each full operation
 * before releasing its existing guard. No queue, deletion, extra connection or
 * retention session is created. Bodies keep their repository component bounds. */
export function createPhotoMediaMaskRasterResourcesV1(
	port: StorageRepositoryPort, own: Own, assertAccepting: () => void,
): Readonly<PhotoMediaMaskRasterResourceOwnerV1> {
	const render = new PhotoMaskRasterRepositoryV1(port), verify = new PhotoMaskRasterRepositoryV1(port), writer = new PhotoMaskRasterRepositoryV1(port);
	let writing = false, verifying = false, closed = false, closing: Promise<void> | null = null;
	const open = () => { assertAccepting(); if (closed) throw new Error('Brush resources are closed.'); };
	const source = Object.freeze<MaskRasterSourcePortV1>({ withBytes: (reference, consume, options) => own(() => {
		open(); return render.withBytes(reference, consume, options);
	}) });
	const resources = Object.freeze<PhotoMediaMaskRasterResourcesV1>({ source,
		put: (reference, bytes, options) => own(async () => {
			open(); if (writing) throw new Error('A brush installation is pending.');
			writing = true;
			try { return await writer.put(reference, bytes, options); } finally { writing = false; }
		}),
		verifyPhoto: (value, signal) => verifyPacket(value, 'photo', signal),
		verifyPreset: (value, signal) => verifyPacket(value, 'preset', signal),
		verifyReferencesV1: (value, signal) => verifyPacket(value, 'references', signal),
	});
	return Object.freeze({ resources, close });

	function verifyPacket(value: unknown, kind: 'photo' | 'preset' | 'references', signal?: AbortSignal): Promise<void> {
		return own(async () => {
			open(); check(signal); if (verifying) throw new Error('Brush writer verification is pending.');
			verifying = true;
			try {
				let references: readonly Readonly<BrushMaskResourceReferenceV1>[];
				if (kind === 'references') references = readClosedDomainArray(value, 'selected brush references', 0, 4_094).map(admitReference);
				else { const collector = createPhotoMaskRasterReachabilityV1();
					if (kind === 'photo') collector.addPhoto(value); else collector.addPreset(value); references = collector.finish(); }
				open(); check(signal);
				for (const reference of references) { await verify.withBytes(reference, () => undefined, { signal }); open(); check(signal); }
			} finally { verifying = false; }
		});
	}
	function close(): Promise<void> {
		if (closing) return closing;
		closed = true;
		closing = Promise.resolve().then(async () => { await Promise.all([render.close(), verify.close(), writer.close()]); });
		return closing;
	}
}

function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	const fields = ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const;
	const input = record(value, 'selected brush reference', fields), reference = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'selected brush reference'));
	for (const key of fields) if (field(input, key, 'selected brush reference') !== reference[key]) throw new TypeError('Selected brush reference differs from its canonical key.');
	return reference;
}
