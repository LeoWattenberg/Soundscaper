/* SPDX-License-Identifier: AGPL-3.0-only */

const PREFIX = 'framescaper-selected-v27-authoring:';
const SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve', 'video-adjustment-layer',
	'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const);
export type FramescaperSelectedV27VisualAuthoringSurface = (typeof SURFACES)[number];

export function framescaperSelectedV27VisualAuthoringSurfaceId(
	surface: string,
): string | null {
	return SURFACES.includes(surface as never)
		? `${PREFIX}${surface}` : null;
}

export function framescaperSelectedV27VisualAuthoringSurface(
	surfaceId: unknown,
): FramescaperSelectedV27VisualAuthoringSurface | null {
	if (typeof surfaceId !== 'string' || !surfaceId.startsWith(PREFIX)) return null;
	const surface = surfaceId.slice(PREFIX.length);
	return SURFACES.includes(surface as never)
		? surface as FramescaperSelectedV27VisualAuthoringSurface : null;
}
