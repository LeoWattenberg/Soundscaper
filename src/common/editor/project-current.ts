/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV11,
	createAudioEditorProjectV11,
	loadAudioEditorProjectV11,
	type AudioEditorProjectV11Options,
} from './project-v11.ts';
import {
	validateAudioEditorProjectV11,
	type AudioEditorProjectV11,
} from './project-v11-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV11;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV11Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV11;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV11;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV11;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV11;
