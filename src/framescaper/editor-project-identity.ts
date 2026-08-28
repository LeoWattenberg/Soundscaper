/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	classifyProjectSchemaIdentity,
	isCurrentProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';

/** Admit only the family-qualified Framescaper 1.0 project domain. */
export function assertFramescaperProjectIdentity(value: unknown): void {
	const classification = classifyProjectSchemaIdentity(
		value,
		FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	);
	if (classification.disposition !== 'current') {
		throw new RangeError(
			`Framescaper ${String(PROJECT_SCHEMA_VERSION)} cannot author a ${classification.disposition} project.`,
		);
	}
}

export function hasFramescaperProjectIdentity(value: unknown): boolean {
	return isCurrentProjectSchemaIdentity(value, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
}
