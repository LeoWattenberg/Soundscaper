/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../automation.js';
import {
	assertFrame,
	normalizeFrameRange,
} from '../project.js';
import {
	normalizeAudioEditorSnapSettings,
} from '../snap-grid.js';
import { normalizeProjectBextMetadata } from '../project-bext-metadata.ts';
import { authoredAdmChannelCount, normalizeAdmProjectMetadata } from '../adm-project-metadata.ts';
import {
	hasAdmMetadataProjectAuthority,
	hasBextMetadataProjectAuthority,
	hasCoreEditingProjectAuthority,
	hasProjectBinMediaAuthority,
	hasVideoEffectsProjectAuthority,
	isTimelineAnnotationProjectSchema,
} from '../project-schema-version.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import {
	collectRelatedClipIds,
	removeClips,
} from './clip-basic-runtime.js';
import {
	assertClipSourceBounds,
	assertClipSpace,
	assertUnusedClipId,
	cloneVideoEffectsWithCommandIds,
	normalizeClipForProject,
	normalizeCommandIds,
	normalizeFrequencyRange,
	normalizeSelectionIds,
	replaceClip,
	requireClip,
	requireClipTrack,
	requireProjectBin,
	requireProjectBinClip,
	requireSource,
	requireStableCommandId,
	requireTrack,
	sortTrack,
} from './shared-runtime.js';
import {
	addSource,
	removeSource,
	reprobeSource,
	rewriteSourceMedia,
	updateSource,
} from './project-source-record-runtime.js';
import { cloneVideoCompositionCarrierFields } from './video-composition-carrier.ts';
import {
	rebindVideoKeyframeCarrierEffects,
} from './video-keyframe-carrier.ts';

function setSelection(project, command) {
	const startFrame = assertFrame(command.startFrame, 'selection.startFrame');
	const endFrame = assertFrame(command.endFrame, 'selection.endFrame');
	const range = startFrame <= endFrame
		? { startFrame, endFrame }
		: { startFrame: endFrame, endFrame: startFrame };
	const supportsAnnotations = isTimelineAnnotationProjectSchema(project)
		&& Array.isArray(project.timelineAnnotations);
	if (Object.hasOwn(command, 'annotationIds') && !supportsAnnotations) {
		throw new RangeError('Timeline annotation selection requires schema 11 or 12.');
	}
	if (!['trackIds', 'clipIds', 'annotationIds', 'frequencyRange'].some((key) => Object.hasOwn(command, key))) {
		project.selection = supportsAnnotations ? { ...range, annotationIds: [] } : range;
		return;
	}
	const trackIds = normalizeSelectionIds(command.trackIds ?? project.selection?.trackIds ?? [], 'selection.trackIds');
	const clipIds = normalizeSelectionIds(command.clipIds ?? project.selection?.clipIds ?? [], 'selection.clipIds');
	const annotationIds = supportsAnnotations
		? normalizeSelectionIds(command.annotationIds ?? project.selection?.annotationIds ?? [], 'selection.annotationIds')
		: [];
	for (const trackId of trackIds) requireTrack(project, trackId);
	for (const clipId of clipIds) requireClip(project, clipId);
	if (supportsAnnotations) {
		const availableAnnotationIds = new Set(project.timelineAnnotations.map(({ id }) => id));
		for (const annotationId of annotationIds) {
			if (!availableAnnotationIds.has(annotationId)) {
				throw new ReferenceError(`Selection references missing annotation ${annotationId}.`);
			}
		}
	}
	project.selection = {
		...range,
		trackIds,
		clipIds,
		...(supportsAnnotations ? { annotationIds } : {}),
		frequencyRange: normalizeFrequencyRange(command.frequencyRange, project.sampleRate),
	};
}

function setLoop(project, command) {
	if (!command.enabled) {
		project.loop = { ...project.loop, enabled: false };
		return;
	}
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'loop');
	project.loop = { enabled: true, startFrame: range.startFrame, endFrame: range.endFrame };
}

