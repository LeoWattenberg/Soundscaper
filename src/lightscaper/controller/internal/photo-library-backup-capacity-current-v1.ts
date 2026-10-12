/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_CATALOG_ARCHIVE_LIMITS_V1 } from '../../archive/catalog-archive-contract.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V4 } from '../../archive/catalog-pack-v4.ts';
import { measurePhotoStackPackRecordV1, PHOTO_STACK_PACK_LIMITS_V1 } from '../../archive/stack-pack.ts';
import { measurePhotoSmartCollectionPackRecordV1, PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 } from '../../archive/smart-collection-pack-v1.ts';
import type { PhotoStackV1 } from '../../catalog/photo-stack-v1.ts';
import type { PhotoSmartCollectionV1 } from '../../catalog/photo-smart-collection-v1.ts';

type PackKind = 'photo' | 'stack' | 'saved-collection';
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Match each owning sequence's ordered byte/count partition. Only scalars
 * survive; an empty sequence has no pack, and every real pack has eight magic bytes. */
export function createPhotoLibraryBackupPackCounterCurrentV1(kind: PackKind) {
	if (kind !== 'photo' && kind !== 'stack' && kind !== 'saved-collection') throw new RangeError('Unsupported archive capacity pack kind.');
	const limits = kind === 'photo' ? PHOTO_CATALOG_PACK_LIMITS_V4 : kind === 'stack' ? PHOTO_STACK_PACK_LIMITS_V1 : PHOTO_SMART_COLLECTION_PACK_LIMITS_V1;
	let packs = 0, bytes = 8, records = 0, sealed = false;
	return Object.freeze({ add(recordBytes: number): void {
		if (sealed) throw new TypeError('Archive capacity pack counter is sealed.');
		if (!Number.isSafeInteger(recordBytes) || recordBytes < 1 || recordBytes + 8 > limits.maximumPackBytes) {
			throw new RangeError('Archive capacity record cannot fit its owning pack.');
		}
		if (packs === 0 || records >= limits.maximumRecords || bytes + recordBytes > limits.maximumPackBytes) {
			if (++packs > PHOTO_CATALOG_ARCHIVE_LIMITS_V1.maximumPacks) throw new RangeError('Archive pack capacity exceeds its asset slots.');
			bytes = 8; records = 0;
		}
		bytes += recordBytes; records++;
	}, finish(): number { sealed = true; return packs; } });
}

/** Companion metadata is independently captured and drained before body IO.
 * The writer retains its separate original saved-source one-shot proof. */
export async function assertPhotoLibraryBackupCapacityCurrentV1(photoPacks: number, resourceCount: number, presetPresent: boolean,
	stacks: AsyncIterable<PhotoStackV1>, definitions: AsyncIterable<PhotoSmartCollectionV1>, signal?: AbortSignal): Promise<void> {
	check(signal);
	for (const count of [photoPacks, resourceCount]) if (!Number.isSafeInteger(count) || count < 0 || count > PHOTO_CATALOG_ARCHIVE_LIMITS_V1.maximumPacks) {
		throw new RangeError('Archive capacity requires bounded admitted asset counts.');
	}
	const stackPacks = createPhotoLibraryBackupPackCounterCurrentV1('stack'), savedPacks = createPhotoLibraryBackupPackCounterCurrentV1('saved-collection');
	for await (const stack of stacks) { check(signal); stackPacks.add(measurePhotoStackPackRecordV1(stack)); check(signal); }
	for await (const definition of definitions) { check(signal); savedPacks.add(measurePhotoSmartCollectionPackRecordV1(definition)); check(signal); }
	const total = photoPacks + resourceCount + (presetPresent ? 1 : 0) + stackPacks.finish() + savedPacks.finish();
	if (total > PHOTO_CATALOG_ARCHIVE_LIMITS_V1.maximumPacks) throw new RangeError('Archive asset slot capacity is exceeded by its complete pack and resource inventory.');
	check(signal);
}
