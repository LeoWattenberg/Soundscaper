/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../src/common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import {
	validateFramescaperProjectV28,
	type FramescaperProjectV28,
} from '../src/framescaper/editor-project-v28-validation.ts';

/** Apply the selected V19 desktop library's exact V28 document boundary. */
export function validateFramescaperDesktopV19CurrentProjectV28(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
): FramescaperProjectV28 {
	if (profile !== FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V28 runtime profile is required.');
	}
	validateFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, value);
	return value as FramescaperProjectV28;
}
