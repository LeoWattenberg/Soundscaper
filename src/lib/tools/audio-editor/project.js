import { validateVideoTrackComposition } from './video-timeline.js';
import { createStableId } from './stable-id.js';
import { normalizeVideoEffects } from './video-effects.js';

export { createStableId } from './stable-id.js';

const AUDIO_EDITOR_SCHEMA_VERSION = 1;
export const AUDIO_EDITOR_SAMPLE_RATE = 48_000;
export const AUDIO_EDITOR_MASTER_CHANNELS = 2;
export const EDITOR_TIMELINE_MINIMUM_SECONDS = 30;

/**
 * @typedef {Object} AudioEditorSourceV1
 * @property {string} id
 * @property {string} name
 * @property {string} mimeType
 * @property {string} storageKey
 * @property {number} frameCount
 * @property {1 | 2} channelCount
 * @property {48000} sampleRate
 * @property {number} originalSampleRate
 */

/**
 * @typedef {Object} AudioEditorClipV1
 * @property {string} id
 * @property {string} sourceId
 * @property {number} timelineStartFrame
 * @property {number} sourceStartFrame
 * @property {number} durationFrames
 * @property {number} gain
 * @property {number} fadeInFrames
 * @property {number} fadeOutFrames
 * @property {boolean} reversed
 */

/**
 * @typedef {Object} AudioEditorEffectV1
 * @property {string} id
 * @property {string} type
 * @property {boolean} enabled
 * @property {Record<string, *>} params
 * @property {Record<string, *> | null} [context]
 * @property {Record<string, *> | null} [state]
 */

/**
 * @typedef {Object} AudioEditorTrackV1
 * @property {string} id
 * @property {string} name
 * @property {number} gain
 * @property {number} pan
 * @property {boolean} mute
 * @property {boolean} solo
 * @property {boolean} armed
 * @property {AudioEditorEffectV1[]} effects
 * @property {string[]} clipIds
 */

/**
 * Canonical persistence document. PCM is referenced by immutable source keys and
 * never included in undo snapshots or serialized commands.
 *
 * @typedef {Object} AudioEditorProjectV1
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} title
 * @property {number} revision
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {48000} sampleRate
 * @property {2} masterChannels
 * @property {{ startFrame: number, endFrame: number }} selection
 * @property {{ enabled: boolean, startFrame: number, endFrame: number }} loop
 * @property {AudioEditorSourceV1[]} sources
 * @property {AudioEditorClipV1[]} clips
 * @property {AudioEditorTrackV1[]} tracks
 * @property {{ gain: number, effects: AudioEditorEffectV1[] }} master
 */

