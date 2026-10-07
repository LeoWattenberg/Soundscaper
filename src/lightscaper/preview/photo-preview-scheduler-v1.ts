/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { id, oneOf } from '../catalog/value-validation.ts';
import { withPhotoOriginalFrameV1 } from './photo-original-frame-v1.ts';
import type { PhotoPreviewCachePortV1 } from './photo-preview-cache-v1.ts';
import { planPhotoPreviewV1, type PhotoPreviewOriginalBindingV1, type PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1, type PreparedPhotoPreviewV1 } from './photo-preview-preparation-v1.ts';

export const PHOTO_PREVIEW_SCHEDULER_LIMITS_V1 = Object.freeze({ maximumQueuedIds: 64, maximumPendingRequests: 65, maximumActiveJobs: 1 });

export interface PhotoPreviewSchedulerOptionsV1 {
	readonly catalogId: string;
	readonly loadPhoto: (photoId: string) => Promise<unknown | null>;
	readonly loadOriginal: (storageKey: string, signal: AbortSignal) => Promise<unknown>;
	readonly cache: PhotoPreviewCachePortV1;
	readonly regenerate?: typeof withPhotoOriginalFrameV1;
}

export type PhotoPreviewJobOutcomeV1 =
	| Readonly<{ outcome: 'ready'; preview: Readonly<PreparedPhotoPreviewV1>; cache: 'hit' | 'stored' | 'transient';
		persistenceError?: unknown; cleanupErrors?: readonly unknown[] }>
	| Readonly<{ outcome: 'missing' | 'superseded' }>;

interface Subscriber {
	readonly resolve: (value: PhotoPreviewJobOutcomeV1) => void;
	readonly reject: (error: unknown) => void;
	readonly signal?: AbortSignal;
	readonly abort: () => void;
	settled: boolean;
}

interface Job {
	readonly key: string;
	readonly photoId: string;
	readonly tier: PhotoPreviewTierV1;
	readonly controller: AbortController;
	readonly subscribers: Set<Subscriber>;
}

