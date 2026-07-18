import { createStableId } from './project.js';
import {
	AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
	AUDIO_EDITOR_TRACK_COLORS,
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	validateAudioEditorProjectV2,
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

function assertUniqueIds(items, type) {
	const ids = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`Every ${type} needs an ID.`);
		if (ids.has(item.id)) throw new RangeError(`Duplicate ${type} ID: ${item.id}.`);
		ids.add(item.id);
	}
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
export function validateAudioEditorProjectV4(project) {
	if (!project || typeof project !== 'object') throw new TypeError('An audio editor project is required.');
	if (project.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Project sources, clips, and tracks must be arrays.');
	}
	if (!project.projectBin || typeof project.projectBin !== 'object' || Array.isArray(project.projectBin)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (!Array.isArray(project.projectBin.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}

	assertUniqueIds(project.sources, 'source');
	assertUniqueIds([...project.clips, ...project.projectBin.clips], 'clip');
	assertUniqueIds(project.tracks, 'track');
	assertDiscriminators(project);
	for (const clip of project.clips) {
		if (clip.binItemId != null) throw new RangeError(`Timeline clip ${clip.id} cannot have a bin item ID.`);
	}
	for (const clip of project.projectBin.clips) {
		if (clip.avLinkId != null) throw new RangeError(`Project Bin clip ${clip.id} cannot have an A/V link ID.`);
		nonEmptyString(clip.binItemId, `Project Bin clip ${clip.id}.binItemId`);
	}

	const normalized = createAudioEditorProjectV4({ ...project, now: project.createdAt });
	validateAudioProjectPortion(normalized);
	validateMediaGraph(normalized);
	return true;
}

function assertDiscriminators(project) {
	for (const source of project.sources) {
		if (!MEDIA_KIND_SET.has(source?.kind)) throw new RangeError(`Unsupported source kind: ${source?.kind}.`);
	}
	for (const clip of [...project.clips, ...project.projectBin.clips]) {
		if (!MEDIA_KIND_SET.has(clip?.kind)) throw new RangeError(`Unsupported clip kind: ${clip?.kind}.`);
	}
	for (const track of project.tracks) {
		if (!TRACK_TYPE_SET.has(track?.type)) throw new RangeError(`Unsupported track type: ${track?.type}.`);
	}
}

function validateAudioProjectPortion(project) {
	const audioSourceIds = new Set(project.sources.filter((source) => source.kind === 'audio').map((source) => source.id));
	const audioClipIds = new Set(project.clips.filter((clip) => clip.kind === 'audio').map((clip) => clip.id));
	const audioTrackIds = new Set(project.tracks.filter((track) => track.type === 'audio').map((track) => track.id));
	const labelTrackIds = new Set(project.tracks.filter((track) => track.type === 'label').map((track) => track.id));
	const audioProject = {
		...project,
		schemaVersion: 2,
		sources: project.sources.filter((source) => audioSourceIds.has(source.id)),
		clips: project.clips.filter((clip) => audioClipIds.has(clip.id)),
		tracks: project.tracks.filter((track) => audioTrackIds.has(track.id) || labelTrackIds.has(track.id)),
		selection: {
			...project.selection,
			trackIds: (project.selection?.trackIds || []).filter((trackId) => audioTrackIds.has(trackId) || labelTrackIds.has(trackId)),
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
	validateAudioEditorProjectV2(audioProject);
}

function validateMediaGraph(project) {
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	const timelineClipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const assignedClipTrack = new Map();

	for (const source of project.sources) {
		if (source.kind === 'video') createVideoSourceV4(source, project.sampleRate);
	}
	for (const clip of project.clips) {
		validateClipSourceBounds(clip, sourceById);
		if (clip.binItemId != null) throw new RangeError(`Timeline clip ${clip.id} cannot have a bin item ID.`);
	}
	for (const clip of project.projectBin.clips) {
		validateClipSourceBounds(clip, sourceById);
		if (clip.avLinkId != null) throw new RangeError(`Project Bin clip ${clip.id} cannot have an A/V link ID.`);
		nonEmptyString(clip.binItemId, `Project Bin clip ${clip.id}.binItemId`);
	}

	for (const track of project.tracks) {
		if (track.type === 'label') {
			if (track.laneGroupId != null) throw new RangeError(`Label track ${track.id} cannot belong to a media lane group.`);
			continue;
		}
		if (track.type === 'video') createVideoTrackV4(track);
		for (const clipId of track.clipIds) {
			const clip = timelineClipById.get(clipId);
			if (!clip) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (clip.kind !== track.type) {
				throw new RangeError(`Track ${track.id} cannot contain a ${clip.kind} clip.`);
			}
			if (assignedClipTrack.has(clipId)) {
				throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			}
			assignedClipTrack.set(clipId, track);
		}
		if (track.type === 'video') validateVideoTrackClipOverlaps(track, timelineClipById);
	}
	if (assignedClipTrack.size !== project.clips.length) {
		throw new RangeError('Every clip must belong to exactly one media track.');
	}

	validateProjectStateReferences(project, timelineClipById, trackById);
	validateLaneGroups(project.tracks);
	validateAvLinks(project.clips, assignedClipTrack);
	validateBinItems(project.projectBin.clips);
}

function validateVideoTrackClipOverlaps(track, clipById) {
	const clips = track.clipIds
		.map((clipId) => clipById.get(clipId))
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
	for (let index = 1; index < clips.length; index += 1) {
		const previous = clips[index - 1];
		if (clips[index].timelineStartFrame < previous.timelineStartFrame + previous.durationFrames) {
			throw new RangeError(`Video clips overlap on track ${track.id}.`);
		}
	}
}

function validateClipSourceBounds(clip, sourceById) {
	const source = sourceById.get(clip.sourceId);
	if (!source) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
	if (clip.kind !== source.kind) {
		throw new RangeError(`Clip ${clip.id} cannot reference ${source.kind === 'audio' ? 'an' : 'a'} ${source.kind} source.`);
	}
	createMediaClipV4(clip);
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

function validateProjectStateReferences(project, clipById, trackById) {
	for (const trackId of [
		...(project.selection?.trackIds || []),
		...(project.view?.selectedTrackIds || []),
	]) {
		if (!trackById.has(trackId)) throw new ReferenceError(`Project state references missing track ${trackId}.`);
	}
	for (const clipId of project.selection?.clipIds || []) {
		if (!clipById.has(clipId)) throw new ReferenceError(`Selection references missing timeline clip ${clipId}.`);
	}
}

function validateLaneGroups(tracks) {
	const groups = new Map();
	for (const [index, track] of tracks.entries()) {
		if (track.laneGroupId == null) continue;
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

function validateAvLinks(clips, assignedClipTrack) {
	const links = new Map();
	for (const clip of clips) {
		if (clip.avLinkId == null) continue;
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
		if (
			audio.timelineStartFrame !== video.timelineStartFrame
			|| audio.durationFrames !== video.durationFrames
		) {
			throw new RangeError(`A/V link ${avLinkId} clips must have aligned timeline ranges.`);
		}
		const audioTrack = assignedClipTrack.get(audio.id);
		const videoTrack = assignedClipTrack.get(video.id);
		if (
			!audioTrack?.laneGroupId
			|| audioTrack.laneGroupId !== videoTrack?.laneGroupId
		) {
			throw new RangeError(`A/V link ${avLinkId} clips must belong to the same media lane group.`);
		}
	}
}

function validateBinItems(clips) {
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

export function loadAudioEditorProjectV4(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = Number(value.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: plainClone(value), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV4(value);
	const project = createAudioEditorProjectV4({ ...value, now: value.createdAt });
	validateAudioEditorProjectV4(project);
	return {
		project,
		readOnly: false,
		reason: null,
	};
}
