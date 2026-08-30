/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoPreviewVisual {
	readonly source?: Readonly<{ readonly id?: string }> | null;
	readonly mediaUrl?: string | null;
	readonly url?: string | null;
	readonly available?: boolean;
	readonly mediaKind?: 'proxy';
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

/** Reuse a clip visual only while it still represents the projected source. */
export function resolveVideoPreviewVisual(
	controller: VideoPreviewVisualActions,
	clipId: string,
	sourceId: string,
): VideoPreviewVisual | null {
	return matchingSourceVisual(controller.actions.video?.getClipVisualData?.(clipId), sourceId)
		?? matchingSourceVisual(controller.actions.timeline.getClipVisualData?.(clipId), sourceId)
		?? controller.actions.video?.getSourceVisualData?.(sourceId)
		?? null;
}

function matchingSourceVisual(
	visual: VideoPreviewVisual | null | undefined,
	sourceId: string,
): VideoPreviewVisual | null {
	return visual?.source?.id === sourceId ? visual : null;
}
