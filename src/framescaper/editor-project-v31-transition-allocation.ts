/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectCommandV31 } from './editor-project-v31-commands.ts';
import { prepareFramescaperVideoTransitionAllocationsV28 } from './editor-project-v28-transition-allocation.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import { validateFramescaperProjectV31 } from './editor-project-v31.ts';

export function prepareFramescaperVideoTransitionAllocationsV31(
	profile: unknown,
	project: unknown,
	command: FramescaperProjectCommandV31,
	createId: (prefix?: string) => string,
): FramescaperProjectCommandV31 {
	assertFramescaperProjectV31Profile(profile);
	validateFramescaperProjectV31(profile, project);
	return prepareFramescaperVideoTransitionAllocationsV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV28FoundationShapeV31(project),
		command,
		createId,
	);
}
