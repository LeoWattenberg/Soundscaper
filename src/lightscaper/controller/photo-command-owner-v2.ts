/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { assertNotAborted } from '../catalog/catalog-transaction.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { serializePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { commitPhotoHistoryV2, createPhotoHistoryV2, redoPhotoHistoryV2, undoPhotoHistoryV2, type PhotoHistoryV2 } from '../catalog/photo-history-v2.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
import { applyPhotoCommandV2 } from './photo-commands-v2.ts';
import { createPhotoDevelopClipboardV2, normalizePhotoDevelopClipboardV1OrV2, type PhotoDevelopClipboardV2 } from './photo-develop-clipboard-v2.ts';
import type { PhotoDevelopClipboardV1 } from './photo-develop-clipboard.ts';
import { PhotoCommandOwnerError } from './photo-command-owner.ts';

export type PhotoCommandRepositoryPortV2 = Pick<PhotoCatalogRepositoryV2, 'loadPhoto' | 'savePhoto'>;
export interface PhotoCommandOptionsV2 { readonly signal?: AbortSignal }
type CurrentPhoto = PhotoDocumentV1 | PhotoDocumentV2;
type Clipboard = PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2;
const NativeController = AbortController, ANY_SIGNAL = AbortSignal.any;

/** Current photo authoring. Only a successful durable save publishes the next history. */
export class PhotoCommandOwnerV2 {
	#history: PhotoHistoryV2;
	#clipboard: Clipboard | null = null;
	#pending: Promise<CurrentPhoto> | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;
	#admitting = false;
	readonly #lifetime = new NativeController();
	readonly #load: PhotoCommandRepositoryPortV2['loadPhoto'];
	readonly #save: PhotoCommandRepositoryPortV2['savePhoto'];

	constructor(readonly repository: PhotoCommandRepositoryPortV2, photo: unknown, capacity = 20) {
		const load = repository.loadPhoto, save = repository.savePhoto;
		if (typeof load !== 'function' || typeof save !== 'function') throw new TypeError('Photo commands require a repository port.');
		this.#load = (...args) => Reflect.apply(load, repository, args) as ReturnType<PhotoCommandRepositoryPortV2['loadPhoto']>;
		this.#save = (...args) => Reflect.apply(save, repository, args) as ReturnType<PhotoCommandRepositoryPortV2['savePhoto']>;
		this.#history = createPhotoHistoryV2(photo, capacity);
	}

	static async open(repository: PhotoCommandRepositoryPortV2, catalogId: string, photoId: string, capacity = 20): Promise<PhotoCommandOwnerV2> {
		const load = repository.loadPhoto, save = repository.savePhoto;
		if (typeof load !== 'function' || typeof save !== 'function') throw new TypeError('Photo commands require a repository port.');
		const pinned: PhotoCommandRepositoryPortV2 = {
			loadPhoto: (...args) => Reflect.apply(load, repository, args) as ReturnType<PhotoCommandRepositoryPortV2['loadPhoto']>,
			savePhoto: (...args) => Reflect.apply(save, repository, args) as ReturnType<PhotoCommandRepositoryPortV2['savePhoto']>,
		};
		const photo = await pinned.loadPhoto(id(catalogId, 'catalog ID'), id(photoId, 'photo ID'));
		if (!photo) throw new ReferenceError('The photo command owner cannot open a missing photo.');
		return new PhotoCommandOwnerV2(pinned, photo, capacity);
	}

