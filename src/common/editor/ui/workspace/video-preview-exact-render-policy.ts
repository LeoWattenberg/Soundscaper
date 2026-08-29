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
