/* SPDX-License-Identifier: AGPL-3.0-only */

import { validatePersistedAudioEffects } from './persisted-audio-effect-validation.ts';
import {
	projectArray,
	projectBoolean,
	projectFiniteInRange,
	projectOptionalId,
	projectPositiveFinite,
	projectRecord,
	projectSafeInteger,
	projectString,
	projectUniqueIds,
	projectUniqueStrings,
	type ProjectDataRecord,
	validateProjectEnvelope,
} from './project-v9-validation-primitives.ts';
import { normalizeVideoEffects } from './video-effects.js';
import { validateVideoTrackComposition } from './video-timeline.js';

const SAMPLE_FORMATS = new Set(['int16', 'int24', 'int32', 'float32', 'float64', 'unknown']);
const DISPLAY_MODES = new Set(['waveform', 'spectrogram', 'multiview', 'half-wave']);

export interface ProjectV9MediaCollections {
	readonly sources: readonly ProjectDataRecord[];
	readonly clips: readonly ProjectDataRecord[];
	readonly tracks: readonly ProjectDataRecord[];
	readonly binClips: readonly ProjectDataRecord[];
}

export function validateProjectV9Media(
	project: ProjectDataRecord,
	sampleRate: number,
): ProjectV9MediaCollections {
	const sources = recordArray(project.sources, 'project.sources');
	const clips = recordArray(project.clips, 'project.clips');
	const tracks = recordArray(project.tracks, 'project.tracks');
	const projectBin = projectRecord(project.projectBin, 'project.projectBin');
	const binClips = recordArray(projectBin.clips, 'project.projectBin.clips');
	projectUniqueIds(sources, 'project.sources');
	projectUniqueIds([...clips, ...binClips], 'project clips');
	projectUniqueIds(tracks, 'project.tracks');
	for (const source of sources) validateSource(source);
	for (const clip of clips) validateClip(clip, false);
	for (const clip of binClips) validateClip(clip, true);
	for (const track of tracks) validateTrack(track, sampleRate);
	validateMediaGraph({ project, sources, clips, tracks, binClips });
	return { sources, clips, tracks, binClips };
}

function validateSource(source: ProjectDataRecord): void {
	projectString(source.id, 'source.id');
	projectString(source.name, `source ${String(source.id)}.name`);
	projectString(source.mimeType, `source ${String(source.id)}.mimeType`);
	projectString(source.storageKey, `source ${String(source.id)}.storageKey`);
	projectSafeInteger(source.frameCount, 1, `source ${String(source.id)}.frameCount`);
	projectSafeInteger(source.sampleRate, 1, `source ${String(source.id)}.sampleRate`);
	if (source.kind === 'audio') {
		projectSafeInteger(source.channelCount, 1, `source ${String(source.id)}.channelCount`);
		projectSafeInteger(source.originalSampleRate, 1, `source ${String(source.id)}.originalSampleRate`);
		if (typeof source.sampleFormat !== 'string' || !SAMPLE_FORMATS.has(source.sampleFormat)) {
			throw new RangeError(`source ${String(source.id)}.sampleFormat has an unsupported value.`);
		}
		projectSafeInteger(source.chunkFrames, 1, `source ${String(source.id)}.chunkFrames`);
		return;
	}
	if (source.kind !== 'video') throw new RangeError(`Unsupported source kind: ${String(source.kind)}.`);
	projectSafeInteger(source.width, 1, `source ${String(source.id)}.width`);
	projectSafeInteger(source.height, 1, `source ${String(source.id)}.height`);
	projectPositiveFinite(source.frameRate, `source ${String(source.id)}.frameRate`);
	projectString(source.videoCodec, `source ${String(source.id)}.videoCodec`);
	optionalString(source.audioCodec, `source ${String(source.id)}.audioCodec`);
	projectBoolean(source.hasAudio, `source ${String(source.id)}.hasAudio`);
	optionalString(source.posterStorageKey, `source ${String(source.id)}.posterStorageKey`);
	optionalString(source.thumbnailStorageKey, `source ${String(source.id)}.thumbnailStorageKey`);
}