function setSnap(project, command) {
	if (!hasCoreEditingProjectAuthority(project)) throw new RangeError('Snap settings require an active editing project.');
	const settings = command.settings || {};
	const next = {
		...project.snap,
		...settings,
	};
	if (Object.hasOwn(settings, 'unit') && !Object.hasOwn(settings, 'division')) next.division = settings.unit;
	if (Object.hasOwn(settings, 'division') && !Object.hasOwn(settings, 'unit')) next.unit = settings.division;
	if (!Object.hasOwn(settings, 'unit') && !Object.hasOwn(settings, 'division')
		&& ['upstreamType', 'opaqueType', 'type'].some((key) => Object.hasOwn(settings, key))) {
		delete next.unit;
		delete next.division;
	}
	project.snap = normalizeAudioEditorSnapSettings(next);
}

function addProjectBinClip(project, value) {
	const projectBin = requireProjectBin(project);
	const clip = normalizeClipForProject(project, {
		...value,
		...cloneVideoCompositionCarrierFields(value, `Project Bin clip ${String(value?.id ?? '')}`),
		groupId: null,
		...(hasProjectBinMediaAuthority(project) ? {
			avLinkId: null,
			binItemId: value?.binItemId || value?.id,
		} : {}),
	});
	assertUnusedClipId(project, clip.id);
	assertClipSourceBounds(project, clip);
	projectBin.clips.push(clip);
}

function moveTimelineClipsToProjectBin(project, clipIds) {
	const projectBin = requireProjectBin(project);
	const requestedIds = normalizeCommandIds(clipIds, 'clipIds');
	const requestedClips = requestedIds.map((clipId) => requireClip(project, clipId));
	const groupIds = new Set(requestedClips.map((clip) => clip.groupId).filter(Boolean));
	const avLinkIds = new Set(requestedClips.map((clip) => clip.avLinkId).filter(Boolean));
	const movedIds = new Set(requestedIds);
	if (groupIds.size || avLinkIds.size) {
		for (const clip of project.clips) {
			if (clip.groupId && groupIds.has(clip.groupId)) movedIds.add(clip.id);
			if (clip.avLinkId && avLinkIds.has(clip.avLinkId)) movedIds.add(clip.id);
		}
	}
	const binItemByClipId = new Map();
	for (const clip of project.clips.filter((candidate) => movedIds.has(candidate.id))) {
		const linked = clip.avLinkId
			? project.clips.filter((candidate) => movedIds.has(candidate.id) && candidate.avLinkId === clip.avLinkId)
			: [clip];
		const binItemId = linked.find((candidate) => candidate.kind === 'video')?.id || linked[0]?.id || clip.id;
		for (const candidate of linked) binItemByClipId.set(candidate.id, binItemId);
	}
	const movedClips = project.clips
		.filter((clip) => movedIds.has(clip.id))
		.map((clip) => normalizeClipForProject(project, {
			...clip,
			...cloneVideoCompositionCarrierFields(clip, `Moved Project Bin clip ${clip.id}`),
			groupId: null,
			id: clip.id,
			...(hasProjectBinMediaAuthority(project) ? {
				avLinkId: null,
				binItemId: binItemByClipId.get(clip.id) || clip.id,
			} : {}),
		}));
	for (const track of project.tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		track.clipIds = track.clipIds.filter((clipId) => !movedIds.has(clipId));
	}
	project.clips = project.clips.filter((clip) => !movedIds.has(clip.id));
	projectBin.clips.push(...movedClips);
	if (Array.isArray(project.selection?.clipIds)) {
		project.selection.clipIds = project.selection.clipIds.filter((clipId) => !movedIds.has(clipId));
	}
}

