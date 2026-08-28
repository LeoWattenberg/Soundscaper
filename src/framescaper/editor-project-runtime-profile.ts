/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { createEditorProjectRuntimeProfilePrerequisite } from
	'../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE } from
	'./editor-project-feature-capabilities.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';

/**
 * Authenticated Framescaper 1.0 capability profile.
 *
 * The capability registrations are independent wire/domain contracts, so the
 * baseline retains the already-audited selected profile object while removing
 * its milestone generation from the public runtime API.
 */
const prerequisite = createEditorProjectRuntimeProfilePrerequisite({
	owner: 'framescaper',
	projectSchemaVersion: 1,
	storageProfile: FRAMESCAPER_PROJECT_STORAGE_PROFILE,
	priorSchemaPolicy: 'reimport-required',
	futureSchemaPolicy: 'opaque-read-only',
	scapeFormatVersions: [1],
	attachedScapeFormatVersion: 1,
	desktopLibrarySchemaVersion: 1,
	desktopProjectSchemaVersion: 1,
	desktopDatabaseUserVersion: 1,
	desktopLibraryScope: ['kw.media', 'framescaper-project-library', 'v1'],
});

export const FRAMESCAPER_PROJECT_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite,
	capabilityProfile: FRAMESCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE,
});

export function assertFramescaperProjectRuntimeProfile(
	profile: unknown,
): asserts profile is typeof FRAMESCAPER_PROJECT_RUNTIME_PROFILE {
	if (profile !== FRAMESCAPER_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The authenticated Framescaper 1.0 runtime profile is required.');
	}
}
