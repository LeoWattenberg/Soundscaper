/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
import { withPhotoOriginalFrameV1 } from './photo-original-frame-v1.ts';
import type { PhotoPreviewCachePortV1 } from './photo-preview-cache-v1.ts';
import { type PhotoPreviewPlanV1, type PhotoPreviewOriginalBindingV1, type PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';
import { type PreparedPhotoPreviewV1 } from './photo-preview-preparation-v1.ts';

export const PHOTO_PREVIEW_SCHEDULER_LIMITS_V1 = Object.freeze({ maximumQueuedIds: 64, maximumPendingRequests: 65, maximumActiveJobs: 1 });

export type PhotoPreviewPreparedCore = Pick<PreparedPhotoPreviewV1, 'key' | 'descriptor' | 'byteLength' | 'outputSha256' | 'body'>;
export type PhotoPreviewCachePortCore<Prepared extends PhotoPreviewPreparedCore> = Omit<PhotoPreviewCachePortV1, 'load'> & {
	load(plan: unknown, signal?: AbortSignal): Promise<Readonly<Prepared> | null>;
};
export interface PhotoPreviewRequestCore {
	readonly photoId: string; readonly tier: PhotoPreviewTierV1; readonly signal?: AbortSignal; readonly variant: string;
}
export interface PhotoPreviewProtocolCore<Prepared extends PhotoPreviewPreparedCore, Plan extends { readonly key: string }> {
	capture(value: unknown): PhotoPreviewRequestCore;
	plan(binding: PhotoPreviewOriginalBindingV1, tier: PhotoPreviewTierV1, photo: PhotoPreviewSchedulerAdmittedPhoto, variant: string): Plan;
	render(request: Readonly<{ plan: Plan; binding: PhotoPreviewOriginalBindingV1; body: unknown; signal: AbortSignal; variant: string }>,
		regenerate: typeof withPhotoOriginalFrameV1): Promise<Readonly<Prepared>>;
}

export interface PhotoPreviewSchedulerOptionsCore<Prepared extends PhotoPreviewPreparedCore = PreparedPhotoPreviewV1> {
	readonly catalogId: string;
	readonly loadPhoto: (photoId: string) => Promise<unknown | null>;
	readonly loadOriginal: (storageKey: string, signal: AbortSignal) => Promise<unknown>;
	readonly cache: PhotoPreviewCachePortCore<Prepared>;
	readonly regenerate?: typeof withPhotoOriginalFrameV1;
}

export type PhotoPreviewJobOutcomeV1<Prepared extends PhotoPreviewPreparedCore = PreparedPhotoPreviewV1> =
	| Readonly<{ outcome: 'ready'; preview: Readonly<Prepared>; cache: 'hit' | 'stored' | 'transient';
		persistenceError?: unknown; cleanupErrors?: readonly unknown[] }>
	| Readonly<{ outcome: 'missing' | 'superseded' }>;

export type PhotoPreviewSchedulerAdmittedPhoto = Pick<PhotoDocumentV1, 'kind' | 'id' | 'catalogId' | 'original'>;

interface Subscriber<Prepared extends PhotoPreviewPreparedCore> {
	readonly resolve: (value: PhotoPreviewJobOutcomeV1<Prepared>) => void;
	readonly reject: (error: unknown) => void;
	readonly signal?: AbortSignal;
	readonly abort: () => void;
	settled: boolean;
}

interface Job<Prepared extends PhotoPreviewPreparedCore> {
	readonly key: string;
	readonly photoId: string;
	readonly tier: PhotoPreviewTierV1;
	readonly controller: AbortController;
	readonly subscribers: Set<Subscriber<Prepared>>;
	readonly variant: string;
}

const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;
const abortReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(throwIfAborted, signal, []); }
function aborted(signal: AbortSignal): boolean { return Reflect.apply(nativeAborted, signal, []) === true; }

