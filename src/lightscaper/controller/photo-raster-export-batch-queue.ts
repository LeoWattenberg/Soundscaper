/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { createDeliveryQueueRunner } from '../../common/editor/delivery-queue-runner.ts';
import type { DeliveryQueue, DeliveryQueueState } from '../../common/editor/delivery-queue.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../common/editor/browser-file-save-service.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { PhotoRasterExport, type PhotoRasterExportReceipt, type PhotoRasterExportRequest } from './photo-raster-export.ts';
import { capturePhotoRasterExportBatchV1, type PhotoRasterExportBatchV1, type PhotoRasterExportBatchMemberV1 } from './photo-raster-export-batch-v1.ts';

/** Methods use authority acquired by the initial gesture. They must never open
 * a deferred picker. Actual browser directory/picker admission is a later UI
 * owner; this injected port does not claim native permission or durable resume. */
export interface PhotoRasterExportBatchDestinations {
	readonly prepareSave: (member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest) => PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
	readonly saveFile: (member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>;
	readonly retireAndJoin: () => Promise<void>;
}
export interface PhotoRasterExportBatchRuntime {
	readonly fileTypeDescription: string;
	/** Invoked synchronously by start(), before any await or job execution. */
	readonly prepareDestinations: (plan: Readonly<PhotoRasterExportBatchV1>, options: Readonly<{ signal: AbortSignal }>) => PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>;
	readonly execute: PhotoRasterExportRequest['execute'];
	readonly withOriginalFrame: PhotoRasterExportRequest['withOriginalFrame'];
	readonly loadRenderer: PhotoRasterExportRequest['loadRenderer'];
	readonly encode: (format: 'png' | 'jpeg', frame: Readonly<PixelFrameV1>, options: Parameters<PhotoRasterExportRequest['encode']>[1]) => ReturnType<PhotoRasterExportRequest['encode']>;
	readonly readMetadata?: PhotoRasterExportRequest['readMetadata'];
}
export interface PhotoRasterExportBatchReceipt {
	readonly batchId: string | null;
	readonly phase: 'idle' | 'preparing' | 'running' | 'settled';
	readonly paused: boolean;
	readonly members: readonly Readonly<PhotoRasterExportBatchMemberV1 & {
		state: DeliveryQueueState; delivery: PhotoRasterExportReceipt | null;
	}>[];
}
export interface PhotoRasterExportBatchFailure {
	readonly cause: unknown;
	readonly receipt: Readonly<PhotoRasterExportBatchReceipt>;
	readonly cleanup?: Readonly<{ cause: unknown }>;
}

/** Foreign values remain opaque. No .name, prototype, mutation or coercion is
 * performed on them; only this owned Error reaches shared queue classification. */
export class PhotoRasterExportBatchError extends Error {
	readonly failure: Readonly<PhotoRasterExportBatchFailure>;
	constructor(cause: unknown, receipt: Readonly<PhotoRasterExportBatchReceipt>, cleanup?: Readonly<{ cause: unknown }>) {
		super('Photo raster batch did not settle successfully.', { cause });
		this.name = 'PhotoRasterExportBatchError';
		this.failure = Object.freeze({ cause, receipt, ...(cleanup ? { cleanup: Object.freeze({ cause: cleanup.cause }) } : {}) });
	}
}
const CANCELLED = new WeakSet<object>();
class MemberCancelled extends Error {
	constructor() { super('Photo raster batch member cancelled.'); this.name = 'PhotoRasterBatchMemberCancelled'; CANCELLED.add(this); }
}
interface MemberCompletion { readonly joined: Promise<void>; readonly resolve: () => void; }
interface ActiveMember { readonly jobId: string; readonly owner: PhotoRasterExport; readonly cancelReason: symbol; cancelled: boolean; }

/** Thin scalar adapter: the existing runner alone schedules jobs and the
 * existing single-photo owner alone renders/encodes/publishes each member. */
export class PhotoRasterExportBatchQueue {
	readonly #runtime: Readonly<PhotoRasterExportBatchRuntime>;
	readonly #stop = new AbortController();
	readonly #runner: ReturnType<typeof createDeliveryQueueRunner>;
	readonly #completed = new Map<string, PhotoRasterExportReceipt>();
	readonly #failures = new Map<string, Readonly<{ cause: unknown }>>();
	readonly #members = new Map<string, MemberCompletion>();
	readonly #observers = new Set<(receipt: Readonly<PhotoRasterExportBatchReceipt>) => void>();
	#plan: Readonly<PhotoRasterExportBatchV1> | null = null;
	#destinations: Readonly<PhotoRasterExportBatchDestinations> | null = null;
	#phase: PhotoRasterExportBatchReceipt['phase'] = 'idle';
	#queue: DeliveryQueue;
	#active: ActiveMember | null = null;
	#work: Promise<Readonly<PhotoRasterExportBatchReceipt>> | null = null;
	#joined: Promise<void> = Promise.resolve();
	#paused = false;

