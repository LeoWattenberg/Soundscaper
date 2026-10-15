/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { assertNotAborted } from '../catalog/catalog-transaction.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { serializePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { serializePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { createPhotoHistoryForProfileV1, commitPhotoHistoryForProfileV1, undoPhotoHistoryForProfileV1,
	redoPhotoHistoryForProfileV1, type PhotoHistoryForProfileV1 } from '../catalog/photo-history-kernel.ts';
import { id } from '../catalog/value-validation.ts';
import { applyPhotoCommandForProfileV1 } from './photo-commands-kernel.ts';
import type { PhotoCommandProfileV1, PhotoForCommandProfileV1 } from './photo-develop-workspace-commands-kernel.ts';
import { createPhotoDevelopClipboardV2, normalizePhotoDevelopClipboardV1OrV2, type PhotoDevelopClipboardV2 } from './photo-develop-clipboard-v2.ts';
import type { PhotoDevelopClipboardV1 } from './photo-develop-clipboard.ts';
import { PhotoCommandOwnerError } from './photo-command-owner.ts';

export interface PhotoCommandOptionsKernel { readonly signal?: AbortSignal }
export interface PhotoCommandRepositoryForProfileV1<Profile extends PhotoCommandProfileV1> {
	loadPhoto(catalogId: string, photoId: string): Promise<PhotoForCommandProfileV1<Profile> | null>;
	savePhoto(value: unknown, expectedRevision: number, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoForCommandProfileV1<Profile>>;
}
type Clipboard = PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2;
const NativeController = AbortController, ANY_SIGNAL = AbortSignal.any;

function captureRepository<Profile extends PhotoCommandProfileV1>(repository: PhotoCommandRepositoryForProfileV1<Profile>): PhotoCommandRepositoryForProfileV1<Profile> {
	const load = repository.loadPhoto, save = repository.savePhoto;
	if (typeof load !== 'function' || typeof save !== 'function') throw new TypeError('Photo commands require a repository port.');
	return Object.freeze({
		loadPhoto: (...args: Parameters<typeof load>) => Reflect.apply(load, repository, args) as ReturnType<typeof load>,
		savePhoto: (...args: Parameters<typeof save>) => Reflect.apply(save, repository, args) as ReturnType<typeof save>,
	});
}
/** Capture both borrowed methods and their receiver before the real read yields. */
export async function loadPhotoCommandRepositoryV1<Profile extends PhotoCommandProfileV1>(repository: PhotoCommandRepositoryForProfileV1<Profile>, catalogId: string, photoId: string) {
	const pinned = captureRepository(repository), photo = await pinned.loadPhoto(id(catalogId, 'catalog ID'), id(photoId, 'photo ID'));
	if (!photo) throw new ReferenceError('The photo command owner cannot open a missing photo.');
	return { repository: pinned, photo };
}

/** One durable publication/lifetime loop with two fixed scalar admission profiles. */
export class PhotoCommandOwnerKernel<Profile extends PhotoCommandProfileV1> {
	#history: PhotoHistoryForProfileV1<Profile>;
	#clipboard: Clipboard | null = null;
	#pending: Promise<PhotoForCommandProfileV1<Profile>> | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;
	#admitting = false;
	readonly #lifetime = new NativeController();
	readonly #profile: Profile;
	readonly #load: PhotoCommandRepositoryForProfileV1<Profile>['loadPhoto'];
	readonly #save: PhotoCommandRepositoryForProfileV1<Profile>['savePhoto'];

	constructor(profile: Profile, readonly repository: PhotoCommandRepositoryForProfileV1<Profile>, photo: unknown, capacity = 20) {
		this.#profile = profile;
		const pinned = captureRepository(repository); this.#load = pinned.loadPhoto; this.#save = pinned.savePhoto;
		this.#history = createPhotoHistoryForProfileV1(profile, photo, capacity);
	}

