import {
	assertFrame,
	assertPositiveFrame,
	clipEndFrame,
	clipsOverlap,
	commitProject,
	createStableId,
	findClip,
	findClipTrack,
	findProjectBinClip,
	findSource,
	findTrack,
	normalizeFrameRange,
} from './project.js';
import { createEffect, normalizeEffect, updateEffect } from './effects.js';
import {
	createAudioClipV2,
	createAudioMasterV2,
	createAudioMixerBusV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	createLabelV2,
} from './project-v2.js';
import {
	createAudioClipV4,
	createAudioSourceV4,
	createAudioTrackV4,
	createLabelTrackV4,
	createMediaClipV4,
	createMediaSourceV4,
	createMediaTrackV4,
} from './project-v4.js';
import {
	createMediaClipV5,
	createMediaSourceV5,
	createMediaTrackV5,
} from './project-v5.js';
import {
	cloneVideoEffects,
	createVideoEffect,
	normalizeVideoEffect,
	updateVideoEffect,
} from './video-effects.js';
import { normalizeAudioEditorSnapSettings } from './snap-grid.js';

/**
 * A JSON-safe command. Commands that create clips carry their generated stable
 * IDs so replay never depends on random state.
 *
 * @typedef {Object} AudioEditorCommand
 * @property {string} type
 * @property {*} [commands]
 * @property {*} [source]
 * @property {*} [track]
 * @property {*} [clip]
 */

/**
 * @typedef {Object} AudioEditorClipboardV2
 * @property {2} schemaVersion
 * @property {number} sampleRate
 * @property {number} durationFrames
 * @property {Array<{
 *   sourceTrackId: string,
 *   sourceTrackName: string,
 *   sourceTrackType: 'audio'|'video',
 *   sourceLaneGroupId: string|null,
 *   clips: Object[],
 * }>} tracks
 */

/**
 * @param {import('./project.js').AudioEditorProjectV1} project
 * @param {AudioEditorCommand} command
 * @returns {import('./project.js').AudioEditorProjectV1}
 */
export function applyEditorCommand(project, command, options = {}) {
	if (![2, 3, 4, 5].includes(project?.schemaVersion)) {
		throw new RangeError('Editor commands require a current audio editor project.');
	}
	if (!command || typeof command.type !== 'string') throw new TypeError('A serializable editor command is required.');
	return commitProject(project, (draft) => {
		mutateCommand(draft, command);
		pruneMissingProjectSelections(draft);
	}, options);
}

function pruneMissingProjectSelections(project) {
	const trackIds = new Set(project.tracks.map((track) => track.id));
	const timelineClipIds = new Set(project.clips.map((clip) => clip.id));
	if (Array.isArray(project.selection?.trackIds)) {
		project.selection.trackIds = project.selection.trackIds.filter((trackId) => trackIds.has(trackId));
	}
	if (Array.isArray(project.selection?.clipIds)) {
		project.selection.clipIds = project.selection.clipIds.filter((clipId) => timelineClipIds.has(clipId));
	}
	if (Array.isArray(project.view?.selectedTrackIds)) {
		project.view.selectedTrackIds = project.view.selectedTrackIds.filter((trackId) => trackIds.has(trackId));
	}
}

function mutateCommand(project, command) {
	switch (command.type) {
		case 'batch':
			if (!Array.isArray(command.commands) || !command.commands.length) throw new TypeError('A command batch cannot be empty.');
			for (const child of command.commands) mutateCommand(project, child);
			break;
		case 'project/rename':
			project.title = String(command.title || '').trim();
			if (!project.title) throw new RangeError('A project title is required.');
			break;
		case 'selection/set':
			setSelection(project, command);
			break;
		case 'loop/set':
			setLoop(project, command);
			break;
		case 'snap/set':
			setSnap(project, command);
			break;
		case 'tempo/set':
			setTempo(project, command);
			break;
		case 'time-display/set':
			setTimeDisplay(project, command);
			break;
		case 'metadata/update':
			updateMetadata(project, command.changes);
			break;
		case 'source/add':
			addSource(project, command.source);
			break;
		case 'source/remove':
			removeSource(project, command.sourceId);
			break;
		case 'source/update':
			updateSource(project, command.sourceId, command.changes);
			break;
		case 'project-bin/add':
			addProjectBinClip(project, command.clip);
			break;
		case 'project-bin/move-from-timeline':
			moveTimelineClipsToProjectBin(project, command.clipIds);
			break;
		case 'project-bin/place':
			placeProjectBinClip(project, command);
			break;
		case 'project-bin/update':
			updateProjectBinClip(project, command.clipId, command.changes);
			break;
		case 'project-bin/remove':
			removeProjectBinClip(project, command.clipId);
			break;
		case 'project-bin/remove-from-project':
			removeProjectBinSourceFromProject(project, command.clipId);
			break;
		case 'project-bin/replace-media':
			replaceProjectBinMedia(project, command);
			break;
		case 'track/add':
			addTrack(project, command.track, command.index);
			break;
		case 'track/remove':
			removeTrack(project, command.trackId);
			break;
		case 'track/update':
			updateTrack(project, command.trackId, command.changes);
			break;
		case 'track/reorder':
			reorderTrack(project, command.trackId, command.index);
			break;
		case 'label/add':
			addLabel(project, command.trackId, command.label);
			break;
		case 'label/update':
			updateLabel(project, command.trackId, command.labelId, command.changes);
			break;
		case 'label/remove':
			removeLabel(project, command.trackId, command.labelId);
			break;
		case 'master/update':
			updateMaster(project, command.changes);
			break;
		case 'mixer/bus-add':
			addMixerBus(project, command);
			break;
		case 'mixer/bus-update':
			updateMixerBus(project, command);
			break;
		case 'mixer/bus-remove':
			removeMixerBus(project, command);
			break;
		case 'mixer/route-update':
			updateMixerRoute(project, command);
			break;
		case 'clip/add':
			addClip(project, command.trackId, command.clip);
			break;
		case 'clip/remove':
			removeClip(project, command.clipId);
			break;
		case 'clip/remove-many':
			removeClips(project, command.clipIds, command.rippleMode);
			break;
		case 'clip/update':
			updateClip(project, command.clipId, command.changes);
			break;
		case 'clip/replace-source':
			replaceClipSource(project, command.clipId, command.sourceId);
			break;
		case 'clip/move':
			moveClip(project, command);
			break;
		case 'clip/transform-many':
			transformClips(project, command);
			break;
		case 'clip/overwrite':
			overwriteClip(project, command);
			break;
		case 'clip/trim':
			trimClip(project, command);
			break;
		case 'clip/split':
			splitClip(project, command);
			break;
		case 'clip/link-av':
			linkAvClips(project, command);
			break;
		case 'clip/unlink-av':
			unlinkAvClips(project, command);
			break;
		case 'clip/group':
			groupClips(project, command.clipIds, command.groupId);
			break;
		case 'clip/ungroup':
			ungroupClips(project, command.clipIds);
			break;
		case 'clip/join':
			joinClips(project, command.clipIds);
			break;
		case 'range/lift-delete':
			deleteRange(project, command, 'none');
			break;
		case 'range/ripple-delete':
			deleteRange(project, command, 'track');
			break;
		case 'range/per-clip-ripple-delete':
			deleteRange(project, command, 'clip');
			break;
		case 'range/keep':
			keepRange(project, command);
			break;
		case 'range/replace':
			replaceRange(project, command);
			break;
		case 'clipboard/paste':
			pasteClipboard(project, command);
			break;
		case 'punch/replace':
			punchReplace(project, command);
			break;
		case 'effect/add':
			addEffect(project, command);
			break;
		case 'effect/update':
			updateRackEffect(project, command);
			break;
		case 'effect/remove':
			removeEffect(project, command);
			break;
		case 'effect/reorder':
			reorderEffect(project, command);
			break;
		case 'video-effect/add':
			addVideoEffect(project, command);
			break;
		case 'video-effect/update':
			updateClipVideoEffect(project, command);
			break;
		case 'video-effect/remove':
			removeVideoEffect(project, command);
			break;
		case 'video-effect/reorder':
			reorderVideoEffect(project, command);
			break;
		default:
			throw new RangeError(`Unsupported editor command: ${command.type}.`);
	}
}

