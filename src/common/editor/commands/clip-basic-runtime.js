/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertFrame,
	clipEndFrame,
	findClip,
	findClipTrack,
} from '../project.js';
import { shapesForNewClipFades } from '../audio-clip-transition-gain.ts';
import { clipLoopUpdateFields } from '../audio-clip-loop.ts';
import { collectRelatedClipIds, mergeEditingRanges } from './editing-selection-authority.ts';
import { hasCoreEditingProjectAuthority, hasProjectBinMediaAuthority } from '../project-schema-version.ts';
import {
	assertClipSourceBounds,
	assertClipSpace,
	assertUnusedClipId,
	envelopeForTrimmedBounds,
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
import { planTakeGraphClipRipple, planTakeGraphRangeRipple } from './take-graph-range-edit.ts';
import { clipOwnerIndex, createCompletedFrameSum, createRelatedClipReader, firstById } from './editing-work-index.ts';

export {
	collectRelatedClipIds,
	mergeEditingRanges,
	resolveEditingSelection,
} from './editing-selection-authority.ts';

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
	const clipById = rippleMode === 'track' ? firstById(project.clips) : null;
	for (const track of project.tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		if (clipById) removedByTrack.set(track.id, track.clipIds
			.filter((id) => removedIds.has(id)).map((id) => clipById.get(id)));
		track.clipIds = track.clipIds.filter((id) => !removedIds.has(id));
	}
	project.clips = project.clips.filter((candidate) => !removedIds.has(candidate.id));
	if (rippleMode !== 'track') return;
	const commitTakeGraph = planTakeGraphClipRipple(project, takeGraphClipRemovals(removedByTrack));
	for (const track of project.tracks) {
		const removed = removedByTrack.get(track.id) || [];
		if (!removed.length || !Array.isArray(track.clipIds)) continue;
		const removedRanges = mergeEditingRanges(removed.map((clip) => ({
			startFrame: clip.timelineStartFrame, endFrame: clipEndFrame(clip),
		})));
		const shiftAt = createCompletedFrameSum(removedRanges.map(range => ({ endFrame: range.endFrame, frames: range.durationFrames })));
		for (const clipId of track.clipIds) {
			const clip = clipById.get(clipId);
			const shiftFrames = shiftAt(clip.timelineStartFrame);
			if (shiftFrames > 0) clip.timelineStartFrame -= shiftFrames;
		}
		sortTrack(project, track, clipById);
	}
	commitTakeGraph?.();
}

/** The spans each edited track is losing, which is what its take graph answers to. */
function takeGraphClipRemovals(removedByTrack) {
	const removals = new Map();
	for (const [trackId, removed] of removedByTrack) {
		if (!removed.length) continue;
		removals.set(String(trackId), removed.map((clip) => ({
			startFrame: clip.timelineStartFrame,
			endFrame: clipEndFrame(clip),
		})));
	}
	return removals;
}

