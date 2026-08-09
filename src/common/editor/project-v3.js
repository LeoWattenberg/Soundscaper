import {
	createAudioClipV2,
	createAudioEditorProjectV2,
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
