const AUDIO_EDITOR_SCHEMA_VERSION = 1;
export const AUDIO_EDITOR_SAMPLE_RATE = 48_000;
export const AUDIO_EDITOR_MASTER_CHANNELS = 2;
export const EDITOR_TIMELINE_MINIMUM_SECONDS = 30;

const ID_FALLBACK_RANDOM_LENGTH = 10;

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

export function createStableId(prefix = 'item') {
	const safePrefix = String(prefix || 'item').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'item';
	if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
		return `${safePrefix}-${globalThis.crypto.randomUUID()}`;
	}

	const random = Math.random().toString(36).slice(2, 2 + ID_FALLBACK_RANDOM_LENGTH);
	return `${safePrefix}-${Date.now().toString(36)}-${random}`;
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
	const usedSourceIds = new Set(project.clips.map((clip) => clip.sourceId));
	const uniqueSources = new Map(project.sources.filter((source) => usedSourceIds.has(source.id)).map((source) => [source.id, source]));
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
		trackCount: project.tracks.filter((track) => track.type !== 'label').length,
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
		const trackClips = [];
		for (const clipId of track.clipIds) {
			if (!clipIds.has(clipId)) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (assignedClipIds.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			assignedClipIds.add(clipId);
			trackClips.push(project.clips.find((clip) => clip.id === clipId));
		}
		trackClips.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
		for (let index = 1; index < trackClips.length; index += 1) {
			if (clipsOverlap(trackClips[index - 1], trackClips[index])) throw new RangeError(`Clips overlap on track ${track.id}.`);
		}
	}
	if (assignedClipIds.size !== project.clips.length) throw new RangeError('Every clip must belong to exactly one audio track.');
	finiteInRange(project.master?.gain, 0, 4, 'master.gain');
	if (!Array.isArray(project.master?.effects)) throw new TypeError('Master effects must be an array.');
	validateMixerV2Shape(project);
	return true;
}
