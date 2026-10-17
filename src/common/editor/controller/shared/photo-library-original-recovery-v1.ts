/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { errorDiagnosticMessage } from '../../error-diagnostic-message.ts';
import type { PhotoLibraryOriginalBodyInspectionV1, PhotoLibraryOriginalInspectionPageV1,
	PhotoLibraryOriginalRecoveryPortV1, PhotoLibraryOriginalRestoreTargetV1,
	PhotoLibraryOriginalRestorationReceiptV1 } from '../../photo-library-original-recovery-port-v1.ts';
import { normalizeCatalogOriginalRepairBindingV1, readCatalogOriginalRepairSignalV1 } from '../../storage/media-catalog-original-repair-contract.ts';
import { catalogOriginalId } from '../../storage/media-catalog-original-schema.ts';

export interface PhotoLibraryOriginalInspectionRequestV1 {
	readonly inspectOriginals: PhotoLibraryOriginalRecoveryPortV1['inspectOriginals'];
	readonly cursor?: string | null;
	readonly signal?: AbortSignal;
}
export interface PhotoLibraryOriginalRestoreRequestV1 {
	readonly restoreOriginalBody: PhotoLibraryOriginalRecoveryPortV1['restoreOriginalBody'];
	readonly target: PhotoLibraryOriginalRestoreTargetV1;
	readonly file: Blob;
	readonly signal?: AbortSignal;
}
export interface PhotoLibraryOriginalRecoverySnapshotV1 {
	readonly phase: 'idle' | 'inspecting' | 'restoring';
	readonly page: PhotoLibraryOriginalInspectionPageV1 | null;
	readonly receipt: PhotoLibraryOriginalRestorationReceiptV1 | null;
	readonly error: string | null;
}
export type PhotoLibraryOriginalRecoveryCancelledV1 = Readonly<{ status: 'cancelled' }>;
type Listener = (snapshot: Readonly<PhotoLibraryOriginalRecoverySnapshotV1>) => void;
interface Active {
	readonly stop: AbortController;
	readonly joined: Promise<void>;
	readonly finish: () => void;
}

// Retained scalar state: one <=2 MiB page, one <=4 KiB receipt and 2048 error units.
// One <=16 KiB target/borrowed Blob may be active; no body is read or copied here.
// Each explicit inspection admits 64 rows/candidates and a <=2 KiB opaque cursor.
const PAGE_BYTES = 2 * 1024 ** 2, RECEIPT_BYTES = 4096, TARGET_BYTES = 16 * 1024, CURSOR_BYTES = 2048;
const cancelled: PhotoLibraryOriginalRecoveryCancelledV1 = Object.freeze({ status: 'cancelled' });
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const abortReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const throwIfAborted = AbortSignal.prototype.throwIfAborted, abort = AbortController.prototype.abort;
const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;

/** Stable presentation owner; callbacks borrow a Session and never transfer its lifetime. */
export class PhotoLibraryOriginalRecoveryV1 {
	#active: Active | null = null;
	#snapshot: Readonly<PhotoLibraryOriginalRecoverySnapshotV1> = Object.freeze({ phase: 'idle', page: null, receipt: null, error: null });
	readonly #listeners = new Map<object, Listener>();

