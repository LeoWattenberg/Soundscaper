/* SPDX-License-Identifier: AGPL-3.0-only */

const PREFIX = 'framescaper-selected-authoring:';
const SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve', 'video-adjustment-layer',
	'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const);
export type FramescaperSelectedVisualAuthoringSurface = (typeof SURFACES)[number];

export function framescaperSelectedVisualAuthoringSurfaceId(
	surface: string,
): string | null {
	return SURFACES.includes(surface as never)
		? `${PREFIX}${surface}` : null;
}

export function framescaperSelectedVisualAuthoringSurface(
	surfaceId: unknown,
): FramescaperSelectedVisualAuthoringSurface | null {
	if (typeof surfaceId !== 'string' || !surfaceId.startsWith(PREFIX)) return null;
	const surface = surfaceId.slice(PREFIX.length);
	return SURFACES.includes(surface as never)
		? surface as FramescaperSelectedVisualAuthoringSurface : null;
}
