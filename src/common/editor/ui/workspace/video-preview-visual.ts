/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoPreviewVisual {
	readonly mediaUrl?: string | null;
	readonly url?: string | null;
	readonly available?: boolean;
}

interface VideoPreviewVisualActions {
	readonly actions: Readonly<{
		readonly video?: Readonly<{
			getClipVisualData?(clipId: string): VideoPreviewVisual | null;
			getSourceVisualData?(sourceId: string): VideoPreviewVisual | null;
		}>;
		readonly timeline: Readonly<{
			getClipVisualData?(clipId: string): VideoPreviewVisual | null;
		}>;
	}>;
}

/** Resolve canonical clip visuals before the source-only transient fallback. */
export function resolveVideoPreviewVisual(
	controller: VideoPreviewVisualActions,
	clipId: string,
	sourceId: string,
): VideoPreviewVisual | null {
	return controller.actions.video?.getClipVisualData?.(clipId)
		?? controller.actions.timeline.getClipVisualData?.(clipId)
		?? controller.actions.video?.getSourceVisualData?.(sourceId)
		?? null;
}
