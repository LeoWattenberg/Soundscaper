import { createStableId } from './project.js';
import {
	AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
} from './project-v2.js';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 4;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;
export const AUDIO_EDITOR_MEDIA_KINDS = Object.freeze(['audio', 'video']);
export const AUDIO_EDITOR_TRACK_TYPES = Object.freeze(['audio', 'video', 'label']);

const MEDIA_KIND_SET = new Set(AUDIO_EDITOR_MEDIA_KINDS);
const TRACK_TYPE_SET = new Set(AUDIO_EDITOR_TRACK_TYPES);

/**
 * @typedef {import('./project-v2.js').AudioEditorSourceV2 & {
 *   kind: 'audio',
 * }} AudioEditorAudioSourceV4
 */

/**
 * Video source ranges use project-rate frames. The original encoded bytes and
 * generated preview derivatives remain outside project snapshots.
 *
 * @typedef {Object} AudioEditorVideoSourceV4
 * @property {'video'} kind
 * @property {string} id
 * @property {string} name
 * @property {string} mimeType
 * @property {string} storageKey
 * @property {number} frameCount
 * @property {number} sampleRate
 * @property {number} width
 * @property {number} height
 * @property {number} frameRate
 * @property {string} videoCodec
 * @property {string|null} audioCodec
 * @property {boolean} hasAudio
 * @property {string|null} posterStorageKey
 * @property {string|null} thumbnailStorageKey
 * @property {*} opaqueExtensions
 */

/**
 * @typedef {import('./project-v2.js').AudioEditorClipV2 & {
 *   kind: 'audio',
 *   avLinkId: string|null,
 *   binItemId: string|null,
 * }} AudioEditorAudioClipV4
 */

/**
 * @typedef {Object} AudioEditorVideoClipV4
 * @property {'video'} kind
 * @property {string} id
 * @property {string} sourceId
 * @property {string} title
 * @property {number} timelineStartFrame
 * @property {number} sourceStartFrame
 * @property {number} sourceDurationFrames
 * @property {number} durationFrames
 * @property {number} trimStartFrames
 * @property {number} trimEndFrames
 * @property {string|null} groupId
 * @property {string} color
 * @property {number} speedRatio
 * @property {string|null} avLinkId
 * @property {string|null} binItemId
 * @property {*} opaqueExtensions
 */

/**
 * @typedef {import('./project-v2.js').AudioEditorAudioTrackV2 & {
 *   laneGroupId: string|null,
 * }} AudioEditorAudioTrackV4
 */

/**
 * @typedef {Object} AudioEditorVideoTrackV4
 * @property {'video'} type
 * @property {string} id
 * @property {string} name
 * @property {string[]} clipIds
 * @property {boolean} mute
 * @property {boolean} hidden
 * @property {boolean} collapsed
 * @property {number} height
 * @property {string|null} laneGroupId
 * @property {*} opaqueExtensions
 */

/**
 * @typedef {import('./project-v2.js').AudioEditorLabelTrackV2 & {
 *   laneGroupId: null,
 * }} AudioEditorLabelTrackV4
 */

/**
 * @typedef {Object} AudioEditorProjectBinV4
 * @property {(AudioEditorAudioClipV4|AudioEditorVideoClipV4)[]} clips
 */

/**
 * @typedef {Omit<import('./project-v3.js').AudioEditorProjectV3, 'schemaVersion'|'sources'|'clips'|'tracks'|'projectBin'> & {
 *   schemaVersion: 4,
 *   sources: (AudioEditorAudioSourceV4|AudioEditorVideoSourceV4)[],
 *   clips: (AudioEditorAudioClipV4|AudioEditorVideoClipV4)[],
 *   tracks: (AudioEditorAudioTrackV4|AudioEditorVideoTrackV4|AudioEditorLabelTrackV4)[],
 *   projectBin: AudioEditorProjectBinV4,
 * }} AudioEditorProjectV4
 */

function plainClone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function optionalId(value, name) {
	return value == null ? null : nonEmptyString(value, name);
}

function optionalString(value, name) {
	if (value == null || value === '') return null;
	return nonEmptyString(value, name);
}

function safeInteger(value, minimum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
	}
	return number;
}

function positiveFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function uniqueStrings(values, name) {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
	const result = values.map((value, index) => nonEmptyString(value, `${name}[${index}]`));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

/** @returns {AudioEditorAudioSourceV4} */
export function createAudioSourceV4(options = {}) {
	return {
		...createAudioSourceV2(options),
		kind: 'audio',
	};
}

/** @returns {AudioEditorVideoSourceV4} */
export function createVideoSourceV4(options = {}, projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE) {
	const sampleRate = safeInteger(options.sampleRate ?? projectSampleRate, 1, 'source.sampleRate');
	const hasAudio = Boolean(options.hasAudio ?? options.audioCodec);
	return {
		kind: 'video',
		id: options.id || createStableId('video-source'),
		name: String(options.name || 'Video source'),
		mimeType: String(options.mimeType || 'video/mp4'),
		storageKey: nonEmptyString(String(options.storageKey || options.id || createStableId('video')), 'source.storageKey'),
		frameCount: safeInteger(options.frameCount, 1, 'source.frameCount'),
		sampleRate,
		width: safeInteger(options.width, 1, 'source.width'),
		height: safeInteger(options.height, 1, 'source.height'),
		frameRate: positiveFinite(options.frameRate ?? 30, 'source.frameRate'),
		videoCodec: String(options.videoCodec || 'unknown'),
		audioCodec: optionalString(options.audioCodec, 'source.audioCodec'),
		hasAudio,
		posterStorageKey: optionalString(options.posterStorageKey, 'source.posterStorageKey'),
		thumbnailStorageKey: optionalString(options.thumbnailStorageKey, 'source.thumbnailStorageKey'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

export function createMediaSourceV4(options = {}, projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE) {
	const kind = options?.kind ?? 'audio';
	if (!MEDIA_KIND_SET.has(kind)) throw new RangeError(`Unsupported source kind: ${kind}.`);
	return kind === 'video'
		? createVideoSourceV4(options, projectSampleRate)
		: createAudioSourceV4(options);
}

/** @returns {AudioEditorAudioClipV4} */
export function createAudioClipV4(options = {}) {
	return {
		...createAudioClipV2(options),
		kind: 'audio',
		avLinkId: optionalId(options.avLinkId, 'clip.avLinkId'),
		binItemId: optionalId(options.binItemId, 'clip.binItemId'),
	};
}

/** @returns {AudioEditorVideoClipV4} */
export function createVideoClipV4(options = {}) {
	const durationFrames = safeInteger(options.durationFrames, 1, 'clip.durationFrames');
	return {
		kind: 'video',
		id: options.id || createStableId('video-clip'),
		sourceId: nonEmptyString(options.sourceId, 'clip.sourceId'),
		title: String(options.title || 'Video clip'),
		timelineStartFrame: safeInteger(options.timelineStartFrame ?? 0, 0, 'clip.timelineStartFrame'),
		sourceStartFrame: safeInteger(options.sourceStartFrame ?? 0, 0, 'clip.sourceStartFrame'),
		sourceDurationFrames: safeInteger(options.sourceDurationFrames ?? durationFrames, 1, 'clip.sourceDurationFrames'),
		durationFrames,
		trimStartFrames: safeInteger(options.trimStartFrames ?? 0, 0, 'clip.trimStartFrames'),
		trimEndFrames: safeInteger(options.trimEndFrames ?? 0, 0, 'clip.trimEndFrames'),
		groupId: optionalId(options.groupId, 'clip.groupId'),
		color: nonEmptyString(options.color || 'auto', 'clip.color'),
		speedRatio: positiveFinite(options.speedRatio ?? 1, 'clip.speedRatio'),
		avLinkId: optionalId(options.avLinkId, 'clip.avLinkId'),
		binItemId: optionalId(options.binItemId, 'clip.binItemId'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

export function createMediaClipV4(options = {}) {
	const kind = options?.kind ?? 'audio';
	if (!MEDIA_KIND_SET.has(kind)) throw new RangeError(`Unsupported clip kind: ${kind}.`);
	return kind === 'video' ? createVideoClipV4(options) : createAudioClipV4(options);
}

/** @returns {AudioEditorAudioTrackV4} */
export function createAudioTrackV4(options = {}, projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE) {
	return {
		...createAudioTrackV2(options, projectSampleRate),
		laneGroupId: optionalId(options.laneGroupId, 'track.laneGroupId'),
	};
}

/** @returns {AudioEditorVideoTrackV4} */
export function createVideoTrackV4(options = {}) {
	return {
		type: 'video',
		id: options.id || createStableId('video-track'),
		name: String(options.name || 'Video track'),
		clipIds: uniqueStrings(options.clipIds || [], 'track.clipIds'),
		mute: Boolean(options.mute),
		hidden: Boolean(options.hidden),
		collapsed: Boolean(options.collapsed),
		height: safeInteger(options.height ?? 120, 40, 'track.height'),
		laneGroupId: optionalId(options.laneGroupId, 'track.laneGroupId'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

/** @returns {AudioEditorLabelTrackV4} */
export function createLabelTrackV4(options = {}) {
	if (options.laneGroupId != null) throw new RangeError('Label tracks cannot belong to a media lane group.');
	return {
		...createLabelTrackV2(options),
		laneGroupId: null,
	};
}

export function createMediaTrackV4(options = {}, projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE) {
	if (!options || !TRACK_TYPE_SET.has(options.type)) {
		throw new RangeError(`Unsupported track type: ${options?.type}.`);
	}
	if (options.type === 'video') return createVideoTrackV4(options);
	if (options.type === 'label') return createLabelTrackV4(options);
	return createAudioTrackV4(options, projectSampleRate);
}

/** @returns {AudioEditorProjectBinV4} */
export function createProjectBinV4(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (value.clips != null && !Array.isArray(value.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}
	return {
		...plainClone(value),
		clips: (value.clips || []).map((candidate) => {
			const clip = createMediaClipV4(candidate);
			return {
				...clip,
				binItemId: clip.binItemId || clip.id,
			};
		}),
	};
}

/** @returns {AudioEditorProjectV4} */
export function createAudioEditorProjectV4(options = {}) {
	const {
		projectBin,
		sources = [],
		clips = [],
		tracks = [],
		...baseOptions
	} = options;
	const project = createAudioEditorProjectV2({
		...baseOptions,
		sources: [],
		clips: [],
		tracks: [],
	});
	return {
		...project,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		sources: sources.map((source) => createMediaSourceV4(source, project.sampleRate)),
		clips: clips.map(createMediaClipV4),
		tracks: tracks.map((track) => createMediaTrackV4(track, project.sampleRate)),
		projectBin: createProjectBinV4(projectBin || {}),
	};
}

/** @param {AudioEditorProjectV4} project @returns {AudioEditorProjectV4} */
export function cloneAudioEditorProjectV4(project) {
	return plainClone(project);
}

/** @param {AudioEditorProjectV4} project @returns {true} */
