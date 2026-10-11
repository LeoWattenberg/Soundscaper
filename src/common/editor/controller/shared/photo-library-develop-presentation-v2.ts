/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PixelPreviewPresentationReaderV1 } from './pixel-preview-presentation-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2, PhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, type PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../imaging/image-develop-state-v2.ts';
import { readPixelFrameV1, type PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import { withPixelFrameBodyV1 } from '../../imaging/pixel-frame-body-v1.ts';
import { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import { createPixelFrameHistogramV1, type PixelFrameHistogramV1 } from '../../imaging/pixel-frame-histogram-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1, type ImageDevelopMaskOverlaySelectionV1 } from '../../imaging/image-develop-mask-overlay-v1.ts';

export interface PhotoDevelopPresentationSnapshotV2 {
	readonly status: 'idle' | 'pending' | 'ready' | 'missing' | 'failed';
	readonly before: Readonly<PixelFrameHistogramV1> | null;
	readonly after: Readonly<PixelFrameHistogramV1> | null;
	readonly extent: Readonly<{ before: Readonly<{ width: number; height: number }>; after: Readonly<{ width: number; height: number }> }> | null;
	readonly error: string | null;
}
export interface PhotoDevelopPresentationViewV2 {
	readonly resolution?: PhotoDevelopResolutionV1;
	readonly revision?: number;
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly before: HTMLCanvasElement;
	readonly after: HTMLCanvasElement;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
	readonly overlay?: HTMLCanvasElement;
}
interface Ports {
	readonly withOriginalFrame?: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly beforePresent?: Promise<void>;
	readonly stage?: typeof withPixelFrameBodyV1;
	readonly paint?: typeof paintPixelFrameCanvasV1;
	readonly clear?: typeof clearPixelFrameCanvasV1;
}
type Rendered = Pick<PhotoDevelopPresentationSnapshotV2, 'before' | 'after' | 'extent'>;
const SOURCE = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const RENDER = Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 });
const CHECK = AbortSignal.prototype.throwIfAborted;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
const PREPARED = new WeakSet<object>();

/** Detach the complete mixed recipe before predecessor, source or lazy runtime
 * waits. Canvas references are borrowed targets, never serialized authority. */
export function preparePhotoDevelopPresentationViewV2(value: unknown): Readonly<PhotoDevelopPresentationViewV2> {
	if (value && typeof value === 'object' && PREPARED.has(value)) return value as Readonly<PhotoDevelopPresentationViewV2>;
	const input = record(value, 'develop presentation', ['photoId', 'develop', 'revision', 'resolution', 'before', 'after', 'maskOverlay', 'overlay'], ['photoId', 'develop', 'before', 'after']);
	const id = field(input, 'photoId', 'develop presentation');
	if (typeof id !== 'string' || id.length === 0 || id.length > 256 || [...id].some(character => character.charCodeAt(0) < 32)) throw new TypeError('Develop requires a bounded photo ID.');
	const resolution = Object.hasOwn(input, 'resolution') ? field(input, 'resolution', 'develop presentation') : undefined;
	if (resolution !== undefined && resolution !== 'proxy' && resolution !== 'full') throw new RangeError('Unknown develop resolution.');
	const revision = Object.hasOwn(input, 'revision') ? field(input, 'revision', 'develop presentation') : undefined;
	if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) throw new RangeError('Develop requires a bounded photo revision.');
	if (resolution === 'full' && revision === undefined) throw new RangeError('Full-resolution develop requires a photo revision.');
	const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop', 'develop presentation'));
	if (new TextEncoder().encode(JSON.stringify(develop)).byteLength > 2_097_152) throw new RangeError('Develop settings exceed their byte budget.');
	const before = field(input, 'before', 'develop presentation'), after = field(input, 'after', 'develop presentation');
	if (!before || typeof before !== 'object' || !after || typeof after !== 'object' || before === after) throw new TypeError('Develop requires two distinct canvas targets.');
	const rawSelection = Object.hasOwn(input, 'maskOverlay') ? field(input, 'maskOverlay', 'develop presentation') : undefined;
	const overlay = Object.hasOwn(input, 'overlay') ? field(input, 'overlay', 'develop presentation') : undefined;
	if ((rawSelection === undefined) !== (overlay === undefined)) throw new TypeError('Mask overlay requires both a selection and a canvas target.');
	if (overlay !== undefined && (!overlay || typeof overlay !== 'object' || overlay === before || overlay === after)) throw new TypeError('Mask overlay requires a distinct canvas target.');
	const maskOverlay = rawSelection === undefined ? undefined : prepareImageDevelopMaskOverlaySelectionV1(rawSelection);
	const result = Object.freeze({ photoId: id, develop, resolution, revision: revision as number | undefined, before: before as HTMLCanvasElement, after: after as HTMLCanvasElement,
		...(maskOverlay ? { maskOverlay, overlay: overlay as HTMLCanvasElement } : {}) });
	PREPARED.add(result); return result;
}

