/* SPDX-License-Identifier: AGPL-3.0-only */
import { createVideoPreviewCompositorFallbackReport } from '../video-preview-compositor.js';
import { areVideoPreviewMediaLayersReadyForExactRender } from './video-preview-exact-render-policy.ts';
import type { createExactPreviewRenderCoordinator } from '../../controller/clip-video/exact-preview-render-coordinator.ts';
import type { ProductVideoVisualPreviewFrame, ProductVideoVisualPreviewSession } from './product-video-visual-preview-runtime.ts';

type Result = Awaited<ReturnType<NonNullable<ProductVideoVisualPreviewSession['renderExact']>>>;
type CpuFrame = NonNullable<Result['cpuFrame']>;
type Data = Readonly<Record<string, unknown>>;
interface LedgerLayer {
	readonly trackId?: unknown; readonly blendMode?: unknown; readonly effects?: unknown;
	readonly entries: readonly Data[];
}
interface MediaLayer extends LedgerLayer {
	readonly entries: readonly (Data & Readonly<{ video?: Readonly<{ readyState?: number; seeking?: boolean }> | null }>)[];
}
interface Options {
	readonly session: ProductVideoVisualPreviewSession | null; readonly canvas: HTMLCanvasElement | null;
	readonly timelineSample: number; readonly mediaLayers: readonly MediaLayer[];
	readonly coordinator: ReturnType<typeof createExactPreviewRenderCoordinator>; readonly isCurrent: () => boolean;
	readonly updateFrame: (frame: ProductVideoVisualPreviewFrame | null, error?: string) => void;
	readonly updateIssue: (report: unknown, renderedEffectIds?: readonly string[]) => void;
	readonly updateOpenFx: (dispositions: NonNullable<Result['openFxDispositions']>, degraded: boolean) => void;
	readonly updateState: (state: 'cpu' | 'fallback') => void; readonly onPublished: () => void;
}

/** Present only complete finishing output; an unflattened layered result remains an explicit omission. */
export function renderProductVideoCpuPreview(options: Options): void {
	const { session, canvas } = options;
	const fallback = (report: unknown) => { options.updateIssue(report); options.updateState('fallback'); };
	if (!session) {
		if (canvas) canvas.width = 0;
		fallback(fallbackReport(options.mediaLayers, null)); return;
	}
	let logical: ProductVideoVisualPreviewFrame;
	try { logical = session.resolve(options.timelineSample); options.updateFrame(logical); }
	catch (error) { options.updateFrame(null, message(error)); fallback(fallbackReport(options.mediaLayers, null)); return; }
	// The media pool is mutable: retain the requested frame's intent before awaiting exact output.
	const report = fallbackReport(options.mediaLayers, logical);
	if (!canvas || session.requiresAsyncFrames !== true || !session.renderExact) { fallback(report); return; }
	if (!areVideoPreviewMediaLayersReadyForExactRender(options.mediaLayers)) return;
	const render = session.renderExact.bind(session);
	void options.coordinator.run({
		render: () => render({ timelineSample: options.timelineSample, mediaLayers: options.mediaLayers }), isCurrent: options.isCurrent,
		publish(result) {
			if (!result.cpuFrame) { fallback(report); return; }
			presentProductVideoCpuFrame(canvas, result.cpuFrame);
			options.updateFrame(result.frame);
			options.updateIssue({ status: 'rendered', renderedEntryCount: 1,
				effects: { requested: result.renderedEffectIds, rendered: result.renderedEffectIds, omitted: [], fallbackRendered: [] },
				composition: { requested: result.frame.layers.flatMap(layer => layer.entries.filter(entry => entry.renderDescription != null && typeof entry.clipId === 'string').map(entry => ({ clipId: entry.clipId }))), omitted: [], fallbackRendered: [] },
			}, result.renderedEffectIds);
			options.updateOpenFx(result.openFxDispositions ?? [], result.reportsOpenFxDegradation ?? false);
			options.updateState('cpu'); options.onPublished();
		},
		onError(error) { fallback(report); options.updateFrame(null, message(error)); },
	});
}

/** Diagnostic intent only: this must not admit unsupported visuals into the renderer. */
function fallbackReport(media: readonly LedgerLayer[], frame: ProductVideoVisualPreviewFrame | null): unknown {
	const clipIds = new Set<string>(); const effectIds = new Set<string>();
	const candidates: readonly LedgerLayer[] = [...media, ...(frame?.layers ?? [])];
	const activeTracks = new Set(candidates.map(layer => layer.trackId));
	const uniqueEffects = (value: unknown, layerEffects = false): unknown => {
		if (!Array.isArray(value)) return value;
		return value.filter((effect: unknown) => {
			if (!effect || typeof effect !== 'object') return true;
			const data = effect as Data;
			const id = layerEffects ? data.previewLedgerId ?? data.id : data.id;
			if (typeof id !== 'string') return true;
			if (effectIds.has(id)) return false;
			effectIds.add(id); return true;
		});
	};
	const layers = candidates.map(layer => ({ ...layer, entries: layer.entries.flatMap(entry => {
		// Current media entries already carry bypass state and canonical descriptions.
		// A second logical representation of that clip must not re-enable its effects.
		if (typeof entry.clipId === 'string') {
			if (clipIds.has(entry.clipId)) return [];
			clipIds.add(entry.clipId);
		}
		return [{ ...entry, effects: uniqueEffects(entry.effects) }];
	}), effects: uniqueEffects(layer.effects, true) }));
	for (const adjustment of frame?.adjustments ?? []) {
		if (!adjustment.targetTrackIds.some(trackId => activeTracks.has(trackId))) continue;
		layers.push({ entries: [], effects: uniqueEffects(adjustment.effects) });
	}
	return createVideoPreviewCompositorFallbackReport(layers);
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
