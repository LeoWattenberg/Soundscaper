/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord, readClosedDomainField as field, readClosedDomainArray } from '../../closed-domain-value.ts';
import type { PhotoLibraryRestoreReceiptV1, PhotoLibraryRestoreRuntimeV1, LoadPhotoLibraryRestoreRuntimeV1 } from '../../photo-library-restore-port-v1.ts';

export interface PhotoLibraryRestoreRequestV1 {
	readonly blob: Blob;
	readonly loadRuntime: LoadPhotoLibraryRestoreRuntimeV1;
	readonly retireAndJoin: () => Promise<void>;
	readonly onAcknowledged?: (receipt: Readonly<PhotoLibraryRestoreReceiptV1>) => void;
	readonly signal?: AbortSignal;
}
interface Demand { readonly stop: AbortController; readonly joined: Promise<void> }
const check = AbortSignal.prototype.throwIfAborted;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;

/** App-lifetime owner. Its receipt and pending restore outlive resettable Sessions and dialogs. */
export class PhotoLibraryRestoreV1 {
	#active: Demand | null = null;
	#runtime: PhotoLibraryRestoreRuntimeV1 | null = null;
	#known: Readonly<PhotoLibraryRestoreReceiptV1> | null = null;
	#activationFailure: unknown;
	#cancelled = false;
	#closed = false;
	#closing: Promise<void> | null = null;
	isPending(): boolean { return this.#active !== null; }
	receipt(): Readonly<PhotoLibraryRestoreReceiptV1> | null { return this.#known; }
	activationFailure(): unknown { return this.#activationFailure; }
	wasCancelled(): boolean { return this.#cancelled; }

	/** Latch before borrowed retirement or lazy loading, in the original Restore click stack. */
	start(value: PhotoLibraryRestoreRequestV1): Promise<Readonly<PhotoLibraryRestoreReceiptV1>> {
		if (this.#closed) return Promise.reject(new Error('The catalog restore owner is closed.'));
		if (this.#active) return Promise.reject(new Error('A catalog restore is already pending.'));
		this.#cancelled = false;
		let request: PhotoLibraryRestoreRequestV1;
		try { request = admit(value); if (request.signal) Reflect.apply(check, request.signal, []); } catch (error) { return Promise.reject(error); }
		// Descriptor traps may have admitted another demand while detaching this request.
		if (this.#closed) return Promise.reject(new Error('The catalog restore owner is closed.'));
		if (this.#active) return Promise.reject(new Error('A catalog restore is already pending.'));
		let settle!: () => void;
		const active: Demand = { stop: new AbortController(), joined: new Promise<void>(resolve => { settle = resolve; }) };
		this.#active = active; this.#activationFailure = undefined; this.#cancelled = false;
		const forward = () => { active.stop.abort(Reflect.apply(reason, request.signal!, [])); };
		if (request.signal) {
			Reflect.apply(add, request.signal, ['abort', forward, { once: true }]);
			if (Reflect.apply(aborted, request.signal, []) === true) forward();
		}
		let retired: Promise<void>;
		try { retired = request.retireAndJoin(); } catch (error) { retired = Promise.reject(error); }
		return this.#run(request, active, retired).catch((failure: unknown) => {
			this.#cancelled = Reflect.apply(aborted, active.stop.signal, []) === true && Object.is(failure, Reflect.apply(reason, active.stop.signal, []));
			throw failure;
		}).finally(() => {
			if (request.signal) Reflect.apply(remove, request.signal, ['abort', forward]);
			if (this.#active === active) this.#active = null;
			settle();
		});
	}

	async #run(request: PhotoLibraryRestoreRequestV1, active: Demand, retired: Promise<void>): Promise<Readonly<PhotoLibraryRestoreReceiptV1>> {
		await retired; Reflect.apply(check, active.stop.signal, []);
		if (!this.#runtime) this.#runtime = bindRuntime(await request.loadRuntime());
		Reflect.apply(check, active.stop.signal, []);
		const known = readPhotoLibraryRestoreReceiptV1(await this.#runtime.restoreArchive(request.blob, { signal: active.stop.signal }));
		this.#known = known;
		// Native publication truth wins later cancel, refresh failure or modal/session retirement.
		try { request.onAcknowledged?.(known); } catch (error) { this.#activationFailure = error; }
		return known;
	}

	cancelAndJoin(): Promise<void> {
		if (!this.#active) return Promise.resolve();
		this.#active.stop.abort(); return this.#active.joined;
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = (async () => { await this.cancelAndJoin(); await this.#runtime?.close(); })();
		return this.#closing;
	}
}

function admit(value: unknown): PhotoLibraryRestoreRequestV1 {
	const label = 'catalog restore request', input = readClosedDomainRecord(value, label,
		['blob', 'loadRuntime', 'retireAndJoin', 'onAcknowledged', 'signal'], ['blob', 'loadRuntime', 'retireAndJoin']);
	const blob = field(input, 'blob', label), size = Reflect.apply(blobSize, blob, []) as number;
	if (!Number.isSafeInteger(size) || size < 1) throw new TypeError('Catalog restore requires a nonempty native Blob.');
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', label) : undefined;
	if (signal !== undefined) {
		Reflect.apply(check, signal, []);
		const nativeSignal = signal as AbortSignal;
		if (Object.getPrototypeOf(nativeSignal) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(nativeSignal, key))) {
			throw new TypeError('Catalog restore requires native cancellation behavior.');
		}
	}
	const loadRuntime = field(input, 'loadRuntime', label), retireAndJoin = field(input, 'retireAndJoin', label);
	const onAcknowledged = Object.hasOwn(input, 'onAcknowledged') ? field(input, 'onAcknowledged', label) : undefined;
	if (typeof loadRuntime !== 'function' || typeof retireAndJoin !== 'function' || (onAcknowledged !== undefined && typeof onAcknowledged !== 'function')) {
		throw new TypeError('Catalog restore requires its scalar runtime and retirement ports.');
	}
	return Object.freeze({ blob: blob as Blob, signal: signal as AbortSignal | undefined,
		loadRuntime: loadRuntime as LoadPhotoLibraryRestoreRuntimeV1, retireAndJoin: retireAndJoin as () => Promise<void>,
		onAcknowledged: onAcknowledged as PhotoLibraryRestoreRequestV1['onAcknowledged'] });
}

function bindRuntime(value: PhotoLibraryRestoreRuntimeV1): PhotoLibraryRestoreRuntimeV1 {
	const label = 'catalog restore runtime', input = readClosedDomainRecord(value, label, ['restoreArchive', 'close']);
	const restore = field(input, 'restoreArchive', label), close = field(input, 'close', label);
	if (typeof restore !== 'function' || typeof close !== 'function') throw new TypeError('Catalog restore runtime requires its owning methods.');
	return Object.freeze({ restoreArchive: restore.bind(value) as PhotoLibraryRestoreRuntimeV1['restoreArchive'], close: close.bind(value) as () => Promise<void> });
}

export function readPhotoLibraryRestoreReceiptV1(value: unknown): Readonly<PhotoLibraryRestoreReceiptV1> {
	const label = 'catalog restore receipt', input = readClosedDomainRecord(value, label,
		['catalogId', 'catalogName', 'photoCount', 'stackCount', 'savedCollectionCount', 'originalCount', 'originalByteLength', 'notices']);
	const get = (key: string) => field(input, key, label);
	const catalogId = get('catalogId'), catalogName = get('catalogName');
	if (typeof catalogId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(catalogId)
		|| typeof catalogName !== 'string' || catalogName.length < 1 || catalogName.length > 256) throw new TypeError('Catalog restore receipt text exceeds its scalar bound.');
	const count = (key: string, maximum = Number.MAX_SAFE_INTEGER): number => {
		const value = get(key);
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > maximum) throw new TypeError('Catalog restore receipt requires canonical bounded integers.');
		return value;
	};
	const photoCount = count('photoCount', 10_000_000), stackCount = count('stackCount', photoCount), savedCollectionCount = count('savedCollectionCount', 10_000);
	const originalCount = count('originalCount', photoCount), originalByteLength = count('originalByteLength');
	if ((photoCount === 0) !== (originalCount === 0) || (originalCount === 0) !== (originalByteLength === 0)) throw new TypeError('Catalog restore receipt counts disagree.');
	const notices = readClosedDomainArray(get('notices'), 'catalog restore notices', 0, 2).map(notice => {
		if (notice !== 'cleanup-failed' && notice !== 'publication-reconciled') throw new TypeError('Catalog restore receipt has an unsupported notice.'); return notice;
	});
	if (new Set(notices).size !== notices.length) throw new TypeError('Catalog restore receipt has duplicate notices.');
	return Object.freeze({ catalogId, catalogName, photoCount, stackCount, savedCollectionCount, originalCount, originalByteLength, notices: Object.freeze(notices) });
}
