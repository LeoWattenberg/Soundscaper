/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../imaging/pixel-frame-repair-lifetime-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../../imaging/image-develop-raw-development-current-v1.ts';
import { normalizeImageDevelopRawDevelopmentV1 } from '../../imaging/image-develop-raw-development-v1.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../imaging/image-develop-state-v4.ts';
import { assertRawRecoveryFrameAuthorityV1 } from '../../raw/internal/raw-recovery-frame-authority-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../../photo-library-develop-original-current-v1.ts';
import type { ImageDevelopRawDevelopmentModeV1 } from '../../imaging/image-develop-raw-development-v1.ts';
import type { RawRecoveryProfileV2 } from '../../raw/libraw-runtime-v2.ts';

type Binding = Readonly<{ photoId: string; revision: number; develop: Readonly<ImageDevelopStateThroughV4>; original: unknown }>;
type Prepared = Readonly<{ next: Readonly<ImageDevelopStateThroughV4> }> | Readonly<{ next: Readonly<ImageDevelopStateThroughV4>;
	original: unknown; method: PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame']; photoId: string; revision: number; profile: RawRecoveryProfileV2 }>;

/** Admit an explicit scalar source edit. Only an active matching native plane
 * proves a noncanonical selection; the complete borrowed operation must retire
 * before its scalar recipe becomes ready for the existing Save writer. */
export async function preparePhotoLibraryRawDevelopmentEditCurrentV1(value: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<ImageDevelopStateThroughV4>> {
	const own = typeof options === 'object' && options !== null ? Object.getOwnPropertyDescriptor(options, 'signal') : undefined;
	if (own && !Object.hasOwn(own, 'value')) throw new TypeError('RAW mode cancellation must be own data.');
	const signal = captureRepairSignalV1(own?.value), check = () => { checkRepairSignalV1(signal); }; check();
	const prepared = (() => { try { record(options, 'RAW mode options', ['signal'], []); return captureEdit(value, signal); }
		catch (error) { check(); throw error; } })();
	return execute(prepared, signal);
}

function captureBinding(input: Readonly<Record<string, unknown>>): Binding {
	const photoId = field(input, 'photoId', 'RAW mode edit'), revision = field(input, 'revision', 'RAW mode edit');
	if (typeof photoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(photoId)
		|| typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) throw new RangeError('RAW mode edit requires its exact bounded photo identity and revision.');
	return Object.freeze({ photoId, revision, develop: normalizeImageDevelopStateThroughV4(field(input, 'develop', 'RAW mode edit')),
		original: field(input, 'original', 'RAW mode edit') });
}
function captureEdit(value: unknown, signal?: AbortSignal): Prepared {
	checkRepairSignalV1(signal);
	const input = record(value, 'RAW mode edit', ['photoId', 'revision', 'develop', 'mode', 'original']);
	const binding = captureBinding(input), raw = normalizeImageDevelopRawDevelopmentV1({ schemaVersion: 1, mode: field(input, 'mode', 'RAW mode edit') });
	const next = setImageDevelopRawDevelopmentCurrentV1(binding.develop, raw);
	if (raw.mode === 'canonical') return Object.freeze({ next });
	const original = binding.original, capability = record(original, 'RAW mode Original capability', ['withFrame', 'withDerivedFrame'], ['withDerivedFrame']);
	const method = field(capability, 'withDerivedFrame', 'RAW mode Original capability');
	if (typeof method !== 'function') throw new TypeError('RAW mode requires a native derived Original capability.');
	const profile = raw.mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1';
	checkRepairSignalV1(signal); return Object.freeze({ next, original, method: method as PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame'],
		photoId: binding.photoId, revision: binding.revision, profile });
}
async function execute(prepared: Prepared, signal?: AbortSignal): Promise<Readonly<ImageDevelopStateThroughV4>> {
	const check = () => { checkRepairSignalV1(signal); };
	if (!('method' in prepared)) { check(); return prepared.next; }
	let proved = false;
	await (Reflect.apply(prepared.method, prepared.original, [{ schemaVersion: 1, photoId: prepared.photoId, expectedRevision: prepared.revision, profile: prepared.profile },
		(value: unknown) => {
			check();
			const input = record(value, 'RAW mode native frame', ['frame', 'rawFlip', 'profile', 'exposureScale', 'photoId', 'revision']);
			if (proved || field(input, 'photoId', 'RAW mode native frame') !== prepared.photoId || field(input, 'revision', 'RAW mode native frame') !== prepared.revision
				|| field(input, 'profile', 'RAW mode native frame') !== prepared.profile) throw new RangeError('RAW mode native frame changed its selected identity, revision or profile.');
			assertRawRecoveryFrameAuthorityV1(field(input, 'frame', 'RAW mode native frame'), prepared.profile);
			check(); proved = true;
		}, signal === undefined ? {} : { signal }]) as Promise<unknown>);
	check(); if (!proved) throw new TypeError('RAW mode requires an actual native frame borrow.');
	return prepared.next;
}

export interface PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1 {
	readonly mode: ImageDevelopRawDevelopmentModeV1;
	readonly ready: Readonly<ImageDevelopStateThroughV4> | null;
	readonly working: boolean;
	readonly failed: boolean;
	readonly closed: boolean;
}

/** One scalar authoring generation. The selected Session still owns source
 * custody; this owner serializes only its proof requests and their retirement. */
export class PhotoLibraryRawDevelopmentAuthoringCurrentV1 {
	readonly #binding: Binding;
	#view: Readonly<PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1>;
	#listener: ((view: Readonly<PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1>) => void) | null = null;
	#pending: Promise<void> = Promise.resolve();
	#stop: AbortController | null = null;
	#opened = false;
	#sequence = 0;
	#closing: Promise<void> | null = null;
	#failure: Readonly<{ error: unknown }> | null = null;

	constructor(value: unknown) {
		this.#binding = captureBinding(record(value, 'RAW authoring source', ['photoId', 'revision', 'develop', 'original']));
		const mode = this.#binding.develop.processVersion === 4 ? this.#binding.develop.rawDevelopment.mode : 'canonical';
		this.#view = Object.freeze({ mode, ready: null, working: true, failed: false, closed: false });
	}
	snapshot(): Readonly<PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1> { return this.#view; }
	subscribe(listener: (view: Readonly<PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1>) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('RAW authoring requires a scalar observer.');
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	open(before: Promise<void> = Promise.resolve()): Promise<void> {
		if (this.#opened || this.#closing) return Promise.reject(new Error('RAW authoring generation is already opened or closed.'));
		this.#opened = true;
		this.#pending = before.catch((error: unknown) => { this.#retain(error); });
		return this.choose(this.#view.mode);
	}
	choose(modeValue: unknown): Promise<void> {
		if (!this.#opened || this.#closing) return Promise.reject(new Error('RAW authoring generation is unavailable.'));
		const previous = this.#pending, previousStop = this.#stop, stop = new AbortController(), sequence = ++this.#sequence;
		let resolve!: () => void;
		// Register demand before reflection or synchronous abort-listener reentry.
		const pending = new Promise<void>(accept => { resolve = accept; }); this.#pending = pending; this.#stop = stop;
		previousStop?.abort();
		let captured: Readonly<{ prepared: Prepared }> | Readonly<{ error: unknown }>;
		try { captured = { prepared: captureEdit({ ...this.#binding, mode: modeValue }, stop.signal) }; }
		catch (error) { captured = { error }; }
		const mode = modeValue === 'canonical' || modeValue === 'headroom' || modeValue === 'recovery' ? modeValue : this.#view.mode;
		this.#publish({ mode, ready: null, working: true, failed: false });
		void (async () => {
			try {
				await previous;
				checkRepairSignalV1(stop.signal);
				if (this.#failure) throw this.#failure.error;
				if ('error' in captured) throw captured.error;
				const ready = await execute(captured.prepared, stop.signal);
				if (!this.#closing && sequence === this.#sequence) this.#publish({ ready, working: false, failed: false });
			} catch (error) {
				if (stop.signal.aborted && Object.is(error, stop.signal.reason)) return;
				if (stop.signal.aborted) this.#retain(error);
				if (!this.#closing && sequence === this.#sequence) this.#publish({ ready: null, working: false, failed: true });
			}
		})().then(resolve, error => { this.#retain(error); resolve(); });
		return pending;
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#stop?.abort();
		this.#publish({ closed: true, ready: null });
		void this.#pending.then(() => {
			this.#publish({ working: false, failed: this.#view.failed || this.#failure !== null });
			if (this.#failure) throw this.#failure.error;
		}).then(resolve, reject);
		return this.#closing;
	}
	cancelAndJoin(): Promise<void> {
		const sequence = this.#sequence, pending = this.#pending;
		this.#stop?.abort();
		return pending.then(() => {
			if (!this.#closing && sequence === this.#sequence) this.#publish({ ready: null, working: false });
			if (this.#failure) throw this.#failure.error;
		});
	}
	#retain(error: unknown): void {
		if (this.#failure && Object.is(this.#failure.error, error)) return;
		this.#failure = { error: this.#failure ? new AggregateError([this.#failure.error, error], 'RAW mode operations failed during retirement.', { cause: this.#failure.error }) : error };
		this.#view = Object.freeze({ ...this.#view, ready: null, failed: true });
	}
	#publish(patch: Partial<PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1>): void {
		this.#view = Object.freeze({ ...this.#view, ...patch });
		try { this.#listener?.(this.#view); } catch (error) { this.#retain(error); }
	}
}
