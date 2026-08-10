/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveVideoSourceDisplaySize } from '../../video-source-presentation.ts';

/**
 * The size a preview entry should present: what the browser decoded, plus
 * whatever of the source's display geometry it left undone. Engines disagree —
 * one applies a pixel aspect ratio to the decoded size and another ignores it —
 * so the residual is resolved against the element's own reported size, and
 * cached because the render loop asks once per frame.
 */

export interface VideoPreviewDisplaySizeEntry {
	displayWidth: number;
	displayHeight: number;
}

interface DecodedVideo {
	readonly videoWidth?: number;
	readonly videoHeight?: number;
}

const CACHE_LIMIT = 64;

export type VideoPreviewDisplaySizeCache = Map<string, { width: number; height: number } | null>;

/** Record the display size one composited entry presents, or zero when it is unknown. */
export function applyVideoPreviewDisplaySize(
	cache: VideoPreviewDisplaySizeCache,
	source: unknown,
	entry: VideoPreviewDisplaySizeEntry,
	video: DecodedVideo | null | undefined,
): void {
	const size = resolveCachedDisplaySize(cache, source, video);
	entry.displayWidth = size?.width ?? 0;
	entry.displayHeight = size?.height ?? 0;
}

function resolveCachedDisplaySize(
	cache: VideoPreviewDisplaySizeCache,
	source: unknown,
	video: DecodedVideo | null | undefined,
): { width: number; height: number } | null {
	const width = Number(video?.videoWidth);
	const height = Number(video?.videoHeight);
	if (!source || typeof source !== 'object' || !width || !height) return null;
	const key = `${String((source as Record<string, unknown>).id)}:${width}x${height}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;
	const size = resolveVideoSourceDisplaySize({ ...source, width, height });
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(key, size);
	return size;
}