function plainClone(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function isoTimestamp(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required.');
	return date.toISOString();
}

/** @param {AudioEditorProjectV1} project @returns {AudioEditorProjectV1} */
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

/** @returns {AudioEditorSourceV1} */
function createAudioSource(options = {}) {
	const frameCount = assertPositiveFrame(options.frameCount, 'source.frameCount');
	const channelCount = Number(options.channelCount);
	if (channelCount !== 1 && channelCount !== 2) throw new RangeError('source.channelCount must be 1 or 2.');

	return {
		id: options.id || createStableId('source'),
		name: String(options.name || 'Audio source'),
		mimeType: String(options.mimeType || 'audio/wav'),
		storageKey: String(options.storageKey || options.id || createStableId('pcm')),
		frameCount,
		channelCount,
		sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
		originalSampleRate: Number.isFinite(options.originalSampleRate)
			? Math.round(options.originalSampleRate)
			: AUDIO_EDITOR_SAMPLE_RATE,
	};
}

/** @returns {AudioEditorTrackV1} */
function createAudioTrack(options = {}) {
	return {
		id: options.id || createStableId('track'),
		name: String(options.name || 'Track'),
		gain: finiteInRange(options.gain ?? 1, 0, 4, 'track.gain'),
		pan: finiteInRange(options.pan ?? 0, -1, 1, 'track.pan'),
		mute: Boolean(options.mute),
		solo: Boolean(options.solo),
		armed: Boolean(options.armed),
		effects: Array.isArray(options.effects) ? plainClone(options.effects) : [],
		clipIds: Array.isArray(options.clipIds) ? [...options.clipIds] : [],
	};
}

/** @returns {AudioEditorClipV1} */
function createAudioClip(options = {}) {
	const durationFrames = assertPositiveFrame(options.durationFrames, 'clip.durationFrames');
	const fadeInFrames = assertFrame(options.fadeInFrames ?? 0, 'clip.fadeInFrames');
	const fadeOutFrames = assertFrame(options.fadeOutFrames ?? 0, 'clip.fadeOutFrames');
	if (fadeInFrames > durationFrames || fadeOutFrames > durationFrames) {
		throw new RangeError('Clip fades cannot be longer than the clip.');
	}

	return {
		id: options.id || createStableId('clip'),
		sourceId: String(options.sourceId || ''),
		timelineStartFrame: assertFrame(options.timelineStartFrame ?? 0, 'clip.timelineStartFrame'),
		sourceStartFrame: assertFrame(options.sourceStartFrame ?? 0, 'clip.sourceStartFrame'),
		durationFrames,
		gain: finiteInRange(options.gain ?? 1, 0, 16, 'clip.gain'),
		fadeInFrames,
		fadeOutFrames,
		reversed: Boolean(options.reversed),
	};
}

function finiteInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
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

/** @param {AudioEditorProjectV1} project @returns {number} */
export function projectDurationFrames(project) {
	let endFrame = project.clips.reduce((maximum, clip) => Math.max(maximum, clipEndFrame(clip)), 0);
	for (const track of project.tracks || []) {
		if (track.type !== 'label') continue;
		for (const label of track.labels || []) endFrame = Math.max(endFrame, label.endFrame);
	}
	return endFrame;
}

/** @param {AudioEditorProjectV1} project @param {number} [sampleRate] @returns {number} */
export function editorTimelineDurationFrames(project, sampleRate = project.sampleRate) {
	const rate = Number(sampleRate) > 0 ? Number(sampleRate) : AUDIO_EDITOR_SAMPLE_RATE;
	return Math.max(
		projectDurationFrames(project) * 2,
		Math.round(rate * EDITOR_TIMELINE_MINIMUM_SECONDS),
	);
}

/** @param {AudioEditorProjectV1} project @returns {number} */
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
	validateAudioEditorProject(project);
	const draft = cloneProject(project);
	mutate(draft);
	draft.revision = project.revision + 1;
	draft.updatedAt = isoTimestamp(options.now);
	validateAudioEditorProject(draft);
	return draft;
}