	get history(): PhotoHistoryForProfileV1<Profile> { return this.#history; }
	get clipboard(): Clipboard | null { return this.#clipboard; }
	get canUndo(): boolean { return this.#history.past.length > 0; }
	get canRedo(): boolean { return this.#history.future.length > 0; }

	execute(command: unknown, options: PhotoCommandOptionsKernel = {}): Promise<PhotoForCommandProfileV1<Profile>> {
		return this.#transition(history => {
			const draft = applyPhotoCommandForProfileV1(this.#profile, history.present, command);
			return this.#serialize(draft) === this.#serialize(history.present)
				? history : commitPhotoHistoryForProfileV1(this.#profile, history, draft);
		}, options);
	}
	undo(options: PhotoCommandOptionsKernel = {}): Promise<PhotoForCommandProfileV1<Profile>> {
		return this.#transition(history => undoPhotoHistoryForProfileV1(this.#profile, history), options);
	}
	redo(options: PhotoCommandOptionsKernel = {}): Promise<PhotoForCommandProfileV1<Profile>> {
		return this.#transition(history => redoPhotoHistoryForProfileV1(this.#profile, history), options);
	}

	copyDevelop(versionId = this.#history.present.activeVersionId): PhotoDevelopClipboardV2 {
		return this.#synchronous(() => {
			const version = this.#history.present.versions.find(entry => entry.id === id(versionId, 'clipboard version ID'));
			if (!version) throw new ReferenceError('Cannot copy a missing photo version.');
			if (version.develop.processVersion >= 3) throw new RangeError('Successor develop processing requires a current clipboard adapter.');
			const packet = createPhotoDevelopClipboardV2(version.develop);
			this.#assertLive(); this.#clipboard = packet; return packet;
		});
	}
	setClipboard(value: unknown): void {
		this.#synchronous(() => { const packet = normalizePhotoDevelopClipboardV1OrV2(value); this.#assertLive(); this.#clipboard = packet; });
	}
	pasteDevelop(value: unknown = this.#clipboard, versionId?: string, options: PhotoCommandOptionsKernel = {}): Promise<PhotoForCommandProfileV1<Profile>> {
		return this.#transition(history => {
			if (value === null) throw new ReferenceError('The photo develop clipboard is empty.');
			if (this.#profile !== 'legacy2') {
				const targetId = versionId === undefined ? history.present.activeVersionId : id(versionId, 'develop version ID');
				const target = history.present.versions.find(version => version.id === targetId);
				if (!target) throw new ReferenceError('The requested photo version is missing.');
				if (target.develop.processVersion >= 3 || (target.workspace?.schemaVersion ?? 1) >= 3) {
					throw new RangeError('Successor develop processing or history requires a current clipboard adapter.');
				}
			}
			const packet = normalizePhotoDevelopClipboardV1OrV2(value);
			const draft = applyPhotoCommandForProfileV1(this.#profile, history.present, { type: 'set-develop', develop: packet.develop,
				...(versionId === undefined ? {} : { versionId }) });
			return this.#serialize(draft) === this.#serialize(history.present)
				? history : commitPhotoHistoryForProfileV1(this.#profile, history, draft);
		}, options);
	}

	reload(options: PhotoCommandOptionsKernel = {}): Promise<PhotoForCommandProfileV1<Profile>> {
		return this.#operation(async signal => {
			const before = this.#history, photo = await this.#load(before.present.catalogId, before.present.id);
			assertNotAborted(signal);
			if (!photo) throw new ReferenceError('The photo is missing.');
			this.#history = createPhotoHistoryForProfileV1(this.#profile, photo, before.capacity); return this.#history.present;
		}, options);
	}

	/** Cancel/join this owner only; the injected repository is independently owned. */
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = this.#pending?.then(() => undefined, () => undefined) ?? Promise.resolve();
		// Native abort listeners may synchronously call Close again.
		this.#lifetime.abort(); return this.#closing;
	}

	#transition(prepare: (history: PhotoHistoryForProfileV1<Profile>) => PhotoHistoryForProfileV1<Profile>, options: PhotoCommandOptionsKernel): Promise<PhotoForCommandProfileV1<Profile>> {
		return this.#operation(async signal => {
			const before = this.#history;
			let next: PhotoHistoryForProfileV1<Profile>;
			try { next = prepare(before); } catch (error) { assertNotAborted(signal); throw error; }
			assertNotAborted(signal);
			if (next === before) return before.present;
			await this.#save({ ...next.present, revision: before.present.revision }, before.present.revision, { signal });
			// Known native ACK wins late cancellation and Close.
			this.#history = next; return next.present;
		}, options);
	}

	#operation(run: (signal: AbortSignal) => Promise<PhotoForCommandProfileV1<Profile>>, options: PhotoCommandOptionsKernel): Promise<PhotoForCommandProfileV1<Profile>> {
		try { this.#assertAvailable(); } catch (error) { return Promise.reject(error); }
		let resolve!: (photo: PhotoForCommandProfileV1<Profile>) => void, reject!: (error: unknown) => void;
		const result = new Promise<PhotoForCommandProfileV1<Profile>>((accept, refuse) => { resolve = accept; reject = refuse; });
		const pending = result.finally(() => { this.#pending = null; });
		this.#pending = pending;
		// Install demand before caller reflection, cancellation callbacks or repository work.
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
	#serialize(photo: unknown): string {
		return this.#profile === 'legacy2' ? serializePhotoDocumentV1OrV2(photo) : serializePhotoDocumentCurrentV1(photo);
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
