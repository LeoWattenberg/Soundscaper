/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION } from './project-library-contract.ts';
import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
	type AudioEditorProjectV17ValidationOptions,
} from '../src/common/editor/project-v17-validation.ts';

export type DesktopCurrentProject = AudioEditorProjectV17;

/** Apply the one exact maintained-domain validator admitted by the fresh desktop namespace. */
export function validateDesktopCurrentProject(
	value: unknown,
	options: AudioEditorProjectV17ValidationOptions = {},
): DesktopCurrentProject {
	if (!validateAudioEditorProjectV17(value, options)) {
		throw new TypeError('Desktop shared project failed current-schema validation');
	}
	if (value.schemaVersion !== DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Desktop shared project accepts only the current project schema');
	}
	return value;
}
