/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	clipEndFrame,
	clipsOverlap,
	findClip,
	findClipTrack,
	findProjectBinClip,
	findSource,
	findTrack,
} from '../project.js';
import {
	createAudioClipV2,
	createAudioSourceV2,
	createAudioTrackV2,
} from '../project-v2.js';
import {
	createMediaClipV4,
	createMediaSourceV4,
	createMediaTrackV4,
} from '../project-v4.js';
import {
	createMediaClipV5,
	createMediaSourceV5,
	createMediaTrackV5,
} from '../project-v5.js';
import { createMediaClipV8 } from '../project-v8.ts';
import {
	createMediaClipV10,
	createMediaSourceV10,
	createMediaTrackV10,
} from '../project-v10.ts';
import { resolveRuntimeClipProjection } from '../runtime-clip-projection.ts';
import {
	cloneVideoEffects,
} from '../video-effects.js';

export function pruneMissingProjectSelections(project) {
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

export function withoutImportedPitchPreset(opaqueExtensions) {
	const output = { ...(opaqueExtensions || {}) };
	delete output.aup4PitchAndSpeedPreset;
	return output;
}

export function ensureMixer(project) {
	if (!project.mixer) project.mixer = { groups: [], sends: [], routes: {} };
	project.mixer.groups ||= [];
	project.mixer.sends ||= [];
	project.mixer.routes ||= {};
	return project.mixer;
}

export function mixerBusCollection(project, type) {
	const mixer = ensureMixer(project);
	if (type === 'group') return mixer.groups;
	if (type === 'send') return mixer.sends;
	throw new RangeError('Mixer bus type must be group or send.');
}

export function requireMixerBus(project, type, busId) {
	const bus = mixerBusCollection(project, type).find((candidate) => candidate.id === busId);
	if (!bus) throw new ReferenceError(`Unknown ${type} bus: ${busId}.`);
	return bus;
}

export function segmentOfClip(clip, segmentStartFrame, segmentEndFrame, timelineStartFrame, id, videoEffectIds = undefined) {
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
	if (clip.anchor != null || clip.sequenceId != null) return value;
	return Array.isArray(clip.videoEffects) ? createMediaClipV5(value) : createMediaClipV4(value);
}

export function envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames) {
	const offsetFrames = timelineStartFrame - clip.timelineStartFrame;
	return (clip.envelope || [])
		.filter((point) => point.frame >= offsetFrames && point.frame <= offsetFrames + durationFrames)
		.map((point) => ({ ...point, frame: point.frame - offsetFrames }));
}

export function assertClipSourceBounds(project, clip) {
	const source = findSource(project, clip.sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${clip.sourceId}.`);
	const sourceFrames = source.kind === 'video' ? (source.sourceFrameCount ?? source.frameCount) : source.frameCount;
	if (clip.sourceStartFrame + (clip.sourceDurationFrames ?? clip.durationFrames) > sourceFrames) throw new RangeError('Clip exceeds its source bounds.');
}

export function assertClipSpace(project, track, candidate, excludedClipId = null, additionalClips = []) {
	if (project.schemaVersion >= 2) return;
	const clips = track.clipIds
		.filter((clipId) => clipId !== excludedClipId)
		.map((clipId) => requireClip(project, clipId));
	if ([...clips, ...additionalClips].some((clip) => clipsOverlap(clip, candidate))) {
		throw new RangeError(`Clip overlaps existing material on track ${track.id}.`);
	}
}

export function validateTrackReplacement(project, track, deletedIds, clips) {
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

export function normalizeRangeReplacementSource(project, value) {
	if (!value || typeof value.id !== 'string' || !value.id) {
		throw new TypeError('A stable replacement source ID is required.');
	}
	if (!Number.isSafeInteger(value.frameCount) || value.frameCount <= 0) {
		throw new RangeError('Range replacement output must contain at least one frame.');
	}
	return normalizeSourceForProject(project, value);
}

export function requireStableCommandId(value, name) {
	if (typeof value !== 'string' || !value) throw new TypeError(`A stable ${name} ID is required.`);
	return value;
}

export function cloneVideoEffectsWithCommandIds(effects, ids, name) {
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

export function prepareVideoEffectIds(clip, idFactory) {
	return clip.kind === 'video' && clip.videoEffects?.length
		? clip.videoEffects.map(() => idFactory('video-effect'))
		: undefined;
}

export function reserveReplacementClipId(project, id, reservedIds) {
	assertUnusedClipId(project, id);
	if (reservedIds.has(id)) throw new RangeError(`Duplicate replacement clip ID: ${id}.`);
	reservedIds.add(id);
}

export function sortTrack(project, track) {
	track.clipIds.sort((firstId, secondId) => {
		const first = requireClip(project, firstId);
		const second = requireClip(project, secondId);
		return first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id);
	});
}

export function replaceClip(project, value) {
	const index = project.clips.findIndex((clip) => clip.id === value.id);
	if (index < 0) throw new ReferenceError(`Unknown clip: ${value.id}.`);
	project.clips[index] = value;
}

export function requireSource(project, sourceId) {
	const source = findSource(project, sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	return source;
}

export function requireTrack(project, trackId) {
	const track = findTrack(project, trackId);
	if (!track) throw new ReferenceError(`Unknown track: ${trackId}.`);
	return track;
}

export function requireLabelTrack(project, trackId) {
	const track = requireTrack(project, trackId);
	if (track.type !== 'label') throw new RangeError(`Track ${trackId} is not a label track.`);
	return track;
}

export function requireClip(project, clipId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip: ${clipId}.`);
	return clip;
}

