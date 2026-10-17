/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Ordinary playing frames retain the shader path. Resource-dependent current
 * sessions explicitly own continuous exact execution; a resource is never
 * omitted to keep playback on a shader-only route.
 */
export function shouldRenderExactProductVideoPreview(
	session: Readonly<{ readonly renderExact?: unknown; readonly exactPlaying?: true }> | null | undefined,
	transportState: unknown,
): boolean {
	return (transportState !== 'playing' || session?.exactPlaying === true) && typeof session?.renderExact === 'function';
}

/** Read back decoded media after its seek drains; readiness alone can still name the old picture. */
export function areVideoPreviewMediaLayersReadyForExactRender(
	layers: readonly Readonly<{
		readonly entries: readonly Readonly<{ readonly video?: Readonly<{
			readonly readyState?: number;
			readonly seeking?: boolean;
		}> | null }>[];
	}>[],
): boolean {
	return layers.every((layer) => layer.entries.every(({ video }) => (
		video != null && Number(video.readyState) >= 2 && video.seeking !== true
	)));
}