function pin<Callable extends (...args: never[]) => unknown>(value: unknown, receiver: unknown): Callable {
	if (typeof value !== 'function') throw new TypeError('Develop presentation requires a callable port.');
	return ((...args: unknown[]): unknown => Reflect.apply(value, receiver, args) as unknown) as unknown as Callable;
}
function ports(value: Ports): Required<Omit<Ports, 'withOriginalFrame'>> & Pick<Ports, 'withOriginalFrame'> {
	const input = record(value, 'develop presentation ports', ['withOriginalFrame', 'readPreview', 'loadProxy', 'beforePresent', 'stage', 'paint', 'clear'], ['readPreview', 'loadProxy']);
	const optional = (key: string): unknown => Object.hasOwn(input, key) ? field(input, key, 'develop presentation ports') : undefined;
	const original = optional('withOriginalFrame'), gate = optional('beforePresent'), stage = optional('stage'), paint = optional('paint'), clear = optional('clear');
	return Object.freeze({ withOriginalFrame: original === undefined ? undefined : pin<PhotoLibraryDevelopOriginalPortV1['withFrame']>(original, value),
		readPreview: pin<PixelPreviewPresentationReaderV1>(field(input, 'readPreview', 'develop presentation ports'), value),
		loadProxy: pin<LoadPhotoLibraryDevelopProxyRuntimeV2>(field(input, 'loadProxy', 'develop presentation ports'), value),
		beforePresent: gate === undefined ? Promise.resolve() : gate as Promise<void>,
		stage: stage === undefined ? withPixelFrameBodyV1 : pin<typeof withPixelFrameBodyV1>(stage, value),
		paint: paint === undefined ? paintPixelFrameCanvasV1 : pin<typeof paintPixelFrameCanvasV1>(paint, value),
		clear: clear === undefined ? clearPixelFrameCanvasV1 : pin<typeof clearPixelFrameCanvasV1>(clear, value) });
}

function captureRuntime(value: Readonly<PhotoLibraryDevelopProxyRuntimeV2>): Readonly<PhotoLibraryDevelopProxyRuntimeV2> {
	const input = record(value, 'develop runtime', ['withProxy', 'withFullResolution']);
	return Object.freeze({ withProxy: pin<PhotoLibraryDevelopProxyRuntimeV2['withProxy']>(field(input, 'withProxy', 'develop runtime'), value),
		withFullResolution: pin<PhotoLibraryDevelopProxyRuntimeV2['withFullResolution']>(field(input, 'withFullResolution', 'develop runtime'), value) });
}

/** One joined source/stage/current renderer at a time. Only scalar histograms and
 * extents survive; resource authentication belongs to the injected runtime2.
 * Fixed profiles bound frames, not total working set or interaction latency. */