/** Scalar demand queue; one callback-scoped native frame and one independent preview at a time. */
export class PhotoPreviewSchedulerCore<Prepared extends PhotoPreviewPreparedCore = PreparedPhotoPreviewV1, Plan extends { readonly key: string } = PhotoPreviewPlanV1> {
	readonly #catalogId: string;
	readonly #protocol: PhotoPreviewProtocolCore<Prepared, Plan>;
	readonly #normalizePhoto: (value: unknown) => PhotoPreviewSchedulerAdmittedPhoto;
	readonly #ports: Readonly<Required<Omit<PhotoPreviewSchedulerOptionsCore<Prepared>, 'catalogId'>>>;
	readonly #jobs = new Map<string, Job<Prepared>>();
	readonly #queue: Job<Prepared>[] = [];
	#active: Job<Prepared> | null = null;
	#activeTask: Promise<PhotoPreviewJobOutcomeV1<Prepared>> | null = null;
	#pendingRequests = 0;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(options: PhotoPreviewSchedulerOptionsCore<Prepared>, normalizePhoto: (value: unknown) => PhotoPreviewSchedulerAdmittedPhoto,
		protocol: PhotoPreviewProtocolCore<Prepared, Plan>) {
		this.#normalizePhoto = normalizePhoto; this.#protocol = protocol;
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
		const configuredRegenerate = Object.hasOwn(input, 'regenerate') ? field(input, 'regenerate', 'photo preview scheduler ports') : undefined;
		const regenerate = (configuredRegenerate ?? withPhotoOriginalFrameV1) as typeof withPhotoOriginalFrameV1;
		if (typeof regenerate !== 'function') throw new TypeError('Photo preview requires an original frame factory.');
		const loadPhoto = field(input, 'loadPhoto', 'photo preview scheduler ports') as PhotoPreviewSchedulerOptionsCore<Prepared>['loadPhoto'];
		const loadOriginal = field(input, 'loadOriginal', 'photo preview scheduler ports') as PhotoPreviewSchedulerOptionsCore<Prepared>['loadOriginal'];
		const load = field(cache, 'load', 'photo preview cache port') as PhotoPreviewCachePortCore<Prepared>['load'];
		const store = field(cache, 'store', 'photo preview cache port') as PhotoPreviewCachePortV1['store'];
		const trim = field(cache, 'trim', 'photo preview cache port') as PhotoPreviewCachePortV1['trim'];
		this.#ports = Object.freeze({ loadPhoto: photoId => Reflect.apply(loadPhoto, options, [photoId]),
			loadOriginal: (storageKey, signal) => Reflect.apply(loadOriginal, options, [storageKey, signal]),
			cache: Object.freeze({ load: (plan, signal) => Reflect.apply(load, cache, [plan, signal]),
				store: (value, signal) => Reflect.apply(store, cache, [value, signal]), trim: signal => Reflect.apply(trim, cache, [signal]) } satisfies PhotoPreviewCachePortCore<Prepared>), regenerate });
	}

	request(value: unknown): Promise<PhotoPreviewJobOutcomeV1<Prepared>> {
		try {
			if (this.#closed) throw closedError();
			const { photoId, tier, signal, variant } = this.#protocol.capture(value);
			if (signal) Reflect.apply(throwIfAborted, signal, []);
			if (this.#closed) throw closedError();
			if (this.#pendingRequests >= PHOTO_PREVIEW_SCHEDULER_LIMITS_V1.maximumPendingRequests) throw new RangeError('Photo preview request budget is full.');
			const key = JSON.stringify([photoId, tier, variant]), previous = this.#jobs.get(key);
			let job = previous && !aborted(previous.controller.signal) ? previous : null;
			if (!job) {
				if (this.#queue.length >= PHOTO_PREVIEW_SCHEDULER_LIMITS_V1.maximumQueuedIds) throw new RangeError('Photo preview queue is full.');
				job = { key, photoId, tier, variant, controller: new AbortController(), subscribers: new Set() };
				this.#jobs.set(key, job); this.#queue.push(job);
			}
			const admitted = job;
			const pending = new Promise<PhotoPreviewJobOutcomeV1<Prepared>>((resolve, reject) => {
				const subscriber: Subscriber<Prepared> = { resolve, reject, signal, settled: false,
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
		this.#closing = pending ? pending.then(() => undefined, (error: unknown) => {
			if (!Object.is(error, active ? Reflect.apply(abortReason, active.controller.signal, []) : undefined)) throw error;
		}) : Promise.resolve();
		for (const job of [...this.#queue, ...(active ? [active] : [])]) {
			for (const subscriber of [...job.subscribers]) this.#cancel(job, subscriber, reason);
			job.controller.abort(reason);
		}
		return this.#closing;
	}

	#start(): void {
		if (this.#closed || this.#active) return;
		const job = this.#queue.shift(); if (!job) return;
		this.#active = job;
		let resolve!: (value: PhotoPreviewJobOutcomeV1<Prepared>) => void, reject!: (error: unknown) => void;
		const pending = new Promise<PhotoPreviewJobOutcomeV1<Prepared>>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#activeTask = pending;
		void pending.then(value => { this.#finish(job, value); }, error => { this.#finish(job, undefined, error); });
		void this.#run(job).then(resolve, reject);
	}

	async #run(job: Job<Prepared>): Promise<PhotoPreviewJobOutcomeV1<Prepared>> {
		const signal = job.controller.signal, photo = await this.#current(job.photoId, signal);
		if (!photo) return Object.freeze({ outcome: 'missing' });
		const binding = originalBinding(photo);
		const plan = this.#protocol.plan(binding, job.tier, photo, job.variant);
		const cached = await this.#ports.cache.load(plan, signal); check(signal);
		if (cached) {
			if (cached.key !== plan.key) throw new RangeError('Photo preview cache returned another plan.');
			if (!await this.#matches(job.photoId, binding, signal)) return Object.freeze({ outcome: 'superseded' });
			return Object.freeze({ outcome: 'ready', preview: cached, cache: 'hit' });
		}
		const body = await this.#ports.loadOriginal(binding.storageKey, signal); check(signal);
		const preview = await this.#protocol.render({ plan, binding, body, signal, variant: job.variant }, this.#ports.regenerate);
		check(signal);
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
			if (aborted(signal)) {
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

	async #current(photoId: string, signal: AbortSignal): Promise<PhotoPreviewSchedulerAdmittedPhoto | null> {
		check(signal); const value = await this.#ports.loadPhoto(photoId); check(signal);
		if (value === null) return null;
		const photo = this.#normalizePhoto(value);
		if (photo.kind !== 'photo' || photo.id !== photoId || photo.catalogId !== this.#catalogId) throw new TypeError('Photo preview read returned another photo or catalog.');
		return photo;
	}

	async #matches(photoId: string, binding: PhotoPreviewOriginalBindingV1, signal: AbortSignal): Promise<boolean> {
		const current = await this.#current(photoId, signal);
		return current !== null && JSON.stringify(originalBinding(current)) === JSON.stringify(binding);
	}

	#cancel(job: Job<Prepared>, subscriber: Subscriber<Prepared>, reason: unknown): void {
		if (subscriber.settled) return;
		this.#settle(job, subscriber); subscriber.reject(reason);
		if (!job.subscribers.size) {
			job.controller.abort(reason);
			const queued = this.#queue.indexOf(job); if (queued >= 0) this.#queue.splice(queued, 1);
			if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
		}
	}

	#finish(job: Job<Prepared>, value?: PhotoPreviewJobOutcomeV1<Prepared>, error?: unknown): void {
		for (const subscriber of [...job.subscribers]) {
			this.#settle(job, subscriber); if (value) subscriber.resolve(value); else subscriber.reject(error);
		}
		if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
		this.#active = null; this.#activeTask = null; this.#start();
	}

	#settle(job: Job<Prepared>, subscriber: Subscriber<Prepared>): void {
		subscriber.settled = true; job.subscribers.delete(subscriber); this.#pendingRequests -= 1;
		if (subscriber.signal) Reflect.apply(removeListener, subscriber.signal, ['abort', subscriber.abort]);
	}
}

function originalBinding(photo: PhotoPreviewSchedulerAdmittedPhoto): Readonly<PhotoPreviewOriginalBindingV1> {
	return Object.freeze({ catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
		contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: photo.original.width, height: photo.original.height });
}

function closedError(): Error { return new Error('Photo preview scheduler is closed.'); }