const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;
const abortReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Scalar demand queue; one callback-scoped native frame and one independent preview at a time. */
export class PhotoPreviewSchedulerV1 {
	readonly #catalogId: string;
	readonly #ports: Readonly<Required<Omit<PhotoPreviewSchedulerOptionsV1, 'catalogId'>>>;
	readonly #jobs = new Map<string, Job>();
	readonly #queue: Job[] = [];
	#active: Job | null = null;
	#activeTask: Promise<PhotoPreviewJobOutcomeV1> | null = null;
	#pendingRequests = 0;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(options: PhotoPreviewSchedulerOptionsV1) {
		const input = record(options, 'photo preview scheduler ports', ['catalogId', 'loadPhoto', 'loadOriginal', 'cache', 'regenerate'],
			['catalogId', 'loadPhoto', 'loadOriginal', 'cache']);
		this.#catalogId = id(field(input, 'catalogId', 'photo preview scheduler ports'), 'preview catalog ID');
		for (const key of ['loadPhoto', 'loadOriginal']) {
			if (typeof field(input, key, 'photo preview scheduler ports') !== 'function') throw new TypeError('Complete preview read ports are required.');
		}
		const cache = record(field(input, 'cache', 'photo preview scheduler ports'), 'photo preview cache port', ['load', 'store', 'trim']);
		for (const key of ['load', 'store', 'trim']) {
			if (typeof field(cache, key, 'photo preview cache port') !== 'function') throw new TypeError('Complete preview cache ports are required.');
		}
		const regenerate = options.regenerate ?? withPhotoOriginalFrameV1;
		if (typeof regenerate !== 'function') throw new TypeError('Photo preview requires an original frame factory.');
		this.#ports = Object.freeze({ loadPhoto: options.loadPhoto.bind(options), loadOriginal: options.loadOriginal.bind(options),
			cache: Object.freeze({ load: options.cache.load.bind(options.cache), store: options.cache.store.bind(options.cache),
				trim: options.cache.trim.bind(options.cache) }), regenerate });
	}

	request(value: unknown): Promise<PhotoPreviewJobOutcomeV1> {
		try {
			if (this.#closed) throw closedError();
			const request = record(value, 'photo preview job', ['photoId', 'tier', 'signal'], ['photoId', 'tier']);
			const photoId = id(field(request, 'photoId', 'photo preview job'), 'preview photo ID');
			const tier = oneOf(field(request, 'tier', 'photo preview job'), ['thumbnail', 'fit-screen'] as const, 'preview tier');
			const signal = Object.hasOwn(request, 'signal') ? field(request, 'signal', 'photo preview job') : undefined;
			if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo preview jobs require a cancellation signal.');
			if (signal) Reflect.apply(throwIfAborted, signal, []);
			if (this.#pendingRequests >= PHOTO_PREVIEW_SCHEDULER_LIMITS_V1.maximumPendingRequests) throw new RangeError('Photo preview request budget is full.');
			const key = JSON.stringify([photoId, tier]), previous = this.#jobs.get(key);
			let job = previous && !previous.controller.signal.aborted ? previous : null;
			if (!job) {
				if (this.#queue.length >= PHOTO_PREVIEW_SCHEDULER_LIMITS_V1.maximumQueuedIds) throw new RangeError('Photo preview queue is full.');
				job = { key, photoId, tier, controller: new AbortController(), subscribers: new Set() };
				this.#jobs.set(key, job); this.#queue.push(job);
			}
			const admitted = job;
			const pending = new Promise<PhotoPreviewJobOutcomeV1>((resolve, reject) => {
				const subscriber: Subscriber = { resolve, reject, signal, settled: false,
					abort: () => { this.#cancel(admitted, subscriber, signal ? Reflect.apply(abortReason, signal, []) : undefined); } };
				admitted.subscribers.add(subscriber); this.#pendingRequests += 1;
				if (signal) Reflect.apply(addListener, signal, ['abort', subscriber.abort, { once: true }]);
			});
			this.#start(); return pending;
		} catch (error) { return Promise.reject(error); }
	}

	status(): Readonly<{ closed: boolean; active: boolean; queued: number; pendingRequests: number }> {
		return Object.freeze({ closed: this.#closed, active: this.#active !== null, queued: this.#queue.length, pendingRequests: this.#pendingRequests });
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		const reason = closedError(), active = this.#active, pending = this.#activeTask;
		for (const job of [...this.#queue, ...(active ? [active] : [])]) {
			for (const subscriber of [...job.subscribers]) this.#cancel(job, subscriber, reason);
			job.controller.abort(reason);
		}
		this.#closing = pending ? pending.then(() => undefined, (error: unknown) => {
			if (error !== active?.controller.signal.reason) throw error;
		}) : Promise.resolve();
		return this.#closing;
	}

	#start(): void {
		if (this.#closed || this.#active) return;
		const job = this.#queue.shift(); if (!job) return;
		this.#active = job;
		const pending = this.#run(job); this.#activeTask = pending;
		void pending.then(value => { this.#finish(job, value); }, error => { this.#finish(job, undefined, error); });
	}

	async #run(job: Job): Promise<PhotoPreviewJobOutcomeV1> {
		const signal = job.controller.signal, photo = await this.#current(job.photoId, signal);
		if (!photo) return Object.freeze({ outcome: 'missing' });
		const binding = originalBinding(photo);
		const plan = planPhotoPreviewV1({ binding, source: { schemaVersion: 1, width: binding.width, height: binding.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, tier: job.tier });
		const cached = await this.#ports.cache.load(plan, signal); signal.throwIfAborted();
		if (cached) {
			if (cached.key !== plan.key) throw new RangeError('Photo preview cache returned another plan.');
			if (!await this.#matches(job.photoId, binding, signal)) return Object.freeze({ outcome: 'superseded' });
			return Object.freeze({ outcome: 'ready', preview: cached, cache: 'hit' });
		}
		const body = await this.#ports.loadOriginal(binding.storageKey, signal); signal.throwIfAborted();
		const preview = await this.#ports.regenerate({ binding, body, signal }, frame => preparePhotoPreviewV1({ plan, binding, frame, signal }));
		signal.throwIfAborted();
		if (!await this.#matches(job.photoId, binding, signal)) return Object.freeze({ outcome: 'superseded' });
		let cache: 'stored' | 'transient' = 'transient', persistenceError: unknown;
		const cleanupErrors: unknown[] = [];
		try {
			let receipt = await this.#ports.cache.store(preview, signal);
			cleanupErrors.push(...receipt.cleanupErrors ?? []);
			if (receipt.outcome === 'pressure') {
				const trimmed = await this.#ports.cache.trim(signal); cleanupErrors.push(...trimmed.cleanupErrors ?? []);
				receipt = await this.#ports.cache.store(preview, signal); cleanupErrors.push(...receipt.cleanupErrors ?? []);
			}
			if (receipt.outcome === 'stored') cache = 'stored';
		} catch (error) {
			if (signal.aborted) {
				if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Photo preview cancellation and cache cleanup failed.', { cause: error });
				throw error;
			}
			persistenceError = error;
		}
		let current: boolean;
		try { current = await this.#matches(job.photoId, binding, signal); }
		catch (error) {
			if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Photo preview revalidation and cache cleanup failed.', { cause: error });
			throw error;
		}
		if (!current) {
			if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Superseded photo preview cache cleanup failed.');
			return Object.freeze({ outcome: 'superseded' });
		}
		return Object.freeze({ outcome: 'ready', preview, cache,
			...(persistenceError === undefined ? {} : { persistenceError }), ...(cleanupErrors.length ? { cleanupErrors: Object.freeze(cleanupErrors) } : {}) });
	}

	async #current(photoId: string, signal: AbortSignal): Promise<PhotoDocumentV1 | null> {
		signal.throwIfAborted(); const value = await this.#ports.loadPhoto(photoId); signal.throwIfAborted();
		if (value === null) return null;
		const photo = validateLightscaperDocumentV1(value);
		if (photo.kind !== 'photo' || photo.id !== photoId || photo.catalogId !== this.#catalogId) throw new TypeError('Photo preview read returned another photo or catalog.');
		return photo;
	}

	async #matches(photoId: string, binding: PhotoPreviewOriginalBindingV1, signal: AbortSignal): Promise<boolean> {
		const current = await this.#current(photoId, signal);
		return current !== null && JSON.stringify(originalBinding(current)) === JSON.stringify(binding);
	}

	#cancel(job: Job, subscriber: Subscriber, reason: unknown): void {
		if (subscriber.settled) return;
		this.#settle(job, subscriber); subscriber.reject(reason ?? new DOMException('Photo preview request was cancelled.', 'AbortError'));
		if (!job.subscribers.size) {
			job.controller.abort(reason);
			const queued = this.#queue.indexOf(job); if (queued >= 0) this.#queue.splice(queued, 1);
			if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
		}
	}

	#finish(job: Job, value?: PhotoPreviewJobOutcomeV1, error?: unknown): void {
		for (const subscriber of [...job.subscribers]) {
			this.#settle(job, subscriber); if (value) subscriber.resolve(value); else subscriber.reject(error);
		}
		if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
		this.#active = null; this.#activeTask = null; this.#start();
	}

	#settle(job: Job, subscriber: Subscriber): void {
		subscriber.settled = true; job.subscribers.delete(subscriber); this.#pendingRequests -= 1;
		if (subscriber.signal) Reflect.apply(removeListener, subscriber.signal, ['abort', subscriber.abort]);
	}
}

function originalBinding(photo: PhotoDocumentV1): Readonly<PhotoPreviewOriginalBindingV1> {
	return Object.freeze({ catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
		contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: photo.original.width, height: photo.original.height });
}

function closedError(): Error { return new Error('Photo preview scheduler is closed.'); }
