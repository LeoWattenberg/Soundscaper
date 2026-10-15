/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectParameterV2 } from '../../../video-effect-parameter-v2.ts';
import { normalizeVideoEffectsV2, createVideoEffectV2 } from '../../../video-effects-v2.ts';
import { readClosedDomainArray } from '../../../closed-domain-value.ts';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../../../imaging/image-develop-contract-v1.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../../../video-cube-lut-profile-v1.ts';
import type { VideoEffectLeafV2 } from '../../../video-effect-leaf-v2.ts';
import type { PhotoLibraryDevelopAcknowledgementV2, PhotoLibraryDevelopSnapshotV2, PhotoLibraryDevelopApplyV2 } from '../../../photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopAcknowledgementV3, PhotoLibraryDevelopSnapshotV3, PhotoLibraryDevelopApplyV3 } from '../../../photo-library-develop-port-v3.ts';
import type { PhotoLibraryDevelopAcknowledgementCurrentV1, PhotoLibraryDevelopSnapshotCurrentV1,
	PhotoLibraryDevelopApplyCurrentV1 } from '../../../photo-library-develop-port-current-v1.ts';
import { detachPhotoDevelopCommandForProfileV1, detachPhotoDevelopSettingsForProfileV1, capturePhotoDevelopPortForProfileV1, capturePhotoDevelopContextForProfileV1,
	type PhotoDevelopProfileV1, type PhotoDevelopCommandForProfileV1, type PhotoDevelopSettingsForProfileV1, type PhotoDevelopPortForProfileV1 } from './photo-library-develop-command-kernel-v1.ts';

export interface PhotoDevelopExecutionContextForProfileV1<Profile extends PhotoDevelopProfileV1> {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<PhotoDevelopPortForProfileV1<Profile>>;
	readonly isCurrent: () => boolean;
	readonly refresh: () => Promise<unknown>;
}
export type ExecutePhotoDevelopForProfileV1<Profile extends PhotoDevelopProfileV1> = (action: (context: PhotoDevelopExecutionContextForProfileV1<Profile>) => Promise<void>, signal?: AbortSignal) => Promise<unknown>;
export type PhotoDevelopDocumentForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopSnapshotV2
	: Profile extends 'current3' ? PhotoLibraryDevelopSnapshotV3 : PhotoLibraryDevelopSnapshotCurrentV1;
export type PhotoDevelopAcknowledgementForProfileV1<Profile extends PhotoDevelopProfileV1> =
	(Profile extends 'legacy2' ? Omit<PhotoLibraryDevelopAcknowledgementV2, 'snapshot'> : Profile extends 'current3'
		? Omit<PhotoLibraryDevelopAcknowledgementV3, 'snapshot'> : Omit<PhotoLibraryDevelopAcknowledgementCurrentV1, 'snapshot'>)
	& Readonly<{ snapshot: Readonly<PhotoDevelopDocumentForProfileV1<Profile>> }>;
export type PhotoDevelopApplyForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopApplyV2
	: Profile extends 'current3' ? PhotoLibraryDevelopApplyV3 : PhotoLibraryDevelopApplyCurrentV1;
