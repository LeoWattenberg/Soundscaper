/* SPDX-License-Identifier: AGPL-3.0-only */

import { createOpaqueProjectConsumer } from '../common/editor/project-opaque-consumer.ts';
import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	classifyProjectSchemaIdentity,
	type ProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';

export type SoundscaperOpaqueCustodyConsumerProject = ReturnType<typeof createOpaqueProjectConsumer<ProjectSchemaIdentity>>;

/** Build an inert consumer shell without traversing the foreign/future domain. */
export function createSoundscaperOpaqueCustodyConsumerProject(
	value: unknown,
): SoundscaperOpaqueCustodyConsumerProject {
	const classification = classifyProjectSchemaIdentity(value, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY);
	if (classification.disposition === 'current') {
		throw new TypeError('Current Soundscaper projects do not use opaque custody.');
	}
	return createOpaqueProjectConsumer(value, classification.identity);
}