/** @param {AudioEditorProjectV1} project @returns {true} */
export function validateAudioEditorProject(project) {
	if (!project || typeof project !== 'object') throw new TypeError('An audio editor project is required.');
	if (project.schemaVersion === 2) return validateProjectV2Shape(project);
	if (project.schemaVersion === 3) return validateProjectV3Shape(project);
	if (project.schemaVersion === 4) return validateProjectV4Shape(project);
	if (project.schemaVersion === 5) return validateProjectV5Shape(project);
	if (project.schemaVersion !== AUDIO_EDITOR_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	if (project.sampleRate !== AUDIO_EDITOR_SAMPLE_RATE || project.masterChannels !== AUDIO_EDITOR_MASTER_CHANNELS) {
		throw new RangeError('Audio editor projects must use a 48 kHz stereo master.');
	}
	assertFrame(project.revision, 'project.revision');
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Project sources, clips, and tracks must be arrays.');
	}

	assertUniqueIds(project.sources, 'source');
	assertUniqueIds(project.clips, 'clip');
	assertUniqueIds(project.tracks, 'track');
	const sourceIds = new Set(project.sources.map((source) => source.id));
	const clipIds = new Set(project.clips.map((clip) => clip.id));
	const referencedClipIds = new Set();

	for (const source of project.sources) createAudioSource(source);
	for (const clip of project.clips) {
		const normalized = createAudioClip(clip);
		if (!sourceIds.has(normalized.sourceId)) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
		const source = findSource(project, normalized.sourceId);
		if (normalized.sourceStartFrame + normalized.durationFrames > source.frameCount) {
			throw new RangeError(`Clip ${clip.id} exceeds its source bounds.`);
		}
	}

	for (const track of project.tracks) {
		createAudioTrack(track);
		if (!Array.isArray(track.clipIds)) throw new TypeError(`Track ${track.id} must contain clip IDs.`);
		const trackClips = [];
		for (const clipId of track.clipIds) {
			if (!clipIds.has(clipId)) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (referencedClipIds.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			referencedClipIds.add(clipId);
			trackClips.push(findClip(project, clipId));
		}
		trackClips.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame);
		for (let index = 1; index < trackClips.length; index += 1) {
			if (clipsOverlap(trackClips[index - 1], trackClips[index])) {
				throw new RangeError(`Clips overlap on track ${track.id}.`);
			}
		}
	}

	if (referencedClipIds.size !== project.clips.length) throw new RangeError('Every clip must belong to exactly one track.');
	finiteInRange(project.master?.gain, 0, 4, 'master.gain');
	if (!Array.isArray(project.master?.effects)) throw new TypeError('Master effects must be an array.');
	validateMixerV2Shape(project);
	return true;
}

function validateMixerV2Shape(project) {
	if (project.mixer == null) return;
	if (typeof project.mixer !== 'object' || Array.isArray(project.mixer)) throw new TypeError('project.mixer must be an object.');
	const groups = project.mixer.groups || [];
	const sends = project.mixer.sends || [];
	if (!Array.isArray(groups) || !Array.isArray(sends)) throw new TypeError('Mixer groups and sends must be arrays.');
	assertUniqueIds([...groups, ...sends], 'mixer bus');
	for (const bus of [...groups, ...sends]) {
		finiteInRange(bus.gain, 0, 4, `mixer bus ${bus.id}.gain`);
		finiteInRange(bus.pan, -1, 1, `mixer bus ${bus.id}.pan`);
		if (!Array.isArray(bus.effects)) throw new TypeError(`Mixer bus ${bus.id} effects must be an array.`);
	}
	const routes = project.mixer.routes || {};
	if (typeof routes !== 'object' || Array.isArray(routes)) throw new TypeError('Mixer routes must be an object.');
	const audioTrackIds = new Set(project.tracks.filter((track) => track.type === 'audio').map((track) => track.id));
	const groupIds = new Set(groups.map((bus) => bus.id));
	const sendIds = new Set(sends.map((bus) => bus.id));
	for (const [trackId, route] of Object.entries(routes)) {
		if (!audioTrackIds.has(trackId)) throw new ReferenceError(`Mixer route references missing audio track ${trackId}.`);
		if (!route || typeof route !== 'object' || Array.isArray(route)) throw new TypeError(`Mixer route ${trackId} must be an object.`);
		if (route.groupId != null && !groupIds.has(route.groupId)) throw new ReferenceError(`Mixer route references missing group bus ${route.groupId}.`);
		if (route.sends != null && (typeof route.sends !== 'object' || Array.isArray(route.sends))) throw new TypeError(`Mixer route ${trackId} sends must be an object.`);
		for (const [sendId, gain] of Object.entries(route.sends || {})) {
			if (!sendIds.has(sendId)) throw new ReferenceError(`Mixer route references missing send bus ${sendId}.`);
			finiteInRange(gain, 0, 4, `mixer route ${trackId} send ${sendId}`);
		}
	}
}

function assertUniqueIds(items, type) {
	const ids = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`Every ${type} needs an ID.`);
		if (ids.has(item.id)) throw new RangeError(`Duplicate ${type} ID: ${item.id}.`);
		ids.add(item.id);
	}
}

