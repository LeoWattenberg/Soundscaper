/* SPDX-License-Identifier: AGPL-3.0-only */

import { renderSoundVisualizerRgba } from '../common/editor/sound-visualizer-rgba.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';

interface SoundVisualizerWindow {
	readonly channels: readonly Float32Array[] | null;
	readonly sampleRate: number;
	readonly windowStartFrame: number;
	readonly timelineFrame: number;
}

interface WindowReader {
	window(
		entry: UnifiedExactRenderVisualFrameEntryV13,
		timelineSample: number,
		outputOrdinal: number,
		signal: AbortSignal,
	): Promise<SoundVisualizerWindow>;
	dispose(): void;
}

interface Drawable {
	readonly drawable: HTMLCanvasElement;
	readonly videoWidth: number;
	readonly videoHeight: number;
}

interface Target {
	readonly entry: UnifiedExactRenderVisualFrameEntryV13;
	readonly timelineSample: number;
	readonly outputOrdinal: number;
}

interface State {
	target: Target | null;
	window: SoundVisualizerWindow | null;
	windowSample: number;
	pending: boolean;
	failure: unknown;
}

export function createSelectedFinishingSoundVisualizerPreview(options: Readonly<{
	readonly reader: WindowReader;
	readonly drawables: ReadonlyMap<string, Drawable>;
	readonly sampleRate: number;
	readonly signal: AbortSignal;
}>): Readonly<{
	update(entry: UnifiedExactRenderVisualFrameEntryV13, timelineSample: number, outputOrdinal: number): void;
	dispose(): void;
}> {
	const states = new Map<string, State>();
	let disposed = false;

	function update(entry: UnifiedExactRenderVisualFrameEntryV13, timelineSample: number, outputOrdinal: number): void {
		if (disposed) throw new Error('The sound visualizer preview is disposed.');
		if (entry.modelKind !== 'sound-visualizer') return;
		let state = states.get(entry.modelId);
		if (!state) {
			state = { target: null, window: null, windowSample: -1, pending: false, failure: null };
			states.set(entry.modelId, state);
		}
		if (state.failure !== null) throw state.failure;
		if (state.target?.timelineSample === timelineSample
			&& state.target.outputOrdinal === outputOrdinal) return;
		if (state.target && timelineSample < state.target.timelineSample) {
			state.window = null;
			state.windowSample = -1;
		}
		state.target = { entry, timelineSample, outputOrdinal };
		paint(state);
		if (!state.pending) request(state);
	}

	function request(state: State): void {
		const target = state.target;
		if (!target || disposed || options.signal.aborted) return;
		state.pending = true;
		let pending: Promise<SoundVisualizerWindow>;
		try {
			pending = options.reader.window(
				target.entry, target.timelineSample, target.outputOrdinal, options.signal,
			);
		} catch (cause) {
			settleFailure(state, cause);
			return;
		}
		void pending.then((window) => {
			state.pending = false;
			if (disposed || options.signal.aborted) return;
			const current = state.target;
			if (!current) return;
			if (nearbyForwardSample(target, current, options.sampleRate)) {
				state.window = window;
				state.windowSample = target.timelineSample;
				paint(state);
			}
			if (current.timelineSample !== target.timelineSample) request(state);
		}).catch((cause: unknown) => {
			settleFailure(state, cause);
		});
	}

	function settleFailure(state: State, cause: unknown): void {
		state.pending = false;
		if (disposed || options.signal.aborted) return;
		state.failure = cause instanceof Error ? cause : new Error(String(cause));
	}

	function paint(state: State): void {
		const target = state.target;
		if (!target || !('source' in target.entry.authoredState)) return;
		const source = target.entry.authoredState.source;
		if (source.kind !== 'generator' || source.generator.kind !== 'sound-visualizer') return;
		const drawable = options.drawables.get(target.entry.modelId);
		if (!drawable) throw new ReferenceError(`Sound visualizer drawable ${target.entry.modelId} is unavailable.`);
		const context = drawable.drawable.getContext('2d');
		if (!context) throw new Error('Sound visualizer drawable has no 2D context.');
		const active = state.window !== null
			&& nearbyForwardSample({ timelineSample: state.windowSample }, target, options.sampleRate)
				? state.window : null;
		const frame = renderSoundVisualizerRgba({
			mode: source.generator.mode,
			channels: active?.channels ?? null,
			sampleRate: active?.sampleRate ?? options.sampleRate,
			windowStartFrame: active?.windowStartFrame ?? 0,
			timelineFrame: target.outputOrdinal,
			width: drawable.videoWidth,
			height: drawable.videoHeight,
			foregroundColor: source.generator.foregroundColor,
			backgroundColor: source.generator.backgroundColor,
		});
		const pixels = frame.pixels;
		for (const graph of target.entry.masks) {
			const mask = evaluateVideoMaskMatteRgbaV13(graph, frame.width, frame.height, new Map());
			for (let index = 0; index < mask.length; index += 1) {
				pixels[index * 4 + 3] = Math.round(pixels[index * 4 + 3]! * mask[index]! / 255);
			}
		}
		context.putImageData(new ImageData(new Uint8ClampedArray(pixels), frame.width, frame.height), 0, 0);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		states.clear();
		options.reader.dispose();
	}

	return Object.freeze({ update, dispose });
}

function nearbyForwardSample(
	from: Readonly<{ timelineSample: number }>,
	current: Target,
	sampleRate: number,
): boolean {
	if (current.timelineSample < from.timelineSample) return false;
	const source = current.entry.authoredState;
	const windowSeconds = 'source' in source && source.source.kind === 'generator'
		&& source.source.generator.kind === 'sound-visualizer'
			? source.source.generator.windowSeconds : 0;
	const maximumLag = Math.max(1, Math.floor(sampleRate * Math.min(windowSeconds / 2, 0.25)));
	return current.timelineSample - from.timelineSample <= maximumLag;
}