	isPending(): boolean { return this.#active !== null; }
	getSnapshot(): Readonly<PhotoLibraryOriginalRecoverySnapshotV1> { return this.#snapshot; }
	subscribe(listener: Listener): () => void {
		if (typeof listener !== 'function') throw new TypeError('Original recovery requires a snapshot observer.');
		if (this.#listeners.size >= 64) throw new RangeError('Original recovery admits at most64 observers.');
		const subscription = {}; this.#listeners.set(subscription, listener);
		try { listener(this.#snapshot); } catch { /* Observers cannot veto resource ownership or durable ACKs. */ }
		return () => { this.#listeners.delete(subscription); };
	}

	startInspection(value: PhotoLibraryOriginalInspectionRequestV1): Promise<PhotoLibraryOriginalInspectionPageV1 | PhotoLibraryOriginalRecoveryCancelledV1> {
		if (this.#active) return Promise.reject(new Error('An original recovery operation is already pending.'));
		try {
			const input = record(value, 'original inspection request', ['inspectOriginals', 'cursor', 'signal'], ['inspectOriginals']);
			const inspect = callback(field(input, 'inspectOriginals', 'original inspection request')) as PhotoLibraryOriginalRecoveryPortV1['inspectOriginals'];
			const signal = readSignal(input), cursor = Object.hasOwn(input, 'cursor') ? readCursor(field(input, 'cursor', 'original inspection request')) : undefined;
			return this.#run('inspecting', signal, async active => {
				checkAbort(active.stop.signal);
				const raw = await inspect(Object.freeze({ cursor, signal: active.stop.signal }));
				checkAbort(active.stop.signal);
				const page = readPage(raw);
				checkAbort(active.stop.signal);
				this.#publish({ page }); return page;
			});
		} catch (error) { return Promise.reject(error); }
	}

	startRestore(value: PhotoLibraryOriginalRestoreRequestV1): Promise<PhotoLibraryOriginalRestorationReceiptV1 | PhotoLibraryOriginalRecoveryCancelledV1> {
		if (this.#active) return Promise.reject(new Error('An original recovery operation is already pending.'));
		try {
			const input = record(value, 'original restoration request', ['restoreOriginalBody', 'target', 'file', 'signal'], ['restoreOriginalBody', 'target', 'file']);
			const restore = callback(field(input, 'restoreOriginalBody', 'original restoration request')) as PhotoLibraryOriginalRecoveryPortV1['restoreOriginalBody'];
			const signal = readSignal(input), target = readTarget(field(input, 'target', 'original restoration request'));
			const file = field(input, 'file', 'original restoration request');
			if (Reflect.apply(blobSize, file, []) !== target.binding.size) throw new RangeError('Selected original byte length does not match the retained binding.');
			return this.#run('restoring', signal, async active => {
				checkAbort(active.stop.signal);
				const acknowledgment = readReceipt(await restore(target, file as Blob, Object.freeze({ signal: active.stop.signal })), target);
				// The borrowed Session confirms durable publication; late cancellation cannot revoke it.
				this.#publish({ receipt: acknowledgment }); return acknowledgment;
			});
		} catch (error) { return Promise.reject(error); }
	}

	/** Join native settlement. The start promise retains primary and cleanup errors. */
	cancelAndJoin(reason?: unknown): Promise<void> {
		const active = this.#active;
		if (!active) return Promise.resolve();
		Reflect.apply(abort, active.stop, [reason]); return active.joined;
	}

	#run<Value>(phase: 'inspecting' | 'restoring', signal: AbortSignal | undefined,
		run: (active: Active) => Promise<Value>): Promise<Value | PhotoLibraryOriginalRecoveryCancelledV1> {
		// Descriptor traps during admission may have synchronously admitted another gesture.
		if (this.#active) return Promise.reject(new Error('An original recovery operation is already pending.'));
		if (signal) checkAbort(signal);
		let finish!: () => void;
		const active: Active = { stop: new AbortController(), joined: new Promise<void>(resolve => { finish = resolve; }), finish: () => { finish(); } };
		this.#active = active;
		const onAbort = () => { if (signal) Reflect.apply(abort, active.stop, [Reflect.apply(abortReason, signal, [])]); };
		if (signal) {
			Reflect.apply(addListener, signal, ['abort', onAbort, { once: true }]);
			if (Reflect.apply(signalAborted, signal, [])) onAbort();
		}
		this.#publish({ phase, error: null, ...(phase === 'restoring' ? { receipt: null } : {}) });
		// Register before invoking borrowed code or observers; no canceled work races native settlement.
		return Promise.resolve().then(() => run(active)).catch((error: unknown) => {
			if (Reflect.apply(signalAborted, active.stop.signal, []) && error === Reflect.apply(abortReason, active.stop.signal, [])) return cancelled;
			this.#publish({ error: failureMessage(error) }); throw error;
		}).finally(() => {
			if (signal) Reflect.apply(removeListener, signal, ['abort', onAbort]);
			if (this.#active === active) this.#active = null;
			active.finish(); this.#publish({ phase: 'idle' });
		});
	}

	#publish(update: Partial<PhotoLibraryOriginalRecoverySnapshotV1>): void {
		const snapshot = Object.freeze({ ...this.#snapshot, ...update }); this.#snapshot = snapshot;
		for (const [subscription, listener] of [...this.#listeners]) {
			if (this.#snapshot !== snapshot) break;
			if (!this.#listeners.has(subscription)) continue;
			try { listener(snapshot); } catch { /* A failed observer cannot discard a durable ACK. */ }
		}
	}
}

function readSignal(input: Readonly<Record<string, unknown>>): AbortSignal | undefined {
	return readCatalogOriginalRepairSignalV1({ signal: Object.hasOwn(input, 'signal') ? field(input, 'signal', 'original recovery request') : undefined });
}
function checkAbort(signal: AbortSignal): void { Reflect.apply(throwIfAborted, signal, []); }
function readTarget(value: unknown): Readonly<PhotoLibraryOriginalRestoreTargetV1> {
	const name = 'original restoration target', input = record(value, name, ['schemaVersion', 'catalogRevision', 'activeImportId', 'photoRevision', 'binding']);
	if (field(input, 'schemaVersion', name) !== 1) throw new RangeError('Unsupported original restoration target.');
	const activeImportId = nullableId(field(input, 'activeImportId', name)), binding = normalizeCatalogOriginalRepairBindingV1(field(input, 'binding', name));
	if (binding.importId !== null && binding.importId !== activeImportId) throw new TypeError('Original restoration target disagrees with its active import.');
	const target = Object.freeze({ schemaVersion: 1 as const, catalogRevision: integer(field(input, 'catalogRevision', name)),
		activeImportId, photoRevision: integer(field(input, 'photoRevision', name)), binding });
	byteBound(target, TARGET_BYTES, 'Original restoration target'); return target;
}
function readReceipt(value: unknown, target: PhotoLibraryOriginalRestoreTargetV1): Readonly<PhotoLibraryOriginalRestorationReceiptV1> {
	const name = 'original restoration receipt', input = record(value, name, ['photoId', 'assetId', 'sha256', 'size', 'notices']);
	const photoId = catalogOriginalId(field(input, 'photoId', name)), assetId = catalogOriginalId(field(input, 'assetId', name));
	const sha256 = field(input, 'sha256', name), size = integer(field(input, 'size', name));
	if (photoId !== target.binding.photoId || assetId !== target.binding.assetId || sha256 !== target.binding.sha256 || size !== target.binding.size) {
		throw new TypeError('Original restoration receipt disagrees with its exact retained binding.');
	}
	const notices = readClosedDomainArray(field(input, 'notices', name), 'original restoration notices', 0, 1).map(value => {
		if (value !== 'cleanup-failed') throw new TypeError('Unknown original restoration cleanup notice.');
		return 'cleanup-failed' as const;
	});
	const receipt = Object.freeze({ photoId, assetId, sha256: target.binding.sha256, size, notices: Object.freeze(notices) });
	byteBound(receipt, RECEIPT_BYTES, 'Original restoration receipt'); return receipt;
}
function readPage(value: unknown): Readonly<PhotoLibraryOriginalInspectionPageV1> {
	const name = 'original inspection page', input = record(value, name,
		['schemaVersion', 'catalogId', 'catalogName', 'revision', 'activeImportId', 'startupFailure', 'rows', 'scanned', 'cursor']);
	if (field(input, 'schemaVersion', name) !== 1) throw new RangeError('Unsupported original inspection page.');
	const catalogId = catalogOriginalId(field(input, 'catalogId', name)), activeImportId = nullableId(field(input, 'activeImportId', name));
	const ids = new Set<string>();
	const rows = readClosedDomainArray(field(input, 'rows', name), 'original inspection rows', 0, 64).map(value => {
		const row = record(value, 'original inspection row', ['photoId', 'revision', 'fileName', 'binding', 'inspection']);
		const photoId = catalogOriginalId(field(row, 'photoId', name)), binding = normalizeCatalogOriginalRepairBindingV1(field(row, 'binding', name));
		if (ids.has(photoId) || binding.photoId !== photoId || binding.catalogId !== catalogId
			|| (binding.importId !== null && binding.importId !== activeImportId)) throw new TypeError('Original inspection row authority disagrees with its page.');
		ids.add(photoId);
		return Object.freeze({ photoId, revision: integer(field(row, 'revision', name)), fileName: text(field(row, 'fileName', name), 512),
			binding, inspection: readOutcome(field(row, 'inspection', name)) });
	});
	const scanned = integer(field(input, 'scanned', name));
	if (scanned < rows.length || scanned > 64) throw new RangeError('Original inspection page scan count exceeds its64-candidate bound.');
	const failure = field(input, 'startupFailure', name);
	const startupFailure = failure === null ? null : Object.freeze({ message: text(field(record(failure, 'startup failure', ['message']), 'message', name), 2048) });
	const cursor = field(input, 'cursor', name);
	if (cursor === undefined) throw new TypeError('Original inspection page requires a null or bounded continuation.');
	const page = Object.freeze({ schemaVersion: 1 as const, catalogId, catalogName: text(field(input, 'catalogName', name), 256),
		revision: integer(field(input, 'revision', name)), activeImportId, startupFailure, rows: Object.freeze(rows), scanned,
		cursor: readCursor(cursor) ?? null });
	byteBound(page, PAGE_BYTES, 'Original inspection page'); return page;
}
function readOutcome(value: unknown): PhotoLibraryOriginalBodyInspectionV1 {
	const input = record(value, 'original inspection outcome', ['status', 'reason', 'storage'], ['status']);
	const status = field(input, 'status', 'original inspection outcome');
	if (status === 'present') { record(value, 'present original', ['status']); return Object.freeze({ status }); }
	if (status === 'unsupported') {
		record(value, 'unsupported original', ['status', 'storage']); const storage = field(input, 'storage', 'unsupported original');
		return Object.freeze({ status, storage: storage === null ? null : text(storage, 256) });
	}
	record(value, 'original inspection outcome', ['status', 'reason']);
	const reason = field(input, 'reason', 'original inspection outcome');
	if (status === 'missing' && (reason === 'media-row' || reason === 'directory' || reason === 'file' || reason === 'inline-blob' || reason === 'chunk')) return Object.freeze({ status, reason });
	if (status === 'corrupt' && (reason === 'size' || reason === 'digest')) return Object.freeze({ status, reason });
	throw new TypeError('Unsupported original body inspection outcome.');
}
function readCursor(value: unknown): string | null | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > CURSOR_BYTES) throw new RangeError('Original inspection cursor exceeds2KiB.');
	return value;
}
function nullableId(value: unknown): string | null { return value === null ? null : catalogOriginalId(value); }
function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('Original recovery requires a nonnegative safe revision or count.');
	return value;
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum) throw new TypeError('Original recovery text exceeds its scalar bound.');
	return value;
}
function callback(value: unknown): (...args: never[]) => unknown {
	if (typeof value !== 'function') throw new TypeError('Original recovery requires its borrowed Session callback.');
	return value as (...args: never[]) => unknown;
}
function byteBound(value: object, maximum: number, name: string): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) throw new RangeError(`${name} exceeds its scalar byte bound.`);
}
function failureMessage(value: unknown): string {
	try { return errorDiagnosticMessage(value, 'Original recovery failed.').slice(0, 2048); }
	catch { return 'Original recovery failed.'; }
}