function placeProjectBinClip(project, command) {
	const binClip = requireProjectBinClip(project, command.binClipId);
	const itemClips = hasProjectBinMediaAuthority(project)
		? project.projectBin.clips.filter((clip) => clip.binItemId === binClip.binItemId)
		: [binClip];
	const timelineStartFrame = assertFrame(command.timelineStartFrame, 'project-bin.timelineStartFrame');
	const placements = Array.isArray(command.placements)
		? command.placements
		: [{
			binClipId: binClip.id,
			trackId: command.trackId,
			clipId: command.clipId,
		}];
	if (placements.length !== itemClips.length) {
		throw new RangeError('Every clip in a Project Bin item needs a timeline placement.');
	}
	const avLinkId = itemClips.length === 2
		? requireStableCommandId(command.avLinkId, 'A/V link')
		: null;
	for (const itemClip of itemClips) {
		const placement = placements.find((candidate) => candidate.binClipId === itemClip.id)
			|| (placements.length === 1 ? placements[0] : null);
		if (!placement) throw new ReferenceError(`Missing placement for Project Bin clip ${itemClip.id}.`);
		const track = requireTrack(project, placement.trackId);
		if (!Array.isArray(track.clipIds) || (hasProjectBinMediaAuthority(project) && track.type !== itemClip.kind)) {
			throw new RangeError(`A ${itemClip.kind || 'audio'} Project Bin clip needs a matching media track.`);
		}
		const clipId = requireStableCommandId(placement.clipId, 'placed clip');
		assertUnusedClipId(project, clipId);
		const videoEffects = itemClip.kind === 'video' && hasVideoEffectsProjectAuthority(project)
			? cloneVideoEffectsWithCommandIds(
				itemClip.videoEffects,
				placement.videoEffectIds,
				`Project Bin placement ${itemClip.id}`,
			)
			: undefined;
		let candidate = {
			...itemClip,
			...cloneVideoCompositionCarrierFields(itemClip, `Placed Project Bin clip ${itemClip.id}`),
			id: clipId,
			timelineStartFrame,
			groupId: null,
			...(videoEffects ? { videoEffects } : {}),
			...(hasProjectBinMediaAuthority(project) ? { avLinkId, binItemId: null } : {}),
		};
		candidate = rebindVideoKeyframeCarrierEffects(
			candidate,
			itemClip,
			candidate,
			`Placed Project Bin clip ${itemClip.id}`,
		);
		const clip = normalizeClipForProject(project, candidate);
		assertClipSourceBounds(project, clip);
		assertClipSpace(project, track, clip);
		project.clips.push(clip);
		track.clipIds.push(clip.id);
		sortTrack(project, track);
	}
}

function updateProjectBinClip(project, clipId, changes = {}) {
	const projectBin = requireProjectBin(project);
	const clip = projectBin.clips.find((candidate) => candidate.id === clipId);
	if (!clip) throw new ReferenceError(`Unknown project-bin clip: ${clipId}.`);
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
		throw new TypeError('Project-bin clip changes must be an object.');
	}
	const allowed = new Set(['title', 'color']);
	for (const key of Object.keys(changes)) {
		if (!allowed.has(key)) throw new RangeError(`Project-bin clip field cannot be updated: ${key}.`);
	}
	if (Object.hasOwn(changes, 'title') && (typeof changes.title !== 'string' || !changes.title.trim())) {
		throw new TypeError('A project-bin clip title is required.');
	}
	if (Object.hasOwn(changes, 'color') && (typeof changes.color !== 'string' || !changes.color.trim())) {
		throw new TypeError('A project-bin clip color is required.');
	}
	const itemIds = new Set(hasProjectBinMediaAuthority(project)
		? projectBin.clips.filter((candidate) => candidate.binItemId === clip.binItemId).map((candidate) => candidate.id)
		: [clip.id]);
	projectBin.clips = projectBin.clips.map((candidate) => itemIds.has(candidate.id)
		? normalizeClipForProject(project, {
			...candidate,
			...changes,
			id: candidate.id,
			groupId: null,
			...(hasProjectBinMediaAuthority(project) ? { avLinkId: null, binItemId: candidate.binItemId } : {}),
		})
		: candidate);
}

function removeProjectBinClip(project, clipId) {
	const projectBin = requireProjectBin(project);
	const clip = projectBin.clips.find((candidate) => candidate.id === clipId);
	if (!clip) throw new ReferenceError(`Unknown project-bin clip: ${clipId}.`);
	if (hasProjectBinMediaAuthority(project)) {
		projectBin.clips = projectBin.clips.filter((candidate) => candidate.binItemId !== clip.binItemId);
		return;
	}
	projectBin.clips = projectBin.clips.filter((candidate) => candidate.id !== clipId);
}

