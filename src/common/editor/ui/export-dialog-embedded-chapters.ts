/* SPDX-License-Identifier: AGPL-3.0-only */

import { supportsEmbeddedExportChapters } from '../export-embedded-chapters.ts';

/** A chapter-bearing file follows the ordinary mixed browser delivery timeline. */
export function exportDialogSupportsEmbeddedChapters(
	settings: Readonly<Record<string, unknown>>,
	desktop = false,
): boolean {
	return !desktop
		&& supportsEmbeddedExportChapters(settings.format)
		&& settings.mode === 'mix'
		&& !settings.masteringSequenceId;
}

/** Embedded chapters use all label tracks, including labels beyond the first one. */
export function exportDialogHasChapterLabels(projectValue: unknown): boolean {
	if (!projectValue || typeof projectValue !== 'object') return false;
	const tracks = (projectValue as Readonly<Record<string, unknown>>).tracks;
	if (!Array.isArray(tracks)) return false;
	return tracks.some((value: unknown) => {
		if (!value || typeof value !== 'object') return false;
		const track = value as Readonly<Record<string, unknown>>;
		return track.type === 'label' && Array.isArray(track.labels) && track.labels.length > 0;
	});
}
