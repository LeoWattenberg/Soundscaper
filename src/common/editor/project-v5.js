import {
	AUDIO_EDITOR_MEDIA_KINDS as V4_MEDIA_KINDS,
	AUDIO_EDITOR_TRACK_TYPES as V4_TRACK_TYPES,
	createAudioClipV4,
	createAudioEditorProjectV4,
	createAudioSourceV4,
	createAudioTrackV4,
	createLabelTrackV4,
	createMediaSourceV4,
	createMediaTrackV4,
	createVideoClipV4,
	createVideoSourceV4,
	createVideoTrackV4,
	validateAudioEditorProjectV4,
} from './project-v4.js';
import { normalizeVideoEffects } from './video-effects.js';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 5;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;
export const AUDIO_EDITOR_MEDIA_KINDS = V4_MEDIA_KINDS;
export const AUDIO_EDITOR_TRACK_TYPES = V4_TRACK_TYPES;

/**
 * @typedef {Object} AudioEditorVideoEffectV5
 * @property {string} id
 * @property {'color-adjust'|'pixelate'|'vignette'|'gaussian-blur'|'sharpen'|'rgb-split'} type
 * @property {boolean} enabled
 * @property {Record<string, number>} params
 */

/**
 * @typedef {import('./project-v4.js').AudioEditorVideoClipV4 & {
 *   videoEffects: AudioEditorVideoEffectV5[],
 * }} AudioEditorVideoClipV5
 */

/**
 * @typedef {Omit<import('./project-v4.js').AudioEditorProjectV4, 'schemaVersion'|'clips'|'projectBin'> & {
 *   schemaVersion: 5,
 *   clips: (import('./project-v4.js').AudioEditorAudioClipV4|AudioEditorVideoClipV5)[],
 *   projectBin: {clips: (import('./project-v4.js').AudioEditorAudioClipV4|AudioEditorVideoClipV5)[]},
 * }} AudioEditorProjectV5
 */

function plainClone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

export function createAudioSourceV5(options = {}) {
	return createAudioSourceV4(options);
}

export function createVideoSourceV5(options = {}, projectSampleRate) {
	return createVideoSourceV4(options, projectSampleRate);
}

export function createMediaSourceV5(options = {}, projectSampleRate) {
	return createMediaSourceV4(options, projectSampleRate);
}

export function createAudioClipV5(options = {}) {
	return createAudioClipV4(options);
}

/** @returns {AudioEditorVideoClipV5} */
export function createVideoClipV5(options = {}) {
	return {
		...createVideoClipV4(options),
		videoEffects: normalizeVideoEffects(
			Object.hasOwn(options, 'videoEffects') ? options.videoEffects : [],
			'clip.videoEffects',
		),
	};
}

export function createMediaClipV5(options = {}) {
	return options?.kind === 'video' ? createVideoClipV5(options) : createAudioClipV5(options);
}

export function createAudioTrackV5(options = {}, projectSampleRate) {
	return createAudioTrackV4(options, projectSampleRate);
}

export function createVideoTrackV5(options = {}) {
	return createVideoTrackV4(options);
}

export function createLabelTrackV5(options = {}) {
	return createLabelTrackV4(options);
}

export function createMediaTrackV5(options = {}, projectSampleRate) {
	return createMediaTrackV4(options, projectSampleRate);
}

export function createProjectBinV5(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (value.clips != null && !Array.isArray(value.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}
	return {
		...plainClone(value),
		clips: (value.clips || []).map((candidate) => {
			const clip = createMediaClipV5(candidate);
			return {
				...clip,
				binItemId: clip.binItemId || clip.id,
			};
		}),
	};
}

/** @returns {AudioEditorProjectV5} */
export function createAudioEditorProjectV5(options = {}) {
	const {
		projectBin,
		clips = [],
		...baseOptions
	} = options;
	const project = createAudioEditorProjectV4({
		...baseOptions,
		clips: [],
		projectBin: { ...(projectBin || {}), clips: [] },
	});
	return {
		...project,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		clips: clips.map(createMediaClipV5),
		projectBin: createProjectBinV5(projectBin || {}),
	};
}

/** @param {AudioEditorProjectV5} project @returns {AudioEditorProjectV5} */
export function cloneAudioEditorProjectV5(project) {
	return plainClone(project);
}

/** @param {AudioEditorProjectV5} project @returns {true} */
export function validateAudioEditorProjectV5(project) {
	if (!project || typeof project !== 'object') throw new TypeError('An audio editor project is required.');
	if (project.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	validateAudioEditorProjectV4({ ...project, schemaVersion: 4 });
	for (const clip of [...project.clips, ...project.projectBin.clips]) {
		if (clip.kind !== 'video') continue;
		if (!Array.isArray(clip.videoEffects)) {
			throw new TypeError(`Video clip ${clip.id}.videoEffects must be an array.`);
		}
		normalizeVideoEffects(clip.videoEffects, `Video clip ${clip.id}.videoEffects`);
	}
	return true;
}

export function loadAudioEditorProjectV5(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = Number(value.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: plainClone(value), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV5(value);
	const project = createAudioEditorProjectV5({ ...value, now: value.createdAt });
	validateAudioEditorProjectV5(project);
	return {
		project,
		readOnly: false,
		reason: null,
	};
}