function removeProjectBinSourceFromProject(project, clipId) {
	const projectBin = requireProjectBin(project);
	const clip = requireProjectBinClip(project, clipId);
	const itemClips = hasProjectBinMediaAuthority(project)
		? projectBin.clips.filter((candidate) => candidate.binItemId === clip.binItemId)
		: [clip];
	const sourceIds = new Set(itemClips.map((candidate) => candidate.sourceId));
	const timelineIds = collectRelatedClipIds(
		project,
		project.clips.filter((candidate) => sourceIds.has(candidate.sourceId)).map((candidate) => candidate.id),
	);
	if (timelineIds.length) removeClips(project, timelineIds);
	projectBin.clips = projectBin.clips.filter((candidate) => !sourceIds.has(candidate.sourceId));
	for (const sourceId of sourceIds) {
		const inUse = [...project.clips, ...projectBin.clips].some((candidate) => candidate.sourceId === sourceId);
		if (!inUse) project.sources = project.sources.filter((source) => source.id !== sourceId);
	}
}

function replaceProjectBinMedia(project, command) {
	const projectBin = requireProjectBin(project);
	const target = requireProjectBinClip(project, command.clipId);
	const replacements = Array.isArray(command.replacements) ? command.replacements : [];
	if (!replacements.length) throw new TypeError('Project Bin replacement mappings are required.');
	if (!['keep-spacing', 'contract-gaps'].includes(command.shortfallMode)) {
		throw new RangeError(`Unsupported Project Bin replacement mode: ${command.shortfallMode}.`);
	}
	const replacementBySourceId = new Map(replacements.map((entry) => {
		const oldSource = requireSource(project, entry.oldSourceId);
		const newSource = requireSource(project, entry.newSourceId);
		if ((oldSource.kind || 'audio') !== (newSource.kind || 'audio')) {
			throw new RangeError('Project Bin replacement media kinds must match.');
		}
		return [oldSource.id, { oldSource, newSource }];
	}));
	const targetItemId = target.binItemId || target.id;
	const newTemplates = Array.isArray(command.templates)
		? command.templates.map((clip) => normalizeClipForProject(project, clip))
		: [];
	if (newTemplates.length !== replacements.length) {
		throw new RangeError('Every replacement source needs a Project Bin template.');
	}
	const templateByKind = new Map(newTemplates.map((clip) => [clip.kind || 'audio', clip]));
	const targetTitle = target.title;
	const targetColor = target.color;
	const removedDurationsByTrack = new Map();
	const removedTimelineIds = new Set();

	project.clips = project.clips.flatMap((clip) => {
		const replacement = replacementBySourceId.get(clip.sourceId);
		if (!replacement) return [clip];
		const next = remapReplacementClip(project, clip, replacement.oldSource, replacement.newSource);
		if (!next) {
			removedTimelineIds.add(clip.id);
			recordReplacementContraction(project, clip, clip.durationFrames, removedDurationsByTrack);
			return [];
		}
		const reduction = clip.durationFrames - next.durationFrames;
		if (reduction > 0) recordReplacementContraction(project, clip, reduction, removedDurationsByTrack);
		return [next];
	});
	for (const track of project.tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		track.clipIds = track.clipIds.filter((clipId) => !removedTimelineIds.has(clipId));
	}

	projectBin.clips = projectBin.clips.flatMap((clip) => {
		const replacement = replacementBySourceId.get(clip.sourceId);
		if (!replacement) return [clip];
		const itemId = clip.binItemId || clip.id;
		if (itemId === targetItemId) {
			const template = templateByKind.get(clip.kind || 'audio');
			if (!template) return [];
			return [normalizeClipForProject(project, {
				...template,
				...clip,
				id: clip.id,
				sourceId: template.sourceId,
				sourceStartFrame: template.sourceStartFrame,
				sourceDurationFrames: template.sourceDurationFrames,
				durationFrames: template.durationFrames,
				title: targetTitle,
				color: targetColor,
				fadeInFrames: Math.min(clip.fadeInFrames || 0, template.durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames || 0, template.durationFrames),
				envelope: truncatedEnvelope(clip.envelope, clip.durationFrames, template.durationFrames),
				trimStartFrames: Math.min(clip.trimStartFrames || 0, template.sourceStartFrame),
				trimEndFrames: Math.min(
					clip.trimEndFrames || 0,
					Math.max(0, replacement.newSource.frameCount - template.sourceStartFrame - template.sourceDurationFrames),
				),
				groupId: null,
				...(hasProjectBinMediaAuthority(project) ? {
					avLinkId: null,
					binItemId: clip.binItemId,
				} : {}),
			})];
		}
		const next = remapReplacementClip(project, clip, replacement.oldSource, replacement.newSource);
		return next ? [{
			...next,
			groupId: null,
			...(hasProjectBinMediaAuthority(project) ? { avLinkId: null, binItemId: clip.binItemId } : {}),
		}] : [];
	});

	if (command.shortfallMode === 'contract-gaps') {
		for (const track of project.tracks) {
			if (!Array.isArray(track.clipIds)) continue;
			const contractions = removedDurationsByTrack.get(track.id) || [];
			if (!contractions.length) continue;
			for (const clipId of track.clipIds) {
				const clip = requireClip(project, clipId);
				const shift = contractions.reduce((sum, entry) => (
					clip.timelineStartFrame >= entry.endFrame ? sum + entry.frames : sum
				), 0);
				if (shift > 0) replaceClip(project, normalizeClipForProject(project, {
					...clip,
					timelineStartFrame: Math.max(0, clip.timelineStartFrame - shift),
					id: clip.id,
				}));
			}
			sortTrack(project, track);
		}
	}

	for (const { oldSource } of replacementBySourceId.values()) {
		const inUse = [...project.clips, ...projectBin.clips].some((clip) => clip.sourceId === oldSource.id);
		if (!inUse) project.sources = project.sources.filter((source) => source.id !== oldSource.id);
	}
}

