/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV12,
	createAudioEditorProjectV12,
	loadAudioEditorProjectV12,
	type AudioEditorProjectV12Options,
} from './project-v12.ts';
import {
	validateAudioEditorProjectV12,
	type AudioEditorProjectV12,
} from './project-v12-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV12;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV12Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV12;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV12;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV12;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV12;
