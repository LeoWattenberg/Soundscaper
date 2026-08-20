/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	preparePersistedProjectCommandDraft,
	projectForRuntimeConsumers,
	validateCurrentAudioEditorProject,
} from './project-current-runtime.ts';

export { createStableId } from './stable-id.js';

export const AUDIO_EDITOR_SAMPLE_RATE = 48_000;
export const AUDIO_EDITOR_MASTER_CHANNELS = 2;
export const EDITOR_TIMELINE_MINIMUM_SECONDS = 30;

/** @template Value @param {Value} value @returns {Value} */
function plainClone(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function isoTimestamp(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required.');
	return date.toISOString();
}

/** @template Project @param {Project} project @returns {Project} */
export function cloneProject(project) {
	return plainClone(project);
}

export function assertFrame(value, name = 'frame') {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

export function assertPositiveFrame(value, name = 'durationFrames') {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

export function normalizeFrameRange(startFrame, endFrame, name = 'range') {
	assertFrame(startFrame, `${name}.startFrame`);
	assertFrame(endFrame, `${name}.endFrame`);
	if (endFrame <= startFrame) throw new RangeError(`${name} must have a positive duration.`);
	return { startFrame, endFrame, durationFrames: endFrame - startFrame };
}

export function findSource(project, sourceId) {
	return project.sources.find((source) => source.id === sourceId) || null;
}

export function findTrack(project, trackId) {
	return project.tracks.find((track) => track.id === trackId) || null;
}

export function findClip(project, clipId) {
	return project.clips.find((clip) => clip.id === clipId) || null;
}

export function findProjectBinClip(project, clipId) {
	return project?.projectBin?.clips?.find((clip) => clip.id === clipId) || null;
}

export function findClipTrack(project, clipId) {
	return project.tracks.find((track) => Array.isArray(track.clipIds) && track.clipIds.includes(clipId)) || null;
}

export function clipEndFrame(clip) {
	return clip.timelineStartFrame + clip.durationFrames;
}

export function clipsOverlap(first, second) {
	return first.timelineStartFrame < clipEndFrame(second)
		&& second.timelineStartFrame < clipEndFrame(first);
}

export function projectDurationFrames(project) {
	const runtimeProject = projectForRuntimeConsumers(project);
	let endFrame = runtimeProject.clips.reduce((maximum, clip) => Math.max(maximum, clipEndFrame(clip)), 0);
	for (const track of runtimeProject.tracks || []) {
		if (track.type !== 'label') continue;
		for (const label of track.labels || []) endFrame = Math.max(endFrame, label.endFrame);
	}
	return endFrame;
}

export function editorTimelineDurationFrames(project, sampleRate = project.sampleRate) {
	const rate = Number(sampleRate) > 0 ? Number(sampleRate) : AUDIO_EDITOR_SAMPLE_RATE;
	return Math.max(
		projectDurationFrames(project) * 2,
		Math.round(rate * EDITOR_TIMELINE_MINIMUM_SECONDS),
	);
}

export function aggregateStereoMinutes(project) {
	const usedSourceIds = new Set(project.clips
		.filter((clip) => clip.kind !== 'video')
		.map((clip) => clip.sourceId));
	const uniqueSources = new Map(project.sources
		.filter((source) => source.kind !== 'video' && usedSourceIds.has(source.id))
		.map((source) => [source.id, source]));
	let channelSeconds = 0;
	for (const source of uniqueSources.values()) {
		const sourceRate = Number(source.sampleRate) || Number(project.sampleRate) || AUDIO_EDITOR_SAMPLE_RATE;
		channelSeconds += source.frameCount / sourceRate * source.channelCount;
	}
	return channelSeconds / ((project.masterChannels || AUDIO_EDITOR_MASTER_CHANNELS) * 60);
}

export function projectEnvelope(project, options = {}) {
	const mobile = Boolean(options.mobile);
	const limits = mobile
		? { trackCount: 4, stereoMinutes: 10 }
		: { trackCount: 8, stereoMinutes: 30 };
	const actual = {
		trackCount: project.tracks.filter((track) => track.type == null || track.type === 'audio').length,
		stereoMinutes: aggregateStereoMinutes(project),
	};
	const exceeded = {
		tracks: actual.trackCount > limits.trackCount,
		stereoMinutes: actual.stereoMinutes > limits.stereoMinutes,
	};
	return {
		mobile,
		limits,
		actual,
		exceeded,
		supported: !exceeded.tracks && !exceeded.stereoMinutes,
	};
}

export function commitProject(project, mutate, options = {}) {
	const persistedBase = options.persistedBase || project;
	validateAudioEditorProject(persistedBase);
	const draft = cloneProject(project);
	mutate(draft);
	draft.revision = project.revision + 1;
	draft.updatedAt = isoTimestamp(options.now);
	preparePersistedProjectCommandDraft(draft, persistedBase);
	validateAudioEditorProject(draft);
	return draft;
}

/** Validate the exact current shared project document. */
export function validateAudioEditorProject(project) {
	if (!project || typeof project !== 'object' || Array.isArray(project)) {
		throw new TypeError('An audio editor project is required.');
	}
	if (validateCurrentAudioEditorProject(project)) return true;
	throw new RangeError(`Unsupported audio editor schema version: ${String(project.schemaVersion)}.`);
}
