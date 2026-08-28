/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../src/common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	validateFramescaperProject,
	type FramescaperProject,
} from '../src/framescaper/editor-project.ts';

/** Apply the Framescaper 1.0 desktop library's exact family-qualified boundary. */
export function validateFramescaperDesktopCurrentProject(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown = FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
): FramescaperProject {
	if (profile !== FRAMESCAPER_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper 1.0 runtime profile is required.');
	}
	validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, value);
	return value as FramescaperProject;
}
