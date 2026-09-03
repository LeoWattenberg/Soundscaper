/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFrame,
	clipEndFrame,
	findClip,
	findClipTrack,
	normalizeFrameRange,
} from '../project.js';
import { hasCoreEditingProjectAuthority, hasProjectBinMediaAuthority } from '../project-schema-version.ts';
import {
	assertClipSourceBounds,
	assertClipSpace,
	assertUnusedClipId,
	assertUnusedId,
	normalizeClipForProject,
	normalizeCommandIds,
	normalizeRangeReplacementSource,
	replaceClip,
	requireClip,
	requireClipTrack,
	requireTrack,
	sortTrack,
	withoutImportedPitchPreset,
} from './shared-runtime.js';

// foundation-edit-matrix: move

export function addClip(project, trackId, value) {
	const track = requireTrack(project, trackId);
	if (!Array.isArray(track.clipIds)) throw new RangeError('Media clips can only be added to media tracks.');
	const clip = normalizeClipForProject(project, {
		...value,
		...(hasProjectBinMediaAuthority(project) ? { binItemId: null } : {}),
	});
	if (hasProjectBinMediaAuthority(project) && track.type !== clip.kind) {
		throw new RangeError(`A ${clip.kind} clip cannot be added to a ${track.type} track.`);
	}
	assertUnusedClipId(project, clip.id);
	assertClipSourceBounds(project, clip);
	assertClipSpace(project, track, clip);
	project.clips.push(clip);
	track.clipIds.push(clip.id);
	sortTrack(project, track);
}

export function removeClip(project, clipId) {
	removeClips(project, [clipId]);
}

export function removeClips(project, clipIds, rippleMode = 'none') {
	if (!['none', 'clip', 'track'].includes(rippleMode || 'none')) {
		throw new RangeError(`Unsupported clip removal ripple mode: ${rippleMode}.`);
	}
	const removedIds = new Set(collectRelatedClipIds(project, normalizeCommandIds(clipIds, 'clipIds')));
	const removedByTrack = new Map();
	for (const track of project.tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		const removed = track.clipIds
			.filter((id) => removedIds.has(id))
			.map((id) => requireClip(project, id))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
		removedByTrack.set(track.id, removed);
		track.clipIds = track.clipIds.filter((id) => !removedIds.has(id));
	}
	project.clips = project.clips.filter((candidate) => !removedIds.has(candidate.id));
	if (rippleMode !== 'track') return;
	for (const track of project.tracks) {
		const removed = removedByTrack.get(track.id) || [];
		if (!removed.length || !Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) {
			const clip = requireClip(project, clipId);
			const shiftFrames = removed.reduce((sum, removedClip) => (
				clip.timelineStartFrame >= clipEndFrame(removedClip)
					? sum + removedClip.durationFrames
					: sum
			), 0);
			if (shiftFrames > 0) clip.timelineStartFrame -= shiftFrames;
		}
		sortTrack(project, track);
	}
}