export function updateClip(project, clipId, changes = {}) {
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const allowed = clip.kind === 'video'
		? new Set(['title', 'groupId', 'color'])
		: new Set([
			'gain', 'fadeInFrames', 'fadeOutFrames', 'fadeInShape', 'fadeOutShape',
			'reversed', 'inverted', 'title', 'envelope',
			'groupId', 'color', 'pitchCents', 'speedRatio', 'preserveFormants', 'linkPitchAndTempo',
			'stretchToTempo', 'renderCacheRevision', 'loop',
		]);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Clip field cannot be updated: ${key}.`);
	const { loop, ...fields } = changes;
	const loopFields = Object.hasOwn(changes, 'loop') ? clipLoopUpdateFields(clip, loop) : {};
	const updated = normalizeClipForProject(project, {
		...clip,
		...shapesForNewClipFades(clip, changes),
		...fields,
		...loopFields,
		...(loopFields.durationFrames !== undefined && loopFields.durationFrames !== clip.durationFrames
			? { envelope: envelopeForTrimmedBounds(clip, clip.timelineStartFrame, loopFields.durationFrames) } : {}),
		...(Object.hasOwn(changes, 'preserveFormants') ? {
			opaqueExtensions: withoutImportedPitchPreset(loopFields.opaqueExtensions ?? clip.opaqueExtensions),
		} : {}),
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
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
	const rippleMode = command.rippleMode ?? 'track';
	if (rippleMode !== 'none' && rippleMode !== 'track') {
		throw new RangeError(`Unsupported rendered clip replacement ripple mode: ${String(rippleMode)}.`);
	}
	const clipById = firstById(project.clips);
	const owners = clipOwnerIndex(project.tracks);
	const sourceIds = new Set(project.sources.map(source => source.id));
	const clipSlots = new Map(project.clips.map((clip, index) => [clip.id, index]));
	const entries = command.entries.map((entry) => {
		const clip = clipById.get(entry.clipId);
		if (!clip) throw new ReferenceError(`Unknown clip: ${entry.clipId}.`);
		if (clip.kind === 'video') throw new RangeError('Rendered audio cannot replace a video clip.');
		const source = normalizeRangeReplacementSource(project, entry.source);
		if (sourceIds.has(source.id)) throw new RangeError(`Duplicate source ID: ${source.id}.`);
		return { clip, source, ratio: source.frameCount / clip.durationFrames };
	});
	const processedIds = new Set(entries.map(({ clip }) => clip.id));
	const remaining = new Set(processedIds);
	const entryById = new Map();
	for (const [index, entry] of entries.entries()) {
		const duplicates = entryById.get(entry.clip.id) || [];
		duplicates.push({ entry, index });
		entryById.set(entry.clip.id, duplicates);
	}
	const readRelated = createRelatedClipReader(project.clips, clipById);
	const components = [];
	while (remaining.size) {
		const seed = remaining.values().next().value;
		const relatedIds = new Set(readRelated([seed]));
		const targets = [...relatedIds].flatMap(id => entryById.get(id) || [])
			.sort((left, right) => left.index - right.index).map(item => item.entry);
		for (const { clip } of targets) remaining.delete(clip.id);
		const ratio = targets[0].ratio;
		if (targets.some((target) => Math.abs(target.ratio - ratio) > 1 / Math.max(1, target.clip.durationFrames))) {
			throw new RangeError('Related clips produced inconsistent effect duration ratios.');
		}
		components.push({ relatedIds, targets, ratio });
	}

	const affectedTracks = new Set();
	for (const component of components) {
		const related = [...component.relatedIds].sort((left, right) => clipSlots.get(left) - clipSlots.get(right))
			.map((clipId) => clipById.get(clipId));
		const anchor = Math.min(...related.map((clip) => clip.timelineStartFrame));
		const oldEnd = Math.max(...related.map(clipEndFrame));
		const newEnd = anchor + Math.max(1, Math.round((oldEnd - anchor) * component.ratio));
		const delta = newEnd - oldEnd;
		const relatedTracks = new Set(related.map((clip) => owners.get(clip.id)));
		for (const track of relatedTracks) {
			if (!track) throw new ReferenceError('Rendered clip is not assigned to a track.');
			affectedTracks.add(track);
		}
		const relatedTrackIds = new Set([...relatedTracks].map(track => track.id));
		if (rippleMode === 'track') {
			// The rendered span ripples the rest of its tracks, so the take graph on
			// those tracks travels with it; a group the span runs through refuses.
			planTakeGraphRangeRipple(
				project,
				new Map([...relatedTrackIds].map((trackId) => [
					String(trackId),
					{ startFrame: anchor, endFrame: oldEnd },
				])),
				delta,
			)?.();
			if (delta !== 0) for (const track of relatedTracks) {
				for (const clipId of track.clipIds) {
					if (component.relatedIds.has(clipId)) continue;
					const clip = clipById.get(clipId);
					if (clip.timelineStartFrame >= oldEnd) clip.timelineStartFrame += delta;
				}
			}
		}
		const targetById = new Map();
		for (const target of component.targets) if (!targetById.has(target.clip.id)) targetById.set(target.clip.id, target);
		for (const original of related) {
			const current = clipById.get(original.id);
			const target = targetById.get(original.id);
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
			if (target) {
				delete updated.fadeInShape;
				delete updated.fadeOutShape;
			}
			project.clips[clipSlots.get(updated.id)] = updated;
			clipById.set(updated.id, updated);
		}
	}
	project.sources.push(...entries.map(({ source }) => source));
	for (const track of affectedTracks) sortTrack(project, track, clipById);
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
	if (targetTrack !== oldTrack) sortTrack(project, targetTrack);
}

/**
 * Returns the clips that participate when an edit begins on activeClipId.
 * An existing multi-selection is honored only when it contains the active
 * clip; grouped companions of every participating clip are then included.
 */

export function collectClipTransformIds(project, activeClipId, options = {}) {
	const activeClip = findClip(project, activeClipId);
	if (!activeClip) return [];
	const ids = new Set([activeClip.id]);
	const selectedIds = options.clipIds || (options.allOnTrack
		? findClipTrack(project, activeClip.id)?.clipIds || []
		: project.selection?.clipIds || []);
	if (selectedIds.includes(activeClip.id)) {
		for (const clipId of selectedIds) if (findClip(project, clipId)) ids.add(clipId);
	}
	return collectRelatedClipIds(project, [...ids]);
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
