/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from './editor-project-feature-capability-profile-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
} from './editor-project-runtime-profile-v20-prerequisite.ts';

/** The authenticated selected V20 browser and desktop generation. */
export const FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
});
