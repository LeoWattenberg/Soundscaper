/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryPreviewOutcomeV1, PhotoLibraryPreviewTierV1 } from '../../photo-library-session-port-v1.ts';
import { withPixelFrameBodyV1 } from '../../imaging/pixel-frame-body-v1.ts';
import { clearPixelFrameCanvasV1, paintPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import type { PixelFrameLimitsV1, PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import { readPixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';

export type PixelPreviewPresentationReaderV1 = (photoId: string, tier: PhotoLibraryPreviewTierV1,
	options: Readonly<{ signal: AbortSignal }>) => Promise<PhotoLibraryPreviewOutcomeV1>;

export interface PixelPreviewPresentationViewV1 {
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly photoIds: readonly string[];
	readonly thumbnailsVisible: boolean;
	readonly fitScreenPhotoId: string | null;
}

export interface PixelPreviewCompareViewV1 {
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly photoIds: readonly string[];
}

export interface PixelPreviewTargetStatusV1 {
	readonly photoId: string;
	readonly tier: PhotoLibraryPreviewTierV1;
	readonly status: 'pending' | 'ready' | 'missing' | 'failed';
	readonly error: string | null;
	readonly notices: readonly ('persistence-failed' | 'cleanup-failed')[];
}

export interface PixelPreviewPresentationSnapshotV1 {
	readonly active: boolean;
	readonly thumbnailBytes: number;
	readonly fitScreenBytes: number;
	readonly targets: readonly Readonly<PixelPreviewTargetStatusV1>[];
	readonly cleanupErrors: readonly string[];
}

type Stage = (request: Parameters<typeof withPixelFrameBodyV1>[0], consume: (frame: PixelFrameV1) => void,
	options: Readonly<{ limits: PixelFrameLimitsV1 }>) => Promise<void>;
interface Ports {
	readonly stage?: Stage;
	readonly paint?: typeof paintPixelFrameCanvasV1;
	readonly clear?: typeof clearPixelFrameCanvasV1;
}
interface Target { readonly canvas: HTMLCanvasElement; bytes: number }
type Profile = 'ordinary' | 'compare';
interface View { readonly readPreview: PixelPreviewPresentationReaderV1; readonly photoIds: readonly string[];
	readonly thumbnailsVisible: boolean; readonly fitScreenPhotoIds: readonly string[]; readonly profile: Profile }
interface Job { readonly key: string; readonly photoId: string; readonly tier: PhotoLibraryPreviewTierV1; readonly profile: Profile;
	readonly generation: number; readonly canvas: HTMLCanvasElement; readonly controller: AbortController }

const MIB = 1024 * 1024;
export const PIXEL_PREVIEW_PRESENTATION_LIMITS_V1 = Object.freeze({ maximumThumbnailTargets: 64,
	maximumFitScreenTargets: 1, maximumThumbnailBytes: 64 * MIB, maximumFitScreenBytes: 16 * MIB });
export const PIXEL_COMPARE_PRESENTATION_LIMITS_V1 = Object.freeze({ maximumFitScreenTargets: 2,
	maximumFitScreenTargetBytes: 16 * MIB, maximumFitScreenBytes: 32 * MIB, maximumBackingBytes: 80 * MIB });
const THUMBNAIL: Readonly<PixelFrameLimitsV1> = Object.freeze({ maximumSidePixels: 512, maximumPixels: 512 * 512, maximumBytes: MIB });
const FIT_SCREEN: Readonly<PixelFrameLimitsV1> = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 2048 * 2048, maximumBytes: 16 * MIB });
const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const SIGNAL_REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Owns scalar demand and surface registration; generations join before another body is requested. */
export class PixelPreviewPresentationV1 {
	readonly #ports: Readonly<Required<Ports>>;
	readonly #targets = new Map<string, Target>();
	readonly #statuses = new Map<string, PixelPreviewTargetStatusV1>();
	readonly #cleanupErrors: string[] = [];
	#view: View | null = null;
	#profile: Profile = 'ordinary';
	#generation = 0;
	#active: Job | null = null;
	#pending: Promise<void> | null = null;
	#listener: ((snapshot: PixelPreviewPresentationSnapshotV1) => void) | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(options: Ports = {}) {
		const input = record(options, 'pixel presentation ports', ['stage', 'paint', 'clear'], []);
		for (const name of ['stage', 'paint', 'clear']) {
			if (Object.hasOwn(input, name) && typeof field(input, name, 'pixel presentation ports') !== 'function') {
				throw new TypeError('Pixel presentation ports must be functions.');
			}
		}
		this.#ports = Object.freeze({ stage: options.stage?.bind(options) ?? withPixelFrameBodyV1,
			paint: options.paint?.bind(options) ?? paintPixelFrameCanvasV1, clear: options.clear?.bind(options) ?? clearPixelFrameCanvasV1 });
	}

	subscribe(listener: (snapshot: PixelPreviewPresentationSnapshotV1) => void): () => void {
		this.#assertOpen();
		if (typeof listener !== 'function') throw new TypeError('Pixel presentation requires a scalar observer.');
		this.#listener = listener; this.#notify();
		return () => { if (this.#listener === listener) this.#listener = null; };
	}

	setView(value: PixelPreviewPresentationViewV1): void {
		this.#assertOpen();
		const input = record(value, 'pixel preview view', ['readPreview', 'photoIds', 'thumbnailsVisible', 'fitScreenPhotoId']);
		if (typeof field(input, 'readPreview', 'pixel preview view') !== 'function') throw new TypeError('Pixel preview view requires a read port.');
		const photoIds = array(field(input, 'photoIds', 'pixel preview view'), 'visible photo IDs', 0, 64).map(photoId);
		if (new Set(photoIds).size !== photoIds.length) throw new RangeError('Visible photo IDs must be unique.');
		const thumbnailsVisible = field(input, 'thumbnailsVisible', 'pixel preview view');
		if (typeof thumbnailsVisible !== 'boolean') throw new TypeError('Thumbnail opt-in must be explicit.');
		const fit = field(input, 'fitScreenPhotoId', 'pixel preview view'), fitScreenPhotoId = fit === null ? null : photoId(fit);
		if (fitScreenPhotoId !== null && !photoIds.includes(fitScreenPhotoId)) throw new RangeError('The loupe must belong to the visible page.');
		this.#setView({ readPreview: value.readPreview, photoIds: Object.freeze(photoIds), thumbnailsVisible,
			fitScreenPhotoIds: Object.freeze(fitScreenPhotoId === null ? [] : [fitScreenPhotoId]), profile: 'ordinary' });
	}

	setCompareView(value: PixelPreviewCompareViewV1): void {
		this.#assertOpen();
		const input = record(value, 'pixel compare view', ['readPreview', 'photoIds']);
		const readPreview = field(input, 'readPreview', 'pixel compare view');
		if (typeof readPreview !== 'function') throw new TypeError('Pixel compare view requires a read port.');
		const photoIds = array(field(input, 'photoIds', 'pixel compare view'), 'compare photo IDs', 2, 2).map(photoId);
		if (new Set(photoIds).size !== 2) throw new RangeError('Compare requires two distinct photo IDs.');
		const ids = Object.freeze(photoIds);
		this.#setView({ readPreview: readPreview as PixelPreviewPresentationReaderV1, photoIds: ids,
			thumbnailsVisible: false, fitScreenPhotoIds: ids, profile: 'compare' });
	}

	attach(idValue: string, tierValue: PhotoLibraryPreviewTierV1, canvas: HTMLCanvasElement | null): void {
		this.#attach(idValue, tierValue, canvas, 'ordinary');
	}

	/** Compare refs may register before layout selects their scalar view on this same owner. */
	attachCompare(idValue: string, canvas: HTMLCanvasElement | null): void {
		this.#attach(idValue, 'fit-screen', canvas, 'compare');
	}

	#attach(idValue: string, tierValue: PhotoLibraryPreviewTierV1, canvas: HTMLCanvasElement | null, profile: Profile): void {
		if (this.#closed && canvas === null) return;
		this.#assertOpen();
		const id = photoId(idValue), tier = readTier(tierValue), key = targetKey(id, tier), previous = this.#targets.get(key);
		// A stale ref from the retired profile cannot detach its successor's target.
		if (canvas === null && profile !== this.#profile) return;
		if (canvas !== null) this.#selectProfile(profile);
		if (previous?.canvas === canvas) return;
		if (previous) {
			if (this.#active?.key === key) this.#active.controller.abort();
			this.#ports.clear(previous.canvas); this.#targets.delete(key);
		}
		if (canvas !== null) {
			if ([...this.#targets.values()].some(target => target.canvas === canvas)) throw new RangeError('A canvas may own only one preview target.');
			const count = [...this.#targets.keys()].filter(key => key.endsWith(`,"${tier}"]`)).length;
			const maximum = tier === 'thumbnail' ? 64 : profile === 'compare' ? 2 : 1;
			if (count >= maximum) throw new RangeError(tier === 'thumbnail' ? 'At most 64 thumbnail targets are admitted.'
				: profile === 'compare' ? 'At most two compare targets are admitted.' : 'At most one loupe target is admitted.');
			this.#ports.clear(canvas); this.#targets.set(key, { canvas, bytes: 0 });
			const status = this.#statuses.get(key); if (status) this.#statuses.set(key, { ...status, status: 'pending', error: null });
		}
		this.#notify(); this.#wake();
	}

	#selectProfile(profile: Profile): void {
		if (profile === this.#profile) return;
		if (this.#targets.size !== 0) throw new RangeError('Mixed ordinary and compare registrations require detaching the previous surfaces.');
		this.#cancel(); this.#view = null; this.#statuses.clear(); this.#profile = profile;
	}
	#setView(view: View): void {
		this.#selectProfile(view.profile);
		const previous = this.#view;
		if (previous?.readPreview === view.readPreview && previous.thumbnailsVisible === view.thumbnailsVisible
			&& JSON.stringify(previous.fitScreenPhotoIds) === JSON.stringify(view.fitScreenPhotoIds)
			&& JSON.stringify(previous.photoIds) === JSON.stringify(view.photoIds)) return;
		this.#cancel(); this.#view = null; this.#statuses.clear(); this.#clearAll();
		this.#view = Object.freeze(view);
		for (const id of view.fitScreenPhotoIds) this.#addStatus(id, 'fit-screen');
		if (view.thumbnailsVisible) for (const id of view.photoIds) this.#addStatus(id, 'thumbnail');
		this.#notify(); this.#wake();
	}

	snapshot(): Readonly<PixelPreviewPresentationSnapshotV1> {
		let thumbnailBytes = 0, fitScreenBytes = 0;
		for (const [key, target] of this.#targets) {
			if (key.endsWith(',"thumbnail"]')) thumbnailBytes += target.bytes; else fitScreenBytes += target.bytes;
		}
		return Object.freeze({ active: this.#active !== null, thumbnailBytes, fitScreenBytes,
			targets: Object.freeze([...this.#statuses.values()].map(status => Object.freeze({ ...status }))),
			cleanupErrors: Object.freeze([...this.#cleanupErrors]) });
	}

	pause(): Promise<void> {
		this.#cancel(); this.#view = null; this.#statuses.clear();
		let cleanup: unknown, failed = false;
		try { this.#clearAll(); } catch (error) { failed = true; cleanup = error; }
		this.#notify();
		const pending = this.#pending ?? Promise.resolve();
		return failed ? pending.then(() => { throw cleanup; }) : pending;
	}

	async drain(): Promise<void> {
		while (this.#pending) await this.#pending;
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
		this.#closed = true;
		try {
			void this.pause().then(() => { this.#targets.clear(); this.#listener = null; resolve(); }, reject);
		} catch (error) { reject(error); }
		return this.#closing;
	}

	#addStatus(id: string, tier: PhotoLibraryPreviewTierV1): void {
		this.#statuses.set(targetKey(id, tier), { photoId: id, tier, status: 'pending', error: null, notices: Object.freeze([]) });
	}
	#cancel(): void { this.#generation += 1; this.#active?.controller.abort(); }
	#clearAll(): void {
		const failures: unknown[] = [];
		for (const target of this.#targets.values()) {
			try { this.#ports.clear(target.canvas); target.bytes = 0; }
			catch (error) { failures.push(error); this.#recordCleanup(error); }
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Preview backing cleanup failed.');
	}
	#assertOpen(): void { if (this.#closed) throw new Error('Pixel presentation is closed.'); }
	#notify(): void {
		try { this.#listener?.(this.snapshot()); }
		catch (error) { this.#recordCleanup(error); }
	}
	#recordCleanup(error: unknown): void {
		if (this.#cleanupErrors.length >= 64) this.#cleanupErrors.shift();
		this.#cleanupErrors.push(errorMessage(error));
	}

	#wake(): void {
		if (this.#closed || this.#pending || !this.#view) return;
		const status = [...this.#statuses.values()].find(status => status.status === 'pending' && this.#targets.has(targetKey(status.photoId, status.tier)));
		if (!status) return;
		const key = targetKey(status.photoId, status.tier), target = this.#targets.get(key)!;
		const job: Job = { key, photoId: status.photoId, tier: status.tier, canvas: target.canvas, profile: this.#view.profile,
			generation: this.#generation, controller: new AbortController() };
		this.#active = job;
		const readPreview = this.#view.readPreview;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const pending = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); this.#pending = pending;
		void pending.then(() => {
			if (this.#pending === pending) this.#pending = null;
			this.#wake();
		}, error => {
			this.#recordCleanup(error);
			if (this.#pending === pending) this.#pending = null;
			this.#wake();
		});
		this.#notify();
		void this.#run(job, readPreview).then(resolve, reject);
	}
	#current(job: Job): boolean {
		return !this.#closed && job.generation === this.#generation && Reflect.apply(SIGNAL_ABORTED, job.controller.signal, []) === false
			&& this.#targets.get(job.key)?.canvas === job.canvas;
	}

	async #run(job: Job, readPreview: PixelPreviewPresentationReaderV1): Promise<void> {
		const signal = job.controller.signal;
		try {
			if (!this.#current(job)) return;
			const outcome = await readPreview(job.photoId, job.tier, { signal });
			if (!this.#current(job)) return;
			const input = record(outcome, 'pixel preview outcome', ['outcome', 'preview', 'cache', 'notices'], ['outcome']);
			const kind = field(input, 'outcome', 'pixel preview outcome');
			if (kind !== 'ready') {
				if ((kind !== 'missing' && kind !== 'superseded') || Object.keys(input).length !== 1) {
					throw new TypeError('Unknown pixel preview outcome.');
				}
				this.#setStatus(job, 'missing'); return;
			}
			const cache = field(input, 'cache', 'pixel preview outcome');
			if (cache !== 'hit' && cache !== 'stored' && cache !== 'transient') throw new TypeError('Unknown preview cache receipt.');
			const notices: ('persistence-failed' | 'cleanup-failed')[] = [];
			for (const notice of array(field(input, 'notices', 'pixel preview outcome'), 'preview notices', 0, 2)) {
				if (notice !== 'persistence-failed' && notice !== 'cleanup-failed') throw new TypeError('Unknown preview notice.');
				if (notices.includes(notice)) throw new TypeError('Preview notices must be unique.');
				notices.push(notice);
			}
			const preview = record(field(input, 'preview', 'pixel preview outcome'), 'pixel preview payload',
				['photoId', 'tier', 'descriptor', 'byteLength', 'outputSha256', 'body']);
			if (field(preview, 'photoId', 'pixel preview payload') !== job.photoId || field(preview, 'tier', 'pixel preview payload') !== job.tier) {
				throw new RangeError('Pixel preview identity does not match its target.');
			}
			const limits = job.tier === 'thumbnail' ? THUMBNAIL : FIT_SCREEN;
			await this.#ports.stage({ descriptor: field(preview, 'descriptor', 'pixel preview payload'),
				byteLength: field(preview, 'byteLength', 'pixel preview payload') as number,
				outputSha256: field(preview, 'outputSha256', 'pixel preview payload') as string,
				body: field(preview, 'body', 'pixel preview payload'), signal }, frame => {
				if (!this.#current(job)) return;
				const admitted = readPixelFrameV1(frame, limits);
				this.#assertBackingBudget(job, admitted.pixels.byteLength);
				const receipt = this.#ports.paint(job.canvas, admitted, { limits, signal });
				if (!this.#current(job)) { this.#ports.clear(job.canvas); return; }
				if (receipt.byteLength !== admitted.pixels.byteLength) {
					this.#ports.clear(job.canvas); throw new RangeError('Canvas receipt exceeds its surface budget.');
				}
				this.#targets.get(job.key)!.bytes = receipt.byteLength;
			}, { limits });
			if (this.#current(job)) this.#setStatus(job, 'ready', null, Object.freeze(notices));
		} catch (error) {
			if (this.#current(job)) {
				try { this.#ports.clear(job.canvas); this.#targets.get(job.key)!.bytes = 0; }
				catch (cleanup) { this.#recordCleanup(cleanup); }
				this.#setStatus(job, 'failed', errorMessage(error));
			}
			else if (error !== Reflect.apply(SIGNAL_REASON, signal, []) && !(error instanceof DOMException && error.name === 'AbortError')) this.#recordCleanup(error);
		} finally {
			if (this.#active === job) this.#active = null;
			this.#notify();
		}
	}
	#assertBackingBudget(job: Job, bytes: number): void {
		let tierBytes = bytes, backingBytes = bytes;
		for (const [key, target] of this.#targets) {
			if (key === job.key) continue;
			backingBytes += target.bytes;
			if (key.endsWith(`,"${job.tier}"]`)) tierBytes += target.bytes;
		}
		const maximum = job.tier === 'thumbnail' ? PIXEL_PREVIEW_PRESENTATION_LIMITS_V1.maximumThumbnailBytes
			: job.profile === 'compare' ? PIXEL_COMPARE_PRESENTATION_LIMITS_V1.maximumFitScreenBytes
				: PIXEL_PREVIEW_PRESENTATION_LIMITS_V1.maximumFitScreenBytes;
		if (tierBytes > maximum || backingBytes > PIXEL_COMPARE_PRESENTATION_LIMITS_V1.maximumBackingBytes) {
			throw new RangeError('Preview surfaces exceed their aggregate backing budget.');
		}
	}
	#setStatus(job: Job, status: PixelPreviewTargetStatusV1['status'], error: string | null = null,
		notices: PixelPreviewTargetStatusV1['notices'] = Object.freeze([])): void {
		this.#statuses.set(job.key, { photoId: job.photoId, tier: job.tier, status, error, notices });
	}
}

function photoId(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256
		|| [...value].some(character => character.charCodeAt(0) < 32)) throw new TypeError('Preview IDs require bounded inert strings.');
	return value;
}
function readTier(value: unknown): PhotoLibraryPreviewTierV1 {
	if (value !== 'thumbnail' && value !== 'fit-screen') throw new RangeError('Unknown preview presentation tier.');
	return value;
}
function targetKey(id: string, tier: PhotoLibraryPreviewTierV1): string { return JSON.stringify([id, tier]); }
function errorMessage(value: unknown): string {
	try {
		const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2048);
	} catch { /* Error diagnostics must not prevent native owner settlement. */ }
	return 'The photo preview could not be displayed.';
}
