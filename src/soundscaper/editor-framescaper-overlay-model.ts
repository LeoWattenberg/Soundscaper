/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Soundscaper has no Framescaper finishing surfaces at all, so the surface
 * union the real menu module derives from its own inventory is empty here.
 */
export type FramescaperFinishingSurface = never;

export function framescaperFinishingSurface(_surfaceId: unknown): null {
	return null;
}

export function framescaperFinishingSurfaceId(_surface: FramescaperFinishingSurface): string {
	return '';
}

export function framescaperSelectedVisualAuthoringSurface(_surfaceId: unknown): null {
	return null;
}

export function framescaperSelectedVisualAuthoringSurfaceId(_surface: never): string {
	return '';
}

const EMPTY_FINISHING_MENU_ITEMS = Object.freeze({
	tracks: [], effect: [], analyze: [], mixer: [], tools: [],
} as const);

export function createFramescaperFinishingMenuItems(): Readonly<{
	tracks: readonly [], effect: readonly [], analyze: readonly [],
	mixer: readonly [], tools: readonly [],
}> {
	return EMPTY_FINISHING_MENU_ITEMS;
}

export function createFramescaperVideoProxyApplicationMenuItems(): readonly [] {
	return Object.freeze([]);
}
