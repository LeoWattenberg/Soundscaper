/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Exact RGBA composition is the settled-frame/export oracle. During playback,
 * keep frames on the complete GPU shader-preview path so readback and full CPU
 * linear composition do not serialize the real-time render loop.
 */
export function shouldRenderExactProductVideoPreview(
	session: Readonly<{ readonly renderExact?: unknown }> | null | undefined,
	transportState: unknown,
): boolean {
	return transportState !== 'playing' && typeof session?.renderExact === 'function';
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