// Kept local rather than importing project-v2.js so the V2 factories can keep
// using createStableId() without introducing a project-module import cycle.
// Full normalization remains in project-v2.js; this validator protects the
// shared history/command boundary and deliberately accepts opaque extensions.
function validateProjectV2Shape(project) {
	if (!Number.isSafeInteger(project.revision) || project.revision < 0) throw new RangeError('project.revision must be a non-negative safe integer.');
	if (!Number.isSafeInteger(project.sampleRate) || project.sampleRate <= 0) throw new RangeError('project.sampleRate must be a positive safe integer.');
	if (!Number.isSafeInteger(project.masterChannels) || project.masterChannels <= 0) throw new RangeError('project.masterChannels must be a positive safe integer.');
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Project sources, clips, and tracks must be arrays.');
	}
	assertUniqueIds(project.sources, 'source');
	assertUniqueIds(project.clips, 'clip');
	assertUniqueIds(project.tracks, 'track');
	const sourceIds = new Set(project.sources.map((source) => source.id));
	const clipIds = new Set(project.clips.map((clip) => clip.id));
	const assignedClipIds = new Set();
	for (const source of project.sources) {
		assertPositiveFrame(source.frameCount, `source ${source.id}.frameCount`);
		assertPositiveFrame(source.sampleRate, `source ${source.id}.sampleRate`);
		assertPositiveFrame(source.channelCount, `source ${source.id}.channelCount`);
	}
	for (const clip of project.clips) {
		if (!sourceIds.has(clip.sourceId)) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
		assertFrame(clip.timelineStartFrame, `clip ${clip.id}.timelineStartFrame`);
		assertFrame(clip.sourceStartFrame, `clip ${clip.id}.sourceStartFrame`);
		assertPositiveFrame(clip.durationFrames, `clip ${clip.id}.durationFrames`);
		const sourceDurationFrames = clip.sourceDurationFrames ?? clip.durationFrames;
		assertPositiveFrame(sourceDurationFrames, `clip ${clip.id}.sourceDurationFrames`);
		const source = project.sources.find((candidate) => candidate.id === clip.sourceId);
		if (clip.sourceStartFrame + sourceDurationFrames > source.frameCount) throw new RangeError(`Clip ${clip.id} exceeds its source bounds.`);
	}
	for (const track of project.tracks) {
		if (track.type === 'label') {
			if (!Array.isArray(track.labels)) throw new TypeError(`Label track ${track.id} must contain labels.`);
			assertUniqueIds(track.labels, 'label');
			for (const label of track.labels) {
				assertFrame(label.startFrame, `label ${label.id}.startFrame`);
				assertFrame(label.endFrame, `label ${label.id}.endFrame`);
				if (label.endFrame < label.startFrame) throw new RangeError(`Label ${label.id} ends before it starts.`);
			}
			continue;
		}
		if (track.type !== 'audio') throw new RangeError(`Unsupported track type: ${track.type}.`);
		if (!Array.isArray(track.clipIds)) throw new TypeError(`Track ${track.id} must contain clip IDs.`);
		for (const clipId of track.clipIds) {
			if (!clipIds.has(clipId)) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (assignedClipIds.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			assignedClipIds.add(clipId);
		}
	}
	if (assignedClipIds.size !== project.clips.length) throw new RangeError('Every clip must belong to exactly one audio track.');
	finiteInRange(project.master?.gain, 0, 4, 'master.gain');
	if (!Array.isArray(project.master?.effects)) throw new TypeError('Master effects must be an array.');
	validateMixerV2Shape(project);
	return true;
}

