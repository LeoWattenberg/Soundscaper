/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEmbeddedExportChapters, supportsEmbeddedExportChapters } from '../export-embedded-chapters.ts';
import { projectDurationFrames } from '../project.js';
import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import type { RuntimeClipProject } from '../runtime-clip-projection.ts';
import { scaleSampleFrame } from '../timeline-time.ts';

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

/** Availability follows the same exclusive span and output-frame rounding as the chapter writer. */
export function exportDialogHasDeliveredChapterLabels(projectValue: unknown, settings: Readonly<Record<string, unknown>>): boolean {
	try {
		const project = projectForRuntimeConsumers(projectValue as RuntimeClipProject);
		const loop = record(project.loop);
		const selected = settings.range === 'selection' ? record(project.selection) : settings.range === 'loop'
			? loop.enabled ? loop : null
			: { startFrame: 0, endFrame: projectDurationFrames(project) };
		if (!selected) return false;
		const range = { startFrame: Number(selected.startFrame), endFrame: Number(selected.endFrame) };
		const sampleRate = Number(settings.sampleRate ?? project.sampleRate);
		const rangeOutputFrames = Math.max(1, scaleSampleFrame(range.endFrame - range.startFrame, Number(project.sampleRate), sampleRate, 'point'));
		return resolveEmbeddedExportChapters(project, range, sampleRate, { rangeOutputFrames }).length > 0;
	} catch { return false; }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : {};
}
