/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProductVideoVisualPreviewFrame,
	ProductVideoVisualPreviewSession,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { createSelectedPreviewRetirement } from './selected-preview-retirement.ts';

/** A failed creation still owns every current session its inherited factory returned. */
export async function rejectAfterInheritedPreviewRetirement(
	primary: unknown,
	inherited: ProductVideoVisualPreviewSession | null,
	disposeLegacy: () => void,
): Promise<never> {
	const close = inherited?.close;
	if (!close) {
		disposeLegacy();
		throw primary;
	}
	let cleanupFailure: Readonly<{ reason: unknown }> | undefined;
	try { await close.call(inherited); }
	catch (cleanup) { cleanupFailure = { reason: cleanup }; }
	if (cleanupFailure && !Object.is(cleanupFailure.reason, primary)) {
		throw new AggregateError([primary, cleanupFailure.reason], 'Inherited timelineImage preview creation cleanup failed.', { cause: primary });
	}
	throw primary;
}

interface TimelineImagePreviewComposition {
	readonly inherited: ProductVideoVisualPreviewSession | null;
	readonly hasImages: boolean;
	readonly imageFrame: (timelineSample: number) => ProductVideoVisualPreviewFrame;
	readonly emptyFrame: () => ProductVideoVisualPreviewFrame;
	readonly mergeFrames: (left: ProductVideoVisualPreviewFrame, right: ProductVideoVisualPreviewFrame) => ProductVideoVisualPreviewFrame;
	readonly timelinePosition: (sample: unknown) => number;
	readonly clipId: (id: unknown) => string;
	readonly disposeImages: () => void;
	readonly disposeInherited: () => void;
}

/** Retain the borrowed native session's exact cancellation and joined retirement. */
export function composeTimelineImagePreviewSession(options: TimelineImagePreviewComposition): ProductVideoVisualPreviewSession {
	const { inherited } = options;
	const renderExact = options.hasImages ? undefined : inherited?.renderExact;
	const inheritedClose = inherited?.close;
	let disposed = false;
	const assertOpen = () => {
		if (disposed) throw new Error('The selected timelineImage image preview session is disposed.');
	};
	const close = inheritedClose ? createSelectedPreviewRetirement(
		() => { disposed = true; },
		[() => inheritedClose.call(inherited), options.disposeImages],
	) : undefined;
	return Object.freeze({
		resolve(timelineSample: number): ProductVideoVisualPreviewFrame {
			assertOpen();
			const sample = options.timelinePosition(timelineSample);
			return options.mergeFrames(inherited?.resolve(sample) ?? options.emptyFrame(), options.imageFrame(sample));
		},
		resolveTransitionWeight(clipId: string, timelineSample: number): number | null {
			assertOpen();
			return inherited?.resolveTransitionWeight(options.clipId(clipId), options.timelinePosition(timelineSample)) ?? null;
		},
		...(renderExact ? { async renderExact(request: Parameters<typeof renderExact>[0]) {
			assertOpen();
			const sample = options.timelinePosition(request.timelineSample);
			const images = options.imageFrame(sample);
			const result = await renderExact.call(inherited, {
				timelineSample: sample, mediaLayers: request.mediaLayers, signal: request.signal,
			});
			return Object.freeze({ ...result, frame: options.mergeFrames(result.frame, images) });
		} } : {}),
		dispose(): void {
			if (close) { void close(); return; }
			if (disposed) return;
			disposed = true;
			options.disposeImages();
			options.disposeInherited();
		},
		...(close ? { close } : {}),
	});
}
