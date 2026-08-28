/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION } from
	'../common/editor/project-schema-identity.ts';

export const FRAMESCAPER_COMPATIBILITY_CONTRACT = Object.freeze({
	owner: 'framescaper' as const,
	schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	schemaVersion: PROJECT_SCHEMA_VERSION,
	scapeFormatVersions: Object.freeze([1] as const),
	attachedScapeFormatVersion: 1 as const,
	activation: 'selected' as const,
});