function validateClip(clip: ProjectDataRecord, inProjectBin: boolean): void {
	const prefix = `clip ${String(clip.id)}`;
	projectString(clip.id, `${prefix}.id`);
	projectString(clip.sourceId, `${prefix}.sourceId`);
	projectString(clip.title, `${prefix}.title`);
	projectSafeInteger(clip.timelineStartFrame, 0, `${prefix}.timelineStartFrame`);
	projectSafeInteger(clip.sourceStartFrame, 0, `${prefix}.sourceStartFrame`);
	const sourceDuration = projectSafeInteger(clip.sourceDurationFrames, 1, `${prefix}.sourceDurationFrames`);
	const duration = projectSafeInteger(clip.durationFrames, 1, `${prefix}.durationFrames`);
	projectSafeInteger(clip.trimStartFrames, 0, `${prefix}.trimStartFrames`);
	projectSafeInteger(clip.trimEndFrames, 0, `${prefix}.trimEndFrames`);
	projectOptionalId(clip.groupId, `${prefix}.groupId`);
	projectString(clip.color, `${prefix}.color`);
	projectOptionalId(clip.avLinkId, `${prefix}.avLinkId`);
	projectOptionalId(clip.binItemId, `${prefix}.binItemId`);
	if (inProjectBin) {
		if (clip.avLinkId !== null) throw new RangeError(`Project Bin ${prefix} cannot have an A/V link ID.`);
		projectString(clip.binItemId, `Project Bin ${prefix}.binItemId`);
	} else if (clip.binItemId !== null) {
		throw new RangeError(`Timeline ${prefix} cannot have a bin item ID.`);
	}
	if (clip.kind === 'audio') {
		const fadeIn = projectSafeInteger(clip.fadeInFrames, 0, `${prefix}.fadeInFrames`);
		const fadeOut = projectSafeInteger(clip.fadeOutFrames, 0, `${prefix}.fadeOutFrames`);
		if (fadeIn > duration || fadeOut > duration) throw new RangeError('Clip fades cannot be longer than the clip.');
		projectFiniteInRange(clip.gain, 0, 16, `${prefix}.gain`);
		projectBoolean(clip.reversed, `${prefix}.reversed`);
		validateProjectEnvelope(clip.envelope, `${prefix}.envelope`);
		for (const point of recordArray(clip.envelope, `${prefix}.envelope`)) {
			if (Number(point.frame) > duration) throw new RangeError(`${prefix}.envelope points must be inside the clip.`);
		}
		projectFiniteInRange(clip.pitchCents, -1_200, 1_200, `${prefix}.pitchCents`);
		projectFiniteInRange(clip.speedRatio, 0.001, 1_000, `${prefix}.speedRatio`);
		projectBoolean(clip.preserveFormants, `${prefix}.preserveFormants`);
		projectBoolean(clip.stretchToTempo, `${prefix}.stretchToTempo`);
		projectSafeInteger(clip.renderCacheRevision, 0, `${prefix}.renderCacheRevision`);
		return;
	}
	if (clip.kind !== 'video') throw new RangeError(`Unsupported clip kind: ${String(clip.kind)}.`);
	projectPositiveFinite(clip.speedRatio, `${prefix}.speedRatio`);
	normalizeVideoEffects(clip.videoEffects, `${prefix}.videoEffects`);
	void sourceDuration;
}

function validateTrack(track: ProjectDataRecord, sampleRate: number): void {
	const prefix = `track ${String(track.id)}`;
	projectString(track.id, `${prefix}.id`);
	projectString(track.name, `${prefix}.name`);
	projectBoolean(track.collapsed, `${prefix}.collapsed`);
	projectSafeInteger(track.height, 40, `${prefix}.height`);
	if (track.type === 'label') {
		if (track.laneGroupId !== null) throw new RangeError(`${prefix} cannot belong to a media lane group.`);
		const labels = recordArray(track.labels, `${prefix}.labels`);
		projectUniqueIds(labels, `${prefix}.labels`);
		for (const label of labels) validateLabel(label, prefix);
		return;
	}
	projectOptionalId(track.laneGroupId, `${prefix}.laneGroupId`);
	projectUniqueStrings(track.clipIds, `${prefix}.clipIds`);
	if (track.type === 'video') {
		projectBoolean(track.mute, `${prefix}.mute`);
		projectBoolean(track.hidden, `${prefix}.hidden`);
		return;
	}
	if (track.type !== 'audio') throw new RangeError(`Unsupported track type: ${String(track.type)}.`);
	projectFiniteInRange(track.gain, 0, 4, `${prefix}.gain`);
	projectFiniteInRange(track.pan, -1, 1, `${prefix}.pan`);
	projectBoolean(track.mute, `${prefix}.mute`);
	projectBoolean(track.solo, `${prefix}.solo`);
	projectBoolean(track.armed, `${prefix}.armed`);
	if (typeof track.displayMode !== 'string' || !DISPLAY_MODES.has(track.displayMode)) {
		throw new RangeError(`${prefix}.displayMode has an unsupported value.`);
	}
	projectString(track.color, `${prefix}.color`);
	validateSpectrogram(track.spectrogram, sampleRate, `${prefix}.spectrogram`);
	validateProjectEnvelope(track.envelope, `${prefix}.envelope`);
	projectBoolean(track.effectsActive, `${prefix}.effectsActive`);
	validatePersistedAudioEffects(track.effects, `${prefix}.effects`);
}

