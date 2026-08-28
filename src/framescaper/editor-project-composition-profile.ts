/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';

/** Authenticate the one process-local Framescaper composition authority before traversal. */
export function assertFramescaperProjectCompositionProfile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper composition runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
