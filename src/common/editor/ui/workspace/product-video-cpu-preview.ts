/* SPDX-License-Identifier: AGPL-3.0-only */
import { createVideoPreviewCompositorFallbackReport } from '../video-preview-compositor.js';
import { areVideoPreviewMediaLayersReadyForExactRender } from './video-preview-exact-render-policy.ts';
import type { createExactPreviewRenderCoordinator } from '../../controller/clip-video/exact-preview-render-coordinator.ts';
import type { ProductVideoVisualPreviewFrame, ProductVideoVisualPreviewSession } from './product-video-visual-preview-runtime.ts';

type Result = Awaited<ReturnType<NonNullable<ProductVideoVisualPreviewSession['renderExact']>>>;
type CpuFrame = NonNullable<Result['cpuFrame']>;
interface Options {
	readonly session: ProductVideoVisualPreviewSession | null; readonly canvas: HTMLCanvasElement | null;
	readonly timelineSample: number; readonly mediaLayers: readonly Readonly<{ entries: readonly Readonly<{ video?: Readonly<{ readyState?: number; seeking?: boolean }> | null }>[] }>[];
	readonly coordinator: ReturnType<typeof createExactPreviewRenderCoordinator>; readonly isCurrent: () => boolean;
	readonly updateFrame: (frame: ProductVideoVisualPreviewFrame | null, error?: string) => void;
	readonly updateIssue: (report: unknown, renderedEffectIds?: readonly string[]) => void;
	readonly updateOpenFx: (dispositions: NonNullable<Result['openFxDispositions']>, degraded: boolean) => void;
	readonly updateState: (state: 'cpu' | 'fallback') => void; readonly onPublished: () => void;
}

/** Present only complete finishing output; an unflattened layered result remains an explicit omission. */
export function renderProductVideoCpuPreview(options: Options): void {
	const { session, canvas } = options;
	if (!session) { if (canvas) canvas.width = 0; options.updateState('fallback'); return; }
	let logical: ProductVideoVisualPreviewFrame;
	try { logical = session.resolve(options.timelineSample); options.updateFrame(logical); }
	catch (error) { options.updateFrame(null, message(error)); options.updateState('fallback'); return; }
	const fallback = () => { options.updateIssue(createVideoPreviewCompositorFallbackReport(logical.layers)); options.updateState('fallback'); };
	if (!canvas || session.requiresAsyncFrames !== true || !session.renderExact) { fallback(); return; }
	if (!areVideoPreviewMediaLayersReadyForExactRender(options.mediaLayers)) return;
	const render = session.renderExact.bind(session);
	void options.coordinator.run({
		render: () => render({ timelineSample: options.timelineSample, mediaLayers: options.mediaLayers }), isCurrent: options.isCurrent,
		publish(result) {
			if (!result.cpuFrame) { fallback(); return; }
			presentProductVideoCpuFrame(canvas, result.cpuFrame);
			options.updateFrame(result.frame);
			options.updateIssue({ status: 'rendered', renderedEntryCount: 1,
				effects: { requested: result.renderedEffectIds, rendered: result.renderedEffectIds, omitted: [], fallbackRendered: [] },
				composition: { requested: result.frame.layers.flatMap(layer => layer.entries.filter(entry => entry.renderDescription != null && typeof entry.clipId === 'string').map(entry => ({ clipId: entry.clipId }))), omitted: [], fallbackRendered: [] },
			}, result.renderedEffectIds);
			options.updateOpenFx(result.openFxDispositions ?? [], result.reportsOpenFxDegradation ?? false);
			options.updateState('cpu'); options.onPublished();
		},
		onError(error) { fallback(); options.updateFrame(null, message(error)); },
	});
}

export function presentProductVideoCpuFrame(canvas: Pick<HTMLCanvasElement, 'width' | 'height' | 'getContext'>, frame: CpuFrame): void {
	const { width, height, pixels } = frame; const bytes = width * height * 4;
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
		|| !Number.isSafeInteger(bytes) || bytes > 64 * 1024 * 1024 || !(pixels instanceof Uint8Array) || pixels.byteLength !== bytes
		|| frame.encoding !== 'srgb' || frame.alphaMode !== 'straight') throw new RangeError('CPU preview requires one bounded complete sRGB RGBA finishing picture.');
	const context = canvas.getContext('2d'); if (!context) throw new Error('CPU preview canvas is unavailable.');
	if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
