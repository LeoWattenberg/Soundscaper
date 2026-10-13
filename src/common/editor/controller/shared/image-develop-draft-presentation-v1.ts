/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../imaging/image-develop-frame-core.ts';
import { prepareImageDevelopMaskOverlaySelectionV1, type ImageDevelopMaskOverlaySelectionV1 } from '../../imaging/image-develop-mask-overlay-v1.ts';
import { preparePhotoDevelopMaskDisplayModeV1, type PhotoDevelopMaskDisplayModeV1 } from '../../photo-develop-mask-display-v1.ts';
import { withPhotoDevelopDisplayFrameV1 } from '../../imaging/photo-develop-display-frame-v1.ts';
import { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';

export interface ImageDevelopDraftFrameRequestV1 {
	readonly develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly maskOverlay?: Readonly<ImageDevelopMaskOverlaySelectionV1>;
}
/** The selected native owner lends its complete rendered draft and observed
 * coverage until the callback settles; no resource or product identity escapes. */
export type WithImageDevelopDraftFrameV1 = <Result>(request: Readonly<ImageDevelopDraftFrameRequestV1>,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<Result>;
export interface ImageDevelopDraftPresentationViewV1 extends ImageDevelopDraftFrameRequestV1 {
	readonly after: HTMLCanvasElement;
	readonly overlay?: HTMLCanvasElement;
	readonly maskOverlayMode?: PhotoDevelopMaskDisplayModeV1;
}
export interface ImageDevelopDraftPresentationSnapshotV1 {
	readonly status: 'idle' | 'pending' | 'ready' | 'failed';
	readonly extent: Readonly<{ width: number; height: number }> | null;
	readonly error: string | null;
}
export interface ImageDevelopDraftPresentationPortsV1 {
	readonly withDraftFrame: WithImageDevelopDraftFrameV1;
	readonly isCurrent: () => boolean;
	readonly beforePresent?: Promise<void>;
	readonly paint?: typeof paintPixelFrameCanvasV1;
	readonly clear?: typeof clearPixelFrameCanvasV1;
}
const DISPLAY = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const CHECK = AbortSignal.prototype.throwIfAborted, ABORT = AbortController.prototype.abort;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const idle = (): ImageDevelopDraftPresentationSnapshotV1 => Object.freeze({ status: 'idle', extent: null, error: null });

/** At most one native/render/display scope and one replacement scalar request.
 * Two fitted canvas planes own at most 32 MiB; no JS pixel plane survives its
 * callback. Ready follows retirement of the complete native scope. */
export class ImageDevelopDraftPresentationV1 {
	readonly #ports: Required<Pick<ImageDevelopDraftPresentationPortsV1, 'withDraftFrame' | 'isCurrent' | 'paint' | 'clear'>> & Pick<ImageDevelopDraftPresentationPortsV1, 'beforePresent'>;
	#view: Readonly<ImageDevelopDraftPresentationViewV1> | null = null;
	#targets: Pick<ImageDevelopDraftPresentationViewV1, 'after' | 'overlay'> | null = null;
	#pending: Promise<void> | null = null;
	#active: AbortController | null = null;
	#pausing: Promise<void> | null = null;
	#closing: Promise<void> | null = null;
	#closed = false;
	#failure: Readonly<{ value: unknown }> | null = null;
	#snapshot = idle();
	#listener: ((snapshot: ImageDevelopDraftPresentationSnapshotV1) => void) | null = null;
	constructor(value: ImageDevelopDraftPresentationPortsV1) {
		const input = record(value, 'image draft presentation ports', ['withDraftFrame', 'isCurrent', 'beforePresent', 'paint', 'clear'], ['withDraftFrame', 'isCurrent']);
		const pin = <Method extends (...args: never[]) => unknown>(method: unknown): Method => {
			if (typeof method !== 'function') throw new TypeError('Image draft presentation requires callable ports.');
			return ((...args: Parameters<Method>) => Reflect.apply(method, value, args)) as Method;
		};
		const optional = (key: string) => Object.hasOwn(input, key) ? field(input, key, 'image draft presentation ports') : undefined;
		const before = optional('beforePresent');
		if (before !== undefined && !(before instanceof Promise)) throw new TypeError('Image draft presentation requires a joined predecessor.');
		this.#ports = Object.freeze({ withDraftFrame: pin<WithImageDevelopDraftFrameV1>(field(input, 'withDraftFrame', 'image draft presentation ports')),
			isCurrent: pin<() => boolean>(field(input, 'isCurrent', 'image draft presentation ports')),
			paint: pin<typeof paintPixelFrameCanvasV1>(optional('paint') ?? paintPixelFrameCanvasV1),
			clear: pin<typeof clearPixelFrameCanvasV1>(optional('clear') ?? clearPixelFrameCanvasV1), ...(before ? { beforePresent: before } : {}) });
	}
	snapshot(): ImageDevelopDraftPresentationSnapshotV1 { return this.#snapshot; }
	subscribe(listener: (snapshot: ImageDevelopDraftPresentationSnapshotV1) => void): () => void {
		if (typeof listener !== 'function') throw new TypeError('Image draft presentation requires a listener.');
		this.#listener = listener; listener(this.#snapshot); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	setView(value: ImageDevelopDraftPresentationViewV1): void {
		if (this.#closed || this.#failure) return;
		const view = prepare(value); this.#view = view;
		if (this.#active) Reflect.apply(ABORT, this.#active, []);
		try { this.#clear(); } catch (error) { this.#remember(error); throw error; }
		this.#targets = view; this.#publish({ status: 'pending', extent: null, error: null }); this.#wake();
	}
	async drain(): Promise<void> { while (this.#pending) await this.#pending; if (this.#failure) throw this.#failure.value; }
	pause(): Promise<void> {
		this.#view = null;
		if (this.#pausing) return this.#pausing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const paused = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); this.#pausing = paused;
		if (this.#active) Reflect.apply(ABORT, this.#active, []);
		try { this.#clear(); } catch (error) { this.#remember(error); }
		void (async () => {
			while (this.#pending) await this.#pending;
			try { this.#clear(); } catch (error) { this.#remember(error); }
			if (this.#failure) throw this.#failure.value;
			this.#publish(this.#view ? { status: 'pending', extent: null, error: null } : idle());
		})().then(resolve, reject);
		void paused.then(() => { if (this.#pausing === paused) this.#pausing = null; this.#wake(); }, () => { if (this.#pausing === paused) this.#pausing = null; });
		return paused;
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		this.#closed = true; this.#listener = null;
		void this.pause().then(resolve, reject); void this.#closing.catch(() => undefined); return this.#closing;
	}
	#wake(): void {
		if (this.#closed || this.#failure || this.#pausing || this.#pending || !this.#view) return;
		const view = this.#view, active = new AbortController(); this.#active = active; this.#targets = view;
		let resolve!: () => void; const pending = new Promise<void>(yes => { resolve = yes; }); this.#pending = pending;
		void this.#run(view, active.signal).catch((error: unknown) => {
			const cancelled = Reflect.apply(ABORTED, active.signal, []) === true && Object.is(error, Reflect.apply(REASON, active.signal, []));
			if (!cancelled) this.#remember(error);
		}).finally(() => {
			if (this.#pending === pending) { this.#pending = null; this.#active = null; }
			resolve(); if (this.#view !== view) this.#wake();
		});
	}
	#check(view: Readonly<ImageDevelopDraftPresentationViewV1>, signal: AbortSignal): void {
		Reflect.apply(CHECK, signal, []);
		if (this.#closed || this.#view !== view || !this.#ports.isCurrent()) throw new DOMException('Image draft presentation changed.', 'AbortError');
	}
	async #run(view: Readonly<ImageDevelopDraftPresentationViewV1>, signal: AbortSignal): Promise<void> {
		await this.#ports.beforePresent; this.#check(view, signal);
		let extent: ImageDevelopDraftPresentationSnapshotV1['extent'] = null;
		await this.#ports.withDraftFrame({ develop: view.develop, ...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }, async output => {
			this.#check(view, signal);
			if (view.maskOverlay && (!output.maskOverlay || output.maskOverlay.maskId !== view.maskOverlay.maskId || output.maskOverlay.effectId !== view.maskOverlay.effectId)) {
				throw new RangeError('Observed image coverage differs from the selected adjustment.');
			}
			if (!view.maskOverlay && output.maskOverlay !== undefined) throw new TypeError('Unrequested image coverage cannot be presented.');
			await withPhotoDevelopDisplayFrameV1({ frame: output.frame, signal,
				...(view.maskOverlay ? { maskOverlay: output.maskOverlay, maskOverlayMode: view.maskOverlayMode } : {}) }, display => {
				this.#check(view, signal); this.#paint(view.after, display.frame, signal); this.#check(view, signal);
				if (view.overlay && display.overlay) { this.#paint(view.overlay, display.overlay, signal); this.#check(view, signal); }
				extent = Object.freeze({ width: display.frame.descriptor.width, height: display.frame.descriptor.height });
			}, 'proxy');
		}, { signal });
		this.#check(view, signal);
		if (!extent) throw new Error('Image draft rendering produced no display frame.');
		this.#publish({ status: 'ready', extent, error: null });
	}
	#paint(canvas: HTMLCanvasElement, frame: Parameters<typeof paintPixelFrameCanvasV1>[1], signal: AbortSignal): void {
		const { width, height } = frame.descriptor, bytes = width * height * 4;
		const receipt = this.#ports.paint(canvas, frame, { limits: DISPLAY, signal });
		if (receipt.width !== width || receipt.height !== height || receipt.byteLength !== bytes || bytes > DISPLAY.maximumBytes) throw new RangeError('Image draft canvas differs from its bounded display plane.');
	}
	#clear(): void {
		const targets = this.#targets; this.#targets = null; if (!targets) return;
		const failures: unknown[] = [];
		for (const canvas of [targets.after, ...(targets.overlay ? [targets.overlay] : [])]) try { this.#ports.clear(canvas); } catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Image draft canvas retirement failed.', { cause: failures[0] });
	}
	#remember(error: unknown): void {
		if (!this.#failure) this.#failure = { value: error };
		else if (!Object.is(error, this.#failure.value)) this.#failure = { value: new AggregateError([this.#failure.value, error], 'Image draft retirement failed.', { cause: this.#failure.value }) };
		try { this.#clear(); } catch (cleanup) { if (!Object.is(cleanup, this.#failure.value)) this.#failure = { value: new AggregateError([this.#failure.value, cleanup], 'Image draft retirement failed.', { cause: this.#failure.value }) }; }
		this.#publish({ status: 'failed', extent: null, error: diagnostic(this.#failure.value) });
	}
	#publish(snapshot: ImageDevelopDraftPresentationSnapshotV1): void {
		this.#snapshot = Object.freeze(snapshot);
		try { if (this.#listener) Reflect.apply(this.#listener, undefined, [this.#snapshot]); }
		catch (error) { this.#failure ??= { value: error }; this.#snapshot = Object.freeze({ status: 'failed', extent: null, error: diagnostic(error) }); }
	}
}

function prepare(value: ImageDevelopDraftPresentationViewV1): Readonly<ImageDevelopDraftPresentationViewV1> {
	const input = record(value, 'image draft presentation', ['develop', 'maskOverlay', 'maskOverlayMode', 'after', 'overlay'], ['develop', 'after']);
	const after = field(input, 'after', 'image draft presentation'), overlay = Object.hasOwn(input, 'overlay') ? field(input, 'overlay', 'image draft presentation') : undefined;
	if (!after || typeof after !== 'object' || overlay !== undefined && (!overlay || typeof overlay !== 'object' || overlay === after)) throw new TypeError('Image draft presentation requires distinct canvas targets.');
	const raw = Object.hasOwn(input, 'maskOverlay') ? field(input, 'maskOverlay', 'image draft presentation') : undefined;
	if ((raw === undefined) !== (overlay === undefined) || raw === undefined && Object.hasOwn(input, 'maskOverlayMode')) throw new TypeError('Image mask display requires a selection and its target.');
	const mode = preparePhotoDevelopMaskDisplayModeV1(Object.hasOwn(input, 'maskOverlayMode') ? field(input, 'maskOverlayMode', 'image draft presentation') : undefined);
	return Object.freeze({ develop: normalizeImageDevelopStateCurrentV1(field(input, 'develop', 'image draft presentation')), after: after as HTMLCanvasElement,
		...(raw === undefined ? {} : { maskOverlay: prepareImageDevelopMaskOverlaySelectionV1(raw), maskOverlayMode: mode, overlay: overlay as HTMLCanvasElement }) });
}
function diagnostic(error: unknown): string {
	try { const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2048);
	} catch { /* Native opaque failures remain available to drain and Close. */ }
	return 'The develop preview failed.';
}
