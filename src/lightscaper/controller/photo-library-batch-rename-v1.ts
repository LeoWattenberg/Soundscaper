/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBatchRenameItemV1, PhotoLibraryBatchRenamePlanV1, PhotoLibraryBatchRenameReceiptV1,
	PhotoLibraryBatchRenameSnapshotV1, PhotoLibraryBatchRenameUndoItemV1, PhotoLibraryBatchRenameUndoV1 } from '../../common/editor/photo-library-batch-rename-port-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { field, id, record } from '../catalog/value-validation.ts';
import { applyPhotoBatchRenameItemV1, normalizePhotoBatchRenamePlanV1, planPhotoBatchRenameV1 } from './photo-batch-rename-v1.ts';
import { applyPhotoBatchRenameUndoItemV1, checkBatchRenameBytes, normalizePhotoBatchRenameUndoV1, readBatchRenameArray } from './photo-batch-rename-inverse-v1.ts';
import type { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

export const PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1 = 1024 * 1024;
// Even a failed64-item undo must retain all inverse fences inside the receipt.
export const PHOTO_BATCH_RENAME_ERROR_MAXIMUM_UNITS_V1 = 1536;
const SNAPSHOT_MAXIMUM_BYTES = 256 * 1024;
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;

/** Borrow the existing session lifecycle and owner, never create another writer. */
export interface PhotoBatchRenameSessionPortsV1 {
	readonly repository: Pick<PhotoCatalogRepositoryV1, 'loadPhoto'>;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly withPhoto: <Result>(catalogId: string, photoId: string, signal: AbortSignal,
		run: (owner: PhotoCommandOwnerV1, signal: AbortSignal) => Promise<Result>) => Promise<Result>;
}

/** Pure whole-selection expansion; arrays are snapped before legacy plan helpers. */
export function planPhotoLibraryBatchRenameV1(value: unknown): PhotoLibraryBatchRenamePlanV1 {
	const input = record(value, 'photo library batch rename request', ['schemaVersion', 'catalogId', 'selection', 'rename']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo batch rename version.');
	return planPhotoBatchRenameV1({ schemaVersion: 1, catalogId: field(input, 'catalogId'), rename: field(input, 'rename'),
		selection: readBatchRenameArray(field(input, 'selection'), 'batch rename selection') });
}

function admitPlan(value: unknown): PhotoLibraryBatchRenamePlanV1 {
	const input = record(value, 'photo library batch rename plan', ['schemaVersion', 'kind', 'catalogId', 'rename', 'items']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo batch rename version.');
	if (field(input, 'kind') !== 'photo-batch-rename') throw new RangeError('Unsupported photo batch rename kind.');
	return normalizePhotoBatchRenamePlanV1({ schemaVersion: 1, kind: 'photo-batch-rename', catalogId: field(input, 'catalogId'),
		rename: field(input, 'rename'), items: readBatchRenameArray(field(input, 'items'), 'batch rename items') });
}

/** One document per step, only scalar names/revisions survive the point read. */
export async function readPhotoLibraryBatchRenameSelectionV1(ports: PhotoBatchRenameSessionPortsV1, value: unknown, options: unknown = {}): Promise<PhotoLibraryBatchRenameSnapshotV1> {
	const admitted = admitPhotoLibraryQueryBuildRequestV1(options), seen = new Set<string>();
	const selected = readBatchRenameArray(value, 'batch rename photo IDs').map(value => {
		const key = id(value, 'batch rename photo ID');
		if (seen.has(key)) throw new RangeError('Batch rename contains duplicate photo identities.');
		seen.add(key); return key;
	});
	return ports.mutate(async (catalogId, signal) => {
		const selection: PhotoLibraryBatchRenameSnapshotV1['selection'][number][] = [];
		for (let position = 0; position < selected.length; position++) {
			check(signal);
			const key = selected[position]!;
			const value = await ports.repository.loadPhoto(catalogId, key); check(signal);
			if (value === null) throw new ReferenceError('Batch rename photo is missing.');
			const photo = validateLightscaperDocumentV1(value);
			if (photo.kind !== 'photo' || photo.catalogId !== catalogId || photo.id !== key) throw new ReferenceError('Batch rename photo is missing or foreign.');
			selection.push(Object.freeze({ photoId: key, expectedRevision: photo.revision, fileName: photo.metadata.fileName }));
			if (position + 1 < selected.length) await task();
		}
		const snapshot: PhotoLibraryBatchRenameSnapshotV1 = Object.freeze({ schemaVersion: 1, catalogId, selection: Object.freeze(selection) });
		checkBatchRenameBytes(snapshot, SNAPSHOT_MAXIMUM_BYTES, 'Batch rename snapshot'); return snapshot;
	}, admitted.signal);
}

export async function renamePhotoLibraryBatchV1(ports: PhotoBatchRenameSessionPortsV1, value: unknown, options: unknown = {}): Promise<PhotoLibraryBatchRenameReceiptV1> {
	const admitted = admitPhotoLibraryQueryBuildRequestV1(options), plan = admitPlan(value);
	return runBatch(ports, plan, 'rename', admitted.signal);
}

export async function undoPhotoLibraryBatchRenameV1(ports: PhotoBatchRenameSessionPortsV1, value: unknown, options: unknown = {}): Promise<PhotoLibraryBatchRenameReceiptV1> {
	const admitted = admitPhotoLibraryQueryBuildRequestV1(options), undo = normalizePhotoBatchRenameUndoV1(value);
	return runBatch(ports, undo, 'undo', admitted.signal);
}

async function runBatch(ports: PhotoBatchRenameSessionPortsV1, packet: PhotoLibraryBatchRenamePlanV1 | PhotoLibraryBatchRenameUndoV1,
	action: 'rename' | 'undo', outerSignal?: AbortSignal): Promise<PhotoLibraryBatchRenameReceiptV1> {
	const outcomes: PhotoLibraryBatchRenameItemV1[] = [];
	const inverse: PhotoLibraryBatchRenameUndoItemV1[] = packet.kind === 'photo-batch-rename-undo' ? [...packet.items] : [];
	let started = false, activeSignal: AbortSignal | undefined;
	let completion: PhotoLibraryBatchRenameReceiptV1['completion'] = 'finished', message: string | null = null;
	try {
		await ports.mutate(async (catalogId, signal) => {
			if (catalogId !== packet.catalogId) throw new RangeError('Batch rename differs from the current catalog identity.');
			started = true; activeSignal = signal;
			for (let position = 0; position < packet.items.length; position++) {
				const item = packet.items[position]!, before = outcomes.length;
				try {
					check(signal);
					await ports.withPhoto(catalogId, item.photoId, signal, async (owner, admitted) => {
						const ack = packet.kind === 'photo-batch-rename'
							? await applyPhotoBatchRenameItemV1(owner, packet, position, { signal: admitted })
							: await applyPhotoBatchRenameUndoItemV1(owner, packet, position, { signal: admitted });
						// Publish the scalar receipt inside the borrowed operation before
						// any cancellation check or surrounding lease cleanup can fail.
						outcomes.push(Object.freeze({ ...ack, message: null }));
						if (ack.status === 'renamed') inverse.push(Object.freeze({ index: ack.index, photoId: ack.photoId,
							expectedRevision: ack.revision, fileName: ack.fileName, previousDisplayName: ack.previousDisplayName }));
						else if (ack.status === 'restored') inverse.splice(inverse.findIndex(entry => entry.index === ack.index), 1);
					});
				} catch (error) {
					if (aborted(signal) || outcomes.length !== before) throw error;
					const previousDisplayName = 'sourceFileName' in item ? item.sourceFileName : item.fileName;
					const fileName = 'sourceFileName' in item ? item.fileName : item.previousDisplayName;
					outcomes.push(Object.freeze({ index: item.index, photoId: item.photoId, previousDisplayName, fileName,
						revision: null, status: 'failed', message: failureMessage(error) }));
				}
				if (position + 1 < packet.items.length) await task();
			}
		}, outerSignal);
	} catch (error) {
		if (!started) throw error;
		const cancelled = aborted(activeSignal);
		completion = cancelled ? (outcomes.length === packet.items.length ? 'finished' : 'cancelled') : 'interrupted';
		message = completion === 'finished' ? null : failureMessage(error);
	}
	const undo = inverse.length === 0 ? null : normalizePhotoBatchRenameUndoV1({ schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: packet.catalogId, items: inverse });
	const receipt: PhotoLibraryBatchRenameReceiptV1 = Object.freeze({ schemaVersion: 1, action, completion, items: Object.freeze(outcomes), undo, message });
	checkBatchRenameBytes(receipt, PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1, 'Batch rename receipt'); return receipt;
}

function check(signal: AbortSignal): void { Reflect.apply(nativeAbort, signal, []); }
function aborted(signal?: AbortSignal): boolean { return signal !== undefined && (Reflect.apply(nativeAborted, signal, []) as unknown) === true; }
function task(): Promise<void> { return new Promise(resolve => { setTimeout(resolve, 0); }); }
function failureMessage(error: unknown): string {
	try {
		const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
		if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') return descriptor.value.slice(0, PHOTO_BATCH_RENAME_ERROR_MAXIMUM_UNITS_V1);
	} catch { /* Error inspection cannot veto a durable acknowledgment. */ }
	return 'Photo batch change failed.';
}