/**
 * Truncate an envelope onto a shortened clip without changing the gain over what
 * the clip still holds. Dropping the points past the new end is not enough,
 * because the evaluator holds the last surviving point after it: the retained
 * material would flatten out instead of continuing toward the point that was
 * cut off. The new end therefore keeps the value the envelope described there.
 */
function truncatedEnvelope(envelope, originalDurationFrames, durationFrames) {
	if (!Array.isArray(envelope) || envelope.length === 0) return [];
	const kept = envelope.filter((point) => point.frame <= durationFrames);
	if (kept.length === envelope.length || kept.some((point) => point.frame === durationFrames)) return kept;
	const valueAt = createEnvelopeValueEvaluator(envelope, Math.max(1, originalDurationFrames));
	return [...kept, { frame: durationFrames, value: valueAt(durationFrames) }];
}

function remapReplacementClip(project, clip, oldSource, newSource) {
	const oldRate = Math.max(1, Number(oldSource.sampleRate) || project.sampleRate);
	const newRate = Math.max(1, Number(newSource.sampleRate) || project.sampleRate);
	const sourceStartFrame = Math.max(0, scaleSampleFrame(clip.sourceStartFrame, oldRate, newRate, 'point'));
	if (sourceStartFrame >= newSource.frameCount) return null;
	const requestedSourceDuration = Math.max(1, scaleSampleFrame(
		clip.sourceDurationFrames, oldRate, newRate, 'point',
	));
	const sourceDurationFrames = Math.min(requestedSourceDuration, newSource.frameCount - sourceStartFrame);
	const durationFrames = Math.max(1, Math.round(clip.durationFrames * sourceDurationFrames / requestedSourceDuration));
	return normalizeClipForProject(project, {
		...clip,
		sourceId: newSource.id,
		sourceStartFrame,
		sourceDurationFrames,
		durationFrames,
		fadeInFrames: Math.min(clip.fadeInFrames || 0, durationFrames),
		fadeOutFrames: Math.min(clip.fadeOutFrames || 0, durationFrames),
		envelope: truncatedEnvelope(clip.envelope, clip.durationFrames, durationFrames),
		trimStartFrames: Math.min(clip.trimStartFrames || 0, sourceStartFrame),
		trimEndFrames: Math.min(
			clip.trimEndFrames || 0,
			Math.max(0, newSource.frameCount - sourceStartFrame - sourceDurationFrames),
		),
		id: clip.id,
	});
}