export interface PhotoDevelopWorkflowSnapshotForProfileV1<Profile extends PhotoDevelopProfileV1> {
	readonly visible: boolean;
	readonly busy: boolean;
	readonly document: Readonly<PhotoDevelopDocumentForProfileV1<Profile>> | null;
	readonly draft: Readonly<PhotoDevelopSettingsForProfileV1<Profile>> | null;
	readonly dirty: boolean;
	readonly receipt: Readonly<PhotoDevelopAcknowledgementForProfileV1<Profile>> | null;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** A menu-owned scalar coordinator borrowing the existing workflow and writer. */
export class PhotoLibraryDevelopWorkflowKernelV1<Profile extends PhotoDevelopProfileV1> {
	readonly #profile: Profile;
	readonly #execute: ExecutePhotoDevelopForProfileV1<Profile>;
	readonly #now: () => string;
	#view: PhotoDevelopWorkflowSnapshotForProfileV1<Profile> = Object.freeze({ visible: false, busy: false, document: null, draft: null,
		dirty: false, receipt: null, notice: null, error: null });
	#listener: ((snapshot: PhotoDevelopWorkflowSnapshotForProfileV1<Profile>) => void) | null = null;
	#gesture: Readonly<PhotoDevelopSettingsForProfileV1<Profile>> | null = null;
	#pending: Promise<unknown> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#retired = false;
	#epoch = 0;
	#closing: Promise<void> | null = null;

	constructor(profile: Profile, options: Readonly<{ execute: ExecutePhotoDevelopForProfileV1<Profile>; now?: () => string }>) {
		if (profile !== 'legacy2' && profile !== 'current3' && profile !== 'current4') throw new TypeError('Unsupported Develop authoring profile.');
		this.#profile = profile;
		const execute = options.execute, now = options.now ?? (() => new Date().toISOString());
		this.#execute = (...args) => Reflect.apply(execute, options, args); this.#now = () => Reflect.apply(now, options, []);
	}
	snapshot(): PhotoDevelopWorkflowSnapshotForProfileV1<Profile> { return this.#view; }
	subscribe(listener: (snapshot: PhotoDevelopWorkflowSnapshotForProfileV1<Profile>) => void): () => void {
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	open(photoId: string, versionId?: string): Promise<null> {
		return this.#run(() => ({ photoId: stableId(photoId), ...(versionId === undefined ? {} : { versionId: stableId(versionId) }) }), async (context, request) => {
			this.#publish({ visible: true, document: null, draft: null, dirty: false, receipt: null, notice: null });
			const port = await this.#acquire(context); if (!port) return null;
			const document = await (Reflect.apply(port.read, port, [{ schemaVersion: this.#schema, ...request }, { signal: context.signal }]) as Promise<PhotoDevelopDocumentForProfileV1<Profile>>); check(context.signal);
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
			const document = await (Reflect.apply(port.read, port, [{ schemaVersion: this.#schema, ...request }, { signal: context.signal }]) as Promise<PhotoDevelopDocumentForProfileV1<Profile>>); check(context.signal);
			if (document.photoId !== request.photoId || document.versionId !== request.versionId) throw new Error('Develop response changed the requested photo or version.');
			if (this.#admittedCurrent(context)) this.#accept(document); return null;
		});
	}
	setEffects(value: readonly VideoEffectLeafV2[]): void {
		if (!this.#editable()) return;
		const draft = this.#view.draft!, effects = normalizeVideoEffectsV2(readClosedDomainArray(value, 'Develop effects', 0, IMAGE_DEVELOP_LIMITS_V1.maximumEffects));
		const processVersion = this.#profile === 'current4' && draft.processVersion === 4 ? 4 : this.#profile !== 'legacy2' && draft.processVersion === 3 ? 3
			: draft.processVersion === 2 || effects.some(effect => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1) ? 2 : 1;
		const retained = new Set(effects.map(effect => effect.id));
		const maskBindings = draft.maskBindings.filter(binding => retained.has(binding.effectId));
		const next = detachPhotoDevelopSettingsForProfileV1(this.#profile, { ...draft, processVersion, effects, maskBindings });
		if (this.#editable() && this.#view.draft === draft) { this.#gesture = null; this.#setDraft(next); }
	}
	/** Whole-recipe edits keep masks and bindings under the existing Save writer. */
	edit(value: PhotoDevelopSettingsForProfileV1<Profile>): void {
		if (!this.#editable()) return;
		const draft = this.#view.draft!, next = detachPhotoDevelopSettingsForProfileV1(this.#profile, value);
		if (this.#profile !== 'legacy2' && (draft.processVersion === 3 && next.processVersion < 3 || draft.processVersion === 4 && next.processVersion !== 4)) {
			throw new RangeError('An authored repair or RAW draft cannot downgrade its process version.');
		}
		if (this.#editable() && this.#view.draft === draft) { this.#gesture = null; this.#setDraft(next); }
	}
	beginGesture(): void { if (this.#editable() && !this.#gesture) this.#gesture = this.#view.draft; }
	previewEffect(id: string, params: Readonly<Record<string, VideoEffectParameterV2>>): void {
		if (!this.#editable()) return; this.beginGesture();
		const draft = this.#view.draft!;
		const effects = draft.effects.map(effect => effect.id === id
			? createVideoEffectV2(effect.type, { ...effect, params: { ...effect.params, ...params } }) : effect);
		const next = detachPhotoDevelopSettingsForProfileV1(this.#profile, { ...draft, effects });
		if (this.#editable() && this.#view.draft === draft) this.#setDraft(next);
	}
	commitGesture(): void { this.#gesture = null; }
	cancelGesture(): void { const original = this.#gesture; this.#gesture = null; if (original && this.#editable()) this.#setDraft(original); }
	discard(): void { if (this.#editable()) this.#accept(this.#view.document!); }
	save(label: string): Promise<PhotoDevelopAcknowledgementForProfileV1<Profile> | null> {
		if (!this.#view.document || !this.#view.draft || !this.#view.dirty) return Promise.resolve(null);
		return this.#run(() => {
			const document = this.#view.document!, draft = this.#view.draft!;
			return this.#request({ type: 'record-develop', versionId: document.versionId, develop: draft, label, createdAt: this.#now() });
		}, (context, request) => this.#apply(context, request));
	}
	apply(value: PhotoDevelopCommandForProfileV1<Profile>): Promise<PhotoDevelopAcknowledgementForProfileV1<Profile> | null> {
		return this.#run(() => this.#request(value), (context, request) => this.#apply(context, request));
	}
	#request(value: unknown): Readonly<PhotoDevelopApplyForProfileV1<Profile>> {
		const document = this.#view.document;
		if (!document || !this.#view.visible) throw new Error('Develop selection is unavailable.');
		const command = detachPhotoDevelopCommandForProfileV1(this.#profile, value);
		if ('versionId' in command && command.type !== 'activate-version' && command.versionId !== document.versionId) throw new Error('Develop command belongs to another version.');
		if (command.type === 'activate-version' && !document.versions.some(version => version.id === command.versionId)) throw new Error('The requested version is missing.');
		if (command.type === 'create-virtual-copy' && command.sourceVersionId !== document.versionId) throw new Error('Virtual copy belongs to another version.');
		const binding = { photoId: document.photoId, expectedRevision: document.revision };
		const request: PhotoLibraryDevelopApplyV2 | PhotoLibraryDevelopApplyV3 | PhotoLibraryDevelopApplyCurrentV1 = this.#profile === 'legacy2'
			? Object.freeze({ ...binding, schemaVersion: 2, command: detachPhotoDevelopCommandForProfileV1('legacy2', command) })
			: this.#profile === 'current3' ? Object.freeze({ ...binding, schemaVersion: 3, command: detachPhotoDevelopCommandForProfileV1('current3', command) })
				: Object.freeze({ ...binding, schemaVersion: 3, command: detachPhotoDevelopCommandForProfileV1('current4', command) });
		// Each branch proves the correlated fixed schema and command policy.
		return request as PhotoDevelopApplyForProfileV1<Profile>;
	}
	async #apply(context: PhotoDevelopExecutionContextForProfileV1<Profile>, request: Readonly<PhotoDevelopApplyForProfileV1<Profile>>): Promise<PhotoDevelopAcknowledgementForProfileV1<Profile> | null> {
		const port = await this.#acquire(context); if (!port) return null;
		const receipt = await (Reflect.apply(port.apply, port, [request, { signal: context.signal }]) as Promise<PhotoDevelopAcknowledgementForProfileV1<Profile>>);
		// A completed native ACK survives late cancellation and retired presentation.
		if (receipt.schemaVersion !== this.#schema || receipt.snapshot.photoId !== request.photoId) throw new Error('Develop acknowledgment changed schema or photo identity.');
		if (!this.#acknowledgedCurrent(context)) return receipt;
		this.#accept(receipt.snapshot); this.#publish({ receipt, notice: null });
		try { check(context.signal); await context.refresh(); check(context.signal); }
		catch { if (this.#acknowledgedCurrent(context)) this.#publish({ notice: 'refresh-failed' }); }
		return receipt;
	}
	async #acquire(context: PhotoDevelopExecutionContextForProfileV1<Profile>): Promise<Readonly<PhotoDevelopPortForProfileV1<Profile>> | null> {
		if (!this.#admittedCurrent(context)) return null;
		const value = await context.acquire(); if (!this.#admittedCurrent(context)) return null;
		try { const port = capturePhotoDevelopPortForProfileV1(this.#profile, value); return this.#admittedCurrent(context) ? port : null; }
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

	get #schema(): 2 | 3 { return this.#profile === 'legacy2' ? 2 : 3; }
	#editable(): boolean { return !this.#closed && !this.#retired && !this.#pending && this.#view.visible && this.#view.document !== null && this.#view.draft !== null; }
	#current(context: PhotoDevelopExecutionContextForProfileV1<Profile>): boolean {
		const current = context.isCurrent(); return !this.#closed && !this.#retired && current;
	}
	#admittedCurrent(context: PhotoDevelopExecutionContextForProfileV1<Profile>): boolean {
		check(context.signal);
		try { const current = this.#current(context); check(context.signal); return current; }
		catch (error) { check(context.signal); throw error; }
	}
	#acknowledgedCurrent(context: PhotoDevelopExecutionContextForProfileV1<Profile>): boolean {
		try { return this.#current(context); } catch { return false; }
	}
	#admit<Value>(admit: () => Value, signal: AbortSignal): Value {
		check(signal);
		try { const value = admit(); check(signal); return value; }
		catch (error) { check(signal); throw error; }
	}
	#isCurrent(context: PhotoDevelopExecutionContextForProfileV1<Profile>, epoch: number): boolean {
		const current = context.isCurrent(); return epoch === this.#epoch && !this.#closed && !this.#retired && current;
	}
	#publish(update: Partial<PhotoDevelopWorkflowSnapshotForProfileV1<Profile>>): void {
		if (this.#closed) return; this.#view = Object.freeze({ ...this.#view, ...update });
		try { this.#listener?.(this.#view); } catch { /* An observer cannot strand joined work or erase an ACK. */ }
	}
	#accept(document: Readonly<PhotoDevelopDocumentForProfileV1<Profile>>): void {
		if (document.schemaVersion !== this.#schema) throw new RangeError(`Current Develop requires schema${this.#schema} snapshots.`);
		const draft = detachPhotoDevelopSettingsForProfileV1(this.#profile, document.develop); this.#gesture = null;
		this.#publish({ document, draft, dirty: false, error: null });
	}
	#setDraft(draft: Readonly<PhotoDevelopSettingsForProfileV1<Profile>>): void {
		this.#publish({ draft, dirty: JSON.stringify(draft) !== JSON.stringify(this.#view.document?.develop), error: null });
	}
	#run<Input, Result>(admit: () => Input, action: (context: PhotoDevelopExecutionContextForProfileV1<Profile>, input: Input) => Promise<Result>): Promise<Result | null> {
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
						const borrowed = this.#admit(() => capturePhotoDevelopContextForProfileV1(this.#profile, context, signal), stop.signal);
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
