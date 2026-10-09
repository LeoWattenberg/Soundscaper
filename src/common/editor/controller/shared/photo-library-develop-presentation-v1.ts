/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelPreviewPresentationReaderV1 } from './pixel-preview-presentation-v1.ts';
import type { PhotoLibraryDevelopSettingsV1 } from '../../photo-library-develop-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV1 } from '../../photo-library-develop-proxy-port-v1.ts';
import { detachPhotoLibraryDevelopSettingsV1 } from './photo-library-develop-command.ts';
import { withPixelFrameBodyV1 } from '../../imaging/pixel-frame-body-v1.ts';
import { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';
import { createPixelFrameHistogramV1, type PixelFrameHistogramV1 } from '../../imaging/pixel-frame-histogram-v1.ts';

export interface PhotoDevelopPresentationSnapshotV1 {
	readonly status: 'idle' | 'pending' | 'ready' | 'missing' | 'failed';
	readonly before: Readonly<PixelFrameHistogramV1> | null;
	readonly after: Readonly<PixelFrameHistogramV1> | null;
	readonly extent: Readonly<{ before: Readonly<{ width: number; height: number }>; after: Readonly<{ width: number; height: number }> }> | null;
	readonly error: string | null;
}
interface View {
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV1;
	readonly before: HTMLCanvasElement;
	readonly after: HTMLCanvasElement;
}
interface Ports {
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV1;
	readonly beforePresent?: Promise<void>;
	readonly stage?: typeof withPixelFrameBodyV1;
	readonly paint?: typeof paintPixelFrameCanvasV1;
	readonly clear?: typeof clearPixelFrameCanvasV1;
}
const SOURCE = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const RENDER = Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 });
const CHECK = AbortSignal.prototype.throwIfAborted;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** One source read/body/proxy consumer at a time; only histograms and scalar extents survive it.
 * Private proxy stages <=96 MiB; borrowed source <=16 MiB; two native canvas
 * backings <=48 MiB are distinct resources, released on retirement/replacement. */
export class PhotoLibraryDevelopPresentationV1 {
	readonly #ports: Required<Ports>;
	#view: View | null = null;
	#targets: Pick<View, 'before' | 'after'> | null = null;
	#pending: Promise<void> | null = null;
	#active: AbortController | null = null;
	#failure: Readonly<{ value: unknown }> | null = null;
	#closed = false;
	#snapshot: PhotoDevelopPresentationSnapshotV1 = Object.freeze({ status: 'idle', before: null, after: null, extent: null, error: null });
	#listener: ((value: PhotoDevelopPresentationSnapshotV1) => void) | null = null;
	constructor(ports: Ports) {
		this.#ports = Object.freeze({ readPreview: ports.readPreview.bind(ports), loadProxy: ports.loadProxy.bind(ports),
			beforePresent: ports.beforePresent ?? Promise.resolve(), stage: ports.stage?.bind(ports) ?? withPixelFrameBodyV1,
			paint: ports.paint?.bind(ports) ?? paintPixelFrameCanvasV1, clear: ports.clear?.bind(ports) ?? clearPixelFrameCanvasV1 });
	}
	snapshot(): PhotoDevelopPresentationSnapshotV1 { return this.#snapshot; }
	subscribe(listener: (value: PhotoDevelopPresentationSnapshotV1) => void): () => void {
		this.#listener = listener; listener(this.#snapshot); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	setView(value: View): void {
		if (this.#closed || this.#failure) return;
		const view = Object.freeze({ ...value, develop: detachPhotoLibraryDevelopSettingsV1(value.develop) });
		this.#view = view; this.#active?.abort(); this.#clear(); this.#targets = view;
		this.#publish({ status: 'pending', before: null, after: null, extent: null, error: null }); this.#wake();
	}
	async drain(): Promise<void> { while (this.#pending) await this.#pending; if (this.#failure) throw this.#failure.value; }
	async pause(): Promise<void> {
		this.#view = null; this.#active?.abort();
		try { await this.drain(); } finally { this.#clear(); this.#publish({ status: 'idle', before: null, after: null, extent: null, error: null }); }
		if (this.#failure) throw this.#failure.value;
	}
	close(): Promise<void> { this.#closed = true; this.#listener = null; return this.pause(); }
	#wake(): void {
		if (this.#closed || this.#failure || this.#pending || !this.#view) return;
		const view = this.#view, active = new AbortController(); this.#active = active;
		const running = this.#run(view, active.signal).catch(error => {
			const cancelled = Reflect.apply(ABORTED, active.signal, []) === true;
			if (cancelled && Reflect.apply(REASON, active.signal, []) !== error) this.#failure = { value: error };
			if (!cancelled && this.#view === view) this.#publish({ status: 'failed', before: null, after: null, extent: null, error: 'The develop preview failed.' });
		}).finally(() => {
			this.#pending = null; this.#active = null;
			if (this.#view !== view) this.#wake();
		});
		this.#pending = running;
	}
	async #run(view: View, signal: AbortSignal): Promise<void> {
		try { await this.#ports.beforePresent; } catch (error) { this.#failure = { value: error }; throw error; }
		check(signal);
		const result = await this.#ports.readPreview(view.photoId, 'fit-screen', { signal }); check(signal);
		if (result.outcome !== 'ready') { if (this.#view === view) this.#publish({ status: 'missing' }); return; }
		if (result.preview.photoId !== view.photoId || result.preview.tier !== 'fit-screen') throw new Error('Develop source changed its requested identity.');
		const runtime = await this.#ports.loadProxy(); check(signal);
		const { descriptor, byteLength, outputSha256, body } = result.preview;
		await this.#ports.stage({ descriptor, byteLength, outputSha256, body, signal }, async frame => {
			const before = await createPixelFrameHistogramV1(frame, { limits: SOURCE, signal }); check(signal);
			this.#ports.paint(view.before, frame, { limits: SOURCE, signal });
			await runtime.withProxy({ frame, develop: view.develop, signal }, output => {
				check(signal); if (this.#view !== view) return;
				this.#ports.paint(view.after, output.frame, { limits: RENDER, signal }); check(signal);
				const extent = Object.freeze({ before: Object.freeze({ width: frame.descriptor.width, height: frame.descriptor.height }),
					after: Object.freeze({ width: output.frame.descriptor.width, height: output.frame.descriptor.height }) });
				this.#publish({ status: 'ready', before, after: output.histogram, extent, error: null });
			});
		}, { limits: SOURCE });
	}
	#clear(): void {
		if (!this.#targets) return;
		for (const canvas of [this.#targets.before, this.#targets.after]) {
			try { this.#ports.clear(canvas); } catch (error) { this.#failure = this.#failure
				? { value: new AggregateError([this.#failure.value, error], 'Develop backing cleanup failed.') } : { value: error }; }
		}
		this.#targets = null;
	}
	#publish(update: Partial<PhotoDevelopPresentationSnapshotV1>): void {
		this.#snapshot = Object.freeze({ ...this.#snapshot, ...update }); this.#listener?.(this.#snapshot);
	}
}