export function updateClip(project, clipId, changes = {}) {
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const allowed = clip.kind === 'video'
		? new Set(['title', 'groupId', 'color'])
		: new Set([
			'gain', 'fadeInFrames', 'fadeOutFrames', 'reversed', 'inverted', 'title', 'envelope',
			'groupId', 'color', 'pitchCents', 'speedRatio', 'preserveFormants',
			'stretchToTempo', 'renderCacheRevision',
		]);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Clip field cannot be updated: ${key}.`);
	const updated = normalizeClipForProject(project, {
		...clip,
		...changes,
		...(Object.hasOwn(changes, 'preserveFormants') ? {
			opaqueExtensions: withoutImportedPitchPreset(clip.opaqueExtensions),
		} : {}),
		id: clip.id,
	});
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
}

export function replaceClipSource(project, clipId, sourceId) {
	if (!hasCoreEditingProjectAuthority(project)) throw new RangeError('Immutable sample editing requires an active editing project.');
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	if (hasProjectBinMediaAuthority(project) && source.kind !== clip.kind) {
		throw new RangeError(`A ${clip.kind} clip cannot reference a ${source.kind} source.`);
	}
	const updated = normalizeClipForProject(project, {
		...clip,
		sourceId: source.id,
		renderCacheRevision: (clip.renderCacheRevision ?? 0) + 1,
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
}

/**
 * Scale a neighbour's envelope onto its rewritten duration. Compression can put
 * two points on one frame, and clamping the tail can put several on the last
 * one, but a project envelope must use strictly increasing frames - so an
 * unmerged collision failed validation and refused the whole effect. A
 * collision keeps the later point, which is the value the material carries out
 * of the region that collapsed.
 */
function scaledEnvelope(envelope, ratio, durationFrames) {
	const scaled = new Map();
	for (const point of envelope || []) {
		const frame = Math.min(durationFrames, Math.round(point.frame * ratio));
		scaled.set(frame, { ...point, frame });
	}
	return [...scaled.values()].sort((left, right) => left.frame - right.frame);
}

export function replaceRenderedClips(project, command) {
	if (!Array.isArray(command.entries) || !command.entries.length) {
		throw new TypeError('Rendered clip replacement entries are required.');
	}
	const entries = command.entries.map((entry) => {
		const clip = requireClip(project, entry.clipId);
		if (clip.kind === 'video') throw new RangeError('Rendered audio cannot replace a video clip.');
		const source = normalizeRangeReplacementSource(project, entry.source);
		assertUnusedId(project.sources, source.id, 'source');
		return { clip, source, ratio: source.frameCount / clip.durationFrames };
	});
	const processedIds = new Set(entries.map(({ clip }) => clip.id));
	const remaining = new Set(processedIds);
	const components = [];
	while (remaining.size) {
		const seed = remaining.values().next().value;
		const relatedIds = new Set(collectRelatedClipIds(project, [seed]));
		const targets = entries.filter(({ clip }) => relatedIds.has(clip.id));
		for (const { clip } of targets) remaining.delete(clip.id);
		const ratio = targets[0].ratio;
		if (targets.some((target) => Math.abs(target.ratio - ratio) > 1 / Math.max(1, target.clip.durationFrames))) {
			throw new RangeError('Related clips produced inconsistent effect duration ratios.');
		}
		components.push({ relatedIds, targets, ratio });
	}

	for (const component of components) {
		const related = [...component.relatedIds].map((clipId) => requireClip(project, clipId));
		const anchor = Math.min(...related.map((clip) => clip.timelineStartFrame));
		const oldEnd = Math.max(...related.map(clipEndFrame));
		const newEnd = anchor + Math.max(1, Math.round((oldEnd - anchor) * component.ratio));
		const delta = newEnd - oldEnd;
		const relatedTrackIds = new Set(related.map((clip) => requireClipTrack(project, clip.id).id));
		for (const clip of project.clips) {
			if (component.relatedIds.has(clip.id)) continue;
			const track = requireClipTrack(project, clip.id);
			if (relatedTrackIds.has(track.id) && clip.timelineStartFrame >= oldEnd) {
				clip.timelineStartFrame += delta;
			}
		}
		for (const original of related) {
			const current = requireClip(project, original.id);
			const target = component.targets.find(({ clip }) => clip.id === original.id);
			const durationFrames = target
				? target.source.frameCount
				: Math.max(1, Math.round(original.durationFrames * component.ratio));
			const timelineStartFrame = anchor + Math.round((original.timelineStartFrame - anchor) * component.ratio);
			const updated = target
				? normalizeClipForProject(project, {
					...current,
					sourceId: target.source.id,
					timelineStartFrame,
					sourceStartFrame: 0,
					sourceDurationFrames: durationFrames,
					durationFrames,
					gain: 1,
					fadeInFrames: 0,
					fadeOutFrames: 0,
					reversed: false,
					inverted: false,
					envelope: [],
					pitchCents: 0,
					speedRatio: 1,
					preserveFormants: false,
					stretchToTempo: false,
					renderCacheRevision: (current.renderCacheRevision || 0) + 1,
					id: current.id,
				})
				: normalizeClipForProject(project, {
					...current,
					timelineStartFrame,
					durationFrames,
					speedRatio: (current.sourceDurationFrames || current.durationFrames) / durationFrames,
					fadeInFrames: Math.min(current.fadeInFrames || 0, durationFrames),
					fadeOutFrames: Math.min(current.fadeOutFrames || 0, durationFrames),
					envelope: scaledEnvelope(current.envelope, component.ratio, durationFrames),
					renderCacheRevision: (current.renderCacheRevision || 0) + 1,
					id: current.id,
				});
			replaceClip(project, updated);
		}
	}
	project.sources.push(...entries.map(({ source }) => source));
	for (const track of project.tracks.filter((candidate) => Array.isArray(candidate.clipIds))) sortTrack(project, track);
}

export function moveClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const timelineStartFrame = assertFrame(command.timelineStartFrame, 'clip move destination');
	const updated = normalizeClipForProject(project, {
		...clip,
		timelineStartFrame,
		id: clip.id,
	});
	assertClipSpace(project, targetTrack, updated, clip.id);
	replaceClip(project, updated);
	if (targetTrack.id !== oldTrack.id) {
		oldTrack.clipIds = oldTrack.clipIds.filter((id) => id !== clip.id);
		targetTrack.clipIds.push(clip.id);
	}
	sortTrack(project, oldTrack);
	sortTrack(project, targetTrack);
}

/**
 * Returns the clips that participate when an edit begins on activeClipId.
 * An existing multi-selection is honored only when it contains the active
 * clip; grouped companions of every participating clip are then included.
 */

export function collectClipTransformIds(project, activeClipId) {
	const activeClip = findClip(project, activeClipId);
	if (!activeClip) return [];
	const ids = new Set([activeClip.id]);
	const selectedIds = project.selection?.clipIds || [];
	if (selectedIds.includes(activeClip.id)) {
		for (const clipId of selectedIds) if (findClip(project, clipId)) ids.add(clipId);
	}
	return collectRelatedClipIds(project, [...ids]);
}

/**
 * Expands clip IDs through both edit groups and linked audio/video pairs.
 * Relations are followed transitively so callers cannot leave half of an A/V
 * pair behind when it belongs to a larger clip group.
 */

export function collectRelatedClipIds(project, clipIds) {
	const ids = new Set((Array.isArray(clipIds) ? clipIds : [clipIds])
		.filter((clipId) => findClip(project, clipId)));
	let changed = true;
	while (changed) {
		changed = false;
		const groupIds = new Set([...ids]
			.map((clipId) => findClip(project, clipId)?.groupId)
			.filter(Boolean));
		const avLinkIds = new Set([...ids]
			.map((clipId) => findClip(project, clipId)?.avLinkId)
			.filter(Boolean));
		for (const clip of project.clips) {
			if (
				(clip.groupId && groupIds.has(clip.groupId))
				|| (clip.avLinkId && avLinkIds.has(clip.avLinkId))
			) {
				if (!ids.has(clip.id)) changed = true;
				ids.add(clip.id);
			}
		}
	}
	return project.clips.filter((clip) => ids.has(clip.id)).map((clip) => clip.id);
}

/**
 * Resolve the document's editing selection without collapsing disjoint clip
 * selections into one destructive time range. A real time range always wins;
 * otherwise the selected clips are expanded through edit groups and A/V links.
 */

export function resolveEditingSelection(project, options = {}) {
	const selection = options.selection || project?.selection || null;
	if (
		Number.isSafeInteger(selection?.startFrame)
		&& Number.isSafeInteger(selection?.endFrame)
		&& selection.endFrame > selection.startFrame
	) {
		const trackIds = (selection.trackIds || [])
			.filter((trackId) => project.tracks.some((track) => track.id === trackId && Array.isArray(track.clipIds)));
		return Object.freeze({
			kind: 'range',
			startFrame: selection.startFrame,
			endFrame: selection.endFrame,
			ranges: Object.freeze([Object.freeze({
				startFrame: selection.startFrame,
				endFrame: selection.endFrame,
				durationFrames: selection.endFrame - selection.startFrame,
			})]),
			trackIds: Object.freeze(trackIds),
			clipIds: Object.freeze([]),
		});
	}
	const requestedClipIds = Array.isArray(options.clipIds) && options.clipIds.length
		? options.clipIds
		: selection?.clipIds?.length
			? selection.clipIds
			: options.selectedClipId ? [options.selectedClipId] : [];
	const clipIds = collectRelatedClipIds(project, requestedClipIds);
	if (!clipIds.length) return null;
	const clips = clipIds.map((clipId) => requireClip(project, clipId));
	const trackIds = [...new Set(clips.map((clip) => requireClipTrack(project, clip.id).id))];
	const ranges = mergeEditingRanges(clips.map((clip) => ({
		startFrame: clip.timelineStartFrame,
		endFrame: clipEndFrame(clip),
	})));
	return Object.freeze({
		kind: 'clips',
		startFrame: ranges[0].startFrame,
		endFrame: ranges.at(-1).endFrame,
		ranges: Object.freeze(ranges.map(Object.freeze)),
		trackIds: Object.freeze(trackIds),
		clipIds: Object.freeze(clipIds),
	});
}

export function mergeEditingRanges(ranges) {
	const sorted = ranges
		.map((range) => normalizeFrameRange(range.startFrame, range.endFrame, 'editing selection'))
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	const merged = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.startFrame <= previous.endFrame) {
			previous.endFrame = Math.max(previous.endFrame, range.endFrame);
			previous.durationFrames = previous.endFrame - previous.startFrame;
		} else merged.push({ ...range });
	}
	return merged;
}

/**
 * Returns clips that should share a trim edge with activeClipId. Clips beside
 * one another on the same track retain independent edges; selected/grouped
 * clips on other tracks participate in the shared trim.
 */

export function collectClipTrimIds(project, activeClipId, edge) {
	if (edge !== 'left' && edge !== 'right') throw new RangeError(`Unsupported trim edge: ${edge}.`);
	const activeClip = findClip(project, activeClipId);
	const activeTrack = activeClip ? findClipTrack(project, activeClip.id) : null;
	if (!activeClip || !activeTrack) return [];
	return collectClipTransformIds(project, activeClip.id).filter((clipId) => {
		if (clipId === activeClip.id) return true;
		const clip = findClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		return Boolean(clip && track && track.id !== activeTrack.id);
	});
}