function setSelection(project, command) {
	const startFrame = assertFrame(command.startFrame, 'selection.startFrame');
	const endFrame = assertFrame(command.endFrame, 'selection.endFrame');
	const range = startFrame <= endFrame
		? { startFrame, endFrame }
		: { startFrame: endFrame, endFrame: startFrame };
	if (!['trackIds', 'clipIds', 'frequencyRange'].some((key) => Object.hasOwn(command, key))) {
		project.selection = range;
		return;
	}
	const trackIds = normalizeSelectionIds(command.trackIds ?? project.selection?.trackIds ?? [], 'selection.trackIds');
	const clipIds = normalizeSelectionIds(command.clipIds ?? project.selection?.clipIds ?? [], 'selection.clipIds');
	for (const trackId of trackIds) requireTrack(project, trackId);
	for (const clipId of clipIds) requireClip(project, clipId);
	project.selection = {
		...range,
		trackIds,
		clipIds,
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
	if (project.schemaVersion < 2) throw new RangeError('Snap settings require an AudioEditorProjectV2 or newer project.');
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

function setTempo(project, command) {
	if (project.schemaVersion < 2) throw new RangeError('Tempo settings require an AudioEditorProjectV2 or newer project.');
	const bpm = command.bpm == null ? project.tempo.bpm : Number(command.bpm);
	if (!Number.isFinite(bpm) || bpm < 1 || bpm > 1_000) throw new RangeError('tempo.bpm must be between 1 and 1000.');
	const numerator = command.numerator == null
		? project.tempo.timeSignature.numerator
		: Number(command.numerator);
	const denominator = command.denominator == null
		? project.tempo.timeSignature.denominator
		: Number(command.denominator);
	if (!Number.isSafeInteger(numerator) || numerator < 1 || numerator > 32) {
		throw new RangeError('tempo.timeSignature.numerator must be between 1 and 32.');
	}
	if (!Number.isSafeInteger(denominator) || denominator < 1 || denominator > 32 || (denominator & (denominator - 1)) !== 0) {
		throw new RangeError('tempo.timeSignature.denominator must be a power of two up to 32.');
	}
	project.tempo = { bpm, timeSignature: { numerator, denominator }, detected: false };
}

function addSource(project, value) {
	const source = normalizeSourceForProject(project, value);
	assertUnusedId(project.sources, source.id, 'source');
	project.sources.push(source);
}

function removeSource(project, sourceId) {
	const inUse = [
		...project.clips,
		...(project.projectBin?.clips || []),
	].some((clip) => clip.sourceId === sourceId);
	if (inUse) throw new RangeError('A source in use cannot be removed.');
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	project.sources.splice(index, 1);
}

function updateSource(project, sourceId, changes = {}) {
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	const allowed = new Set([
		'name', 'mimeType', 'originalSampleRate', 'sampleFormat', 'opaqueExtensions',
		'videoCodec', 'audioCodec', 'hasAudio', 'posterStorageKey', 'thumbnailStorageKey',
	]);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Source field cannot be updated: ${key}.`);
	project.sources[index] = normalizeSourceForProject(project, { ...project.sources[index], ...changes, id: sourceId });
}

function addProjectBinClip(project, value) {
	const projectBin = requireProjectBin(project);
	const clip = normalizeClipForProject(project, {
		...value,
		groupId: null,
		...(project.schemaVersion >= 4 ? {
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
			groupId: null,
			id: clip.id,
			...(project.schemaVersion >= 4 ? {
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
	const itemClips = project.schemaVersion >= 4
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
		if (!Array.isArray(track.clipIds) || (project.schemaVersion >= 4 && track.type !== itemClip.kind)) {
			throw new RangeError(`A ${itemClip.kind || 'audio'} Project Bin clip needs a matching media track.`);
		}
		const clipId = requireStableCommandId(placement.clipId, 'placed clip');
		assertUnusedClipId(project, clipId);
		const videoEffects = itemClip.kind === 'video' && project.schemaVersion >= 5
			? cloneVideoEffectsWithCommandIds(
				itemClip.videoEffects,
				placement.videoEffectIds,
				`Project Bin placement ${itemClip.id}`,
			)
			: undefined;
		const clip = normalizeClipForProject(project, {
			...itemClip,
			id: clipId,
			timelineStartFrame,
			groupId: null,
			...(videoEffects ? { videoEffects } : {}),
			...(project.schemaVersion >= 4 ? { avLinkId, binItemId: null } : {}),
		});
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
	const itemIds = new Set(project.schemaVersion >= 4
		? projectBin.clips.filter((candidate) => candidate.binItemId === clip.binItemId).map((candidate) => candidate.id)
		: [clip.id]);
	projectBin.clips = projectBin.clips.map((candidate) => itemIds.has(candidate.id)
		? normalizeClipForProject(project, {
			...candidate,
			...changes,
			id: candidate.id,
			groupId: null,
			...(project.schemaVersion >= 4 ? { avLinkId: null, binItemId: candidate.binItemId } : {}),
		})
		: candidate);
}

function removeProjectBinClip(project, clipId) {
	const projectBin = requireProjectBin(project);
	const clip = projectBin.clips.find((candidate) => candidate.id === clipId);
	if (!clip) throw new ReferenceError(`Unknown project-bin clip: ${clipId}.`);
	if (project.schemaVersion >= 4) {
		projectBin.clips = projectBin.clips.filter((candidate) => candidate.binItemId !== clip.binItemId);
		return;
	}
	projectBin.clips = projectBin.clips.filter((candidate) => candidate.id !== clipId);
}

function removeProjectBinSourceFromProject(project, clipId) {
	const projectBin = requireProjectBin(project);
	const clip = requireProjectBinClip(project, clipId);
	const itemClips = project.schemaVersion >= 4
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
				envelope: (clip.envelope || []).filter((point) => point.frame <= template.durationFrames),
				trimStartFrames: Math.min(clip.trimStartFrames || 0, template.sourceStartFrame),
				trimEndFrames: Math.min(
					clip.trimEndFrames || 0,
					Math.max(0, replacement.newSource.frameCount - template.sourceStartFrame - template.sourceDurationFrames),
				),
				groupId: null,
				...(project.schemaVersion >= 4 ? {
					avLinkId: null,
					binItemId: clip.binItemId,
				} : {}),
			})];
		}
		const next = remapReplacementClip(project, clip, replacement.oldSource, replacement.newSource);
		return next ? [{
			...next,
			groupId: null,
			...(project.schemaVersion >= 4 ? { avLinkId: null, binItemId: clip.binItemId } : {}),
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

function remapReplacementClip(project, clip, oldSource, newSource) {
	const oldRate = Math.max(1, Number(oldSource.sampleRate) || project.sampleRate);
	const newRate = Math.max(1, Number(newSource.sampleRate) || project.sampleRate);
	const sourceStartFrame = Math.max(0, Math.round(clip.sourceStartFrame / oldRate * newRate));
	if (sourceStartFrame >= newSource.frameCount) return null;
	const requestedSourceDuration = Math.max(1, Math.round(clip.sourceDurationFrames / oldRate * newRate));
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
		envelope: (clip.envelope || []).filter((point) => point.frame <= durationFrames),
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

function addTrack(project, value, requestedIndex) {
	if (value?.type === 'label') {
		if (project.schemaVersion < 2) throw new RangeError('Label tracks require an AudioEditorProjectV2 or newer project.');
		const labelTrack = project.schemaVersion >= 4 ? createLabelTrackV4(value) : createLabelTrackV2(value);
		assertUnusedId(project.tracks, labelTrack.id, 'track');
		const labelIndex = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
		project.tracks.splice(labelIndex, 0, labelTrack);
		return;
	}
	if (value?.type === 'video') {
		if (project.schemaVersion < 4) throw new RangeError('Video tracks require an AudioEditorProjectV4 project.');
		const track = normalizeTrackForProject(project, value);
		assertUnusedId(project.tracks, track.id, 'track');
		if (track.clipIds.length) throw new RangeError('Add clips after adding a track.');
		const index = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
		project.tracks.splice(index, 0, track);
		return;
	}
	const effects = Array.isArray(value?.effects) ? value.effects.map(normalizeEffect) : [];
	const track = normalizeTrackForProject(project, { ...value, effects });
	assertUnusedId(project.tracks, track.id, 'track');
	if (track.clipIds.length) throw new RangeError('Add clips after adding a track.');
	const effectIds = new Set(allEffects(project).map((effect) => effect.id));
	for (const effect of track.effects) {
		if (effectIds.has(effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
		effectIds.add(effect.id);
	}
	const index = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
	project.tracks.splice(index, 0, track);
}

function removeTrack(project, trackId) {
	const index = project.tracks.findIndex((track) => track.id === trackId);
	if (index < 0) throw new ReferenceError(`Unknown track: ${trackId}.`);
	const requestedTrack = project.tracks[index];
	const laneGroupId = requestedTrack.laneGroupId;
	const removedTracks = laneGroupId
		? project.tracks.filter((track) => track.laneGroupId === laneGroupId)
		: [requestedTrack];
	const removedTrackIds = new Set(removedTracks.map((track) => track.id));
	const clipIds = new Set(removedTracks.flatMap((track) => track.clipIds || []));
	project.clips = project.clips.filter((clip) => !clipIds.has(clip.id));
	project.tracks = project.tracks.filter((track) => !removedTrackIds.has(track.id));
	for (const removedTrackId of removedTrackIds) {
		if (project.mixer?.routes) delete project.mixer.routes[removedTrackId];
		disableAutoDuckForRemovedControlTrack(project, removedTrackId);
	}
}

function disableAutoDuckForRemovedControlTrack(project, controlTrackId) {
	const racks = [
		project.master.effects,
		...project.tracks.filter((track) => Array.isArray(track.effects)).map((track) => track.effects),
		...(project.mixer?.groups || []).map((bus) => bus.effects),
		...(project.mixer?.sends || []).map((bus) => bus.effects),
	];
	for (const rack of racks) {
		for (let index = 0; index < rack.length; index += 1) {
			const effect = rack[index];
			if (effect.type !== 'audacity-auto-duck' || effect.context?.controlTrackId !== controlTrackId) continue;
			rack[index] = updateEffect(effect, {
				enabled: false,
				context: { controlTrackId: null },
			});
		}
	}
}

function updateTrack(project, trackId, changes = {}) {
	const track = requireTrack(project, trackId);
	if (track.type === 'label') {
		const allowed = new Set(['name', 'collapsed', 'height']);
		for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Label track field cannot be updated: ${key}.`);
		Object.assign(track, project.schemaVersion >= 4
			? createLabelTrackV4({ ...track, ...changes, labels: track.labels })
			: createLabelTrackV2({ ...track, ...changes, labels: track.labels }));
		return;
	}
	if (track.type === 'video') {
		const allowed = new Set(['name', 'mute', 'hidden', 'collapsed', 'height']);
		for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Video track field cannot be updated: ${key}.`);
		Object.assign(track, normalizeTrackForProject(project, { ...track, ...changes, clipIds: track.clipIds }));
		return;
	}
	const allowed = new Set(['name', 'gain', 'pan', 'mute', 'solo', 'armed', 'effectsActive']);
	for (const key of ['displayMode', 'color', 'spectrogram', 'envelope', 'collapsed', 'height']) allowed.add(key);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Track field cannot be updated: ${key}.`);
	const updated = normalizeTrackForProject(project, { ...track, ...changes, effects: track.effects, clipIds: track.clipIds });
	Object.assign(track, updated);
}

function reorderTrack(project, trackId, requestedIndex) {
	const fromIndex = project.tracks.findIndex((track) => track.id === trackId);
	if (fromIndex < 0) throw new ReferenceError(`Unknown track: ${trackId}.`);
	const index = Number(requestedIndex);
	if (!Number.isInteger(index) || index < 0 || index >= project.tracks.length) {
		throw new RangeError('Track destination is out of bounds.');
	}
	if (index === fromIndex) return;
	if (project.schemaVersion >= 4 && project.tracks.some((track) => track.laneGroupId)) {
		const blocks = [];
		const consumedLaneGroups = new Set();
		for (const track of project.tracks) {
			if (!track.laneGroupId) {
				blocks.push([track]);
				continue;
			}
			if (consumedLaneGroups.has(track.laneGroupId)) continue;
			consumedLaneGroups.add(track.laneGroupId);
			blocks.push(project.tracks.filter((candidate) => candidate.laneGroupId === track.laneGroupId));
		}
		const sourceBlockIndex = blocks.findIndex((block) => block.some((track) => track.id === trackId));
		const destinationTrackId = project.tracks[index].id;
		const destinationBlockIndex = blocks.findIndex((block) => (
			block.some((track) => track.id === destinationTrackId)
		));
		if (sourceBlockIndex === destinationBlockIndex) return;
		const [sourceBlock] = blocks.splice(sourceBlockIndex, 1);
		const adjustedDestination = blocks.findIndex((block) => (
			block.some((track) => track.id === destinationTrackId)
		));
		blocks.splice(
			index < fromIndex ? adjustedDestination : adjustedDestination + 1,
			0,
			sourceBlock,
		);
		project.tracks = blocks.flat();
		return;
	}
	const [track] = project.tracks.splice(fromIndex, 1);
	project.tracks.splice(index, 0, track);
}

function addLabel(project, trackId, value) {
	const track = requireLabelTrack(project, trackId);
	const label = createLabelV2(value);
	assertUnusedId(track.labels, label.id, 'label');
	track.labels.push(label);
	track.labels.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame || left.id.localeCompare(right.id));
}

function updateLabel(project, trackId, labelId, changes = {}) {
	const track = requireLabelTrack(project, trackId);
	const index = track.labels.findIndex((label) => label.id === labelId);
	if (index < 0) throw new ReferenceError(`Unknown label: ${labelId}.`);
	const allowed = new Set(['title', 'startFrame', 'endFrame', 'color', 'opaqueExtensions']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Label field cannot be updated: ${key}.`);
	track.labels[index] = createLabelV2({ ...track.labels[index], ...changes, id: labelId });
	track.labels.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame || left.id.localeCompare(right.id));
}

function removeLabel(project, trackId, labelId) {
	const track = requireLabelTrack(project, trackId);
	const index = track.labels.findIndex((label) => label.id === labelId);
	if (index < 0) throw new ReferenceError(`Unknown label: ${labelId}.`);
	track.labels.splice(index, 1);
}

function updateMaster(project, changes = {}) {
	const keys = Object.keys(changes);
	const allowed = new Set(['gain', 'pan', 'mute', 'solo', 'envelope', 'collapsed', 'effectsActive']);
	if (keys.some((key) => !allowed.has(key))) throw new RangeError('Unsupported master mixer field.');
	const normalized = createAudioMasterV2({ ...project.master, ...changes, effects: project.master.effects });
	for (const key of keys) project.master[key] = normalized[key];
}

function ensureMixer(project) {
	if (!project.mixer) project.mixer = { groups: [], sends: [], routes: {} };
	project.mixer.groups ||= [];
	project.mixer.sends ||= [];
	project.mixer.routes ||= {};
	return project.mixer;
}

function mixerBusCollection(project, type) {
	const mixer = ensureMixer(project);
	if (type === 'group') return mixer.groups;
	if (type === 'send') return mixer.sends;
	throw new RangeError('Mixer bus type must be group or send.');
}

function requireMixerBus(project, type, busId) {
	const bus = mixerBusCollection(project, type).find((candidate) => candidate.id === busId);
	if (!bus) throw new ReferenceError(`Unknown ${type} bus: ${busId}.`);
	return bus;
}

function addMixerBus(project, command) {
	const collection = mixerBusCollection(project, command.busType);
	const bus = createAudioMixerBusV2(command.bus, command.busType, collection.length);
	const allBuses = [...ensureMixer(project).groups, ...ensureMixer(project).sends];
	if (allBuses.some((candidate) => candidate.id === bus.id)) throw new RangeError(`Duplicate mixer bus ID: ${bus.id}.`);
	for (const effect of bus.effects) {
		if (allEffects(project).some((candidate) => candidate.id === effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
	}
	collection.push(bus);
}

function updateMixerBus(project, command) {
	const bus = requireMixerBus(project, command.busType, command.busId);
	const changes = command.changes || {};
	const allowed = new Set(['name', 'color', 'gain', 'pan', 'mute', 'solo', 'envelope', 'collapsed', 'effectsActive']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Mixer bus field cannot be updated: ${key}.`);
	const collection = mixerBusCollection(project, command.busType);
	const normalized = createAudioMixerBusV2({ ...bus, ...changes, effects: bus.effects }, command.busType, collection.indexOf(bus));
	Object.assign(bus, normalized);
}

function removeMixerBus(project, command) {
	const collection = mixerBusCollection(project, command.busType);
	const index = collection.findIndex((candidate) => candidate.id === command.busId);
	if (index < 0) throw new ReferenceError(`Unknown ${command.busType} bus: ${command.busId}.`);
	collection.splice(index, 1);
	for (const route of Object.values(ensureMixer(project).routes)) {
		if (command.busType === 'group' && route.groupId === command.busId) route.groupId = null;
		if (command.busType === 'send' && route.sends) delete route.sends[command.busId];
	}
}

