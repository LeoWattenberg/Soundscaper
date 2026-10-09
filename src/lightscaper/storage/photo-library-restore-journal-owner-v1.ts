/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoMediaSettingsRepositoryV1 } from './photo-media-store.ts';
import type { PhotoLibraryLocationPointer } from './photo-library-location-v2.ts';
import { readPhotoLibraryLocationPointerV2 } from './photo-library-location-v2.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from './photo-library-catalog-pointer.ts';
import { normalizePhotoLibraryRestoreJournalV1, photoLibraryRestoreCommitKeyV1,
	PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, type PhotoLibraryRestoreJournalV1,
	type PhotoLibraryRestoreReadyReceiptV1 } from './photo-library-restore-journal-v1.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';

/** Borrowed fixed-anchor transport. The host owns native leases and both fresh resource owners. */
export class PhotoLibraryRestoreJournalOwnerV1 {
	readonly #read: PhotoMediaSettingsRepositoryV1['get'];
	readonly #insert: PhotoMediaSettingsRepositoryV1['putIfAbsent'];
	readonly #replace: PhotoMediaSettingsRepositoryV1['replaceIfCurrent'];
	readonly #delete: PhotoMediaSettingsRepositoryV1['deleteIfCurrent'];
	#raw: unknown;
	#journal: Readonly<PhotoLibraryRestoreJournalV1> | null = null;
	constructor(settings: Pick<PhotoMediaSettingsRepositoryV1, 'get' | 'putIfAbsent' | 'replaceIfCurrent' | 'deleteIfCurrent'>, readonly assertHeld: () => void) {
		this.#read = settings.get.bind(settings); this.#insert = settings.putIfAbsent.bind(settings);
		this.#replace = settings.replaceIfCurrent.bind(settings); this.#delete = settings.deleteIfCurrent.bind(settings);
	}
	get current(): Readonly<PhotoLibraryRestoreJournalV1> | null { return this.#journal; }
	async stage(allocation: Readonly<PhotoLibraryRestoreAllocationV1>, expectedPointer: PhotoLibraryLocationPointer): Promise<void> {
		this.assertHeld();
		// Entropy is allocated by the host; any existing permanent history protects this token forever.
		if (await this.#read(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken)) !== undefined) {
			throw new Error('The allocated restore namespace has permanent history.');
		}
		this.assertHeld();
		const journal = normalizePhotoLibraryRestoreJournalV1({ schemaVersion: 1, kind: 'photo-library-restore-journal',
			allocation, expectedPointer, phase: 'staging', candidateReceipt: null });
		await this.#write(journal, () => this.#insert(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, journal));
	}
	async ready(receipt: Readonly<PhotoLibraryRestoreReadyReceiptV1>): Promise<Readonly<PhotoLibraryRestoreJournalV1>> {
		if (!this.#journal) throw new Error('A durable staging journal is required.');
		const journal = normalizePhotoLibraryRestoreJournalV1({ ...this.#journal, phase: 'ready', candidateReceipt: receipt });
		await this.#write(journal, () => this.#replace(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, this.#raw, journal));
		return journal;
	}
	async #write(journal: Readonly<PhotoLibraryRestoreJournalV1>, write: () => Promise<boolean>): Promise<void> {
		this.assertHeld(); let failed = false, failure: unknown;
		try {
			if (await write()) { this.#raw = journal; this.#journal = journal; return; }
		} catch (error) { failed = true; failure = error; }
		let raw: unknown;
		try { raw = await this.#read(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1); }
		catch (error) { throw failed ? new AggregateError([failure, error], 'Restore journal acknowledgement is uncertain.') : error; }
		let matching = false;
		try { matching = JSON.stringify(normalizePhotoLibraryRestoreJournalV1(raw)) === JSON.stringify(journal); }
		catch { /* Foreign or malformed journals stay untouched. */ }
		if (!matching) throw failed ? failure : new Error('The active restore journal changed.');
		// Reconciled native ACK retains the exact stored record for subsequent byte-order-sensitive CAS.
		this.#raw = raw; this.#journal = journal;
	}
	async canDiscard(): Promise<boolean> {
		if (!this.#journal) return false;
		const allocation = this.#journal.allocation;
		this.assertHeld();
		if (await this.#read(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken)) !== undefined) return false;
		this.assertHeld();
		const pointer = readPhotoLibraryLocationPointerV2(await this.#read(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1));
		this.assertHeld();
		return pointer.schemaVersion !== 2 || pointer.namespaceToken !== allocation.namespaceToken;
	}
	/** Called only after successful deletion proof, or a permanent publication ACK. */
	async retire(): Promise<void> {
		if (!this.#journal) return;
		if (!await this.#delete(PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1, this.#raw)) throw new Error('The restore journal changed during retirement.');
		this.#raw = undefined; this.#journal = null;
	}
}