function validateLabel(label: ProjectDataRecord, trackName: string): void {
	const prefix = `${trackName}.label ${String(label.id)}`;
	projectString(label.id, `${prefix}.id`);
	projectString(label.title, `${prefix}.title`, true);
	const start = projectSafeInteger(label.startFrame, 0, `${prefix}.startFrame`);
	const end = projectSafeInteger(label.endFrame, 0, `${prefix}.endFrame`);
	if (end < start) throw new RangeError(`${prefix}.endFrame cannot precede its startFrame.`);
	projectString(label.color, `${prefix}.color`);
}

function validateSpectrogram(value: unknown, sampleRate: number, name: string): void {
	const spectrogram = projectRecord(value, name);
	projectString(spectrogram.scale, `${name}.scale`);
	const minimum = projectFiniteInRange(spectrogram.minimumFrequency, 0, sampleRate / 2, `${name}.minimumFrequency`);
	const maximum = projectFiniteInRange(spectrogram.maximumFrequency, 0, sampleRate / 2, `${name}.maximumFrequency`);
	if (maximum <= minimum) throw new RangeError(`${name} must have a positive frequency range.`);
	const windowSize = projectSafeInteger(spectrogram.windowSize, 32, `${name}.windowSize`);
	if ((windowSize & (windowSize - 1)) !== 0) throw new RangeError(`${name}.windowSize must be a power of two.`);
	projectString(spectrogram.windowType, `${name}.windowType`);
	projectFiniteInRange(spectrogram.gain, -120, 120, `${name}.gain`);
	projectFiniteInRange(spectrogram.range, 1, 240, `${name}.range`);
}

