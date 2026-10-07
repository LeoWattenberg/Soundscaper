/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertNotAborted } from '../catalog/catalog-transaction.ts';
import { serializeLightscaperDocumentV1 } from '../catalog/documents.ts';
import { commitPhotoHistoryV1, createPhotoHistoryV1, redoPhotoHistoryV1, undoPhotoHistoryV1,
	type PhotoHistoryV1 } from '../catalog/photo-history.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
import { applyPhotoCommandV1 } from './photo-commands.ts';
import { createPhotoDevelopClipboardV1, normalizePhotoDevelopClipboardV1, type PhotoDevelopClipboardV1 } from './photo-develop-clipboard.ts';

export type PhotoCommandRepositoryPortV1 = Pick<PhotoCatalogRepositoryV1, 'loadPhoto' | 'savePhoto'>;
export interface PhotoCommandOptionsV1 { readonly signal?: AbortSignal }

export class PhotoCommandOwnerError extends Error {
	readonly code: 'PHOTO_COMMAND_BUSY' | 'PHOTO_COMMAND_CLOSED';
	constructor(kind: 'busy' | 'closed') {
		super(kind === 'busy' ? 'A photo command is already pending.' : 'The photo command owner is closed.');
		this.code = kind === 'busy' ? 'PHOTO_COMMAND_BUSY' : 'PHOTO_COMMAND_CLOSED';
	}
}

/** One photo session. Successful durable acknowledgment is the history publication point. */
export class PhotoCommandOwnerV1 {
	#history: PhotoHistoryV1;
	#clipboard: PhotoDevelopClipboardV1 | null = null;
	#pending: Promise<PhotoDocumentV1> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(readonly repository: PhotoCommandRepositoryPortV1, photo: unknown, capacity = 20) {
		this.#history = createPhotoHistoryV1(photo, capacity);
	}

	static async open(repository: PhotoCommandRepositoryPortV1, catalogId: string, photoId: string, capacity = 20): Promise<PhotoCommandOwnerV1> {
		const photo = await repository.loadPhoto(catalogId, photoId);
		if (!photo) throw new ReferenceError('The photo command owner cannot open a missing photo.');
		return new PhotoCommandOwnerV1(repository, photo, capacity);
	}

	get history(): PhotoHistoryV1 { return this.#history; }
	get clipboard(): PhotoDevelopClipboardV1 | null { return this.#clipboard; }
	get canUndo(): boolean { return this.#history.past.length > 0; }
	get canRedo(): boolean { return this.#history.future.length > 0; }

	async execute(command: unknown, options: PhotoCommandOptionsV1 = {}): Promise<PhotoDocumentV1> {
		return this.#transition((history) => {
			const draft = applyPhotoCommandV1(history.present, command);
			return serializeLightscaperDocumentV1(draft) === serializeLightscaperDocumentV1(history.present)
				? history : commitPhotoHistoryV1(history, draft);
		}, options);
	}

	async undo(options: PhotoCommandOptionsV1 = {}): Promise<PhotoDocumentV1> {
		return this.#transition(undoPhotoHistoryV1, options);
	}

	async redo(options: PhotoCommandOptionsV1 = {}): Promise<PhotoDocumentV1> {
		return this.#transition(redoPhotoHistoryV1, options);
	}

	copyDevelop(versionId = this.#history.present.activeVersionId): PhotoDevelopClipboardV1 {
		this.#assertLive();
		const version = this.#history.present.versions.find((entry) => entry.id === id(versionId, 'clipboard version ID'));
		if (!version) throw new ReferenceError('Cannot copy a missing photo version.');
		this.#clipboard = createPhotoDevelopClipboardV1(version.develop);
		return this.#clipboard;
	}

	setClipboard(value: unknown): void {
		this.#assertLive();
		this.#clipboard = normalizePhotoDevelopClipboardV1(value);
	}

	async pasteDevelop(value: unknown = this.#clipboard, versionId?: string, options: PhotoCommandOptionsV1 = {}): Promise<PhotoDocumentV1> {
		if (value === null) throw new ReferenceError('The photo develop clipboard is empty.');
		const packet = normalizePhotoDevelopClipboardV1(value);
		return this.execute({ type: 'set-develop', develop: packet.develop, ...(versionId === undefined ? {} : { versionId }) }, options);
	}

	async reload(options: PhotoCommandOptionsV1 = {}): Promise<PhotoDocumentV1> {
		this.#assertLive();
		if (this.#pending) throw new PhotoCommandOwnerError('busy');
		const before = this.#history;
		return this.#operation(async (signal) => {
			const photo = await this.repository.loadPhoto(before.present.catalogId, before.present.id);
			assertNotAborted(signal);
			if (!photo) throw new ReferenceError('The photo is missing.');
			this.#history = createPhotoHistoryV1(photo, before.capacity);
			return this.#history.present;
		}, options);
	}

	/** Cancel/await this owner only; the injected repository may serve other photos. */
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#active?.abort();
		this.#closing = this.#pending?.then(() => undefined, () => undefined) ?? Promise.resolve();
		return this.#closing;
	}

	#transition(prepare: (history: PhotoHistoryV1) => PhotoHistoryV1, options: PhotoCommandOptionsV1): Promise<PhotoDocumentV1> {
		this.#assertLive();
		if (this.#pending) throw new PhotoCommandOwnerError('busy');
		assertNotAborted(options.signal);
		const before = this.#history;
		const next = prepare(before);
		if (next === before) return Promise.resolve(before.present);
		return this.#operation(async (signal) => {
			await this.repository.savePhoto({ ...next.present, revision: before.present.revision }, before.present.revision, { signal });
			// Never check cancellation after acknowledgment: the durable commit owns
			// the outcome even if close/abort arrives before this continuation.
			this.#history = next;
			return next.present;
		}, options);
	}

	#operation(run: (signal: AbortSignal) => Promise<PhotoDocumentV1>, options: PhotoCommandOptionsV1): Promise<PhotoDocumentV1> {
		const active = new AbortController();
		this.#active = active;
		const signal = options.signal ? AbortSignal.any([active.signal, options.signal]) : active.signal;
		const pending = Promise.resolve().then(() => { assertNotAborted(signal); return run(signal); }).finally(() => {
			this.#pending = null;
			this.#active = null;
		});
		this.#pending = pending;
		return pending;
	}

	#assertLive(): void { if (this.#closed) throw new PhotoCommandOwnerError('closed'); }
}