	constructor(value: PhotoRasterExportBatchRuntime) {
		this.#runtime = captureRuntime(value);
		this.#runner = createDeliveryQueueRunner({ runJob: (entry, context) => this.#runMember(entry.jobId, context.signal),
			onChange: queue => {
				this.#queue = queue;
				for (const entry of queue.entries) if (entry.state !== 'queued' && entry.state !== 'running') this.#members.get(entry.jobId)?.resolve();
				this.#publish();
			}, isAbortError: value => typeof value === 'object' && value !== null && CANCELLED.has(value) });
		this.#queue = this.#runner.getQueue();
	}
	getSnapshot(): Readonly<PhotoRasterExportBatchReceipt> {
		const members = this.#plan?.members.map(member => Object.freeze({ ...member,
			state: this.#queue.entries.find(entry => entry.jobId === member.jobId)?.state ?? 'queued', delivery: this.#completed.get(member.jobId) ?? null })) ?? [];
		return Object.freeze({ batchId: this.#plan?.batchId ?? null, phase: this.#phase, paused: this.#queue.paused, members: Object.freeze(members) });
	}
	/** Observers receive scalar receipts only and cannot revoke a delivered member. */
	subscribe(observer: (receipt: Readonly<PhotoRasterExportBatchReceipt>) => void): () => void {
		this.#observers.add(observer);
		return () => { this.#observers.delete(observer); };
	}
	#publish(): void {
		if (!this.#observers.size) return;
		const receipt = this.getSnapshot();
		for (const observer of [...this.#observers]) {
			if (!this.#observers.has(observer)) continue;
			try { observer(receipt); } catch { /* Progress cannot change owned work or ACKs. */ }
		}
	}
	/** Single use: neither Maps nor atomic-restart labels constitute persisted resume. */
	start(value: unknown): Promise<Readonly<PhotoRasterExportBatchReceipt>> {
		if (this.#phase !== 'idle') return Promise.reject(new PhotoRasterExportBatchError(new Error('Photo raster batch already started.'), this.getSnapshot()));
		let preparation: PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>;
		try {
			const plan = capturePhotoRasterExportBatchV1(value);
			if (plan.output?.metadataScope === 'capture' && !this.#runtime.readMetadata) throw new TypeError('Capture export requires its selected metadata reader.');
			this.#plan = plan; this.#phase = 'preparing'; this.#runner.pause();
			for (const member of this.#plan.members) {
				let resolve!: () => void;
				this.#members.set(member.jobId, { joined: new Promise<void>(accept => { resolve = accept; }), resolve });
				this.#runner.enqueue({ jobId: member.jobId, label: member.fileName, taskKind: 'encoded-export', recoveryClass: 'atomic-restart' });
			}
			preparation = this.#runtime.prepareDestinations(this.#plan, { signal: this.#stop.signal });
		} catch (cause) {
			this.#cancelQueued();
			this.#phase = 'settled'; this.#publish(); return Promise.reject(new PhotoRasterExportBatchError(cause, this.getSnapshot()));
		}
		this.#work = this.#run(preparation);
		this.#joined = this.#work.then(() => undefined, () => undefined);
		return this.#work;
	}
	pause(): void { this.#paused = true; this.#runner.pause(); }
	resume(): void { this.#paused = false; if (this.#phase === 'running' && !this.#stop.signal.aborted) this.#runner.resume(); }
	async cancelMember(jobId: string): Promise<void> {
		const completion = this.#members.get(jobId), entry = this.#queue.entries.find(item => item.jobId === jobId);
		if (!completion || !entry) throw new RangeError('Photo raster batch member does not exist.');
		if (entry.state !== 'queued' && entry.state !== 'running') return;
		const active = this.#active;
		if (active?.jobId === jobId) {
			active.cancelled = true;
			// Never eagerly cancel the runner: a held irreversible commit may still ACK.
			await active.owner.cancelAndJoin(active.cancelReason); await completion.joined;
		} else { this.#runner.cancel(jobId); await completion.joined; }
	}
	async cancelAndJoin(): Promise<void> {
		this.#runner.pause(); this.#stop.abort();
		this.#cancelQueued();
		if (this.#phase === 'idle') { this.#phase = 'settled'; this.#publish(); }
		if (this.#active) { this.#active.cancelled = true; await this.#active.owner.cancelAndJoin(this.#active.cancelReason); }
		await this.#joined;
	}
	#cancelQueued(): void {
		for (const entry of this.#queue.entries) if (entry.state === 'queued') this.#runner.cancel(entry.jobId);
	}
	async #run(preparation: PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>): Promise<Readonly<PhotoRasterExportBatchReceipt>> {
		let failure: Readonly<{ cause: unknown }> | null, cleanup: Readonly<{ cause: unknown }> | null = null;
		let retire: PhotoRasterExportBatchDestinations['retireAndJoin'] | null = null;
		try {
			const authority = await preparation;
			// Own the safe cleanup before any other admission can reject this authority.
			retire = captureRetirement(authority);
			this.#destinations = captureDestinations(authority, retire);
			// Enqueueing while paused creates a settling admission drain. Join it
			// before resuming, including immediately fulfilled authority promises.
			await this.#runner.settled();
			if (!this.#stop.signal.aborted) { this.#phase = 'running'; this.#publish(); if (!this.#paused) this.#runner.resume(); }
			// Pausing ends one drain. Completion belongs to members, not that drain.
			await Promise.all([...this.#members.values()].map(member => member.joined));
			await this.#runner.settled();
			failure = this.#failures.values().next().value ?? null;
		} catch (cause) { this.#cancelQueued(); failure = Object.freeze({ cause }); }
		finally {
			if (retire) {
				try { await retire(); } catch (cause) { cleanup = Object.freeze({ cause }); }
			}
			this.#phase = 'settled';
			this.#publish();
		}
		const receipt = this.getSnapshot();
		if (failure) throw new PhotoRasterExportBatchError(failure.cause, receipt, cleanup ?? undefined);
		if (cleanup) throw new PhotoRasterExportBatchError(cleanup.cause, receipt);
		return receipt;
	}
	async #runMember(jobId: string, signal: AbortSignal): Promise<void> {
		const plan = this.#plan!, member = plan.members.find(item => item.jobId === jobId)!, destinations = this.#destinations!;
		const active: ActiveMember = { jobId, owner: new PhotoRasterExport(plan.format), cancelReason: Symbol('Photo raster member cancellation'), cancelled: false }; this.#active = active;
		try {
			const runtime = this.#runtime, result = await active.owner.start({ photoId: member.photoId, versionId: member.versionId,
				expectedRevision: member.expectedRevision, fileName: member.fileName, fileTypeDescription: runtime.fileTypeDescription, signal,
				...(plan.output ? { output: plan.output } : {}), ...(runtime.readMetadata ? { readMetadata: runtime.readMetadata } : {}),
				prepareSave: request => destinations.prepareSave(member, request), saveFile: request => destinations.saveFile(member, request),
				execute: runtime.execute, withOriginalFrame: runtime.withOriginalFrame, loadRenderer: runtime.loadRenderer,
				encode: (frame, options) => runtime.encode(plan.format, frame, options) });
			if (result.status === 'cancelled') throw new MemberCancelled();
			this.#completed.set(jobId, result);
		} catch (cause) {
			// Owner cancellation reasons remain opaque. Successful ACKs returned above win.
			if ((active.cancelled && Object.is(cause, active.cancelReason))
				|| (typeof cause === 'object' && cause !== null && CANCELLED.has(cause))) throw new MemberCancelled();
			this.#failures.set(jobId, Object.freeze({ cause }));
			throw new PhotoRasterExportBatchError(cause, this.getSnapshot());
		} finally { if (this.#active === active) this.#active = null; }
	}
}

function captureRuntime(value: unknown): Readonly<PhotoRasterExportBatchRuntime> {
	const methods = ['prepareDestinations', 'execute', 'withOriginalFrame', 'loadRenderer', 'encode'] as const;
	const input = record(value, 'Photo raster batch runtime', ['fileTypeDescription', ...methods, 'readMetadata'], ['fileTypeDescription', ...methods]);
	const description = field(input, 'fileTypeDescription', 'Photo raster batch runtime');
	if (typeof description !== 'string' || !description || description.length > 256) throw new TypeError('Photo raster batch type description exceeds its scalar bound.');
	return Object.freeze({ fileTypeDescription: description, prepareDestinations: method<PhotoRasterExportBatchRuntime['prepareDestinations']>(input, value, 'prepareDestinations'),
		execute: method<PhotoRasterExportBatchRuntime['execute']>(input, value, 'execute'), withOriginalFrame: method<PhotoRasterExportBatchRuntime['withOriginalFrame']>(input, value, 'withOriginalFrame'),
		loadRenderer: method<PhotoRasterExportBatchRuntime['loadRenderer']>(input, value, 'loadRenderer'), encode: method<PhotoRasterExportBatchRuntime['encode']>(input, value, 'encode'),
		...(Object.hasOwn(input, 'readMetadata') ? { readMetadata: method<NonNullable<PhotoRasterExportBatchRuntime['readMetadata']>>(input, value, 'readMetadata') } : {}) });
}
function captureRetirement(value: unknown): PhotoRasterExportBatchDestinations['retireAndJoin'] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo raster batch destinations require own cleanup.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'retireAndJoin'), fn: unknown = descriptor?.value;
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true || typeof fn !== 'function') {
		throw new TypeError('Photo raster batch destinations require own callable cleanup.');
	}
	return () => Reflect.apply(fn, value, []) as Promise<void>;
}
function captureDestinations(value: unknown, retireAndJoin: PhotoRasterExportBatchDestinations['retireAndJoin']): Readonly<PhotoRasterExportBatchDestinations> {
	const input = record(value, 'Photo raster batch destinations', ['prepareSave', 'saveFile', 'retireAndJoin']);
	return Object.freeze({ prepareSave: method<PhotoRasterExportBatchDestinations['prepareSave']>(input, value, 'prepareSave'),
		saveFile: method<PhotoRasterExportBatchDestinations['saveFile']>(input, value, 'saveFile'), retireAndJoin });
}
function method<Method>(input: Readonly<Record<string, unknown>>, receiver: unknown, key: string): Method {
	const fn = field(input, key, 'Photo raster batch capability');
	if (typeof fn !== 'function') throw new TypeError('Photo raster batch requires own callable capabilities.');
	return ((...args: unknown[]): unknown => Reflect.apply(fn, receiver, args)) as Method;
}
