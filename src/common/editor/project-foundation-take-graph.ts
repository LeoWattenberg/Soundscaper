/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectDataRecord } from './project-validation-primitives.ts';

interface ResolvedClipSpan {
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
}

/**
 * Relate a take group to the material of its own takes.
 *
 * A take group states where on its track a recording sits, so every edit path
 * that moves that track's material has to move the group with it. Each path was
 * taught that rule one at a time and nothing checked the result, so a path that
 * had not been taught desynchronized the graph from its audio silently and
 * permanently: the document stayed valid, and undo faithfully restored the
 * corruption. `validateDerivedAvLinks` is the same class of relation for the
 * other collection that rides an edit, and it throws at commit, which is what
 * makes an A/V link desync recoverable. This gives the take graph the same seam.
 *
 * The relation speaks only where the group's takes are on its own track at all.
 * Cycle recording publishes its take sources and the group together and places
 * no clips: a graph lives that way until it is flattened, which is the state
 * the take/comp workflow spends most of its life in. So a group whose take
 * sources appear on no clip of its track stands alone and is left alone; once
 * any of that material is on the track, all of it must cover the group.
 */
export function validateTakeGraphTrackMaterial(
	project: ProjectDataRecord,
	tracks: readonly ProjectDataRecord[],
	clips: readonly ProjectDataRecord[],
	resolvedClipById: ReadonlyMap<string, ResolvedClipSpan>,
): void {
	const groups = Array.isArray(project.takeGroups) ? project.takeGroups : null;
	if (!groups?.length) return;
	const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
	const trackById = new Map(tracks.map((track) => [String(track.id), track]));
	for (const value of groups as readonly unknown[]) {
		// The V17 document validator owns the group's own shape; an unusable
		// candidate is its error to report, not a coverage failure here.
		const group = isRecord(value) ? value : null;
		if (!group) continue;
		const startSample = group.startSample;
		const endSample = group.endSample;
		if (typeof group.trackId !== 'string' || !Number.isSafeInteger(startSample)
			|| !Number.isSafeInteger(endSample) || Number(endSample) <= Number(startSample)) continue;
		const track = trackById.get(group.trackId);
		if (!track || !Array.isArray(track.clipIds)) continue;
		const sourceIds = takeSourceIds(group.takes);
		if (!sourceIds.size) continue;
		const spans = takeMaterialSpans(track.clipIds, clipById, resolvedClipById, sourceIds);
		if (!spans.length) continue;
		if (!coversSpan(spans, Number(startSample), Number(endSample))) {
			throw new RangeError(
				`Take group ${String(group.id)} must be covered by its own take material on track ${group.trackId}.`,
			);
		}
	}
}

function takeSourceIds(value: unknown): ReadonlySet<string> {
	const result = new Set<string>();
	if (!Array.isArray(value)) return result;
	for (const take of value as readonly unknown[]) {
		if (isRecord(take) && typeof take.sourceId === 'string') result.add(take.sourceId);
	}
	return result;
}

function takeMaterialSpans(
	clipIds: readonly unknown[],
	clipById: ReadonlyMap<string, ProjectDataRecord>,
	resolvedClipById: ReadonlyMap<string, ResolvedClipSpan>,
	sourceIds: ReadonlySet<string>,
): readonly ResolvedClipSpan[] {
	const spans: ResolvedClipSpan[] = [];
	for (const clipId of clipIds) {
		const id = String(clipId);
		const clip = clipById.get(id);
		if (!clip || typeof clip.sourceId !== 'string' || !sourceIds.has(clip.sourceId)) continue;
		const resolved = resolvedClipById.get(id);
		if (resolved) spans.push(resolved);
	}
	return spans;
}

function coversSpan(
	spans: readonly ResolvedClipSpan[],
	startSample: number,
	endSample: number,
): boolean {
	let covered = startSample;
	for (const span of [...spans].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)) {
		if (span.timelineStartFrame > covered) return false;
		if (span.timelineEndFrame > covered) covered = span.timelineEndFrame;
		if (covered >= endSample) return true;
	}
	return covered >= endSample;
}

function isRecord(value: unknown): value is ProjectDataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
