import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	validateAudioEditorProjectV2,
} from './project-v2.js';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 3;
export const AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_SCHEMA_VERSION;

/**
 * Audio which belongs to a project without participating in its timeline.
 *
 * @typedef {Object} AudioEditorProjectBinV3
 * @property {import('./project-v2.js').AudioEditorClipV2[]} clips
 */

/**
 * @typedef {import('./project-v2.js').AudioEditorProjectV2 & {
 *   schemaVersion: 3,
 *   projectBin: AudioEditorProjectBinV3,
 * }} AudioEditorProjectV3
 */

function plainClone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function assertUniqueClipIds(clips) {
	const ids = new Set();
	for (const clip of clips) {
		if (!clip || typeof clip.id !== 'string' || !clip.id) throw new TypeError('Every clip needs an ID.');
		if (ids.has(clip.id)) throw new RangeError(`Duplicate clip ID: ${clip.id}.`);
		ids.add(clip.id);
	}
}

function validateClipSourceBounds(clip, sourceById) {
	const source = sourceById.get(clip.sourceId);
	if (!source) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
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

/** @returns {AudioEditorProjectBinV3} */
export function createProjectBinV3(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (value.clips != null && !Array.isArray(value.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}
	return {
		...plainClone(value),
		clips: (value.clips || []).map(createAudioClipV2),
	};
}

/** @returns {AudioEditorProjectV3} */
export function createAudioEditorProjectV3(options = {}) {
	const { projectBin, ...v2Options } = options;
	const project = createAudioEditorProjectV2(v2Options);
	return {
		...project,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		projectBin: createProjectBinV3(projectBin || {}),
	};
}

/** @param {AudioEditorProjectV3} project @returns {AudioEditorProjectV3} */
export function cloneAudioEditorProjectV3(project) {
	return plainClone(project);
}

/** @param {AudioEditorProjectV3} project @returns {true} */
export function validateAudioEditorProjectV3(project) {
	if (!project || typeof project !== 'object') throw new TypeError('An audio editor project is required.');
	if (project.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	if (!project.projectBin || typeof project.projectBin !== 'object' || Array.isArray(project.projectBin)) {
		throw new TypeError('project.projectBin must be an object.');
	}
	if (!Array.isArray(project.projectBin.clips)) {
		throw new TypeError('project.projectBin.clips must be an array.');
	}

	const timelineProject = { ...project, schemaVersion: 2 };
	delete timelineProject.projectBin;
	validateAudioEditorProjectV2(timelineProject);

	const normalizedBin = createProjectBinV3(project.projectBin);
	assertUniqueClipIds([...project.clips, ...normalizedBin.clips]);
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	for (const clip of normalizedBin.clips) validateClipSourceBounds(clip, sourceById);
	return true;
}

export function loadAudioEditorProjectV3(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = Number(value.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return { project: plainClone(value), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV3(value);
	return {
		project: createAudioEditorProjectV3({ ...value, now: value.createdAt }),
		readOnly: false,
		reason: null,
	};
}
