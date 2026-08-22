/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../src/common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import {
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
	type FramescaperProjectV20ValidationOptions,
} from '../src/framescaper/editor-project-v20-validation.ts';

/** Apply the V12 desktop's one exact local owner and V20 document boundary. */
export function validateFramescaperDesktopCurrentProjectV20(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown = FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
	options: FramescaperProjectV20ValidationOptions = {},
): FramescaperProjectV20 {
	if (profile !== FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V20 runtime profile is required.');
	}
	validateFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, value, options);
	return value as FramescaperProjectV20;
}
