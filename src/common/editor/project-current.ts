/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneAudioEditorProjectV13,
	createAudioEditorProjectV13,
	loadAudioEditorProjectV13,
	type AudioEditorProjectV13Options,
} from './project-v13.ts';
import {
	validateAudioEditorProjectV13,
	type AudioEditorProjectV13,
} from './project-v13-validation.ts';

export {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
} from './project-schema-version.ts';

export type AudioEditorProjectCurrent = AudioEditorProjectV13;
export type AudioEditorProjectCurrentOptions = AudioEditorProjectV13Options;

export const createCurrentAudioEditorProject = createAudioEditorProjectV13;
export const cloneCurrentAudioEditorProject = cloneAudioEditorProjectV13;
export const loadCurrentAudioEditorProject = loadAudioEditorProjectV13;
export const validateCurrentAudioEditorProject = validateAudioEditorProjectV13;