	get history(): PhotoHistoryV2 { return this.#history; }
	get clipboard(): Clipboard | null { return this.#clipboard; }
	get canUndo(): boolean { return this.#history.past.length > 0; }
	get canRedo(): boolean { return this.#history.future.length > 0; }

	execute(command: unknown, options: PhotoCommandOptionsV2 = {}): Promise<CurrentPhoto> {
		return this.#transition(history => {
			const draft = applyPhotoCommandV2(history.present, command);
			return serializePhotoDocumentV1OrV2(draft) === serializePhotoDocumentV1OrV2(history.present)
				? history : commitPhotoHistoryV2(history, draft);
		}, options);
	}
	undo(options: PhotoCommandOptionsV2 = {}): Promise<CurrentPhoto> { return this.#transition(undoPhotoHistoryV2, options); }
	redo(options: PhotoCommandOptionsV2 = {}): Promise<CurrentPhoto> { return this.#transition(redoPhotoHistoryV2, options); }

	copyDevelop(versionId = this.#history.present.activeVersionId): PhotoDevelopClipboardV2 {
		return this.#synchronous(() => {
			const version = this.#history.present.versions.find(entry => entry.id === id(versionId, 'clipboard version ID'));
			if (!version) throw new ReferenceError('Cannot copy a missing photo version.');
			const packet = createPhotoDevelopClipboardV2(version.develop);
			this.#assertLive(); this.#clipboard = packet; return packet;
		});
	}
	setClipboard(value: unknown): void {
		this.#synchronous(() => { const packet = normalizePhotoDevelopClipboardV1OrV2(value); this.#assertLive(); this.#clipboard = packet; });
	}
	pasteDevelop(value: unknown = this.#clipboard, versionId?: string, options: PhotoCommandOptionsV2 = {}): Promise<CurrentPhoto> {
		return this.#transition(history => {
			if (value === null) throw new ReferenceError('The photo develop clipboard is empty.');
			const packet = normalizePhotoDevelopClipboardV1OrV2(value);
			const draft = applyPhotoCommandV2(history.present, { type: 'set-develop', develop: packet.develop,
				...(versionId === undefined ? {} : { versionId }) });
			return serializePhotoDocumentV1OrV2(draft) === serializePhotoDocumentV1OrV2(history.present)
				? history : commitPhotoHistoryV2(history, draft);
		}, options);
	}

	reload(options: PhotoCommandOptionsV2 = {}): Promise<CurrentPhoto> {
		return this.#operation(async signal => {
			const before = this.#history, photo = await this.#load(before.present.catalogId, before.present.id);
			assertNotAborted(signal);
			if (!photo) throw new ReferenceError('The photo is missing.');
			this.#history = createPhotoHistoryV2(photo, before.capacity); return this.#history.present;
		}, options);
	}

	/** Cancel/join this owner only. The injected repository remains independently owned. */
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; this.#lifetime.abort();
		this.#closing = this.#pending?.then(() => undefined, () => undefined) ?? Promise.resolve();
		return this.#closing;
	}

	#transition(prepare: (history: PhotoHistoryV2) => PhotoHistoryV2, options: PhotoCommandOptionsV2): Promise<CurrentPhoto> {
		return this.#operation(async signal => {
			const before = this.#history;
			let next: PhotoHistoryV2;
			try { next = prepare(before); } catch (error) { assertNotAborted(signal); throw error; }
			assertNotAborted(signal);
			if (next === before) return before.present;
			await this.#save({ ...next.present, revision: before.present.revision }, before.present.revision, { signal });
			// Known native ACK wins late cancellation and Close.
			this.#history = next; return next.present;
		}, options);
	}

	#operation(run: (signal: AbortSignal) => Promise<CurrentPhoto>, options: PhotoCommandOptionsV2): Promise<CurrentPhoto> {
		try { this.#assertAvailable(); } catch (error) { return Promise.reject(error); }
		let resolve!: (photo: CurrentPhoto) => void, reject!: (error: unknown) => void;
		const result = new Promise<CurrentPhoto>((accept, refuse) => { resolve = accept; reject = refuse; });
		const pending = result.finally(() => { this.#pending = null; });
		this.#pending = pending;
		// Install demand before caller reflection, cancellation callbacks or borrowed repository work.
		const start = async () => {
			assertNotAborted(this.#lifetime.signal);
			let caller: unknown;
			try {
				const input = record(options, 'photo command options', ['signal'], []);
				caller = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo command options') : undefined;
			} catch (error) { assertNotAborted(this.#lifetime.signal); throw error; }
			assertNotAborted(this.#lifetime.signal);
			if (caller !== undefined) assertPhotoStackQuerySignalV1(caller);
			const signal = caller === undefined ? this.#lifetime.signal : ANY_SIGNAL([this.#lifetime.signal, caller]);
			assertNotAborted(signal); return run(signal);
		};
		void start().then(resolve, reject); return pending;
	}

	#synchronous<Result>(run: () => Result): Result {
		this.#assertAvailable(); this.#admitting = true;
		try { return run(); } finally { this.#admitting = false; }
	}
	#assertAvailable(): void {
		this.#assertLive(); if (this.#pending || this.#admitting) throw new PhotoCommandOwnerError('busy');
	}
	#assertLive(): void { if (this.#closed) throw new PhotoCommandOwnerError('closed'); }
}
