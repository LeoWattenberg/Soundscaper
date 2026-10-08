/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from './photo-library-catalog-pointer.ts';
import { readPhotoLibraryLocationPointerV2, resolvePhotoLibraryLocationV2,
	type PhotoLibraryLocationPointer, type PhotoLibraryLocationV2 } from './photo-library-location-v2.ts';
import { normalizePhotoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1,
	resolveCommittedPhotoLibraryLocationV2 } from './photo-library-restore-journal-v1.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';

export interface PhotoLibrarySessionLocationV2 {
	readonly pointer: PhotoLibraryLocationPointer;
	readonly location: Readonly<PhotoLibraryLocationV2>;
	readonly allocation: Readonly<PhotoLibraryRestoreAllocationV1> | null;
}
export interface PhotoLibraryLocationReaderPortsV2 {
	readonly settings: Readonly<Pick<KeyValueRepository, 'get'>>;
	readonly initializeDefault: () => Promise<unknown>;
}
const check = AbortSignal.prototype.throwIfAborted;

/** Borrowed fixed-anchor reader, under the initializer lease; selected resources do not exist yet. */
export async function readPhotoLibrarySessionLocationV2(ports: PhotoLibraryLocationReaderPortsV2,
	signal?: AbortSignal): Promise<Readonly<PhotoLibrarySessionLocationV2>> {
	const read = ports.settings.get.bind(ports.settings), initialize = ports.initializeDefault.bind(ports);
	if (signal) Reflect.apply(check, signal, []);
	const current = await read(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1);
	if (signal) Reflect.apply(check, signal, []);
	const selected = current === undefined ? await initialize() : current;
	if (signal) Reflect.apply(check, signal, []);
	const pointer = readPhotoLibraryLocationPointerV2(selected);
	if (pointer.schemaVersion === 1) return Object.freeze({ pointer, location: resolvePhotoLibraryLocationV2(pointer), allocation: null });
	if (signal) Reflect.apply(check, signal, []);
	const rawHistory = await read(photoLibraryRestoreCommitKeyV1(pointer.namespaceToken));
	if (signal) Reflect.apply(check, signal, []);
	const history = normalizePhotoLibraryRestoreCommitV1(rawHistory);
	return Object.freeze({ pointer, location: resolveCommittedPhotoLibraryLocationV2(pointer, history), allocation: history.allocation });
}
