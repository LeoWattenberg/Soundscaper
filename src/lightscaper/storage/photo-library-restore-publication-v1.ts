/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from './photo-library-catalog-pointer.ts';
import { photoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1, classifyPhotoLibraryRestoreCommitV1,
	type PhotoLibraryRestoreCommitV1, type PhotoLibraryRestoreReadyReceiptV1 } from './photo-library-restore-journal-v1.ts';

/** Trusted host port bound to the fixed default PhotoMediaStore settings, never selected media. */
export type PhotoLibraryRestorePublicationSettingsPortV1 = Readonly<Pick<KeyValueRepository, 'get' | 'replaceIfCurrentAndPutIfAbsent'>>;
export interface PhotoLibraryRestorePublicationOptionsV1 {
	readonly settings: PhotoLibraryRestorePublicationSettingsPortV1;
	readonly journal: unknown;
	readonly admitWrite: () => void;
}
export type PhotoLibraryRestorePublicationResultV1 = Readonly<{
	outcome: 'acknowledged';
	receipt: Readonly<PhotoLibraryRestoreReadyReceiptV1>;
	commit: Readonly<PhotoLibraryRestoreCommitV1>;
	reconciled: boolean;
	errors: readonly unknown[];
}> | Readonly<{
	outcome: 'not-published' | 'protected-uncertain';
	errors: readonly unknown[];
}>;

/**
 * Borrowed cooperative lease/cancellation admission only; no resource, journal, or delete owner.
 * True native completion and matching permanent history remain ACK even after later pointer moves.
 */
export async function publishPhotoLibraryRestorePointerV1(value: PhotoLibraryRestorePublicationOptionsV1): Promise<PhotoLibraryRestorePublicationResultV1> {
	const input = readClosedDomainRecord(value, 'restore publication', ['settings', 'journal', 'admitWrite']);
	const field = (key: string) => readClosedDomainField(input, key, 'restore publication');
	const commit = photoLibraryRestoreCommitV1(field('journal'));
	const admitWrite = field('admitWrite');
	if (typeof admitWrite !== 'function') throw new TypeError('Restore publication requires live synchronous write admission.');
	const settings = field('settings') as PhotoLibraryRestorePublicationSettingsPortV1;
	if (!settings || typeof settings.get !== 'function' || typeof settings.replaceIfCurrentAndPutIfAbsent !== 'function') {
		throw new TypeError('Restore publication requires the fixed durable settings port.');
	}
	const read = settings.get.bind(settings), replace = settings.replaceIfCurrentAndPutIfAbsent.bind(settings);
	const key = photoLibraryRestoreCommitKeyV1(commit.allocation.namespaceToken), errors: unknown[] = [];
	try {
		admitWrite();
		const published = await replace(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, commit.previousPointer, commit.replacementPointer, key, commit, durable => {
			if (!durable) throw new Error('Restore publication requires native durable IndexedDB.');
			admitWrite();
		});
		// A known completed pair is returned without any later cancellation/read/cleanup probe.
		if (published) return acknowledged(false);
	} catch (error) { errors.push(error); }
	let history: unknown;
	try { history = await read(key); }
	catch (error) { errors.push(error); return result('protected-uncertain'); }
	const state = classifyPhotoLibraryRestoreCommitV1(history, commit);
	if (state === 'matching') return acknowledged(true);
	return result(state === 'absent' ? 'not-published' : 'protected-uncertain');
	function acknowledged(reconciled: boolean): PhotoLibraryRestorePublicationResultV1 {
		return Object.freeze({ outcome: 'acknowledged', receipt: commit.candidateReceipt, commit, reconciled, errors: Object.freeze([...errors]) });
	}
	function result(outcome: 'not-published' | 'protected-uncertain'): PhotoLibraryRestorePublicationResultV1 {
		return Object.freeze({ outcome, errors: Object.freeze([...errors]) });
	}
}
