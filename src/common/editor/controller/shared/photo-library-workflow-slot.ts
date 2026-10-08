/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBackupSaveRequestV1 } from './photo-library-backup-save-v1.ts';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryV2 } from '../../photo-library-query-port-v2.ts';

export type PhotoLibraryBackupSaveRuntimeV1 = Readonly<Pick<PhotoLibraryBackupSaveRequestV1, 'prepareSave' | 'saveFile' | 'maximumStreamingBytes'>>;
export type LoadPhotoLibraryBackupSaveRuntimeV1 = () => Promise<PhotoLibraryBackupSaveRuntimeV1>;
export interface PhotoLibraryWorkflowSlotV1 {
	live: boolean;
	readonly factory: CreatePhotoLibrarySessionV1 | undefined;
	readonly backupLoader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	readonly lifetime: AbortController;
	readonly beforeDrain: Promise<void> | null;
	pending: Promise<PhotoLibrarySessionPortV1> | null;
	active: AbortController | null;
	query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2 | null;
	savedCollectionId: string | null;
	stackCollapsed: boolean;
	page: PhotoLibraryPageV1 | null;
	batchRenamePlanner: PhotoLibrarySessionPortV1['planBatchRename'] | null;
	backupRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	backupLoading: Promise<void> | null;
	retirement: Promise<void> | null;
}

/** Register factory ownership before invoking borrowed code; replacement joins the previous drain. */
export function acquirePhotoLibraryWorkflowSlotV1(current: PhotoLibraryWorkflowSlotV1): Promise<PhotoLibrarySessionPortV1> {
	if (!current.pending) {
		const pending = Promise.resolve().then(async () => {
			if (current.beforeDrain) await current.beforeDrain;
			current.lifetime.signal.throwIfAborted();
			if (!current.factory) throw new Error('The photo library is unavailable.');
			return current.factory();
		});
		current.pending = pending;
		void pending.catch(() => { if (current.pending === pending) current.pending = null; });
	}
	return current.pending;
}

/** Idempotent retirement fences synchronously, then joins destinations, late factories and native close. */
export function retirePhotoLibraryWorkflowSlotV1(current: PhotoLibraryWorkflowSlotV1, cancelDestinations: () => Promise<void>): Promise<void> {
	if (current.retirement) return current.retirement;
	let resolve!: () => void, reject!: (error: unknown) => void;
	const closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	current.retirement = closing; void closing.catch(() => undefined);
	current.live = false; current.lifetime.abort(); current.active?.abort();
	const pending = current.pending;
	let destinations: Promise<void>;
	try { destinations = cancelDestinations(); } catch (error) { destinations = Promise.reject(error); }
	void destinations.catch(() => undefined);
	void (async () => {
		const errors: unknown[] = [];
		try { await current.beforeDrain; } catch (error) { errors.push(error); }
		try { await destinations; } catch (error) { errors.push(error); }
		const owner = await pending?.catch(() => null);
		try { await owner?.close(); } catch (error) { errors.push(error); }
		if (errors.length === 1) throw errors[0];
		if (errors.length) throw new AggregateError(errors, 'Photo library generation cleanup failed.');
	})().then(resolve, reject);
	return closing;
}

/** All owners settle before a cleanup failure can release a replacement generation. */
export async function joinPhotoLibraryRetirementV1(owners: readonly (Promise<void> | null)[]): Promise<void> {
	const settled = await Promise.allSettled(owners), errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'Photo library generation cleanup failed.');
}
