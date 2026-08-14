/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v21.ts';
import { SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v21-prerequisite.ts';

export const SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE,
});