export class PhotoLibraryDevelopPresentationV2 {
	readonly #ports: ReturnType<typeof ports>;
	#view: Readonly<PhotoDevelopPresentationViewV2> | null = null;
	#targets: Pick<PhotoDevelopPresentationViewV2, 'before' | 'after' | 'overlay'> | null = null;
	#pending: Promise<void> | null = null;
	#active: AbortController | null = null;
	#pausing: Promise<void> | null = null;
	#closing: Promise<void> | null = null;
	#failure: Readonly<{ value: unknown }> | null = null;
	#closed = false;
	#snapshot: PhotoDevelopPresentationSnapshotV2 = Object.freeze({ status: 'idle', before: null, after: null, extent: null, error: null });
	#listener: ((value: PhotoDevelopPresentationSnapshotV2) => void) | null = null;
	constructor(value: Ports) { this.#ports = ports(value); }
	snapshot(): PhotoDevelopPresentationSnapshotV2 { return this.#snapshot; }
	subscribe(listener: (value: PhotoDevelopPresentationSnapshotV2) => void): () => void {
		this.#listener = listener; listener(this.#snapshot); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	setView(value: PhotoDevelopPresentationViewV2): void {
		if (this.#closed || this.#failure) return;
		const view = preparePhotoDevelopPresentationViewV2(value);
		if (this.#closed || this.#failure) return;
		this.#view = view; this.#active?.abort(); this.#clear();
		if (this.#closed || this.#failure || this.#view !== view) return;
		this.#targets = view; this.#publish({ status: 'pending', before: null, after: null, extent: null, error: null }); this.#wake();
	}
	async drain(): Promise<void> { while (this.#pending) await this.#pending; if (this.#failure) throw this.#failure.value; }
	pause(): Promise<void> {
		this.#view = null;
		if (this.#pausing) return this.#pausing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const paused = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); this.#pausing = paused;
		this.#active?.abort();
		void this.drain().then(() => this.#finishPause(), error => { this.#remember(error); this.#finishPause(); }).then(resolve, reject);
		void paused.then(() => { if (this.#pausing === paused) this.#pausing = null; this.#wake(); }, () => { if (this.#pausing === paused) this.#pausing = null; });
		return paused;
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
		this.#closed = true; this.#listener = null; void this.pause().then(resolve, reject); return this.#closing;
	}
	#finishPause(): void {
		this.#clear();
		const queued = !this.#closed && !this.#failure ? this.#view : null;
		if (queued) this.#targets = queued;
		this.#publish({ status: queued ? 'pending' : 'idle', before: null, after: null, extent: null, error: null });
		if (this.#failure) throw this.#failure.value;
	}
	#wake(): void {
		if (this.#closed || this.#failure || this.#pausing || this.#pending || !this.#view) return;
		const view = this.#view, active = new AbortController(); this.#active = active;
		let resolve!: () => void;
		const pending = new Promise<void>(done => { resolve = done; }); this.#pending = pending;
		void this.#run(view, active.signal).catch((error: unknown) => {
			const cancelled = Reflect.apply(ABORTED, active.signal, []) === true;
			if (cancelled && !Object.is(Reflect.apply(REASON, active.signal, []), error)) this.#remember(error);
			if (this.#view === view) {
				this.#clear(error); this.#publish({ status: 'failed', before: null, after: null, extent: null, error: 'The develop preview failed.' });
			}
		}).finally(() => {
			if (this.#pending === pending) { this.#pending = null; this.#active = null; }
			resolve(); if (this.#view !== view) this.#wake();
		});
	}
	async #run(view: Readonly<PhotoDevelopPresentationViewV2>, signal: AbortSignal): Promise<void> {
		try { await this.#ports.beforePresent; } catch (error) { this.#remember(error); throw error; }
		check(signal);
		if (view.resolution === 'full') {
			const loaded = await this.#ports.loadProxy(); check(signal); const runtime = captureRuntime(loaded); check(signal);
			if (!this.#ports.withOriginalFrame) throw new Error('Full-resolution development is unavailable.');
			const rendered = await this.#ports.withOriginalFrame({ schemaVersion: 1, photoId: view.photoId, expectedRevision: view.revision! }, async source => {
				check(signal);
				if (source.photoId !== view.photoId || source.revision !== view.revision) throw new Error('Develop original changed its requested identity or revision.');
				return this.#present(view, readPixelFrameV1(source.frame, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source), runtime, signal);
			}, { signal });
			check(signal); if (this.#view === view && rendered) this.#publish({ status: 'ready', ...rendered, error: null }); return;
		}
		const result = await this.#ports.readPreview(view.photoId, 'fit-screen', { signal }); check(signal);
		if (result.outcome !== 'ready') { if (this.#view === view) this.#publish({ status: 'missing' }); return; }
		if (result.preview.photoId !== view.photoId || result.preview.tier !== 'fit-screen') throw new Error('Develop source changed its requested identity.');
		const loaded = await this.#ports.loadProxy(); check(signal); const runtime = captureRuntime(loaded); check(signal);
		const { descriptor, byteLength, outputSha256, body } = result.preview;
		const rendered = await this.#ports.stage({ descriptor, byteLength, outputSha256, body, signal }, frame => this.#present(view, frame, runtime, signal), { limits: SOURCE });
		check(signal); if (this.#view === view && rendered) this.#publish({ status: 'ready', ...rendered, error: null });
	}
	async #present(view: Readonly<PhotoDevelopPresentationViewV2>, frame: PixelFrameV1, runtime: Readonly<PhotoLibraryDevelopProxyRuntimeV2>, signal: AbortSignal): Promise<Rendered | null> {
		const profile = view.resolution === 'full' ? PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 : { source: SOURCE, render: RENDER };
		const render = view.resolution === 'full' ? runtime.withFullResolution : runtime.withProxy;
		if (typeof render !== 'function') throw new Error('The requested develop renderer is unavailable.');
		const before = await createPixelFrameHistogramV1(frame, { limits: profile.source, signal }); check(signal);
		this.#ports.paint(view.before, frame, { limits: profile.source, signal }); check(signal);
		let completed: Rendered | null = null;
		await Reflect.apply(render, runtime, [{ frame, develop: view.develop, signal, ...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }, (output: Parameters<Parameters<PhotoLibraryDevelopProxyRuntimeV2['withProxy']>[1]>[0]) => {
			check(signal); if (this.#view !== view) return;
			this.#ports.paint(view.after, output.frame, { limits: profile.render, signal }); check(signal);
			if (view.maskOverlay && view.overlay) {
				const observed = output.maskOverlay, descriptor = readPixelFrameV1(output.frame, profile.render).descriptor;
				if (!observed || observed.maskId !== view.maskOverlay.maskId || observed.effectId !== view.maskOverlay.effectId
					|| observed.width !== descriptor.width || observed.height !== descriptor.height || observed.coverage.length !== descriptor.width * descriptor.height) {
					throw new RangeError('Mask coverage does not match the requested After image.');
				}
				const pixels = new Uint8Array(observed.coverage.length * 4);
				try {
					for (let index = 0; index < observed.coverage.length; index++) {
						if (index % 16_384 === 0) check(signal);
						pixels[index * 4] = 255; pixels[index * 4 + 1] = 48; pixels[index * 4 + 2] = 48; pixels[index * 4 + 3] = observed.coverage[index]!;
					}
					this.#ports.paint(view.overlay, { descriptor: { schemaVersion: 1, width: descriptor.width, height: descriptor.height,
						sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, { limits: profile.render, signal }); check(signal);
				} finally { pixels.fill(0); }
			}
			const extent = Object.freeze({ before: Object.freeze({ width: frame.descriptor.width, height: frame.descriptor.height }), after: Object.freeze({ width: output.frame.descriptor.width, height: output.frame.descriptor.height }) });
			completed = Object.freeze({ before, after: output.histogram, extent });
		}]);
		check(signal); return completed;
	}
	#remember(value: unknown): void {
		if (!this.#failure) this.#failure = Object.freeze({ value });
		else if (!Object.is(this.#failure.value, value)) this.#failure = Object.freeze({ value: new AggregateError([this.#failure.value, value], 'Develop retirement failed.', { cause: value }) });
	}
	#clear(primary?: unknown): void {
		const targets = this.#targets; this.#targets = null; if (!targets) return;
		for (const canvas of [targets.before, targets.after, ...(targets.overlay ? [targets.overlay] : [])]) {
			try { this.#ports.clear(canvas); } catch (error) { if (arguments.length !== 0) this.#remember(primary); this.#remember(error); }
		}
	}
	#publish(update: Partial<PhotoDevelopPresentationSnapshotV2>): void {
		this.#snapshot = Object.freeze({ ...this.#snapshot, ...update });
		try { this.#listener?.(this.#snapshot); } catch (error) { this.#remember(error); }
	}
}
