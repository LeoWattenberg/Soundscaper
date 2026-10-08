/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryPreviewOutcomeV1, PhotoLibraryPreviewTierV1 } from '../../photo-library-session-port-v1.ts';
import { withPixelFrameBodyV1 } from '../../imaging/pixel-frame-body-v1.ts';
import { clearPixelFrameCanvasV1, paintPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import type { PixelFrameLimitsV1, PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';

export type PixelPreviewPresentationReaderV1 = (photoId: string, tier: PhotoLibraryPreviewTierV1,
	options: Readonly<{ signal: AbortSignal }>) => Promise<PhotoLibraryPreviewOutcomeV1>;

export interface PixelPreviewPresentationViewV1 {
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly photoIds: readonly string[];
	readonly thumbnailsVisible: boolean;
	readonly fitScreenPhotoId: string | null;
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
interface Job { readonly key: string; readonly photoId: string; readonly tier: PhotoLibraryPreviewTierV1;
	readonly generation: number; readonly canvas: HTMLCanvasElement; readonly controller: AbortController }

const MIB = 1024 * 1024;
export const PIXEL_PREVIEW_PRESENTATION_LIMITS_V1 = Object.freeze({ maximumThumbnailTargets: 64,
	maximumFitScreenTargets: 1, maximumThumbnailBytes: 64 * MIB, maximumFitScreenBytes: 16 * MIB });
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
	#view: PixelPreviewPresentationViewV1 | null = null;
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
		const previous = this.#view;
		if (previous?.readPreview === value.readPreview && previous.thumbnailsVisible === thumbnailsVisible
			&& previous.fitScreenPhotoId === fitScreenPhotoId && JSON.stringify(previous.photoIds) === JSON.stringify(photoIds)) return;
		this.#cancel(); this.#clearAll(); this.#statuses.clear();
		this.#view = Object.freeze({ readPreview: value.readPreview, photoIds: Object.freeze(photoIds), thumbnailsVisible, fitScreenPhotoId });
		if (fitScreenPhotoId !== null) this.#addStatus(fitScreenPhotoId, 'fit-screen');
		if (thumbnailsVisible) for (const id of photoIds) this.#addStatus(id, 'thumbnail');
		this.#notify(); this.#wake();
	}

	attach(idValue: string, tierValue: PhotoLibraryPreviewTierV1, canvas: HTMLCanvasElement | null): void {
		if (this.#closed && canvas === null) return;
		this.#assertOpen();
		const id = photoId(idValue), tier = readTier(tierValue), key = targetKey(id, tier), previous = this.#targets.get(key);
		if (previous?.canvas === canvas) return;
		if (previous) {
			if (this.#active?.key === key) this.#active.controller.abort();
			this.#ports.clear(previous.canvas); this.#targets.delete(key);
		}
		if (canvas !== null) {
			if ([...this.#targets.values()].some(target => target.canvas === canvas)) throw new RangeError('A canvas may own only one preview target.');
			const count = [...this.#targets.keys()].filter(key => key.endsWith(`,"${tier}"]`)).length;
			if (count >= (tier === 'thumbnail' ? 64 : 1)) throw new RangeError(tier === 'thumbnail' ? 'At most 64 thumbnail targets are admitted.' : 'At most one loupe target is admitted.');
			this.#ports.clear(canvas); this.#targets.set(key, { canvas, bytes: 0 });
			const status = this.#statuses.get(key); if (status) this.#statuses.set(key, { ...status, status: 'pending', error: null });
		}
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
		this.#cancel(); this.#view = null; this.#statuses.clear(); this.#clearAll(); this.#notify();
		return this.#pending ?? Promise.resolve();
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
	#clearAll(): void { for (const target of this.#targets.values()) { this.#ports.clear(target.canvas); target.bytes = 0; } }
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
		const job: Job = { key, photoId: status.photoId, tier: status.tier, canvas: target.canvas,
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
				const receipt = this.#ports.paint(job.canvas, frame, { limits, signal });
				if (!Number.isSafeInteger(receipt.byteLength) || receipt.byteLength <= 0 || receipt.byteLength > limits.maximumBytes) {
					this.#ports.clear(job.canvas); throw new RangeError('Canvas receipt exceeds its surface budget.');
				}
				this.#targets.get(job.key)!.bytes = receipt.byteLength;
			}, { limits });
			if (this.#current(job)) this.#setStatus(job, 'ready', null, Object.freeze(notices));
		} catch (error) {
			if (this.#current(job)) { this.#ports.clear(job.canvas); this.#targets.get(job.key)!.bytes = 0; this.#setStatus(job, 'failed', errorMessage(error)); }
			else if (error !== Reflect.apply(SIGNAL_REASON, signal, []) && !(error instanceof DOMException && error.name === 'AbortError')) this.#recordCleanup(error);
		} finally {
			if (this.#active === job) this.#active = null;
			this.#notify();
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
	const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value.slice(0, 2048) : 'The photo preview could not be displayed.';
}
