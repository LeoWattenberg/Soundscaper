/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';

export type FramescaperProjectRetimeProfile = EditorProjectRuntimeProfile;

/** Compatibility name for callers compiled before retime became the selected route. */
export const FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE = FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE;

/** Authenticate the process-local retime model authority before document traversal. */
export function assertFramescaperProjectRetimeProfile(
	profile: unknown,
): asserts profile is FramescaperProjectRetimeProfile {
	if (profile !== FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper retime runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