export function requireProjectBin(project) {
	if (project.schemaVersion < 3 || !project.projectBin || !Array.isArray(project.projectBin.clips)) {
		throw new RangeError('Project-bin commands require an AudioEditorProjectV3 or newer project.');
	}
	return project.projectBin;
}

export function requireProjectBinClip(project, clipId) {
	requireProjectBin(project);
	const clip = findProjectBinClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown project-bin clip: ${clipId}.`);
	return clip;
}

export function requireClipTrack(project, clipId) {
	const track = findClipTrack(project, clipId);
	if (!track) throw new ReferenceError(`Clip ${clipId} is not assigned to a track.`);
	return track;
}

export function assertUnusedId(items, id, type) {
	if (items.some((item) => item.id === id)) throw new RangeError(`Duplicate ${type} ID: ${id}.`);
}

export function assertUnusedClipId(project, id) {
	if (project.clips.some((clip) => clip.id === id) || findProjectBinClip(project, id)) {
		throw new RangeError(`Duplicate clip ID: ${id}.`);
	}
}

export function insertionIndex(value, length) {
	const index = Number(value);
	if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError('Insertion index is out of bounds.');
	return index;
}

export function normalizeCommandIds(values, name) {
	if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array.`);
	const result = values.map((value, index) => {
		if (typeof value !== 'string' || !value) throw new TypeError(`${name}[${index}] must be a stable ID.`);
		return value;
	});
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

export function normalizeSelectionIds(values, name) {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
	if (!values.length) return [];
	return normalizeCommandIds(values, name);
}

export function normalizeFrequencyRange(value, sampleRate) {
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

function normalizeClipValue(value) {
	if (Array.isArray(value?.videoEffects) || value?.schemaVersion >= 5) return createMediaClipV5(value);
	return value?.kind ? createMediaClipV4(value) : createAudioClipV2(value);
}

export function normalizeSourceForProject(project, value) {
	if (project.schemaVersion >= 10) {
		const source = createMediaSourceV10({ ...value, kind: value?.kind || 'audio' }, project.sampleRate);
		return source.kind === 'video' ? { ...source, frameCount: source.sampleFrameCount } : source;
	}
	return project.schemaVersion >= 5
		? createMediaSourceV5({ ...value, kind: value?.kind || 'audio' }, project.sampleRate)
		: project.schemaVersion >= 4
		? createMediaSourceV4({ ...value, kind: value?.kind || 'audio' }, project.sampleRate)
		: createAudioSourceV2(value);
}

export function normalizeTrackForProject(project, value) {
	if (project.schemaVersion >= 10) {
		return createMediaTrackV10({ ...value, type: value?.type || 'audio' }, project.sampleRate);
	}
	return project.schemaVersion >= 5
		? createMediaTrackV5({ ...value, type: value?.type || 'audio' }, project.sampleRate)
		: project.schemaVersion >= 4
		? createMediaTrackV4({ ...value, type: value?.type || 'audio' }, project.sampleRate)
		: createAudioTrackV2(value, project.sampleRate);
}

export function normalizeClipForProject(project, value) {
	if (project.schemaVersion >= 10) {
		if (project.runtimeProjectionVersion && value?.coordinateDomain === 'resolved-samples') {
			const timelineStartFrame = Number(value.timelineStartFrame);
			const durationFrames = Number(value.durationFrames);
			const sourceStartFrame = Number(value.sourceStartFrame);
			const sourceDurationFrames = Number(value.sourceDurationFrames);
			return {
				...value,
				timelineEndFrame: timelineStartFrame + durationFrames,
				sourceEndFrame: sourceStartFrame + sourceDurationFrames,
			};
		}
		const source = requireSource(project, value.sourceId);
		const sequenceId = value.sequenceId || project.primarySequenceId;
		const sequence = project.sequences.find((candidate) => candidate.id === sequenceId);
		if (!sequence) throw new ReferenceError(`Unknown sequence: ${sequenceId}.`);
		const clip = createMediaClipV10({
			...value,
			kind: value?.kind || 'audio',
			binItemId: value?.binItemId ?? null,
			avLinkId: value?.avLinkId ?? null,
		}, {
			projectSampleRate: project.sampleRate,
			tempoMap: project.tempoMap,
			sequence,
			source,
		});
		return resolveRuntimeClipProjection(project, clip);
	}
	return project.schemaVersion >= 8
		? createMediaClipV8({
			...value,
			kind: value?.kind || 'audio',
			binItemId: value?.binItemId ?? null,
			avLinkId: value?.avLinkId ?? null,
		})
		: project.schemaVersion >= 5
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