function updateMixerRoute(project, command) {
	const track = requireTrack(project, command.trackId);
	if (track.type !== 'audio') throw new RangeError('Only audio tracks can be routed through the mixer.');
	const mixer = ensureMixer(project);
	const current = mixer.routes[track.id] || { groupId: null, sends: {} };
	const changes = command.changes || {};
	const allowed = new Set(['groupId', 'sends']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Mixer route field cannot be updated: ${key}.`);
	let groupId = Object.hasOwn(changes, 'groupId') ? changes.groupId : current.groupId;
	if (groupId === '') groupId = null;
	if (groupId != null) requireMixerBus(project, 'group', groupId);
	const sends = { ...(current.sends || {}) };
	if (Object.hasOwn(changes, 'sends')) {
		if (!changes.sends || typeof changes.sends !== 'object' || Array.isArray(changes.sends)) throw new TypeError('Mixer route sends must be an object.');
		for (const [sendId, requestedGain] of Object.entries(changes.sends)) {
			requireMixerBus(project, 'send', sendId);
			if (requestedGain == null) delete sends[sendId];
			else {
				const gain = Number(requestedGain);
				if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Mixer send gain must be between 0 and 4.');
				sends[sendId] = gain;
			}
		}
	}
	mixer.routes[track.id] = { groupId, sends };
}

function updateMetadata(project, changes = {}) {
	if (project.schemaVersion < 2) throw new RangeError('Metadata editing requires an AudioEditorProjectV2 or newer project.');
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Metadata changes must be an object.');
	const allowed = new Set(['title', 'artist', 'album', 'trackNumber', 'year', 'comments', 'tags']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Metadata field cannot be updated: ${key}.`);
	const next = { ...project.metadata };
	for (const key of allowed) {
		if (!Object.hasOwn(changes, key)) continue;
		if (key === 'tags') {
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
	if (project.schemaVersion < 2) throw new RangeError('Time-display settings require an AudioEditorProjectV2 or newer project.');
	if (typeof command.format !== 'string' || !command.format.trim()) throw new TypeError('A time-display format is required.');
	project.timeDisplay = { ...project.timeDisplay, format: command.format };
}

function addClip(project, trackId, value) {
	const track = requireTrack(project, trackId);
	if (!Array.isArray(track.clipIds)) throw new RangeError('Media clips can only be added to media tracks.');
	const clip = normalizeClipForProject(project, {
		...value,
		...(project.schemaVersion >= 4 ? { binItemId: null } : {}),
	});
	if (project.schemaVersion >= 4 && track.type !== clip.kind) {
		throw new RangeError(`A ${clip.kind} clip cannot be added to a ${track.type} track.`);
	}
	assertUnusedClipId(project, clip.id);
	assertClipSourceBounds(project, clip);
	assertClipSpace(project, track, clip);
	project.clips.push(clip);
	track.clipIds.push(clip.id);
	sortTrack(project, track);
}

function removeClip(project, clipId) {
	removeClips(project, [clipId]);
}

function removeClips(project, clipIds, rippleMode = 'none') {
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

function updateClip(project, clipId, changes = {}) {
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const allowed = clip.kind === 'video'
		? new Set(['title', 'groupId', 'color'])
		: new Set([
			'gain', 'fadeInFrames', 'fadeOutFrames', 'reversed', 'title', 'envelope',
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

function replaceClipSource(project, clipId, sourceId) {
	if (project.schemaVersion < 2) throw new RangeError('Immutable sample editing requires an AudioEditorProjectV2 or newer project.');
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	if (project.schemaVersion >= 4 && source.kind !== clip.kind) {
		throw new RangeError(`A ${clip.kind} clip cannot reference a ${source.kind} source.`);
	}
	const updated = normalizeClipForProject(project, {
		...clip,
		sourceId: source.id,
		renderCacheRevision: clip.renderCacheRevision + 1,
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
}

function moveClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const updated = normalizeClipForProject(project, {
		...clip,
		timelineStartFrame: command.timelineStartFrame,
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

/**
 * Prepares an atomic transform for selected/grouped clips. When overwrite is
 * enabled, stable IDs are reserved for any inactive clip that is split into
 * multiple surviving segments, including fresh A/V links for matching
 * survivor pairs.
 */
export function prepareTransformClipsCommand(project, transforms, options = {}, idFactory = createStableId) {
	const state = buildClipTransformState(project, transforms);
	const overwrite = Boolean(options.overwrite);
	validateClipTransformState(project, state, overwrite);
	const splitClipIds = {};
	const splitAvLinkIds = {};
	const videoEffectIds = {};
	if (overwrite) {
		const rangesByClipId = overwriteClipRanges(project, state);
		const splitCountsByAvLinkId = new Map();
		for (const clip of project.clips) {
			const ranges = rangesByClipId.get(clip.id);
			const splitCount = Math.max(0, (ranges?.length || 0) - 1);
			if (!splitCount) continue;
			splitClipIds[clip.id] = Array.from({ length: splitCount }, () => idFactory('clip'));
			for (const splitId of splitClipIds[clip.id]) {
				const effectIds = prepareVideoEffectIds(clip, idFactory);
				if (effectIds) videoEffectIds[splitId] = effectIds;
			}
			if (clip.avLinkId) {
				const previousCount = splitCountsByAvLinkId.get(clip.avLinkId);
				if (previousCount != null && previousCount !== splitCount) {
					throw new RangeError(`Linked A/V clips require matching overwrite segments: ${clip.avLinkId}.`);
				}
				splitCountsByAvLinkId.set(clip.avLinkId, splitCount);
			}
		}
		for (const [avLinkId, splitCount] of splitCountsByAvLinkId) {
			splitAvLinkIds[avLinkId] = Array.from({ length: splitCount }, () => idFactory('av-link'));
		}
	}
	return {
		type: 'clip/transform-many',
		transforms: state.map((item) => ({
			clipId: item.clip.id,
			trackId: item.track.id,
			changes: { ...item.changes },
		})),
		overwrite,
		splitClipIds,
		splitAvLinkIds,
		videoEffectIds,
	};
}

function transformClips(project, command) {
	const state = buildClipTransformState(project, command.transforms);
	const overwrite = Boolean(command.overwrite);
	validateClipTransformState(project, state, overwrite);
	const movingIds = new Set(state.map((item) => item.clip.id));
	const replacementsById = new Map();
	const reservedIds = new Set();

	if (overwrite) {
		const rangesByClipId = overwriteClipRanges(project, state);
		const splitCountsByAvLinkId = new Map();
		for (const clip of project.clips) {
			const ranges = rangesByClipId.get(clip.id);
			if (!ranges) continue;
			const splitIds = command.splitClipIds?.[clip.id] || [];
			const splitCount = Math.max(0, ranges.length - 1);
			if (!Array.isArray(splitIds) || splitIds.length !== splitCount) {
				throw new TypeError(`Stable split clip IDs are required for ${clip.id}.`);
			}
			for (const splitId of splitIds) {
				const stableId = requireStableCommandId(splitId, 'split clip');
				reserveReplacementClipId(project, stableId, reservedIds);
			}
			if (clip.avLinkId && splitCount) {
				const previousCount = splitCountsByAvLinkId.get(clip.avLinkId);
				if (previousCount != null && previousCount !== splitCount) {
					throw new RangeError(`Linked A/V clips require matching overwrite segments: ${clip.avLinkId}.`);
				}
				splitCountsByAvLinkId.set(clip.avLinkId, splitCount);
			}
		}
		const existingAvLinkIds = new Set(project.clips.map((clip) => clip.avLinkId).filter(Boolean));
		const reservedAvLinkIds = new Set();
		for (const [avLinkId, splitCount] of splitCountsByAvLinkId) {
			const splitIds = command.splitAvLinkIds?.[avLinkId] || [];
			if (!Array.isArray(splitIds) || splitIds.length !== splitCount) {
				throw new TypeError(`Stable split A/V link IDs are required for ${avLinkId}.`);
			}
			for (const splitId of splitIds) {
				const stableId = requireStableCommandId(splitId, 'split A/V link');
				if (existingAvLinkIds.has(stableId) || reservedAvLinkIds.has(stableId)) {
					throw new RangeError(`Duplicate A/V link ID: ${stableId}.`);
				}
				reservedAvLinkIds.add(stableId);
			}
		}
		for (const clip of project.clips) {
			const ranges = rangesByClipId.get(clip.id);
			if (!ranges) continue;
			const ids = [clip.id, ...(command.splitClipIds?.[clip.id] || [])];
			replacementsById.set(clip.id, ranges.map(([startFrame, endFrame], index) => {
				let segment = segmentOfClip(
					clip,
					startFrame,
					endFrame,
					startFrame,
					ids[index],
					command.videoEffectIds?.[ids[index]],
				);
				if (clip.avLinkId && index > 0) {
					segment = normalizeClipForProject(project, {
						...segment,
						avLinkId: command.splitAvLinkIds[clip.avLinkId][index - 1],
						id: segment.id,
					});
				}
				return segment;
			}));
		}
	}

	const updatedById = new Map(state.map((item) => [item.clip.id, item.updated]));
	project.clips = project.clips.flatMap((clip) => {
		if (updatedById.has(clip.id)) return [updatedById.get(clip.id)];
		if (replacementsById.has(clip.id)) return replacementsById.get(clip.id);
		return [clip];
	});

	for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
		const clips = track.clipIds
			.filter((clipId) => !movingIds.has(clipId))
			.flatMap((clipId) => replacementsById.has(clipId)
				? replacementsById.get(clipId)
				: [requireClip(project, clipId)])
			.concat(state.filter((item) => item.track.id === track.id).map((item) => item.updated))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
		track.clipIds = clips.map((clip) => clip.id);
	}
}

function buildClipTransformState(project, transforms) {
	if (!Array.isArray(transforms) || !transforms.length) throw new TypeError('Clip transforms must be a non-empty array.');
	const ids = normalizeCommandIds(transforms.map((transform) => transform?.clipId), 'transforms.clipIds');
	const allowed = new Set([
		'timelineStartFrame', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames',
		'trimStartFrames', 'trimEndFrames', 'fadeInFrames', 'fadeOutFrames',
		'envelope', 'pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo',
		'renderCacheRevision',
	]);
	return transforms.map((transform, index) => {
		const clip = requireClip(project, ids[index]);
		const oldTrack = requireClipTrack(project, clip.id);
		const track = requireTrack(project, transform.trackId || oldTrack.id);
		if (!Array.isArray(track.clipIds)) throw new RangeError(`Media clips cannot be transformed onto track ${track.id}.`);
		if (project.schemaVersion >= 4 && track.type !== clip.kind) {
			throw new RangeError(`A ${clip.kind} clip cannot be transformed onto a ${track.type} track.`);
		}
		const changes = transform.changes || {};
		if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Clip transform changes must be an object.');
		for (const key of Object.keys(changes)) {
			if (!allowed.has(key)) throw new RangeError(`Clip field cannot be transformed: ${key}.`);
		}
		const durationFrames = changes.durationFrames ?? clip.durationFrames;
		const timelineStartFrame = changes.timelineStartFrame ?? clip.timelineStartFrame;
		const updated = normalizeClipForProject(project, {
			...clip,
			...changes,
			...(Object.hasOwn(changes, 'preserveFormants') ? {
				opaqueExtensions: withoutImportedPitchPreset(clip.opaqueExtensions),
			} : {}),
			...(!Object.hasOwn(changes, 'envelope') && durationFrames !== clip.durationFrames ? {
				envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
			} : {}),
			id: clip.id,
		});
		assertClipSourceBounds(project, updated);
		return { clip, oldTrack, track, updated, changes: { ...changes } };
	});
}

function withoutImportedPitchPreset(opaqueExtensions) {
	const output = { ...(opaqueExtensions || {}) };
	delete output.aup4PitchAndSpeedPreset;
	return output;
}

function validateClipTransformState(project, state, overwrite) {
	if (project.schemaVersion >= 2) return;
	const movingIds = new Set(state.map((item) => item.clip.id));
	for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
		const activeClips = state.filter((item) => item.track.id === track.id).map((item) => item.updated);
		assertNonOverlappingClips(track.id, activeClips);
		if (overwrite) continue;
		const inactiveClips = track.clipIds
			.filter((clipId) => !movingIds.has(clipId))
			.map((clipId) => requireClip(project, clipId));
		assertNonOverlappingClips(track.id, [...inactiveClips, ...activeClips]);
	}
}

function assertNonOverlappingClips(trackId, clips) {
	const ordered = [...clips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
	for (let index = 1; index < ordered.length; index += 1) {
		if (clipsOverlap(ordered[index - 1], ordered[index])) {
			throw new RangeError(`Clip overlaps existing material on track ${trackId}.`);
		}
	}
}

function remainingClipRanges(clip, activeClips) {
	let ranges = [[clip.timelineStartFrame, clipEndFrame(clip)]];
	for (const activeClip of [...activeClips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)) {
		const activeStart = activeClip.timelineStartFrame;
		const activeEnd = clipEndFrame(activeClip);
		ranges = ranges.flatMap(([startFrame, endFrame]) => {
			if (activeEnd <= startFrame || activeStart >= endFrame) return [[startFrame, endFrame]];
			const result = [];
			if (startFrame < activeStart) result.push([startFrame, activeStart]);
			if (endFrame > activeEnd) result.push([activeEnd, endFrame]);
			return result;
		});
		if (!ranges.length) break;
	}
	return ranges;
}

function overwriteClipRanges(project, state) {
	const tracks = project.tracks.filter((track) => Array.isArray(track.clipIds));
	const movingIds = new Set(state.map((item) => item.clip.id));
	const trackIdByClipId = new Map();
	for (const track of tracks) {
		for (const clipId of track.clipIds) trackIdByClipId.set(clipId, track.id);
	}
	const clipsByAvLinkId = new Map();
	for (const clip of project.clips) {
		if (!clip.avLinkId) continue;
		const linked = clipsByAvLinkId.get(clip.avLinkId) || [];
		linked.push(clip);
		clipsByAvLinkId.set(clip.avLinkId, linked);
	}
	const cutsByTrackId = new Map();
	for (const item of state) appendOverwriteCut(cutsByTrackId, item.track.id, item.updated);

	let changed = true;
	while (changed) {
		changed = false;
		for (const track of tracks) {
			const cuts = cutsByTrackId.get(track.id);
			if (!cuts?.length) continue;
			for (const clipId of track.clipIds) {
				if (movingIds.has(clipId)) continue;
				const clip = requireClip(project, clipId);
				if (!clip.avLinkId) continue;
				const overlappingCuts = cuts.filter((cut) => clipsOverlap(clip, cut));
				if (!overlappingCuts.length) continue;
				for (const linkedClip of clipsByAvLinkId.get(clip.avLinkId) || []) {
					if (linkedClip.id === clip.id || movingIds.has(linkedClip.id)) continue;
					const linkedTrackId = trackIdByClipId.get(linkedClip.id);
					if (!linkedTrackId) continue;
					for (const cut of overlappingCuts) {
						if (appendOverwriteCut(cutsByTrackId, linkedTrackId, cut)) changed = true;
					}
				}
			}
		}
	}

	const rangesByClipId = new Map();
	for (const track of tracks) {
		const cuts = cutsByTrackId.get(track.id);
		if (!cuts?.length) continue;
		for (const clipId of track.clipIds) {
			if (movingIds.has(clipId)) continue;
			const clip = requireClip(project, clipId);
			const ranges = remainingClipRanges(clip, cuts);
			if (
				ranges.length === 1
				&& ranges[0][0] === clip.timelineStartFrame
				&& ranges[0][1] === clipEndFrame(clip)
			) continue;
			rangesByClipId.set(clip.id, ranges);
		}
	}
	return rangesByClipId;
}

function appendOverwriteCut(cutsByTrackId, trackId, clip) {
	const startFrame = clip.timelineStartFrame;
	const endFrame = clipEndFrame(clip);
	const cuts = cutsByTrackId.get(trackId) || [];
	if (cuts.some((cut) => (
		cut.timelineStartFrame === startFrame
		&& clipEndFrame(cut) === endFrame
	))) return false;
	cuts.push({ timelineStartFrame: startFrame, durationFrames: endFrame - startFrame });
	cuts.sort((left, right) => (
		left.timelineStartFrame - right.timelineStartFrame
		|| clipEndFrame(left) - clipEndFrame(right)
	));
	cutsByTrackId.set(trackId, cuts);
	return true;
}

function overwriteClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const requestedChanges = command.changes || {};
	const timelineStartFrame = requestedChanges.timelineStartFrame ?? clip.timelineStartFrame;
	const durationFrames = requestedChanges.durationFrames ?? clip.durationFrames;
	const updated = normalizeClipForProject(project, {
		...clip,
		...requestedChanges,
		...(!Object.hasOwn(requestedChanges, 'envelope') && durationFrames !== clip.durationFrames ? {
			envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
		} : {}),
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);

	const replacements = [];
	const removedIds = new Set();
	for (const clipId of targetTrack.clipIds) {
		if (clipId === clip.id) continue;
		const inactiveClip = requireClip(project, clipId);
		if (!clipsOverlap(inactiveClip, updated)) {
			replacements.push(inactiveClip);
			continue;
		}
		removedIds.add(inactiveClip.id);
		const inactiveStart = inactiveClip.timelineStartFrame;
		const inactiveEnd = clipEndFrame(inactiveClip);
		const activeStart = updated.timelineStartFrame;
		const activeEnd = clipEndFrame(updated);
		const hasLeadingSegment = inactiveStart < activeStart;
		const hasTrailingSegment = inactiveEnd > activeEnd;
		if (hasLeadingSegment) {
			replacements.push(segmentOfClip(inactiveClip, inactiveStart, activeStart, inactiveStart, inactiveClip.id));
		}
		if (hasTrailingSegment) {
			const id = hasLeadingSegment ? command.splitClipIds?.[inactiveClip.id] : inactiveClip.id;
			if (!id) throw new TypeError(`A stable split clip ID is required for ${inactiveClip.id}.`);
			if (hasLeadingSegment) assertUnusedClipId(project, id);
			replacements.push(segmentOfClip(
				inactiveClip,
				activeEnd,
				inactiveEnd,
				activeEnd,
				id,
				command.videoEffectIds?.[id],
			));
		}
	}

	project.clips = project.clips.filter((item) => item.id !== updated.id && !removedIds.has(item.id));
	project.clips.push(updated, ...replacements);
	if (targetTrack.id !== oldTrack.id) {
		oldTrack.clipIds = oldTrack.clipIds.filter((clipId) => clipId !== clip.id);
	}
	targetTrack.clipIds = [...replacements.map((item) => item.id), updated.id];
	sortTrack(project, oldTrack);
	sortTrack(project, targetTrack);
}

export function prepareOverwriteClipCommand(project, clipId, options = {}, idFactory = createStableId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip ${clipId}.`);
	const targetTrack = findTrack(project, options.trackId) || findClipTrack(project, clipId);
	if (!targetTrack) throw new ReferenceError(`Unknown target track for clip ${clipId}.`);
	const candidate = normalizeClipForProject(project, { ...clip, ...(options.changes || {}), id: clip.id });
	const splitClipIds = {};
	const videoEffectIds = {};
	for (const targetClipId of targetTrack.clipIds) {
		if (targetClipId === clip.id) continue;
		const inactiveClip = requireClip(project, targetClipId);
		if (
			clipsOverlap(inactiveClip, candidate)
			&& inactiveClip.timelineStartFrame < candidate.timelineStartFrame
			&& clipEndFrame(inactiveClip) > clipEndFrame(candidate)
		) {
			splitClipIds[inactiveClip.id] = idFactory('clip');
			const effectIds = prepareVideoEffectIds(inactiveClip, idFactory);
			if (effectIds) videoEffectIds[splitClipIds[inactiveClip.id]] = effectIds;
		}
	}
	return {
		type: 'clip/overwrite',
		clipId,
		trackId: targetTrack.id,
		changes: { ...(options.changes || {}) },
		splitClipIds,
		videoEffectIds,
	};
}

function trimClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const track = requireClipTrack(project, clip.id);
	const timelineStartFrame = command.timelineStartFrame ?? clip.timelineStartFrame;
	const durationFrames = command.durationFrames ?? clip.durationFrames;
	const sourceDurationFrames = command.sourceDurationFrames ?? Math.max(
		1,
		Math.round((clip.sourceDurationFrames ?? clip.durationFrames) * durationFrames / clip.durationFrames),
	);
	const updated = normalizeClipForProject(project, {
		...clip,
		timelineStartFrame,
		sourceStartFrame: command.sourceStartFrame ?? clip.sourceStartFrame,
		sourceDurationFrames,
		durationFrames,
		trimStartFrames: command.trimStartFrames ?? clip.trimStartFrames,
		trimEndFrames: command.trimEndFrames ?? clip.trimEndFrames,
		envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
		fadeInFrames: command.fadeInFrames ?? Math.min(clip.fadeInFrames, command.durationFrames ?? clip.durationFrames),
		fadeOutFrames: command.fadeOutFrames ?? Math.min(clip.fadeOutFrames, command.durationFrames ?? clip.durationFrames),
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
	sortTrack(project, track);
}

function splitClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const atFrame = assertFrame(command.atFrame, 'split.atFrame');
	if (atFrame <= clip.timelineStartFrame || atFrame >= clipEndFrame(clip)) {
		throw new RangeError('A split must be inside the clip.');
	}
	if (!command.rightClipId) throw new TypeError('A stable rightClipId is required for a replayable split.');
	assertUnusedClipId(project, command.rightClipId);
	if (!clip.avLinkId) {
		splitSingleClip(project, clip, atFrame, command.rightClipId, null, command.rightVideoEffectIds);
		return;
	}
	const linkedClip = project.clips.find((candidate) => (
		candidate.id !== clip.id && candidate.avLinkId === clip.avLinkId
	));
	if (!linkedClip) throw new RangeError(`A/V link ${clip.avLinkId} is incomplete.`);
	if (
		linkedClip.timelineStartFrame !== clip.timelineStartFrame
		|| linkedClip.durationFrames !== clip.durationFrames
	) {
		throw new RangeError(`A/V link ${clip.avLinkId} is not aligned.`);
	}
	const linkedRightClipId = requireStableCommandId(command.linkedRightClipId, 'linked right clip');
	const rightAvLinkId = requireStableCommandId(command.rightAvLinkId, 'right A/V link');
	assertUnusedClipId(project, linkedRightClipId);
	if (linkedRightClipId === command.rightClipId) throw new RangeError('Split clip IDs must be unique.');
	splitSingleClip(project, clip, atFrame, command.rightClipId, rightAvLinkId, command.rightVideoEffectIds);
	splitSingleClip(project, linkedClip, atFrame, linkedRightClipId, rightAvLinkId, command.linkedRightVideoEffectIds);
}

export function prepareSplitCommand(clipId, atFrame, idFactory = createStableId, videoEffects = []) {
	return {
		type: 'clip/split',
		clipId,
		atFrame,
		rightClipId: idFactory('clip'),
		...(videoEffects.length ? {
			rightVideoEffectIds: videoEffects.map(() => idFactory('video-effect')),
		} : {}),
	};
}

export function prepareLinkedSplitCommand(project, clipId, atFrame, idFactory = createStableId) {
	const clip = requireClip(project, clipId);
	if (!clip.avLinkId) return prepareSplitCommand(clipId, atFrame, idFactory, clip.videoEffects || []);
	const linkedClip = project.clips.find((candidate) => (
		candidate.id !== clip.id && candidate.avLinkId === clip.avLinkId
	));
	if (!linkedClip) throw new RangeError(`A/V link ${clip.avLinkId} is incomplete.`);
	return {
		type: 'clip/split',
		clipId,
		atFrame,
		rightClipId: idFactory('clip'),
		linkedRightClipId: idFactory('clip'),
		rightAvLinkId: idFactory('av-link'),
		...(clip.videoEffects?.length ? {
			rightVideoEffectIds: clip.videoEffects.map(() => idFactory('video-effect')),
		} : {}),
		...(linkedClip.videoEffects?.length ? {
			linkedRightVideoEffectIds: linkedClip.videoEffects.map(() => idFactory('video-effect')),
		} : {}),
	};
}

function splitSingleClip(project, clip, atFrame, rightClipId, rightAvLinkId = null, rightVideoEffectIds = undefined) {
	const track = requireClipTrack(project, clip.id);
	const left = segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id);
	const right = segmentOfClip(
		clip,
		atFrame,
		clipEndFrame(clip),
		atFrame,
		rightClipId,
		rightVideoEffectIds,
	);
	if (rightAvLinkId) right.avLinkId = rightAvLinkId;
	replaceClip(project, left);
	project.clips.push(right);
	const index = track.clipIds.indexOf(clip.id);
	track.clipIds.splice(index + 1, 0, right.id);
	sortTrack(project, track);
}

function linkAvClips(project, command) {
	if (project.schemaVersion < 4) throw new RangeError('A/V links require an AudioEditorProjectV4 project.');
	const video = requireClip(project, command.videoClipId);
	const audio = requireClip(project, command.audioClipId);
	if (video.kind !== 'video' || audio.kind !== 'audio') {
		throw new RangeError('An A/V link requires one video clip and one audio clip.');
	}
	if (video.avLinkId || audio.avLinkId) throw new RangeError('A clip must be unlinked before it can be relinked.');
	if (
		video.timelineStartFrame !== audio.timelineStartFrame
		|| video.durationFrames !== audio.durationFrames
	) {
		throw new RangeError('A/V clips must have aligned timeline ranges.');
	}
	const videoTrack = requireClipTrack(project, video.id);
	const audioTrack = requireClipTrack(project, audio.id);
	if (!videoTrack.laneGroupId || videoTrack.laneGroupId !== audioTrack.laneGroupId) {
		throw new RangeError('A/V clips must belong to the same media lane group.');
	}
	const avLinkId = requireStableCommandId(command.avLinkId, 'A/V link');
	for (const candidate of project.clips) {
		if (candidate.avLinkId === avLinkId) throw new RangeError(`Duplicate A/V link ID: ${avLinkId}.`);
	}
	replaceClip(project, normalizeClipForProject(project, { ...video, avLinkId, id: video.id }));
	replaceClip(project, normalizeClipForProject(project, { ...audio, avLinkId, id: audio.id }));
}

function unlinkAvClips(project, command) {
	if (project.schemaVersion < 4) throw new RangeError('A/V links require an AudioEditorProjectV4 project.');
	const requestedClip = command.clipId ? requireClip(project, command.clipId) : null;
	const avLinkId = command.avLinkId || requestedClip?.avLinkId;
	if (!avLinkId) return;
	const linked = project.clips.filter((clip) => clip.avLinkId === avLinkId);
	if (!linked.length) throw new ReferenceError(`Unknown A/V link: ${avLinkId}.`);
	for (const clip of linked) {
		replaceClip(project, normalizeClipForProject(project, { ...clip, avLinkId: null, id: clip.id }));
	}
}

export function prepareLinkAvCommand(videoClipId, audioClipId, idFactory = createStableId) {
	return {
		type: 'clip/link-av',
		videoClipId: requireStableCommandId(videoClipId, 'video clip'),
		audioClipId: requireStableCommandId(audioClipId, 'audio clip'),
		avLinkId: idFactory('av-link'),
	};
}

export function prepareUnlinkAvCommand(clipId) {
	return { type: 'clip/unlink-av', clipId: requireStableCommandId(clipId, 'clip') };
}

export function prepareGroupClipsCommand(clipIds, idFactory = createStableId) {
	const normalizedIds = normalizeCommandIds(clipIds, 'clipIds');
	return { type: 'clip/group', clipIds: normalizedIds, groupId: idFactory('clip-group') };
}

function groupClips(project, clipIds, groupId) {
	if (project.schemaVersion < 2) throw new RangeError('Clip grouping requires an AudioEditorProjectV2 or newer project.');
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	if (ids.length < 2) throw new RangeError('At least two clips are required to create a group.');
	const stableGroupId = requireStableCommandId(groupId, 'clip group');
	for (const clipId of ids) {
		const clip = requireClip(project, clipId);
		replaceClip(project, normalizeClipForProject(project, { ...clip, groupId: stableGroupId, id: clip.id }));
	}
}

function ungroupClips(project, clipIds) {
	if (project.schemaVersion < 2) throw new RangeError('Clip grouping requires an AudioEditorProjectV2 or newer project.');
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	for (const clipId of ids) {
		const clip = requireClip(project, clipId);
		replaceClip(project, normalizeClipForProject(project, { ...clip, groupId: null, id: clip.id }));
	}
}

function joinClips(project, clipIds) {
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	if (ids.length < 2) throw new RangeError('At least two clips are required to join.');
	const clips = ids.map((clipId) => requireClip(project, clipId))
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
	const clipsByTrack = new Map();
	for (const clip of clips) {
		const track = requireClipTrack(project, clip.id);
		const trackClips = clipsByTrack.get(track.id) || [];
		trackClips.push(clip.id);
		clipsByTrack.set(track.id, trackClips);
	}
	if (clipsByTrack.size > 1) {
		if (project.schemaVersion < 4 || clipsByTrack.size !== 2 || clips.some((clip) => !clip.avLinkId)) {
			throw new RangeError('Joined clips must belong to the same track.');
		}
		const selectedIds = new Set(ids);
		for (const clip of clips) {
			const linked = project.clips.filter((candidate) => candidate.avLinkId === clip.avLinkId);
			if (linked.length !== 2 || linked.some((candidate) => !selectedIds.has(candidate.id))) {
				throw new RangeError('Linked A/V clips must be joined together.');
			}
		}
		const tracks = project.tracks.filter((track) => clipsByTrack.has(track.id));
		if (
			tracks.length !== 2
			|| tracks[0].type !== 'video'
			|| tracks[1].type !== 'audio'
			|| !tracks[0].laneGroupId
			|| tracks[0].laneGroupId !== tracks[1].laneGroupId
		) {
			throw new RangeError('Joined A/V clips must belong to one media lane group.');
		}
		const linkOrder = tracks.map((track) => clipsByTrack.get(track.id)
			.map((clipId) => requireClip(project, clipId))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)
			.map((clip) => clip.avLinkId));
		if (
			linkOrder[0].length !== linkOrder[1].length
			|| linkOrder[0].some((avLinkId, index) => avLinkId !== linkOrder[1][index])
		) {
			throw new RangeError('Joined A/V clips must have matching linked segments.');
		}
		for (const track of tracks) joinClips(project, clipsByTrack.get(track.id));
		return;
	}
	const track = requireClipTrack(project, clips[0].id);
	for (let index = 1; index < clips.length; index += 1) {
		const previous = clips[index - 1];
		const current = clips[index];
		if (clipEndFrame(previous) !== current.timelineStartFrame) {
			throw new RangeError('Only adjacent clips can be joined without rendering.');
		}
		if (!clipsHaveContiguousSource(previous, current)) {
			throw new RangeError('Clips with different processing or source regions must be rendered before joining.');
		}
	}
	const first = clips[0];
	const last = clips.at(-1);
	const joinedDurationFrames = clipEndFrame(last) - first.timelineStartFrame;
	const joinedSourceDurationFrames = clips.reduce((sum, clip) => sum + (clip.sourceDurationFrames ?? clip.durationFrames), 0);
	const joined = normalizeClipForProject(project, {
		...first,
		durationFrames: joinedDurationFrames,
		sourceDurationFrames: joinedSourceDurationFrames,
		trimEndFrames: last.trimEndFrames,
		fadeOutFrames: last.fadeOutFrames,
		envelope: joinClipEnvelopes(clips),
		id: first.id,
	});
	const removedIds = new Set(clips.slice(1).map((clip) => clip.id));
	project.clips = project.clips
		.filter((clip) => !removedIds.has(clip.id))
		.map((clip) => clip.id === joined.id ? joined : clip);
	track.clipIds = track.clipIds.filter((clipId) => !removedIds.has(clipId));
	sortTrack(project, track);
}

function clipsHaveContiguousSource(left, right) {
	if (
		left.sourceId !== right.sourceId
		|| left.reversed !== right.reversed
		|| left.gain !== right.gain
		|| (left.pitchCents ?? 0) !== (right.pitchCents ?? 0)
		|| (left.speedRatio ?? 1) !== (right.speedRatio ?? 1)
		|| Boolean(left.preserveFormants) !== Boolean(right.preserveFormants)
		|| Boolean(left.stretchToTempo) !== Boolean(right.stretchToTempo)
		|| !videoEffectStacksEquivalent(left.videoEffects, right.videoEffects)
	) return false;
	const leftDuration = left.sourceDurationFrames ?? left.durationFrames;
	const rightDuration = right.sourceDurationFrames ?? right.durationFrames;
	return left.reversed
		? right.sourceStartFrame + rightDuration === left.sourceStartFrame
		: left.sourceStartFrame + leftDuration === right.sourceStartFrame;
}

function videoEffectStacksEquivalent(left, right) {
	const leftStack = Array.isArray(left) ? left : [];
	const rightStack = Array.isArray(right) ? right : [];
	if (leftStack.length !== rightStack.length) return false;
	return leftStack.every((effect, index) => {
		const candidate = rightStack[index];
		return Boolean(candidate)
			&& effect.type === candidate.type
			&& effect.enabled === candidate.enabled
			&& JSON.stringify(effect.params) === JSON.stringify(candidate.params);
	});
}

function joinClipEnvelopes(clips) {
	const result = [];
	let offset = 0;
	for (const clip of clips) {
		for (const point of clip.envelope || []) {
			const frame = offset + point.frame;
			const previous = result.at(-1);
			if (previous?.frame === frame) result[result.length - 1] = { ...point, frame };
			else result.push({ ...point, frame });
		}
		offset += clip.durationFrames;
	}
	return result;
}

function deleteRange(project, command, rippleMode) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'delete range');
	const trackIds = command.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const affectedClipIds = Array.isArray(command.clipIds) ? new Set(command.clipIds) : null;
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		processTrackRange(
			project,
			track,
			range,
			rippleMode,
			command.splitClipIds || {},
			command.splitAvLinkIds || {},
			command.videoEffectIds || {},
			affectedClipIds,
		);
	}
}

function processTrackRange(
	project,
	track,
	range,
	rippleMode,
	splitClipIds,
	splitAvLinkIds = {},
	videoEffectIds = {},
	affectedClipIds = null,
) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const replacements = [];
	const deletedIds = new Set(track.clipIds);
	for (const clip of originals) {
		if (affectedClipIds && !affectedClipIds.has(clip.id)) {
			replacements.push(clip);
			continue;
		}
		const start = clip.timelineStartFrame;
		const end = clipEndFrame(clip);
		if (end <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (start >= range.endFrame) {
			replacements.push({
				...clip,
				timelineStartFrame: rippleMode === 'track' ? start - range.durationFrames : start,
			});
			continue;
		}

		const hasLeft = start < range.startFrame;
		const hasRight = end > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(clip, start, range.startFrame, start, clip.id));
		if (hasRight) {
			const rightId = hasLeft ? splitClipIds[clip.id] : clip.id;
			if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
			if (hasLeft) assertUnusedClipId(project, rightId);
			const timelineStartFrame = rippleMode === 'track'
				? range.startFrame
				: rippleMode === 'clip'
					? Math.max(start, range.startFrame)
					: range.endFrame;
			let right = segmentOfClip(
				clip,
				range.endFrame,
				end,
				timelineStartFrame,
				rightId,
				videoEffectIds[rightId],
			);
			if (hasLeft && clip.avLinkId) {
				const rightAvLinkId = splitAvLinkIds[clip.avLinkId];
				if (!rightAvLinkId) throw new TypeError(`A stable split A/V link ID is required for ${clip.avLinkId}.`);
				right = normalizeClipForProject(project, { ...right, avLinkId: rightAvLinkId, id: right.id });
			}
			replacements.push(right);
		}
	}

	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame)
		.map((clip) => clip.id);
}

function keepRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'kept range');
	const trackIds = command.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const affectedClipIds = Array.isArray(command.clipIds) ? new Set(command.clipIds) : null;
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
		const deletedIds = new Set(track.clipIds);
		const replacements = [];
		for (const clip of originals) {
			if (affectedClipIds && !affectedClipIds.has(clip.id)) {
				replacements.push(clip);
				continue;
			}
			const start = Math.max(range.startFrame, clip.timelineStartFrame);
			const end = Math.min(range.endFrame, clipEndFrame(clip));
			if (end <= start) continue;
			replacements.push(segmentOfClip(clip, start, end, start, clip.id));
		}
		project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
		project.clips.push(...replacements);
		track.clipIds = replacements
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
			.map((clip) => clip.id);
	}
}

export function prepareRangeDeleteCommand(project, options = {}, idFactory = createStableId) {
	const rippleMode = options.rippleMode || (options.ripple ? 'track' : 'none');
	if (!['none', 'clip', 'track'].includes(rippleMode)) throw new RangeError(`Unsupported ripple mode: ${rippleMode}.`);
	const type = rippleMode === 'clip'
		? 'range/per-clip-ripple-delete'
		: rippleMode === 'track'
			? 'range/ripple-delete'
			: 'range/lift-delete';
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'delete range');
	const requestedTrackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const { trackIds, clipIds } = collectLinkedRangeTargets(project, requestedTrackIds, {
		expandTracks: rippleMode === 'track',
	});
	const clipIdSet = new Set(clipIds);
	const splitClipIds = {};
	const splitAvLinkIds = {};
	const videoEffectIds = {};
	for (const trackId of trackIds) {
		for (const clipId of requireTrack(project, trackId).clipIds) {
			if (!clipIdSet.has(clipId)) continue;
			const clip = requireClip(project, clipId);
			if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
				splitClipIds[clip.id] = idFactory('clip');
				const effectIds = prepareVideoEffectIds(clip, idFactory);
				if (effectIds) videoEffectIds[splitClipIds[clip.id]] = effectIds;
				if (clip.avLinkId && !splitAvLinkIds[clip.avLinkId]) {
					splitAvLinkIds[clip.avLinkId] = idFactory('av-link');
				}
			}
		}
	}
	return { type, trackIds, clipIds, ...range, splitClipIds, splitAvLinkIds, videoEffectIds };
}

export function prepareKeepRangeCommand(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'kept range');
	const requestedTrackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const { trackIds, clipIds } = collectLinkedRangeTargets(project, requestedTrackIds);
	return { type: 'range/keep', trackIds, clipIds, ...range };
}

function collectLinkedRangeTargets(project, requestedTrackIds, options = {}) {
	const tracks = requestedTrackIds.map((trackId) => {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) throw new RangeError(`Track ${track.id} does not contain media clips.`);
		return track;
	});
	if (options.expandTracks) return collectLinkedTrackRippleTargets(project, tracks.map((track) => track.id));
	const clipIds = collectAvLinkedClipIds(project, tracks.flatMap((track) => track.clipIds));
	const clipIdSet = new Set(clipIds);
	return {
		trackIds: project.tracks
			.filter((track) => Array.isArray(track.clipIds) && track.clipIds.some((clipId) => clipIdSet.has(clipId)))
			.map((track) => track.id),
		clipIds,
	};
}

function collectLinkedTrackRippleTargets(project, requestedTrackIds) {
	const trackIdSet = new Set(requestedTrackIds);
	const clipIdSet = new Set();
	let previousTrackCount = -1;
	while (trackIdSet.size !== previousTrackCount) {
		previousTrackCount = trackIdSet.size;
		for (const track of project.tracks) {
			if (!trackIdSet.has(track.id)) continue;
			if (!Array.isArray(track.clipIds)) throw new RangeError(`Track ${track.id} does not contain media clips.`);
			for (const clipId of track.clipIds) clipIdSet.add(clipId);
		}
		for (const clipId of collectAvLinkedClipIds(project, [...clipIdSet])) {
			clipIdSet.add(clipId);
			trackIdSet.add(requireClipTrack(project, clipId).id);
		}
	}
	return {
		trackIds: project.tracks
			.filter((track) => trackIdSet.has(track.id) && Array.isArray(track.clipIds))
			.map((track) => track.id),
		clipIds: project.clips.filter((clip) => clipIdSet.has(clip.id)).map((clip) => clip.id),
	};
}

function collectAvLinkedClipIds(project, clipIds) {
	const ids = new Set((Array.isArray(clipIds) ? clipIds : [clipIds])
		.filter((clipId) => findClip(project, clipId)));
	const avLinkIds = new Set([...ids]
		.map((clipId) => findClip(project, clipId)?.avLinkId)
		.filter(Boolean));
	for (const clip of project.clips) {
		if (clip.avLinkId && avLinkIds.has(clip.avLinkId)) ids.add(clip.id);
	}
	return project.clips.filter((clip) => ids.has(clip.id)).map((clip) => clip.id);
}

/** @returns {AudioEditorClipboardV2} */
export function createClipboardDescriptor(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'clipboard range');
	const requestedTrackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const requestedTracks = requestedTrackIds.map((trackId) => requireTrack(project, trackId));
	const baseClipIds = options.clipIds
		? collectRelatedClipIds(project, options.clipIds)
		: requestedTracks.flatMap((track) => track.clipIds.filter((clipId) => {
			const clip = requireClip(project, clipId);
			return clip.timelineStartFrame < range.endFrame && clipEndFrame(clip) > range.startFrame;
		}));
	const includedClipIds = new Set(collectAvLinkedClipIds(project, baseClipIds));
	const trackIdSet = new Set(requestedTrackIds);
	for (const clipId of includedClipIds) trackIdSet.add(requireClipTrack(project, clipId).id);
	const trackIds = project.tracks
		.filter((track) => trackIdSet.has(track.id) && Array.isArray(track.clipIds))
		.map((track) => track.id);
	const pairedLaneGroupIds = new Set();
	const laneGroups = new Map();
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!track.laneGroupId) continue;
		const tracks = laneGroups.get(track.laneGroupId) || [];
		tracks.push(track);
		laneGroups.set(track.laneGroupId, tracks);
	}
	for (const [laneGroupId, tracks] of laneGroups) {
		if (
			tracks.length === 2
			&& tracks[0].type === 'video'
			&& tracks[1].type === 'audio'
		) pairedLaneGroupIds.add(laneGroupId);
	}
	return {
		schemaVersion: 2,
		sampleRate: project.sampleRate,
		durationFrames: range.durationFrames,
		tracks: trackIds.map((trackId) => {
			const track = requireTrack(project, trackId);
			const clips = track.clipIds.flatMap((clipId) => {
				if (!includedClipIds.has(clipId)) return [];
				const clip = requireClip(project, clipId);
				const startFrame = Math.max(range.startFrame, clip.timelineStartFrame);
				const endFrame = Math.min(range.endFrame, clipEndFrame(clip));
				if (endFrame <= startFrame) return [];
				const segment = segmentOfClip(clip, startFrame, endFrame, startFrame - range.startFrame, clip.id);
				return [{
					key: `${clip.id}:${startFrame}:${endFrame}`,
					kind: segment.kind || 'audio',
					sourceId: segment.sourceId,
					offsetFrame: segment.timelineStartFrame,
					sourceStartFrame: segment.sourceStartFrame,
					durationFrames: segment.durationFrames,
					gain: segment.gain,
					fadeInFrames: segment.fadeInFrames,
					fadeOutFrames: segment.fadeOutFrames,
					reversed: segment.reversed,
					title: segment.title,
					sourceDurationFrames: segment.sourceDurationFrames,
					trimStartFrames: segment.trimStartFrames,
					trimEndFrames: segment.trimEndFrames,
					envelope: segment.envelope,
					groupId: segment.groupId,
					avLinkId: segment.avLinkId || null,
					color: segment.color,
					pitchCents: segment.pitchCents,
					speedRatio: segment.speedRatio,
					preserveFormants: segment.preserveFormants,
					stretchToTempo: segment.stretchToTempo,
					renderCacheRevision: segment.renderCacheRevision,
					...(segment.kind === 'video' && Array.isArray(segment.videoEffects) ? {
						videoEffects: cloneVideoEffects(segment.videoEffects),
					} : {}),
				}];
			});
			return {
				sourceTrackId: track.id,
				sourceTrackName: track.name,
				sourceTrackType: track.type || 'audio',
				sourceLaneGroupId: track.laneGroupId && pairedLaneGroupIds.has(track.laneGroupId)
					? track.laneGroupId
					: null,
				clips,
			};
		}),
	};
}

export function preparePasteCommand(clipboard, options = {}, idFactory = createStableId) {
	if (!isCompatibleClipboard(clipboard)) throw new TypeError('A compatible editor clipboard is required.');
	const mode = options.mode || 'reject';
	if (!['reject', 'overlap', 'insert-track', 'insert-all'].includes(mode)) throw new RangeError(`Unsupported paste mode: ${mode}.`);
	const clipIds = {};
	const groupIds = {};
	const avLinkIds = {};
	const videoEffectIds = {};
	for (const track of clipboard.tracks || []) {
		for (const clip of track.clips || []) {
			clipIds[clip.key] = idFactory('clip');
			if (clip.groupId && !groupIds[clip.groupId]) groupIds[clip.groupId] = idFactory('clip-group');
			if (clip.avLinkId && !avLinkIds[clip.avLinkId]) avLinkIds[clip.avLinkId] = idFactory('av-link');
			if (clip.kind === 'video' && clip.videoEffects?.length) {
				videoEffectIds[clip.key] = clip.videoEffects.map(() => idFactory('video-effect'));
			}
		}
	}
	const command = {
		type: 'clipboard/paste',
		clipboard,
		atFrame: assertFrame(options.atFrame ?? 0, 'paste.atFrame'),
		trackMap: { ...(options.trackMap || {}) },
		clipIds,
		groupIds,
		avLinkIds,
		videoEffectIds,
		mode,
		splitClipIds: {},
		splitAvLinkIds: {},
	};
	if (options.project) preparePasteCollisionIds(options.project, command, idFactory);
	return command;
}

export function prepareCut(project, options = {}, idFactory = createStableId) {
	return {
		clipboard: createClipboardDescriptor(project, options),
		command: prepareRangeDeleteCommand(project, { ...options, ripple: Boolean(options.ripple) }, idFactory),
	};
}

function pasteClipboard(project, command) {
	const clipboard = command.clipboard;
	if (!isCompatibleClipboard(clipboard)) {
		throw new RangeError('The clipboard is incompatible with this project.');
	}
	const atFrame = assertFrame(command.atFrame, 'paste.atFrame');
	const scale = project.sampleRate / clipboard.sampleRate;
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('The clipboard sample rate is invalid.');
	const pastedDurationFrames = Math.max(1, Math.round(clipboard.durationFrames * scale));
	const mode = command.mode || 'reject';
	const targetTracks = new Set();
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId);
		const sourceTrackType = clipboardTrack.sourceTrackType || clipboardTrack.clips?.[0]?.kind || 'audio';
		if (project.schemaVersion >= 4 && targetTrack.type !== sourceTrackType) {
			throw new RangeError(`A ${sourceTrackType} clipboard track cannot be pasted into a ${targetTrack.type} track.`);
		}
		targetTracks.add(targetTrack);
	}
	if (mode === 'overlap' && project.schemaVersion < 2) {
		const range = normalizeFrameRange(atFrame, atFrame + pastedDurationFrames, 'paste overlap range');
		for (const track of targetTracks) processTrackRange(
			project,
			track,
			range,
			'none',
			command.splitClipIds || {},
			{},
			command.videoEffectIds || {},
		);
	} else if (mode === 'overlap' && command.collisionClipIds?.length) {
		const range = normalizeFrameRange(atFrame, atFrame + pastedDurationFrames, 'paste overlap range');
		const affectedClipIds = new Set(command.collisionClipIds);
		for (const trackId of command.collisionTrackIds || []) {
			processTrackRange(
				project,
				requireTrack(project, trackId),
				range,
				'none',
				command.splitClipIds || {},
				command.splitAvLinkIds || {},
				command.videoEffectIds || {},
				affectedClipIds,
			);
		}
	} else if (mode === 'insert-track' || mode === 'insert-all') {
		const tracks = command.collisionTrackIds?.length
			? command.collisionTrackIds.map((trackId) => requireTrack(project, trackId))
			: mode === 'insert-all'
				? project.tracks.filter((track) => Array.isArray(track.clipIds))
				: [...targetTracks];
		const affectedClipIds = command.collisionClipIds?.length ? new Set(command.collisionClipIds) : null;
		for (const track of tracks) {
			insertSpaceOnTrack(
				project,
				track,
				atFrame,
				pastedDurationFrames,
				command.splitClipIds || {},
				command.splitAvLinkIds || {},
				command.videoEffectIds || {},
				affectedClipIds,
			);
		}
	}
	const additions = [];
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId);
		for (const descriptor of clipboardTrack.clips || []) {
			const id = command.clipIds?.[descriptor.key];
			if (!id) throw new TypeError(`A stable pasted clip ID is required for ${descriptor.key}.`);
			assertUnusedClipId(project, id);
			const clip = normalizeClipForProject(project, scaleClipboardClip(
				descriptor,
				scale,
				atFrame,
				id,
				command.groupIds || {},
				command.avLinkIds || {},
				command.videoEffectIds?.[descriptor.key],
			));
			assertClipSourceBounds(project, clip);
			if (mode === 'reject') {
				const existing = targetTrack.clipIds.map((clipId) => requireClip(project, clipId));
				const pending = additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip);
				if ([...existing, ...pending].some((candidate) => clipsOverlap(candidate, clip))) {
					throw new RangeError(`Clip overlaps existing material on track ${targetTrack.id}.`);
				}
			}
			assertClipSpace(project, targetTrack, clip, null, additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip));
			additions.push({ track: targetTrack, clip });
		}
	}
	for (const { track, clip } of additions) {
		project.clips.push(clip);
		track.clipIds.push(clip.id);
	}
	for (const track of new Set(additions.map((addition) => addition.track))) sortTrack(project, track);
}

function preparePasteCollisionIds(project, command, idFactory) {
	const scale = project.sampleRate / command.clipboard.sampleRate;
	const durationFrames = Math.max(1, Math.round(command.clipboard.durationFrames * scale));
	const targetIds = new Set((command.clipboard.tracks || []).map((track) => command.trackMap?.[track.sourceTrackId] || track.sourceTrackId));
	const targetTracks = command.mode === 'insert-all'
		? project.tracks.filter((track) => Array.isArray(track.clipIds))
		: project.tracks.filter((track) => targetIds.has(track.id) && Array.isArray(track.clipIds));
	let baseClipIds;
	if (command.mode === 'overlap' && project.schemaVersion >= 2) {
		const pastedVideoTrackIds = new Set((command.clipboard.tracks || [])
			.filter((track) => (track.sourceTrackType || track.clips?.[0]?.kind || 'audio') === 'video')
			.map((track) => command.trackMap?.[track.sourceTrackId] || track.sourceTrackId));
		baseClipIds = project.tracks
			.filter((track) => pastedVideoTrackIds.has(track.id))
			.flatMap((track) => track.clipIds.filter((clipId) => {
				const clip = requireClip(project, clipId);
				return (
					clip.timelineStartFrame < command.atFrame + durationFrames
					&& clipEndFrame(clip) > command.atFrame
				);
			}));
	} else {
		baseClipIds = targetTracks.flatMap((track) => track.clipIds);
	}
	const collisionClipIds = command.mode === 'insert-track' || command.mode === 'insert-all'
		? collectLinkedTrackRippleTargets(project, targetTracks.map((track) => track.id)).clipIds
		: collectAvLinkedClipIds(project, baseClipIds);
	const collisionClipIdSet = new Set(collisionClipIds);
	const tracks = project.tracks.filter((track) => (
		Array.isArray(track.clipIds)
		&& track.clipIds.some((clipId) => collisionClipIdSet.has(clipId))
	));
	command.collisionClipIds = collisionClipIds;
	command.collisionTrackIds = tracks.map((track) => track.id);
	for (const track of tracks) {
		for (const clipId of track.clipIds) {
			if (!collisionClipIdSet.has(clipId)) continue;
			const clip = requireClip(project, clipId);
			const spansBoundary = command.mode === 'overlap'
				? clip.timelineStartFrame < command.atFrame && clipEndFrame(clip) > command.atFrame + durationFrames
				: (command.mode === 'insert-track' || command.mode === 'insert-all')
					&& clip.timelineStartFrame < command.atFrame && clipEndFrame(clip) > command.atFrame;
			if (spansBoundary) {
				command.splitClipIds[clip.id] = idFactory('clip');
				const effectIds = prepareVideoEffectIds(clip, idFactory);
				if (effectIds) command.videoEffectIds[command.splitClipIds[clip.id]] = effectIds;
				if (clip.avLinkId && !command.splitAvLinkIds[clip.avLinkId]) {
					command.splitAvLinkIds[clip.avLinkId] = idFactory('av-link');
				}
			}
		}
	}
}

function insertSpaceOnTrack(
	project,
	track,
	atFrame,
	durationFrames,
	splitClipIds,
	splitAvLinkIds = {},
	videoEffectIds = {},
	affectedClipIds = null,
) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const replacements = [];
	const deletedIds = new Set(track.clipIds);
	for (const clip of originals) {
		if (affectedClipIds && !affectedClipIds.has(clip.id)) {
			replacements.push(clip);
			continue;
		}
		if (clip.timelineStartFrame >= atFrame) {
			replacements.push(normalizeClipForProject(project, {
				...clip,
				timelineStartFrame: clip.timelineStartFrame + durationFrames,
				id: clip.id,
			}));
			continue;
		}
		if (clipEndFrame(clip) <= atFrame) {
			replacements.push(clip);
			continue;
		}
		const rightId = splitClipIds[clip.id];
		if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
		assertUnusedClipId(project, rightId);
		replacements.push(segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id));
		let right = segmentOfClip(
			clip,
			atFrame,
			clipEndFrame(clip),
			atFrame + durationFrames,
			rightId,
			videoEffectIds[rightId],
		);
		if (clip.avLinkId) {
			const rightAvLinkId = splitAvLinkIds[clip.avLinkId];
			if (!rightAvLinkId) throw new TypeError(`A stable split A/V link ID is required for ${clip.avLinkId}.`);
			right = normalizeClipForProject(project, { ...right, avLinkId: rightAvLinkId, id: right.id });
		}
		replacements.push(right);
	}
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
		.map((clip) => clip.id);
}

function scaleClipboardClip(descriptor, scale, atFrame, id, groupIds, avLinkIds, videoEffectIds = undefined) {
	const durationFrames = Math.max(1, Math.round(descriptor.durationFrames * scale));
	return {
		...descriptor,
		kind: descriptor.kind || 'audio',
		id,
		groupId: descriptor.groupId ? groupIds[descriptor.groupId] || null : null,
		avLinkId: descriptor.avLinkId ? avLinkIds[descriptor.avLinkId] || null : null,
		timelineStartFrame: atFrame + Math.round(descriptor.offsetFrame * scale),
		durationFrames,
		fadeInFrames: Math.min(durationFrames, Math.round((descriptor.fadeInFrames || 0) * scale)),
		fadeOutFrames: Math.min(durationFrames, Math.round((descriptor.fadeOutFrames || 0) * scale)),
		...(descriptor.kind === 'video' && Array.isArray(descriptor.videoEffects) ? {
			videoEffects: cloneVideoEffectsWithCommandIds(
				descriptor.videoEffects,
				videoEffectIds,
				`Pasted clip ${descriptor.key}`,
			),
		} : {}),
		...(Array.isArray(descriptor.envelope) ? {
			envelope: descriptor.envelope.map((point) => ({
				...point,
				frame: Math.min(durationFrames, Math.max(0, Math.round(point.frame * scale))),
			})).filter((point, index, values) => !index || point.frame > values[index - 1].frame),
		} : {}),
	};
}

function isCompatibleClipboard(clipboard) {
	return Boolean(clipboard && (clipboard.schemaVersion === 1 || clipboard.schemaVersion === 2));
}

export function preparePunchCommand(project, options = {}, idFactory = createStableId) {
	const rangeCommand = prepareRangeDeleteCommand(project, {
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		trackIds: [options.trackId],
	}, idFactory);
	return {
		type: 'punch/replace',
		trackId: options.trackId,
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		sourceId: options.sourceId,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		...(options.sourceDurationFrames == null ? {} : { sourceDurationFrames: options.sourceDurationFrames }),
		clipId: options.clipId || idFactory('clip'),
		splitClipIds: rangeCommand.splitClipIds,
		videoEffectIds: rangeCommand.videoEffectIds,
	};
}

/**
 * Prepare an Audacity-style replacement of one track range with an immutable
 * source. The source's complete frame range becomes the replacement clip, and
 * later material on that track ripples by outputFrames - inputFrames.
 */
export function prepareRangeReplacementCommand(project, options = {}, idFactory = createStableId) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'replacement range');
	const track = requireTrack(project, options.trackId);
	const sourceId = options.source?.id || idFactory('source');
	const source = normalizeRangeReplacementSource(project, { ...(options.source || {}), id: sourceId });
	assertUnusedId(project.sources, source.id, 'source');
	const clipId = requireStableCommandId(options.clipId || idFactory('clip'), 'replacement clip');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);
	const splitClipIds = {};
	const videoEffectIds = {};
	for (const existingClipId of track.clipIds) {
		const clip = requireClip(project, existingClipId);
		if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
			const rightId = requireStableCommandId(idFactory('clip'), `right segment for ${clip.id}`);
			reserveReplacementClipId(project, rightId, generatedClipIds);
			splitClipIds[clip.id] = rightId;
			const effectIds = prepareVideoEffectIds(clip, idFactory);
			if (effectIds) videoEffectIds[rightId] = effectIds;
		}
	}
	return {
		type: 'range/replace',
		trackId: track.id,
		...range,
		source,
		clipId,
		splitClipIds,
		videoEffectIds,
	};
}

function replaceRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'replacement range');
	const track = requireTrack(project, command.trackId);
	const source = normalizeRangeReplacementSource(project, command.source);
	const clipId = requireStableCommandId(command.clipId, 'replacement clip');
	assertUnusedId(project.sources, source.id, 'source');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);

	const originals = track.clipIds.map((id) => requireClip(project, id));
	const deletedIds = new Set(track.clipIds);
	const replacements = [];
	const timelineDelta = source.frameCount - range.durationFrames;
	for (const clip of originals) {
		const startFrame = clip.timelineStartFrame;
		const endFrame = clipEndFrame(clip);
		if (endFrame <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (startFrame >= range.endFrame) {
			replacements.push(normalizeClipForProject(project, {
				...clip,
				timelineStartFrame: startFrame + timelineDelta,
				id: clip.id,
			}));
			continue;
		}

		const hasLeft = startFrame < range.startFrame;
		const hasRight = endFrame > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(clip, startFrame, range.startFrame, startFrame, clip.id));
		if (hasRight) {
			const rightId = hasLeft
				? requireStableCommandId(command.splitClipIds?.[clip.id], `right segment for ${clip.id}`)
				: clip.id;
			if (hasLeft) reserveReplacementClipId(project, rightId, generatedClipIds);
			replacements.push(segmentOfClip(
				clip,
				range.endFrame,
				endFrame,
				range.startFrame + source.frameCount,
				rightId,
				command.videoEffectIds?.[rightId],
			));
		}
	}

	const replacement = normalizeClipForProject(project, {
		id: clipId,
		sourceId: source.id,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: source.frameCount,
		durationFrames: source.frameCount,
	});
	const nextTrackClips = [...replacements, replacement]
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id));
	project.sources.push(source);
	validateTrackReplacement(project, track, deletedIds, nextTrackClips);
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...nextTrackClips);
	track.clipIds = nextTrackClips.map((clip) => clip.id);
}

function punchReplace(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'punch range');
	const track = requireTrack(project, command.trackId);
	processTrackRange(
		project,
		track,
		range,
		false,
		command.splitClipIds || {},
		{},
		command.videoEffectIds || {},
	);
	addClip(project, track.id, {
		id: command.clipId,
		sourceId: command.sourceId,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: command.sourceStartFrame ?? 0,
		...(command.sourceDurationFrames == null ? {} : { sourceDurationFrames: command.sourceDurationFrames }),
		durationFrames: range.durationFrames,
	});
}

function addEffect(project, command) {
	const rack = getRack(project, command);
	const effect = command.effect?.type ? normalizeEffect(command.effect) : createEffect(command.effectType, command.effect || {});
	if (allEffects(project).some((item) => item.id === effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
	const index = command.index == null ? rack.length : insertionIndex(command.index, rack.length);
	rack.splice(index, 0, effect);
}

function updateRackEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack[index] = updateEffect(rack[index], command.changes || {});
}

function removeEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack.splice(index, 1);
}

function reorderEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	const toIndex = Number(command.toIndex);
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= rack.length) throw new RangeError('Effect destination is out of bounds.');
	const [effect] = rack.splice(index, 1);
	rack.splice(toIndex, 0, effect);
}

function getRack(project, command) {
	if (command.scope === 'master') return project.master.effects;
	if (command.scope === 'track') {
		const track = requireTrack(project, command.trackId);
		if (track.type !== 'audio') throw new RangeError('Track effects require an audio track.');
		return track.effects;
	}
	if (command.scope === 'group' || command.scope === 'send') {
		return requireMixerBus(project, command.scope, command.busId || command.trackId).effects;
	}
	throw new RangeError('Effect scope must be track, group, send, or master.');
}

function allEffects(project) {
	return [
		...project.master.effects,
		...project.tracks.flatMap((track) => track.effects || []),
		...(project.mixer?.groups || []).flatMap((bus) => bus.effects || []),
		...(project.mixer?.sends || []).flatMap((bus) => bus.effects || []),
	];
}

function requireVideoEffectStack(project, clipId) {
	if (project.schemaVersion < 5) throw new RangeError('Video effects require an AudioEditorProjectV5 project.');
	const clip = requireClip(project, clipId);
	if (clip.kind !== 'video') throw new RangeError(`Clip ${clipId} is not a video clip.`);
	if (!Array.isArray(clip.videoEffects)) throw new TypeError(`Video clip ${clipId} has no effect stack.`);
	return clip.videoEffects;
}

function addVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const effect = command.effect?.type
		? normalizeVideoEffect(command.effect)
		: createVideoEffect(command.effectType, command.effect || {});
	if (stack.some((candidate) => candidate.id === effect.id)) {
		throw new RangeError(`Duplicate video effect ID: ${effect.id}.`);
	}
	const index = command.index == null ? stack.length : insertionIndex(command.index, stack.length);
	stack.splice(index, 0, effect);
}

function updateClipVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const index = stack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown video effect: ${command.effectId}.`);
	stack[index] = updateVideoEffect(stack[index], command.changes || {});
}

function removeVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const index = stack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown video effect: ${command.effectId}.`);
	stack.splice(index, 1);
}

function reorderVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const index = stack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown video effect: ${command.effectId}.`);
	const toIndex = Number(command.toIndex);
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= stack.length) {
		throw new RangeError('Video effect destination is out of bounds.');
	}
	const [effect] = stack.splice(index, 1);
	stack.splice(toIndex, 0, effect);
}

function segmentOfClip(clip, segmentStartFrame, segmentEndFrame, timelineStartFrame, id, videoEffectIds = undefined) {
	const offsetFrames = segmentStartFrame - clip.timelineStartFrame;
	const durationFrames = segmentEndFrame - segmentStartFrame;
	const sourceDuration = clip.sourceDurationFrames ?? clip.durationFrames;
	const sourceOffsetFrames = Math.round(offsetFrames * sourceDuration / clip.durationFrames);
	const segmentSourceDuration = segmentEndFrame === clipEndFrame(clip)
		? sourceDuration - sourceOffsetFrames
		: Math.max(1, Math.round(durationFrames * sourceDuration / clip.durationFrames));
	const sourceStartFrame = clip.reversed
		? clip.sourceStartFrame + sourceDuration - sourceOffsetFrames - segmentSourceDuration
		: clip.sourceStartFrame + sourceOffsetFrames;
	const envelope = Array.isArray(clip.envelope)
		? clip.envelope
			.filter((point) => point.frame >= offsetFrames && point.frame <= offsetFrames + durationFrames)
			.map((point) => ({ ...point, frame: point.frame - offsetFrames }))
		: undefined;
	const value = {
		...clip,
		id,
		timelineStartFrame,
		sourceStartFrame,
		durationFrames,
		sourceDurationFrames: segmentSourceDuration,
		trimStartFrames: segmentStartFrame === clip.timelineStartFrame ? clip.trimStartFrames : 0,
		trimEndFrames: segmentEndFrame === clipEndFrame(clip) ? clip.trimEndFrames : 0,
		...(envelope ? { envelope } : {}),
		fadeInFrames: segmentStartFrame === clip.timelineStartFrame ? Math.min(clip.fadeInFrames, durationFrames) : 0,
		fadeOutFrames: segmentEndFrame === clipEndFrame(clip) ? Math.min(clip.fadeOutFrames, durationFrames) : 0,
	};
	if (!clip.kind) return normalizeClipValue(value);
	if (clip.kind === 'video' && id !== clip.id && clip.videoEffects?.length) {
		value.videoEffects = cloneVideoEffectsWithCommandIds(
			clip.videoEffects,
			videoEffectIds,
			`Segment ${id}`,
		);
	}
	return Array.isArray(clip.videoEffects) ? createMediaClipV5(value) : createMediaClipV4(value);
}

function envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames) {
	const offsetFrames = timelineStartFrame - clip.timelineStartFrame;
	return (clip.envelope || [])
		.filter((point) => point.frame >= offsetFrames && point.frame <= offsetFrames + durationFrames)
		.map((point) => ({ ...point, frame: point.frame - offsetFrames }));
}

function assertClipSourceBounds(project, clip) {
	const source = findSource(project, clip.sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${clip.sourceId}.`);
	if (clip.sourceStartFrame + (clip.sourceDurationFrames ?? clip.durationFrames) > source.frameCount) throw new RangeError('Clip exceeds its source bounds.');
}

function assertClipSpace(project, track, candidate, excludedClipId = null, additionalClips = []) {
	if (project.schemaVersion >= 2) return;
	const clips = track.clipIds
		.filter((clipId) => clipId !== excludedClipId)
		.map((clipId) => requireClip(project, clipId));
	if ([...clips, ...additionalClips].some((clip) => clipsOverlap(clip, candidate))) {
		throw new RangeError(`Clip overlaps existing material on track ${track.id}.`);
	}
}

function validateTrackReplacement(project, track, deletedIds, clips) {
	const ids = new Set(project.clips.filter((clip) => !deletedIds.has(clip.id)).map((clip) => clip.id));
	for (const clip of clips) {
		if (ids.has(clip.id)) throw new RangeError(`Duplicate clip ID: ${clip.id}.`);
		ids.add(clip.id);
		assertClipSourceBounds(project, clip);
	}
	if (project.schemaVersion < 2) for (let index = 1; index < clips.length; index += 1) {
		if (clipsOverlap(clips[index - 1], clips[index])) throw new RangeError(`Range replacement overlaps existing material on track ${track.id}.`);
	}
}

function normalizeRangeReplacementSource(project, value) {
	if (!value || typeof value.id !== 'string' || !value.id) {
		throw new TypeError('A stable replacement source ID is required.');
	}
	if (!Number.isSafeInteger(value.frameCount) || value.frameCount <= 0) {
		throw new RangeError('Range replacement output must contain at least one frame.');
	}
	return normalizeSourceForProject(project, value);
}

function requireStableCommandId(value, name) {
	if (typeof value !== 'string' || !value) throw new TypeError(`A stable ${name} ID is required.`);
	return value;
}

function cloneVideoEffectsWithCommandIds(effects, ids, name) {
	const stack = Array.isArray(effects) ? effects : [];
	if (!stack.length) return [];
	if (!Array.isArray(ids) || ids.length !== stack.length) {
		throw new TypeError(`${name} requires one stable ID for every video effect.`);
	}
	let index = 0;
	return cloneVideoEffects(stack, {
		regenerateIds: true,
		idFactory: () => requireStableCommandId(ids[index++], `${name} video effect`),
	});
}

function prepareVideoEffectIds(clip, idFactory) {
	return clip.kind === 'video' && clip.videoEffects?.length
		? clip.videoEffects.map(() => idFactory('video-effect'))
		: undefined;
}

function reserveReplacementClipId(project, id, reservedIds) {
	assertUnusedClipId(project, id);
	if (reservedIds.has(id)) throw new RangeError(`Duplicate replacement clip ID: ${id}.`);
	reservedIds.add(id);
}

function sortTrack(project, track) {
	track.clipIds.sort((firstId, secondId) => {
		const first = requireClip(project, firstId);
		const second = requireClip(project, secondId);
		return first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id);
	});
}

function replaceClip(project, value) {
	const index = project.clips.findIndex((clip) => clip.id === value.id);
	if (index < 0) throw new ReferenceError(`Unknown clip: ${value.id}.`);
	project.clips[index] = value;
}

function requireSource(project, sourceId) {
	const source = findSource(project, sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	return source;
}

function requireTrack(project, trackId) {
	const track = findTrack(project, trackId);
	if (!track) throw new ReferenceError(`Unknown track: ${trackId}.`);
	return track;
}

function requireLabelTrack(project, trackId) {
	const track = requireTrack(project, trackId);
	if (track.type !== 'label') throw new RangeError(`Track ${trackId} is not a label track.`);
	return track;
}

function requireClip(project, clipId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip: ${clipId}.`);
	return clip;
}

function requireProjectBin(project) {
	if (project.schemaVersion < 3 || !project.projectBin || !Array.isArray(project.projectBin.clips)) {
		throw new RangeError('Project-bin commands require an AudioEditorProjectV3 or newer project.');
	}
	return project.projectBin;
}

function requireProjectBinClip(project, clipId) {
	requireProjectBin(project);
	const clip = findProjectBinClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown project-bin clip: ${clipId}.`);
	return clip;
}

function requireClipTrack(project, clipId) {
	const track = findClipTrack(project, clipId);
	if (!track) throw new ReferenceError(`Clip ${clipId} is not assigned to a track.`);
	return track;
}

function assertUnusedId(items, id, type) {
	if (items.some((item) => item.id === id)) throw new RangeError(`Duplicate ${type} ID: ${id}.`);
}

function assertUnusedClipId(project, id) {
	if (project.clips.some((clip) => clip.id === id) || findProjectBinClip(project, id)) {
		throw new RangeError(`Duplicate clip ID: ${id}.`);
	}
}

function insertionIndex(value, length) {
	const index = Number(value);
	if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError('Insertion index is out of bounds.');
	return index;
}

function normalizeCommandIds(values, name) {
	if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array.`);
	const result = values.map((value, index) => {
		if (typeof value !== 'string' || !value) throw new TypeError(`${name}[${index}] must be a stable ID.`);
		return value;
	});
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

function normalizeSelectionIds(values, name) {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
	if (!values.length) return [];
	return normalizeCommandIds(values, name);
}

function normalizeFrequencyRange(value, sampleRate) {
	if (value == null) return null;
	const minimumFrequency = Number(value.minimumFrequency);
	const maximumFrequency = Number(value.maximumFrequency);
	if (
		!Number.isFinite(minimumFrequency)
		|| !Number.isFinite(maximumFrequency)
		|| minimumFrequency < 0
		|| maximumFrequency <= minimumFrequency
		|| maximumFrequency > sampleRate / 2
	) {
		throw new RangeError('Selection frequency range is outside the project bandwidth.');
	}
	return { minimumFrequency, maximumFrequency };
}

export function createAddSourceCommand(options) {
	return { type: 'source/add', source: normalizeSourceValue(options) };
}

export function createAddTrackCommand(options = {}) {
	return { type: 'track/add', track: normalizeTrackValue(options) };
}

export function createAddClipCommand(trackId, options) {
	return { type: 'clip/add', trackId, clip: normalizeClipValue(options) };
}

export function createReplaceClipSourceCommand(clipId, sourceId) {
	return {
		type: 'clip/replace-source',
		clipId: requireStableCommandId(clipId, 'clip'),
		sourceId: requireStableCommandId(sourceId, 'source'),
	};
}

export function createAddVideoEffectCommand(clipId, effectType, options = {}) {
	return {
		type: 'video-effect/add',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effect: createVideoEffect(effectType, options),
		...(options.index == null ? {} : { index: options.index }),
	};
}

export function createUpdateVideoEffectCommand(clipId, effectId, changes = {}) {
	return {
		type: 'video-effect/update',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
		changes: { ...changes },
	};
}

export function createBypassVideoEffectCommand(clipId, effectId, bypassed = true) {
	if (typeof bypassed !== 'boolean') throw new TypeError('Video effect bypass state must be boolean.');
	return createUpdateVideoEffectCommand(clipId, effectId, { enabled: !bypassed });
}

export function createReorderVideoEffectCommand(clipId, effectId, toIndex) {
	if (!Number.isSafeInteger(toIndex) || toIndex < 0) {
		throw new RangeError('Video effect destination must be a non-negative safe integer.');
	}
	return {
		type: 'video-effect/reorder',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
		toIndex,
	};
}

export function createRemoveVideoEffectCommand(clipId, effectId) {
	return {
		type: 'video-effect/remove',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
	};
}

export function createAddLabelTrackCommand(options = {}) {
	return { type: 'track/add', track: createLabelTrackV2(options) };
}

export function createAddLabelCommand(trackId, options = {}) {
	return { type: 'label/add', trackId, label: createLabelV2(options) };
}

function normalizeSourceValue(value) {
	if (value?.schemaVersion >= 5) return createMediaSourceV5(value);
	return value?.kind ? createMediaSourceV4(value) : createAudioSourceV2(value);
}

function normalizeTrackValue(value) {
	if (value?.schemaVersion >= 5) return createMediaTrackV5(value);
	if (value?.type === 'video') return createMediaTrackV4(value);
	if (value?.schemaVersion >= 4 && value?.type === 'label') return createLabelTrackV4(value);
	if (value?.type === 'label') return createLabelTrackV2(value);
	if (value?.schemaVersion >= 4 || value?.laneGroupId) return createAudioTrackV4(value);
	return createAudioTrackV2(value);
}

function normalizeClipValue(value) {
	if (Array.isArray(value?.videoEffects) || value?.schemaVersion >= 5) return createMediaClipV5(value);
	return value?.kind ? createMediaClipV4(value) : createAudioClipV2(value);
}

function normalizeSourceForProject(project, value) {
	return project.schemaVersion >= 5
		? createMediaSourceV5({ ...value, kind: value?.kind || 'audio' }, project.sampleRate)
		: project.schemaVersion >= 4
		? createMediaSourceV4({ ...value, kind: value?.kind || 'audio' }, project.sampleRate)
		: createAudioSourceV2(value);
}

function normalizeTrackForProject(project, value) {
	return project.schemaVersion >= 5
		? createMediaTrackV5({ ...value, type: value?.type || 'audio' }, project.sampleRate)
		: project.schemaVersion >= 4
		? createMediaTrackV4({ ...value, type: value?.type || 'audio' }, project.sampleRate)
		: createAudioTrackV2(value, project.sampleRate);
}

function normalizeClipForProject(project, value) {
	return project.schemaVersion >= 5
		? createMediaClipV5({
			...value,
			kind: value?.kind || 'audio',
			binItemId: value?.binItemId ?? null,
			avLinkId: value?.avLinkId ?? null,
		})
		: project.schemaVersion >= 4
		? createMediaClipV4({
			...value,
			kind: value?.kind || 'audio',
			binItemId: value?.binItemId ?? null,
			avLinkId: value?.avLinkId ?? null,
		})
		: createAudioClipV2(value);
}
