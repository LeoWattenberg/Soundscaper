/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capability-profile-v23.ts';
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE_PREREQUISITE } from './editor-project-runtime-profile-v23-prerequisite.ts';

export const SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE_PREREQUISITE,
	capabilityProfile: SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE,
});
