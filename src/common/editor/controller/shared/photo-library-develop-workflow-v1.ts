/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectParameterV1 } from '../../video-curve-types-v1.ts';
import { normalizeVideoEffects, createVideoEffect } from '../../video-effects.js';
import type { VideoEffectLeaf } from '../../project-media-types.ts';
import type { PhotoLibraryDevelopAcknowledgementV1, PhotoLibraryDevelopCommandV1, PhotoLibraryDevelopPortV1,
	PhotoLibraryDevelopSettingsV1, PhotoLibraryDevelopSnapshotV1 } from '../../photo-library-develop-port-v1.ts';
import { detachPhotoLibraryDevelopCommandV1, detachPhotoLibraryDevelopSettingsV1 } from './photo-library-develop-command.ts';

export interface PhotoDevelopExecutionContextV1 {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<PhotoLibraryDevelopPortV1>;
	readonly isCurrent: () => boolean;
	readonly refresh: () => Promise<unknown>;
}
export type ExecutePhotoDevelopV1 = (action: (context: PhotoDevelopExecutionContextV1) => Promise<void>, signal?: AbortSignal) => Promise<unknown>;
export interface PhotoDevelopWorkflowSnapshotV1 {
	readonly visible: boolean;
	readonly busy: boolean;
	readonly document: Readonly<PhotoLibraryDevelopSnapshotV1> | null;
	readonly draft: Readonly<PhotoLibraryDevelopSettingsV1> | null;
	readonly dirty: boolean;
	readonly receipt: Readonly<PhotoLibraryDevelopAcknowledgementV1> | null;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** A menu-owned scalar coordinator borrowing the existing workflow and writer. */
export class PhotoLibraryDevelopWorkflowV1 {
	readonly #execute: ExecutePhotoDevelopV1;
	readonly #now: () => string;
	#view: PhotoDevelopWorkflowSnapshotV1 = Object.freeze({ visible: false, busy: false, document: null, draft: null,
		dirty: false, receipt: null, notice: null, error: null });
	#listener: ((snapshot: PhotoDevelopWorkflowSnapshotV1) => void) | null = null;
	#gesture: PhotoLibraryDevelopSettingsV1 | null = null;
	#pending: Promise<unknown> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#retired = false;
	#epoch = 0;

	constructor(options: Readonly<{ execute: ExecutePhotoDevelopV1; now?: () => string }>) {
		this.#execute = options.execute; this.#now = options.now ?? (() => new Date().toISOString());
	}
	snapshot(): PhotoDevelopWorkflowSnapshotV1 { return this.#view; }
	subscribe(listener: (snapshot: PhotoDevelopWorkflowSnapshotV1) => void): () => void {
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	open(photoId: string, versionId?: string): Promise<null> {
		return this.#run(() => ({ photoId: stableId(photoId), ...(versionId === undefined ? {} : { versionId: stableId(versionId) }) }), async (context, request) => {
			this.#publish({ visible: true, document: null, draft: null, dirty: false, receipt: null, notice: null });
			const port = await context.acquire(); check(context.signal); if (!this.#current(context)) return null;
			const document = await port.read({ schemaVersion: 1, ...request }, { signal: context.signal }); check(context.signal);
			if (document.photoId !== request.photoId || (request.versionId !== undefined && document.versionId !== request.versionId)) throw new Error('Develop response changed the requested photo or version.');
			if (this.#current(context)) this.#accept(document); return null;
		});
	}
	/** Keep the opted-in child dialog mounted while acknowledging an external batch. */
	reload(): Promise<null> {
		return this.#run(() => {
			const document = this.#view.document;
			if (!document || this.#view.dirty) throw new Error('Reload requires an unchanged Develop selection.');
			return { photoId: document.photoId, versionId: document.versionId };
		}, async (context, request) => {
			const port = await context.acquire(); check(context.signal); if (!this.#current(context)) return null;
			const document = await port.read({ schemaVersion: 1, ...request }, { signal: context.signal }); check(context.signal);
			if (document.photoId !== request.photoId || document.versionId !== request.versionId) throw new Error('Develop response changed the requested photo or version.');
			if (this.#current(context)) this.#accept(document); return null;
		});
	}
	setEffects(value: readonly VideoEffectLeaf[]): void {
		if (!this.#editable()) return;
		const effects = normalizeVideoEffects(value) as VideoEffectLeaf[];
		this.#setDraft(detachPhotoLibraryDevelopSettingsV1({ ...this.#view.draft, effects }));
	}
	beginGesture(): void { if (this.#editable() && !this.#gesture) this.#gesture = this.#view.draft; }
	previewEffect(id: string, params: Readonly<Record<string, VideoEffectParameterV1>>): void {
		if (!this.#editable()) return; this.beginGesture();
		this.setEffects(this.#view.draft!.effects.map(effect => effect.id === id
			? createVideoEffect(effect.type, { ...effect, params: { ...effect.params, ...params } }) as VideoEffectLeaf : effect));
	}
	commitGesture(): void { this.#gesture = null; }
	cancelGesture(): void { const original = this.#gesture; this.#gesture = null; if (original && this.#editable()) this.#setDraft(original); }
	discard(): void { if (this.#editable()) this.#accept(this.#view.document!); }
	save(label: string): Promise<PhotoLibraryDevelopAcknowledgementV1 | null> {
		const document = this.#view.document, draft = this.#view.draft;
		if (!document || !draft || !this.#view.dirty) return Promise.resolve(null);
		return this.apply({ type: 'record-develop', versionId: document.versionId, develop: draft, label, createdAt: this.#now() });
	}
	apply(value: PhotoLibraryDevelopCommandV1): Promise<PhotoLibraryDevelopAcknowledgementV1 | null> {
		return this.#run(() => {
			if (!this.#view.document || !this.#view.visible) throw new Error('Develop selection is unavailable.');
			const command = detachPhotoLibraryDevelopCommandV1(value), document = this.#view.document;
			if ('versionId' in command && command.type !== 'activate-version' && command.versionId !== document.versionId) throw new Error('Develop command belongs to another version.');
			if (command.type === 'activate-version' && !document.versions.some(version => version.id === command.versionId)) throw new Error('The requested version is missing.');
			if (command.type === 'create-virtual-copy' && command.sourceVersionId !== document.versionId) throw new Error('Virtual copy belongs to another version.');
			return Object.freeze({ schemaVersion: 1 as const, photoId: document.photoId, expectedRevision: document.revision, command });
		}, async (context, request) => {
			const port = await context.acquire(); check(context.signal); if (!this.#current(context)) return null;
			const receipt = await port.apply(request, { signal: context.signal });
			// Native ACK is returned even when cancellation or retirement arrives later.
			if (!this.#current(context)) return receipt;
			if (receipt.snapshot.photoId !== request.photoId) throw new Error('Develop acknowledgment changed photo identity.');
			this.#accept(receipt.snapshot); this.#publish({ receipt, notice: null });
			try { check(context.signal); await context.refresh(); check(context.signal); }
			catch { if (this.#current(context)) this.#publish({ notice: 'refresh-failed' }); }
			return receipt;
		});
	}
	cancel(): Promise<void> { this.#active?.abort(); return this.#pending ? this.#pending.then(() => undefined, () => undefined) : Promise.resolve(); }
	resume(): void { if (!this.#closed) this.#retired = false; }
	retire(): Promise<void> { this.#retired = true; this.#epoch++; this.#publish({ visible: false }); return this.cancel(); }
	close(): Promise<void> { const joined = this.retire(); this.#closed = true; this.#listener = null; return joined; }

	#editable(): boolean { return !this.#closed && !this.#retired && !this.#pending && this.#view.visible && this.#view.document !== null && this.#view.draft !== null; }
	#current(context: PhotoDevelopExecutionContextV1): boolean { return !this.#closed && !this.#retired && context.isCurrent(); }
	#publish(update: Partial<PhotoDevelopWorkflowSnapshotV1>): void {
		if (this.#closed) return; this.#view = Object.freeze({ ...this.#view, ...update });
		try { this.#listener?.(this.#view); } catch { /* An observer cannot strand joined work or erase an ACK. */ }
	}
	#accept(document: PhotoLibraryDevelopSnapshotV1): void {
		const draft = detachPhotoLibraryDevelopSettingsV1(document.develop); this.#gesture = null;
		this.#publish({ document, draft, dirty: false, error: null });
	}
	#setDraft(draft: PhotoLibraryDevelopSettingsV1): void {
		this.#publish({ draft, dirty: JSON.stringify(draft) !== JSON.stringify(this.#view.document?.develop), error: null });
	}
	#run<Input, Result>(admit: () => Input, action: (context: PhotoDevelopExecutionContextV1, input: Input) => Promise<Result>): Promise<Result | null> {
		if (this.#closed || this.#retired || this.#pending) return Promise.resolve(null);
		const epoch = this.#epoch;
		const stop = new AbortController(); this.#active = stop;
		let resolve!: (result: Result | null) => void;
		const pending = new Promise<Result | null>(accept => { resolve = accept; }); this.#pending = pending;
		this.#publish({ busy: true, error: null });
		const run = async (): Promise<Result | null> => {
			let result: Result | null = null;
			try {
				const input = admit(); check(stop.signal);
				await this.#execute(async context => { result = await action({ ...context,
					isCurrent: () => epoch === this.#epoch && context.isCurrent() }, input); }, stop.signal);
			} catch (error) {
				if (!(Reflect.apply(ABORTED, stop.signal, []) && Reflect.apply(REASON, stop.signal, []) === error)) {
					this.#publish({ error: diagnostic(error) });
				}
			} finally { this.#pending = null; this.#active = null; this.#publish({ busy: false }); }
			return result;
		};
		void run().then(resolve); return pending;
	}
}
function stableId(value: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Develop requires a stable photo/version ID.'); return value;
}
function diagnostic(value: unknown): string {
	try { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2048); }
	catch { /* Opaque failures never replace joined work or native receipts. */ }
	return 'The develop action failed.';
}
