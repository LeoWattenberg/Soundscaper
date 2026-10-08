/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBatchRenameUndoV1 } from '../../common/editor/photo-library-batch-rename-port-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { field, id, integer, name, record } from '../catalog/value-validation.ts';
import type { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

export const PHOTO_BATCH_RENAME_UNDO_MAXIMUM_BYTES_V1 = 256 * 1024;
const admitted = new WeakSet<object>();

/** Snapshot array data descriptors without invoking caller-owned length/methods. */
export function readBatchRenameArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} requires a native array.`);
	const length = Object.getOwnPropertyDescriptor(value, 'length');
	const count = integer(length && 'value' in length ? length.value as unknown : undefined, 1, 64, `${label} length`);
	if (Reflect.ownKeys(value).length !== count + 1) throw new TypeError(`${label} requires dense closed entries.`);
	const result: unknown[] = [];
	for (let index = 0; index < count; index++) {
		const item = Object.getOwnPropertyDescriptor(value, String(index));
		if (!item || !('value' in item)) throw new TypeError(`${label} requires own data entries.`);
		result.push(item.value as unknown);
	}
	return result;
}

/** Complete inverse admission precedes writer acquisition and any photo traversal. */
export function normalizePhotoBatchRenameUndoV1(value: unknown): PhotoLibraryBatchRenameUndoV1 {
	if (value && typeof value === 'object' && admitted.has(value)) return value as PhotoLibraryBatchRenameUndoV1;
	const input = record(value, 'photo batch rename undo', ['schemaVersion', 'kind', 'catalogId', 'items']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo batch rename undo version.');
	if (field(input, 'kind') !== 'photo-batch-rename-undo') throw new RangeError('Unsupported photo batch rename undo kind.');
	const catalogId = id(field(input, 'catalogId'), 'batch undo catalog ID'), seen = new Set<string>();
	let previousIndex = -1;
	const items = readBatchRenameArray(field(input, 'items'), 'batch undo items').map(value => {
		const item = record(value, 'batch undo item', ['index', 'photoId', 'expectedRevision', 'fileName', 'previousDisplayName']);
		const index = integer(field(item, 'index'), 0, 63, 'batch undo selected index');
		if (index <= previousIndex) throw new RangeError('Batch undo indexes must preserve distinct selection order.');
		previousIndex = index;
		const photoId = id(field(item, 'photoId'), 'batch undo photo ID');
		if (seen.has(photoId)) throw new RangeError('Batch undo contains duplicate photo identities.');
		seen.add(photoId);
		const fileName = name(field(item, 'fileName'), 'batch undo current display name');
		const previousDisplayName = name(field(item, 'previousDisplayName'), 'batch undo previous display name');
		if (fileName === previousDisplayName) throw new RangeError('Batch undo requires an acknowledged name change.');
		return Object.freeze({ index, photoId, fileName, previousDisplayName,
			expectedRevision: integer(field(item, 'expectedRevision'), 1, Number.MAX_SAFE_INTEGER, 'batch undo expected revision') });
	});
	const packet: PhotoLibraryBatchRenameUndoV1 = Object.freeze({ schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId, items: Object.freeze(items) });
	checkBatchRenameBytes(packet, PHOTO_BATCH_RENAME_UNDO_MAXIMUM_BYTES_V1, 'Batch undo');
	admitted.add(packet); return packet;
}

export function checkBatchRenameBytes(value: object, maximum: number, label: string): void {
	const serialized = JSON.stringify(value);
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) throw new RangeError(`${label} exceeds its scalar byte budget.`);
}

/** A compensating metadata command with exact durable revision/name fences. */
export async function applyPhotoBatchRenameUndoItemV1(owner: PhotoCommandOwnerV1, value: unknown, selectedPosition: number, options: unknown = {}) {
	const packet = normalizePhotoBatchRenameUndoV1(value);
	const item = packet.items[integer(selectedPosition, 0, packet.items.length - 1, 'batch undo item position')]!;
	const cancellation = admitPhotoLibraryQueryBuildRequestV1(options);
	const current = validateLightscaperDocumentV1(owner.history.present);
	if (current.kind !== 'photo' || current.catalogId !== packet.catalogId || current.id !== item.photoId) throw new RangeError('Batch undo differs from the borrowed owner identity.');
	if (current.revision !== item.expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
	if (current.metadata.fileName !== item.fileName) throw new RangeError('Batch undo differs from the current display filename.');
	const acknowledged = await owner.execute({ type: 'set-metadata', changes: { fileName: item.previousDisplayName } }, cancellation);
	return Object.freeze({ index: item.index, photoId: item.photoId, previousDisplayName: current.metadata.fileName,
		fileName: acknowledged.metadata.fileName, revision: acknowledged.revision, status: 'restored' as const });
}