function recordReplacementContraction(project, clip, frames, contractionsByTrack) {
	const track = requireClipTrack(project, clip.id);
	const contractions = contractionsByTrack.get(track.id) || [];
	contractions.push({
		endFrame: clip.timelineStartFrame + clip.durationFrames,
		frames,
	});
	contractionsByTrack.set(track.id, contractions);
}

function updateMetadata(project, changes = {}) {
	if (!hasCoreEditingProjectAuthority(project)) throw new RangeError('Metadata editing requires an active editing project.');
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Metadata changes must be an object.');
	const allowed = new Set([
		'title', 'artist', 'album', 'trackNumber', 'year', 'comments', 'tags',
		...(hasBextMetadataProjectAuthority(project) ? ['bext'] : []),
		...(hasAdmMetadataProjectAuthority(project) ? ['adm'] : []),
	]);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Metadata field cannot be updated: ${key}.`);
	const next = { ...project.metadata };
	for (const key of allowed) {
		if (!Object.hasOwn(changes, key)) continue;
		if (key === 'bext') {
			next.bext = changes.bext == null ? null : normalizeProjectBextMetadata(changes.bext);
		} else if (key === 'adm') {
			next.adm = changes.adm == null ? null : normalizeAdmProjectMetadata(changes.adm);
			const authoredChannels = authoredAdmChannelCount(next.adm);
			const passthroughChannels = next.adm?.mode === 'passthrough'
				&& next.adm.valid
				&& Number.isSafeInteger(next.adm.geometry.channelCount)
				&& next.adm.geometry.channelCount >= 1
				&& next.adm.geometry.channelCount <= 32
				? next.adm.geometry.channelCount
				: null;
			if (authoredChannels != null || passthroughChannels != null) {
				project.masterChannels = authoredChannels ?? passthroughChannels;
			}
		} else if (key === 'tags') {
			if (!changes.tags || typeof changes.tags !== 'object' || Array.isArray(changes.tags)) {
				throw new TypeError('metadata.tags must be an object.');
			}
			next.tags = Object.fromEntries(Object.entries(changes.tags).map(([name, value]) => {
				const normalizedName = String(name).trim();
				if (!normalizedName) throw new RangeError('A metadata tag name is required.');
				return [normalizedName, String(value ?? '')];
			}));
		} else next[key] = String(changes[key] ?? '');
	}
	project.metadata = next;
}

function setTimeDisplay(project, command) {
	if (!hasCoreEditingProjectAuthority(project)) throw new RangeError('Time-display settings require an active editing project.');
	if (typeof command.format !== 'string' || !command.format.trim()) throw new TypeError('A time-display format is required.');
	project.timeDisplay = { ...project.timeDisplay, format: command.format };
}
export function createProjectSourceBinRuntimeHandlers(dispatchChild) {
	return {
		'batch'(project, command) {
			if (!Array.isArray(command.commands) || !command.commands.length) {
				throw new TypeError('A command batch cannot be empty.');
			}
			for (const child of command.commands) dispatchChild(project, child);
		},
		'project/rename'(project, command) {
			project.title = String(command.title || '').trim();
			if (!project.title) throw new RangeError('A project title is required.');
		},
		'selection/set': setSelection,
		'loop/set': setLoop,
		'snap/set': setSnap,
		'time-display/set': setTimeDisplay,
		'metadata/update': (project, command) => updateMetadata(project, command.changes),
		'source/add': (project, command) => addSource(project, command.source),
		'source/remove': (project, command) => removeSource(project, command.sourceId),
		'source/update': (project, command) => updateSource(project, command.sourceId, command.changes),
		'source/reprobe': reprobeSource,
		'source/rewrite-media': rewriteSourceMedia,
		'project-bin/add': (project, command) => addProjectBinClip(project, command.clip),
		'project-bin/move-from-timeline': (project, command) => moveTimelineClipsToProjectBin(project, command.clipIds),
		'project-bin/place': placeProjectBinClip,
		'project-bin/update': (project, command) => updateProjectBinClip(project, command.clipId, command.changes),
		'project-bin/remove': (project, command) => removeProjectBinClip(project, command.clipId),
		'project-bin/remove-from-project': (project, command) => removeProjectBinSourceFromProject(project, command.clipId),
		'project-bin/replace-media': replaceProjectBinMedia,
	};
}
