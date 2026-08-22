/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';

export type FramescaperProjectV20Profile = EditorProjectRuntimeProfile;

/** Compatibility name for callers compiled before V20 became the selected route. */
export const FRAMESCAPER_V20_PROJECT_MODEL_PROFILE = FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE;

/** Authenticate the process-local V20 model authority before document traversal. */
export function assertFramescaperProjectV20Profile(
	profile: unknown,
): asserts profile is FramescaperProjectV20Profile {
	if (profile !== FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V20 runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
