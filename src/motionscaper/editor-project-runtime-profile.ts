/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectFeatureCapabilityProfile } from '../common/editor/project-feature-capability-profile.ts';
import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { MOTIONSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';

const prerequisite = createEditorProjectRuntimeProfilePrerequisite({
	owner: 'motionscaper',
	projectSchemaVersion: 1,
	storageProfile: MOTIONSCAPER_PROJECT_STORAGE_PROFILE,
	priorSchemaPolicy: 'reimport-required',
	futureSchemaPolicy: 'opaque-read-only',
	scapeFormatVersions: [1],
	attachedScapeFormatVersion: 1,
	desktopLibrarySchemaVersion: 1,
	desktopProjectSchemaVersion: 1,
	desktopDatabaseUserVersion: 1,
	desktopLibraryScope: ['Motionscaper', 'project-library', 'v1'],
});

const capabilityProfile = createEditorProjectFeatureCapabilityProfile({
	owner: 'motionscaper',
	registrations: [
		{ key: 'motionComposition', featureId: 'org.motionscaper.capability.composition', available: false },
		{ key: 'motionDelivery', featureId: 'org.motionscaper.capability.delivery', available: false },
		{ key: 'motionExpressions', featureId: 'org.motionscaper.capability.expressions', available: false },
		{ key: 'motionScene3d', featureId: 'org.motionscaper.capability.scene-3d', available: false },
	],
});

export const MOTIONSCAPER_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite, capabilityProfile,
});

export function assertMotionscaperProjectRuntimeProfile(
	profile: unknown,
): asserts profile is typeof MOTIONSCAPER_PROJECT_RUNTIME_PROFILE {
	if (profile !== MOTIONSCAPER_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated Motionscaper family-v1 runtime profile is required.');
	}
}
