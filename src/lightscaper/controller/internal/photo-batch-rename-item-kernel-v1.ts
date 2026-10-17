/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoForCommandProfileV1, type PhotoCommandProfileV1 } from '../photo-develop-workspace-commands-kernel.ts';
import { PhotoCatalogRevisionConflictError } from '../../catalog/repository-types.ts';
import { integer } from '../../catalog/value-validation.ts';
import type { PhotoCommandOwnerKernel } from '../photo-command-owner-kernel.ts';
import { normalizePhotoBatchRenamePlanV1, type PhotoBatchRenameAcknowledgementV1 } from '../photo-batch-rename-v1.ts';
import { normalizePhotoBatchRenameUndoV1 } from '../photo-batch-rename-inverse-v1.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from '../photo-library-query-v1.ts';

/** Fixed facade admission shares only the scalar plan and native publication loop. */
export async function applyPhotoBatchRenameItemForProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, owner: PhotoCommandOwnerKernel<Profile>, value: unknown, selectedIndex: number, options: unknown = {}): Promise<PhotoBatchRenameAcknowledgementV1> {
	const cancellation = admitPhotoLibraryQueryBuildRequestV1(options), plan = normalizePhotoBatchRenamePlanV1(value);
	const item = plan.items[integer(selectedIndex, 0, plan.items.length - 1, 'batch rename selected index')]!;
	const current = selected(profile, owner, plan.catalogId, item.photoId, item.expectedRevision, item.sourceFileName), execute = owner.execute;
	check(cancellation.signal); const changed = item.fileName !== current.metadata.fileName;
	const acknowledged = changed ? await Reflect.apply(execute, owner, [{ type: 'set-metadata', changes: { fileName: item.fileName } }, cancellation]) : current;
	return Object.freeze({ index: item.index, photoId: item.photoId, previousDisplayName: current.metadata.fileName,
		fileName: acknowledged.metadata.fileName, revision: acknowledged.revision, status: changed ? 'renamed' : 'unchanged' });
}

export async function applyPhotoBatchRenameUndoItemForProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, owner: PhotoCommandOwnerKernel<Profile>, value: unknown, selectedIndex: number, options: unknown = {}) {
	const cancellation = admitPhotoLibraryQueryBuildRequestV1(options), packet = normalizePhotoBatchRenameUndoV1(value);
	const item = packet.items[integer(selectedIndex, 0, packet.items.length - 1, 'batch undo item position')]!;
	const current = selected(profile, owner, packet.catalogId, item.photoId, item.expectedRevision, item.fileName), execute = owner.execute;
	check(cancellation.signal);
	const acknowledged = await Reflect.apply(execute, owner, [{ type: 'set-metadata', changes: { fileName: item.previousDisplayName } }, cancellation]);
	return Object.freeze({ index: item.index, photoId: item.photoId, previousDisplayName: current.metadata.fileName,
		fileName: acknowledged.metadata.fileName, revision: acknowledged.revision, status: 'restored' as const });
}

function selected<Profile extends PhotoCommandProfileV1>(profile: Profile, owner: PhotoCommandOwnerKernel<Profile>, catalogId: string, photoId: string, revision: number, fileName: string) {
	const photo = readPhotoForCommandProfileV1(profile, owner.history.present);
	if (photo.catalogId !== catalogId || photo.id !== photoId) throw new RangeError('Batch rename differs from the borrowed owner identity.');
	if (photo.revision !== revision) throw new PhotoCatalogRevisionConflictError('photo');
	if (photo.metadata.fileName !== fileName) throw new RangeError('Batch rename differs from the current display filename.'); return photo;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
