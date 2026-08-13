/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v19.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
} from './editor-project-runtime-profile-v19-prerequisite.ts';

export const FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE,
});