function validateProjectV3Shape(project) {
	if (!project.projectBin || typeof project.projectBin !== 'object' || Array.isArray(project.projectBin)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (!Array.isArray(project.projectBin.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}
	validateProjectV2Shape(project);
	assertUniqueIds([...project.clips, ...project.projectBin.clips], 'clip');
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	for (const clip of project.projectBin.clips) {
		if (!sourceById.has(clip.sourceId)) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
		assertFrame(clip.timelineStartFrame, `clip ${clip.id}.timelineStartFrame`);
		assertFrame(clip.sourceStartFrame, `clip ${clip.id}.sourceStartFrame`);
		assertPositiveFrame(clip.durationFrames, `clip ${clip.id}.durationFrames`);
		const sourceDurationFrames = clip.sourceDurationFrames ?? clip.durationFrames;
		assertPositiveFrame(sourceDurationFrames, `clip ${clip.id}.sourceDurationFrames`);
		const source = sourceById.get(clip.sourceId);
		if (clip.sourceStartFrame + sourceDurationFrames > source.frameCount) {
			throw new RangeError(`Clip ${clip.id} exceeds its source bounds.`);
		}
	}
	const timelineClipIds = new Set(project.clips.map((clip) => clip.id));
	for (const clipId of project.selection?.clipIds || []) {
		if (!timelineClipIds.has(clipId)) throw new ReferenceError(`Selection references missing timeline clip ${clipId}.`);
	}
	return true;
}

function validateProjectV4Shape(project) {
	if (!project.projectBin || typeof project.projectBin !== 'object' || Array.isArray(project.projectBin)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (!Array.isArray(project.projectBin.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Project sources, clips, and tracks must be arrays.');
	}
	assertUniqueIds(project.sources, 'source');
	assertUniqueIds([...project.clips, ...project.projectBin.clips], 'clip');
	assertUniqueIds(project.tracks, 'track');
	for (const source of project.sources) {
		if (source.kind !== 'audio' && source.kind !== 'video') {
			throw new RangeError(`Unsupported source kind: ${source.kind}.`);
		}
	}
	for (const clip of [...project.clips, ...project.projectBin.clips]) {
		if (clip.kind !== 'audio' && clip.kind !== 'video') {
			throw new RangeError(`Unsupported clip kind: ${clip.kind}.`);
		}
	}
	for (const track of project.tracks) {
		if (!['audio', 'video', 'label'].includes(track.type)) {
			throw new RangeError(`Unsupported track type: ${track.type}.`);
		}
	}

	const audioSourceIds = new Set(project.sources
		.filter((source) => source.kind === 'audio')
		.map((source) => source.id));
	const audioClipIds = new Set(project.clips
		.filter((clip) => clip.kind === 'audio')
		.map((clip) => clip.id));
	const audioTrackIds = new Set(project.tracks
		.filter((track) => track.type === 'audio')
		.map((track) => track.id));
	const labelTrackIds = new Set(project.tracks
		.filter((track) => track.type === 'label')
		.map((track) => track.id));
	const audioProject = {
		...project,
		schemaVersion: 2,
		sources: project.sources.filter((source) => audioSourceIds.has(source.id)),
		clips: project.clips.filter((clip) => audioClipIds.has(clip.id)),
		tracks: project.tracks.filter((track) => audioTrackIds.has(track.id) || labelTrackIds.has(track.id)),
		selection: {
			...project.selection,
			trackIds: (project.selection?.trackIds || []).filter((trackId) => (
				audioTrackIds.has(trackId) || labelTrackIds.has(trackId)
			)),
			clipIds: (project.selection?.clipIds || []).filter((clipId) => audioClipIds.has(clipId)),
		},
		view: {
			...project.view,
			selectedTrackIds: (project.view?.selectedTrackIds || []).filter((trackId) => (
				audioTrackIds.has(trackId) || labelTrackIds.has(trackId)
			)),
		},
	};
	delete audioProject.projectBin;
	validateProjectV2Shape(audioProject);

	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	const timelineClipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const assignedClipTrack = new Map();
	for (const source of project.sources) {
		if (source.kind !== 'video') continue;
		assertPositiveFrame(source.frameCount, `source ${source.id}.frameCount`);
		assertPositiveFrame(source.sampleRate, `source ${source.id}.sampleRate`);
		assertPositiveFrame(source.width, `source ${source.id}.width`);
		assertPositiveFrame(source.height, `source ${source.id}.height`);
		if (!Number.isFinite(source.frameRate) || source.frameRate <= 0) {
			throw new RangeError(`source ${source.id}.frameRate must be positive.`);
		}
		if (typeof source.storageKey !== 'string' || !source.storageKey) {
			throw new TypeError(`source ${source.id}.storageKey must be a non-empty string.`);
		}
	}
	for (const clip of project.clips) {
		validateV4ClipBounds(clip, sourceById);
		if (clip.binItemId != null) throw new RangeError(`Timeline clip ${clip.id} cannot have a bin item ID.`);
	}
	for (const clip of project.projectBin.clips) {
		validateV4ClipBounds(clip, sourceById);
		if (clip.avLinkId != null) throw new RangeError(`Project Bin clip ${clip.id} cannot have an A/V link ID.`);
		if (typeof clip.binItemId !== 'string' || !clip.binItemId) {
			throw new TypeError(`Project Bin clip ${clip.id}.binItemId must be a non-empty string.`);
		}
	}
	for (const track of project.tracks) {
		if (track.type === 'label') {
			if (track.laneGroupId != null) throw new RangeError(`Label track ${track.id} cannot belong to a media lane group.`);
			continue;
		}
		if (!Array.isArray(track.clipIds)) throw new TypeError(`Track ${track.id} must contain clip IDs.`);
		for (const clipId of track.clipIds) {
			const clip = timelineClipById.get(clipId);
			if (!clip) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (clip.kind !== track.type) throw new RangeError(`Track ${track.id} cannot contain a ${clip.kind} clip.`);
			if (assignedClipTrack.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			assignedClipTrack.set(clipId, track);
		}
		if (track.type === 'video') validateVideoTrackComposition(track, timelineClipById);
	}
	if (assignedClipTrack.size !== project.clips.length) {
		throw new RangeError('Every clip must belong to exactly one media track.');
	}
	for (const trackId of [
		...(project.selection?.trackIds || []),
		...(project.view?.selectedTrackIds || []),
	]) {
		if (!trackById.has(trackId)) throw new ReferenceError(`Project state references missing track ${trackId}.`);
	}
	for (const clipId of project.selection?.clipIds || []) {
		if (!timelineClipById.has(clipId)) throw new ReferenceError(`Selection references missing timeline clip ${clipId}.`);
	}
	validateV4LaneGroups(project.tracks);
	validateV4AvLinks(project.clips, assignedClipTrack);
	validateV4BinItems(project.projectBin.clips);
	return true;
}

function validateProjectV5Shape(project) {
	validateProjectV4Shape(project);
	for (const clip of [...project.clips, ...project.projectBin.clips]) {
		if (clip.kind !== 'video') continue;
		if (!Array.isArray(clip.videoEffects)) {
			throw new TypeError(`Video clip ${clip.id}.videoEffects must be an array.`);
		}
		normalizeVideoEffects(clip.videoEffects, `Video clip ${clip.id}.videoEffects`);
	}
	return true;
}

function validateV4ClipBounds(clip, sourceById) {
	const source = sourceById.get(clip.sourceId);
	if (!source) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
	if (source.kind !== clip.kind) {
		throw new RangeError(`Clip ${clip.id} cannot reference ${source.kind === 'audio' ? 'an' : 'a'} ${source.kind} source.`);
	}
	assertFrame(clip.timelineStartFrame, `clip ${clip.id}.timelineStartFrame`);
	assertFrame(clip.sourceStartFrame, `clip ${clip.id}.sourceStartFrame`);
	assertPositiveFrame(clip.durationFrames, `clip ${clip.id}.durationFrames`);
	assertPositiveFrame(clip.sourceDurationFrames, `clip ${clip.id}.sourceDurationFrames`);
	assertFrame(clip.trimStartFrames, `clip ${clip.id}.trimStartFrames`);
	assertFrame(clip.trimEndFrames, `clip ${clip.id}.trimEndFrames`);
	if (clip.sourceStartFrame + clip.sourceDurationFrames > source.frameCount) {
		throw new RangeError(`Clip ${clip.id} exceeds its source bounds.`);
	}
	if (clip.trimStartFrames > clip.sourceStartFrame) {
		throw new RangeError(`Clip ${clip.id} has an invalid leading trim range.`);
	}
	if (clip.sourceStartFrame + clip.sourceDurationFrames + clip.trimEndFrames > source.frameCount) {
		throw new RangeError(`Clip ${clip.id} has an invalid trailing trim range.`);
	}
}

function validateV4LaneGroups(tracks) {
	const groups = new Map();
	for (const [index, track] of tracks.entries()) {
		if (track.laneGroupId == null) continue;
		if (typeof track.laneGroupId !== 'string' || !track.laneGroupId) {
			throw new TypeError(`track ${track.id}.laneGroupId must be a non-empty string.`);
		}
		const entries = groups.get(track.laneGroupId) || [];
		entries.push({ index, track });
		groups.set(track.laneGroupId, entries);
	}
	for (const [laneGroupId, entries] of groups) {
		if (
			entries.length !== 2
			|| entries[0].track.type !== 'video'
			|| entries[1].track.type !== 'audio'
			|| entries[1].index !== entries[0].index + 1
		) {
			throw new RangeError(`Media lane group ${laneGroupId} must contain one adjacent video/audio track pair.`);
		}
	}
}

function validateV4AvLinks(clips, assignedClipTrack) {
	const links = new Map();
	for (const clip of clips) {
		if (clip.avLinkId == null) continue;
		if (typeof clip.avLinkId !== 'string' || !clip.avLinkId) {
			throw new TypeError(`clip ${clip.id}.avLinkId must be a non-empty string.`);
		}
		const linked = links.get(clip.avLinkId) || [];
		linked.push(clip);
		links.set(clip.avLinkId, linked);
	}
	for (const [avLinkId, linked] of links) {
		const audio = linked.find((clip) => clip.kind === 'audio');
		const video = linked.find((clip) => clip.kind === 'video');
		if (linked.length !== 2 || !audio || !video) {
			throw new RangeError(`A/V link ${avLinkId} must contain exactly one audio and one video clip.`);
		}
		if (audio.timelineStartFrame !== video.timelineStartFrame || audio.durationFrames !== video.durationFrames) {
			throw new RangeError(`A/V link ${avLinkId} clips must have aligned timeline ranges.`);
		}
		const audioTrack = assignedClipTrack.get(audio.id);
		const videoTrack = assignedClipTrack.get(video.id);
		if (!audioTrack?.laneGroupId || audioTrack.laneGroupId !== videoTrack?.laneGroupId) {
			throw new RangeError(`A/V link ${avLinkId} clips must belong to the same media lane group.`);
		}
	}
}

function validateV4BinItems(clips) {
	const items = new Map();
	for (const clip of clips) {
		const grouped = items.get(clip.binItemId) || [];
		grouped.push(clip);
		items.set(clip.binItemId, grouped);
	}
	for (const [binItemId, grouped] of items) {
		const audioCount = grouped.filter((clip) => clip.kind === 'audio').length;
		const videoCount = grouped.filter((clip) => clip.kind === 'video').length;
		if (grouped.length > 2 || audioCount > 1 || videoCount > 1) {
			throw new RangeError(`Project Bin item ${binItemId} can contain at most one audio and one video clip.`);
		}
		if (
			audioCount === 1
			&& videoCount === 1
			&& grouped[0].durationFrames !== grouped[1].durationFrames
		) {
			throw new RangeError(`Project Bin item ${binItemId} clips must have aligned durations.`);
		}
	}
}
