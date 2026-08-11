/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION } from './project-library-contract.ts';
import {
	validateAudioEditorProjectV16,
	type AudioEditorProjectV16,
	type AudioEditorProjectV16ValidationOptions,
} from '../src/common/editor/project-v16-validation.ts';

export type DesktopCurrentProject = AudioEditorProjectV16;

/** Apply the one exact maintained-domain validator admitted by the fresh desktop namespace. */
export function validateDesktopCurrentProject(
	value: unknown,
	options: AudioEditorProjectV16ValidationOptions = {},
): DesktopCurrentProject {
	if (!validateAudioEditorProjectV16(value, options)) {
		throw new TypeError('Desktop shared project failed current-schema validation');
	}
	if (value.schemaVersion !== DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Desktop shared project accepts only the current project schema');
	}
	return value;
}
