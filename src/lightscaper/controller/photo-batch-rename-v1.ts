/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportSettingsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { array, field, id, integer, name, record } from '../catalog/value-validation.ts';
import { expandPhotoImportNameV1, normalizePhotoImportRenameV1 } from '../import/photo-import-name-template-v1.ts';
import type { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

export const PHOTO_BATCH_RENAME_MAXIMUM_BYTES_V1 = 256 * 1024;
type Rename = NonNullable<PhotoLibraryImportSettingsV1['rename']>;

export interface PhotoBatchRenameItemV1 {
	readonly index: number;
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly sourceFileName: string;
	readonly fileName: string;
}
export interface PhotoBatchRenamePlanV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-batch-rename';
	readonly catalogId: string;
	readonly rename: Rename;
	readonly items: readonly PhotoBatchRenameItemV1[];
}
export interface PhotoBatchRenameAcknowledgementV1 {
	readonly index: number;
	readonly photoId: string;
	readonly previousDisplayName: string;
	readonly fileName: string;
	readonly revision: number;
	readonly status: 'renamed' | 'unchanged';
}

const admittedPlans = new WeakSet<object>();

/** Entire scalar selection is admitted before borrowing any command owner. */
export function planPhotoBatchRenameV1(value: unknown): PhotoBatchRenamePlanV1 {
	const input = record(value, 'photo batch rename request', ['schemaVersion', 'catalogId', 'selection', 'rename']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo batch rename version.');
	const catalogId = id(field(input, 'catalogId'), 'batch rename catalog ID');
	const rename = normalizePhotoImportRenameV1(field(input, 'rename'));
	if (rename === null) throw new TypeError('Photo batch rename requires an authored recipe.');
	const seen = new Set<string>();
	const items = array(field(input, 'selection'), 'batch rename selection', 1, 64).map((value, index) => {
		const selection = record(value, 'batch rename photo', ['photoId', 'expectedRevision', 'fileName']);
		const photoId = id(field(selection, 'photoId'), 'batch rename photo ID');
		if (seen.has(photoId)) throw new RangeError('Photo batch rename contains duplicate photo identities.');
		seen.add(photoId);
		const sourceFileName = name(field(selection, 'fileName'), 'batch rename source filename');
		return Object.freeze({ index, photoId,
			expectedRevision: integer(field(selection, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expected photo revision'),
			sourceFileName, fileName: expandPhotoImportNameV1(sourceFileName, index, rename) });
	});
	const plan: PhotoBatchRenamePlanV1 = Object.freeze({ schemaVersion: 1, kind: 'photo-batch-rename', catalogId, rename, items: Object.freeze(items) });
	const serialized = JSON.stringify(plan);
	if (serialized.length > PHOTO_BATCH_RENAME_MAXIMUM_BYTES_V1
		|| new TextEncoder().encode(serialized).byteLength > PHOTO_BATCH_RENAME_MAXIMUM_BYTES_V1) {
		throw new RangeError('Photo batch rename plan exceeds its scalar byte budget.');
	}
	admittedPlans.add(plan); return plan;
}

/** Re-derive transported plans; admitted frozen plans require no repeated copying. */
export function normalizePhotoBatchRenamePlanV1(value: unknown): PhotoBatchRenamePlanV1 {
	if (value && typeof value === 'object' && admittedPlans.has(value)) return value as PhotoBatchRenamePlanV1;
	const input = record(value, 'photo batch rename plan', ['schemaVersion', 'kind', 'catalogId', 'rename', 'items']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo batch rename version.');
	if (field(input, 'kind') !== 'photo-batch-rename') throw new RangeError('Unsupported photo batch rename plan kind.');
	const items = array(field(input, 'items'), 'batch rename items', 1, 64).map((value, index) => {
		const item = record(value, 'batch rename item', ['index', 'photoId', 'expectedRevision', 'sourceFileName', 'fileName']);
		if (field(item, 'index') !== index) throw new RangeError('Photo batch rename index differs from selection order.');
		return item;
	});
	const plan = planPhotoBatchRenameV1({ schemaVersion: field(input, 'schemaVersion'), catalogId: field(input, 'catalogId'), rename: field(input, 'rename'),
		selection: items.map(item => ({ photoId: field(item, 'photoId'), expectedRevision: field(item, 'expectedRevision'), fileName: field(item, 'sourceFileName') })) });
	for (const item of plan.items) {
		if (field(items[item.index]!, 'fileName') !== item.fileName) throw new RangeError('Photo batch rename output differs from its recipe binding.');
	}
	return plan;
}

/** Caller owns the catalog lease, serial loop, current owner and partial receipts. */
export async function applyPhotoBatchRenameItemV1(
	owner: PhotoCommandOwnerV1, value: unknown, selectedIndex: number, options: unknown = {},
): Promise<PhotoBatchRenameAcknowledgementV1> {
	const plan = normalizePhotoBatchRenamePlanV1(value);
	const item = plan.items[integer(selectedIndex, 0, plan.items.length - 1, 'batch rename selected index')]!;
	const cancellation = admitPhotoLibraryQueryBuildRequestV1(options);
	const current = validateLightscaperDocumentV1(owner.history.present);
	if (current.kind !== 'photo' || current.catalogId !== plan.catalogId || current.id !== item.photoId) {
		throw new RangeError('Photo batch rename differs from the borrowed owner identity.');
	}
	if (current.revision !== item.expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
	if (current.metadata.fileName !== item.sourceFileName) throw new RangeError('Photo batch rename differs from the current display filename.');
	const changed = item.fileName !== current.metadata.fileName;
	const acknowledged = changed ? await owner.execute({ type: 'set-metadata', changes: { fileName: item.fileName } }, cancellation) : current;
	// The existing owner publishes history only after durable CAS. Preserve that
	// acknowledgment when abort/close arrives during its final continuation.
	return Object.freeze({ index: item.index, photoId: item.photoId, previousDisplayName: current.metadata.fileName,
		fileName: acknowledged.metadata.fileName, revision: acknowledged.revision, status: changed ? 'renamed' : 'unchanged' });
}
