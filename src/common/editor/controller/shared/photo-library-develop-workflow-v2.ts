/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectParameterV2 } from '../../video-effect-parameter-v2.ts';
import { normalizeVideoEffectsV2, createVideoEffectV2 } from '../../video-effects-v2.ts';
import { readClosedDomainArray } from '../../closed-domain-value.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../../imaging/image-develop-contract-v1.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../../video-cube-lut-profile-v1.ts';
import type { VideoEffectLeafV2 } from '../../video-effect-leaf-v2.ts';
import type { PhotoLibraryDevelopAcknowledgementV2, PhotoLibraryDevelopCommandV2, PhotoLibraryDevelopPortV2,
	PhotoLibraryDevelopSettingsV2, PhotoLibraryDevelopSnapshotV2, PhotoLibraryDevelopApplyV2 } from '../../photo-library-develop-port-v2.ts';
import { detachPhotoLibraryDevelopCommandV2, detachPhotoLibraryDevelopSettingsV2, capturePhotoLibraryDevelopPortV2, capturePhotoDevelopExecutionContextV2 } from './photo-library-develop-command-v2.ts';

export interface PhotoDevelopExecutionContextV2 {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<PhotoLibraryDevelopPortV2>;
	readonly isCurrent: () => boolean;
	readonly refresh: () => Promise<unknown>;
}
export type ExecutePhotoDevelopV2 = (action: (context: PhotoDevelopExecutionContextV2) => Promise<void>, signal?: AbortSignal) => Promise<unknown>;
export interface PhotoDevelopWorkflowSnapshotV2 {
	readonly visible: boolean;
	readonly busy: boolean;
	readonly document: Readonly<PhotoLibraryDevelopSnapshotV2> | null;
	readonly draft: Readonly<PhotoLibraryDevelopSettingsV2> | null;
	readonly dirty: boolean;
	readonly receipt: Readonly<PhotoLibraryDevelopAcknowledgementV2> | null;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** A menu-owned scalar coordinator borrowing the existing workflow and writer. */
export class PhotoLibraryDevelopWorkflowV2 {
	readonly #execute: ExecutePhotoDevelopV2;
	readonly #now: () => string;
	#view: PhotoDevelopWorkflowSnapshotV2 = Object.freeze({ visible: false, busy: false, document: null, draft: null,
		dirty: false, receipt: null, notice: null, error: null });
	#listener: ((snapshot: PhotoDevelopWorkflowSnapshotV2) => void) | null = null;
	#gesture: PhotoLibraryDevelopSettingsV2 | null = null;
	#pending: Promise<unknown> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#retired = false;
	#epoch = 0;
	#closing: Promise<void> | null = null;

	constructor(options: Readonly<{ execute: ExecutePhotoDevelopV2; now?: () => string }>) {
		const execute = options.execute, now = options.now ?? (() => new Date().toISOString());
		this.#execute = (...args) => Reflect.apply(execute, options, args); this.#now = () => Reflect.apply(now, options, []);
	}
	snapshot(): PhotoDevelopWorkflowSnapshotV2 { return this.#view; }
	subscribe(listener: (snapshot: PhotoDevelopWorkflowSnapshotV2) => void): () => void {
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	open(photoId: string, versionId?: string): Promise<null> {
		return this.#run(() => ({ photoId: stableId(photoId), ...(versionId === undefined ? {} : { versionId: stableId(versionId) }) }), async (context, request) => {
			this.#publish({ visible: true, document: null, draft: null, dirty: false, receipt: null, notice: null });
			const port = await this.#acquire(context); if (!port) return null;
			const document = await port.read({ schemaVersion: 2, ...request }, { signal: context.signal }); check(context.signal);
			if (document.photoId !== request.photoId || (request.versionId !== undefined && document.versionId !== request.versionId)) throw new Error('Develop response changed the requested photo or version.');
			if (this.#admittedCurrent(context)) this.#accept(document); return null;
		});
	}
	/** Keep the opted-in child dialog mounted while acknowledging an external batch. */
	reload(): Promise<null> {
		return this.#run(() => {
			const document = this.#view.document;
			if (!document || this.#view.dirty) throw new Error('Reload requires an unchanged Develop selection.');
			return { photoId: document.photoId, versionId: document.versionId };
		}, async (context, request) => {
			const port = await this.#acquire(context); if (!port) return null;
			const document = await port.read({ schemaVersion: 2, ...request }, { signal: context.signal }); check(context.signal);
			if (document.photoId !== request.photoId || document.versionId !== request.versionId) throw new Error('Develop response changed the requested photo or version.');
			if (this.#admittedCurrent(context)) this.#accept(document); return null;
		});
	}
	setEffects(value: readonly VideoEffectLeafV2[]): void {
		if (!this.#editable()) return;
		const draft = this.#view.draft!, effects = normalizeVideoEffectsV2(readClosedDomainArray(value, 'Develop effects', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects));
		const processVersion = draft.processVersion === 2 || effects.some(effect => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1) ? 2 : 1;
		const retained = new Set(effects.map(effect => effect.id));
		const maskBindings = draft.maskBindings.filter(binding => retained.has(binding.effectId));
		const next = detachPhotoLibraryDevelopSettingsV2({ ...draft, processVersion, effects, maskBindings });
		if (this.#editable() && this.#view.draft === draft) { this.#gesture = null; this.#setDraft(next); }
	}
	/** Whole-recipe edits keep masks and bindings under the existing Save writer. */
	edit(value: PhotoLibraryDevelopSettingsV2): void {
		if (!this.#editable()) return;
		const draft = this.#view.draft!, next = detachPhotoLibraryDevelopSettingsV2(value);
		if (this.#editable() && this.#view.draft === draft) { this.#gesture = null; this.#setDraft(next); }
	}
	beginGesture(): void { if (this.#editable() && !this.#gesture) this.#gesture = this.#view.draft; }
	previewEffect(id: string, params: Readonly<Record<string, VideoEffectParameterV2>>): void {
		if (!this.#editable()) return; this.beginGesture();
		const draft = this.#view.draft!;
		const effects = draft.effects.map(effect => effect.id === id
			? createVideoEffectV2(effect.type, { ...effect, params: { ...effect.params, ...params } }) : effect);
		const next = detachPhotoLibraryDevelopSettingsV2({ ...draft, effects });
		if (this.#editable() && this.#view.draft === draft) this.#setDraft(next);
	}
	commitGesture(): void { this.#gesture = null; }
	cancelGesture(): void { const original = this.#gesture; this.#gesture = null; if (original && this.#editable()) this.#setDraft(original); }
	discard(): void { if (this.#editable()) this.#accept(this.#view.document!); }
	save(label: string): Promise<PhotoLibraryDevelopAcknowledgementV2 | null> {
		if (!this.#view.document || !this.#view.draft || !this.#view.dirty) return Promise.resolve(null);
		return this.#run(() => {
			const document = this.#view.document!, draft = this.#view.draft!;
			return this.#request({ type: 'record-develop', versionId: document.versionId, develop: draft, label, createdAt: this.#now() });
		}, (context, request) => this.#apply(context, request));
	}
	apply(value: PhotoLibraryDevelopCommandV2): Promise<PhotoLibraryDevelopAcknowledgementV2 | null> {
		return this.#run(() => this.#request(value), (context, request) => this.#apply(context, request));
	}
	#request(value: PhotoLibraryDevelopCommandV2): Readonly<PhotoLibraryDevelopApplyV2> {
		const document = this.#view.document;
		if (!document || !this.#view.visible) throw new Error('Develop selection is unavailable.');
		const command = detachPhotoLibraryDevelopCommandV2(value);
		if ('versionId' in command && command.type !== 'activate-version' && command.versionId !== document.versionId) throw new Error('Develop command belongs to another version.');
		if (command.type === 'activate-version' && !document.versions.some(version => version.id === command.versionId)) throw new Error('The requested version is missing.');
		if (command.type === 'create-virtual-copy' && command.sourceVersionId !== document.versionId) throw new Error('Virtual copy belongs to another version.');
		return Object.freeze({ schemaVersion: 2, photoId: document.photoId, expectedRevision: document.revision, command });
	}
	async #apply(context: PhotoDevelopExecutionContextV2, request: Readonly<PhotoLibraryDevelopApplyV2>): Promise<PhotoLibraryDevelopAcknowledgementV2 | null> {
		const port = await this.#acquire(context); if (!port) return null;
		const receipt = await port.apply(request, { signal: context.signal });
		// A completed native ACK survives late cancellation and retired presentation.
		if (receipt.schemaVersion !== 2 || receipt.snapshot.photoId !== request.photoId) throw new Error('Develop acknowledgment changed schema or photo identity.');
		if (!this.#acknowledgedCurrent(context)) return receipt;
		this.#accept(receipt.snapshot); this.#publish({ receipt, notice: null });
		try { check(context.signal); await context.refresh(); check(context.signal); }
		catch { if (this.#acknowledgedCurrent(context)) this.#publish({ notice: 'refresh-failed' }); }
		return receipt;
	}
	async #acquire(context: PhotoDevelopExecutionContextV2): Promise<Readonly<PhotoLibraryDevelopPortV2> | null> {
		if (!this.#admittedCurrent(context)) return null;
		const value = await context.acquire(); if (!this.#admittedCurrent(context)) return null;
		try { const port = capturePhotoLibraryDevelopPortV2(value); return this.#admittedCurrent(context) ? port : null; }
		catch (error) { check(context.signal); throw error; }
	}
	cancel(): Promise<void> { this.#active?.abort(); return this.#pending ? this.#pending.then(() => undefined, () => undefined) : Promise.resolve(); }
	resume(): void { if (!this.#closed) this.#retired = false; }
	retire(): Promise<void> { this.#retired = true; this.#epoch++; this.#publish({ visible: false }); return this.cancel(); }
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; this.#retired = true; this.#epoch++; this.#listener = null;
		this.#view = Object.freeze({ ...this.#view, visible: false });
		this.#closing = Promise.resolve().then(() => this.cancel()); return this.#closing;
	}

	#editable(): boolean { return !this.#closed && !this.#retired && !this.#pending && this.#view.visible && this.#view.document !== null && this.#view.draft !== null; }
	#current(context: PhotoDevelopExecutionContextV2): boolean {
		const current = context.isCurrent(); return !this.#closed && !this.#retired && current;
	}
	#admittedCurrent(context: PhotoDevelopExecutionContextV2): boolean {
		check(context.signal);
		try { const current = this.#current(context); check(context.signal); return current; }
		catch (error) { check(context.signal); throw error; }
	}
	#acknowledgedCurrent(context: PhotoDevelopExecutionContextV2): boolean {
		try { return this.#current(context); } catch { return false; }
	}
	#admit<Value>(admit: () => Value, signal: AbortSignal): Value {
		check(signal);
		try { const value = admit(); check(signal); return value; }
		catch (error) { check(signal); throw error; }
	}
	#isCurrent(context: PhotoDevelopExecutionContextV2, epoch: number): boolean {
		const current = context.isCurrent(); return epoch === this.#epoch && !this.#closed && !this.#retired && current;
	}
	#publish(update: Partial<PhotoDevelopWorkflowSnapshotV2>): void {
		if (this.#closed) return; this.#view = Object.freeze({ ...this.#view, ...update });
		try { this.#listener?.(this.#view); } catch { /* An observer cannot strand joined work or erase an ACK. */ }
	}
	#accept(document: PhotoLibraryDevelopSnapshotV2): void {
		if (document.schemaVersion !== 2) throw new RangeError('Current Develop requires schema2 snapshots.');
		const draft = detachPhotoLibraryDevelopSettingsV2(document.develop); this.#gesture = null;
		this.#publish({ document, draft, dirty: false, error: null });
	}
	#setDraft(draft: PhotoLibraryDevelopSettingsV2): void {
		this.#publish({ draft, dirty: JSON.stringify(draft) !== JSON.stringify(this.#view.document?.develop), error: null });
	}
	#run<Input, Result>(admit: () => Input, action: (context: PhotoDevelopExecutionContextV2, input: Input) => Promise<Result>): Promise<Result | null> {
		if (this.#closed || this.#retired || this.#pending) return Promise.resolve(null);
		const epoch = this.#epoch;
		const stop = new AbortController(); this.#active = stop;
		let resolve!: (result: Result | null) => void;
		const pending = new Promise<Result | null>(accept => { resolve = accept; }); this.#pending = pending;
		this.#publish({ busy: true, error: null });
		const run = async (): Promise<Result | null> => {
			let result: Result | null = null;
			try {
				if (this.#closed || this.#retired || epoch !== this.#epoch) return null;
				const input = this.#admit(admit, stop.signal);
				if (this.#closed || this.#retired || epoch !== this.#epoch) return null;
				await this.#execute(async context => {
					if (this.#closed || this.#retired || epoch !== this.#epoch) return;
					const signal = context.signal;
					try {
						const borrowed = this.#admit(() => capturePhotoDevelopExecutionContextV2(context, signal), stop.signal);
						if (this.#closed || this.#retired || epoch !== this.#epoch) return;
						result = await action({ ...borrowed, isCurrent: () => this.#isCurrent(borrowed, epoch) }, input);
					} catch (error) { if (!(Reflect.apply(ABORTED, signal, []) && Object.is(Reflect.apply(REASON, signal, []), error))) throw error; }
				}, stop.signal);
			} catch (error) {
				if (!(Reflect.apply(ABORTED, stop.signal, []) && Object.is(Reflect.apply(REASON, stop.signal, []), error))) {
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