function validateMediaGraph(collections: ProjectV9MediaCollections & { readonly project: ProjectDataRecord }): void {
	const { project, sources, clips, tracks, binClips } = collections;
	const sourceById = new Map(sources.map((source) => [String(source.id), source]));
	const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
	const trackById = new Map(tracks.map((track) => [String(track.id), track]));
	const assigned = new Map<string, ProjectDataRecord>();
	for (const clip of [...clips, ...binClips]) validateClipSourceBounds(clip, sourceById);
	for (const track of tracks) {
		if (track.type === 'label') continue;
		for (const clipId of projectUniqueStrings(track.clipIds, `track ${String(track.id)}.clipIds`)) {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Track ${String(track.id)} references a missing clip.`);
			if (clip.kind !== track.type) throw new RangeError(`Track ${String(track.id)} cannot contain a ${String(clip.kind)} clip.`);
			if (assigned.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			assigned.set(clipId, track);
		}
		if (track.type === 'video') validateVideoTrackComposition(track, clipById);
	}
	if (assigned.size !== clips.length) throw new RangeError('Every clip must belong to exactly one media track.');
	validateStateReferences(project, clipById, trackById);
	validateLaneGroups(tracks);
	validateAvLinks(clips, assigned);
	validateBinItems(binClips);
}

function validateClipSourceBounds(
	clip: ProjectDataRecord,
	sourceById: ReadonlyMap<string, ProjectDataRecord>,
): void {
	const source = sourceById.get(String(clip.sourceId));
	if (!source) throw new ReferenceError(`Clip ${String(clip.id)} references a missing source.`);
	if (source.kind !== clip.kind) throw new RangeError(`Clip ${String(clip.id)} references a different source kind.`);
	const sourceStart = Number(clip.sourceStartFrame);
	const sourceDuration = Number(clip.sourceDurationFrames);
	const trimStart = Number(clip.trimStartFrames);
	const trimEnd = Number(clip.trimEndFrames);
	const sourceFrames = Number(source.frameCount);
	if (sourceStart + sourceDuration > sourceFrames) throw new RangeError(`Clip ${String(clip.id)} exceeds its source bounds.`);
	if (trimStart > sourceStart) throw new RangeError(`Clip ${String(clip.id)} has an invalid leading trim range.`);
	if (sourceStart + sourceDuration + trimEnd > sourceFrames) {
		throw new RangeError(`Clip ${String(clip.id)} has an invalid trailing trim range.`);
	}
}

function validateStateReferences(
	project: ProjectDataRecord,
	clipById: ReadonlyMap<string, ProjectDataRecord>,
	trackById: ReadonlyMap<string, ProjectDataRecord>,
): void {
	const selection = projectRecord(project.selection, 'project.selection');
	const view = projectRecord(project.view, 'project.view');
	for (const trackId of [
		...projectUniqueStrings(selection.trackIds, 'selection.trackIds'),
		...projectUniqueStrings(view.selectedTrackIds, 'view.selectedTrackIds'),
	]) {
		if (!trackById.has(trackId)) throw new ReferenceError(`Project state references missing track ${trackId}.`);
	}
	for (const clipId of projectUniqueStrings(selection.clipIds, 'selection.clipIds')) {
		if (!clipById.has(clipId)) throw new ReferenceError(`Selection references missing timeline clip ${clipId}.`);
	}
}

function validateLaneGroups(tracks: readonly ProjectDataRecord[]): void {
	const groups = new Map<string, Array<{ readonly index: number; readonly track: ProjectDataRecord }>>();
	for (const [index, track] of tracks.entries()) {
		if (track.laneGroupId === null) continue;
		const laneGroupId = projectString(track.laneGroupId, `track ${String(track.id)}.laneGroupId`);
		const entries = groups.get(laneGroupId) ?? [];
		entries.push({ index, track });
		groups.set(laneGroupId, entries);
	}
	for (const [laneGroupId, entries] of groups) {
		if (entries.length !== 2 || entries[0]?.track.type !== 'video'
			|| entries[1]?.track.type !== 'audio' || entries[1].index !== entries[0].index + 1) {
			throw new RangeError(`Media lane group ${laneGroupId} must contain one adjacent video/audio track pair.`);
		}
	}
}

function validateAvLinks(
	clips: readonly ProjectDataRecord[],
	assigned: ReadonlyMap<string, ProjectDataRecord>,
): void {
	const links = new Map<string, ProjectDataRecord[]>();
	for (const clip of clips) {
		if (clip.avLinkId === null) continue;
		const id = projectString(clip.avLinkId, `clip ${String(clip.id)}.avLinkId`);
		const entries = links.get(id) ?? [];
		entries.push(clip);
		links.set(id, entries);
	}
	for (const [id, entries] of links) {
		const audio = entries.find((clip) => clip.kind === 'audio');
		const video = entries.find((clip) => clip.kind === 'video');
		if (entries.length !== 2 || !audio || !video) {
			throw new RangeError(`A/V link ${id} must contain exactly one audio and one video clip.`);
		}
		if (audio.timelineStartFrame !== video.timelineStartFrame || audio.durationFrames !== video.durationFrames) {
			throw new RangeError(`A/V link ${id} clips must have aligned timeline ranges.`);
		}
		const audioTrack = assigned.get(String(audio.id));
		const videoTrack = assigned.get(String(video.id));
		if (!audioTrack?.laneGroupId || audioTrack.laneGroupId !== videoTrack?.laneGroupId) {
			throw new RangeError(`A/V link ${id} clips must belong to the same media lane group.`);
		}
	}
}

function validateBinItems(clips: readonly ProjectDataRecord[]): void {
	const items = new Map<string, ProjectDataRecord[]>();
	for (const clip of clips) {
		const id = projectString(clip.binItemId, `Project Bin clip ${String(clip.id)}.binItemId`);
		const entries = items.get(id) ?? [];
		entries.push(clip);
		items.set(id, entries);
	}
	for (const [id, entries] of items) {
		const audio = entries.filter((clip) => clip.kind === 'audio');
		const video = entries.filter((clip) => clip.kind === 'video');
		if (entries.length > 2 || audio.length > 1 || video.length > 1) {
			throw new RangeError(`Project Bin item ${id} can contain at most one audio and one video clip.`);
		}
		if (audio.length === 1 && video.length === 1 && audio[0]?.durationFrames !== video[0]?.durationFrames) {
			throw new RangeError(`Project Bin item ${id} clips must have aligned durations.`);
		}
	}
}

function recordArray(value: unknown, name: string): readonly ProjectDataRecord[] {
	return projectArray(value, name).map((item, index) => projectRecord(item, `${name}[${String(index)}]`));
}

function optionalString(value: unknown, name: string): void {
	if (value !== null) projectString(value, name);
}
