/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	loadFramescaperProjectV32,
	type LoadedFramescaperProjectV32,
} from './editor-project-v32.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';

export interface MigratedFramescaperProjectV32 extends LoadedFramescaperProjectV32 {
	readonly migrated: false;
	readonly fromVersion: number;
}

/** V32 never implicitly upgrades V28; reimport remains an explicit user operation. */
export function migrateFramescaperProjectV32(
	profile: unknown,
	value: unknown,
): MigratedFramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	const loaded = loadFramescaperProjectV32(profile, value);
	return Object.freeze({
		...loaded,
		migrated: false,
		fromVersion: Number((loaded.project as Readonly<Record<string, unknown>>).schemaVersion),
	});
}
