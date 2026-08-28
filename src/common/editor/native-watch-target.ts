/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	classifyProjectSchemaIdentity,
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
} from './project-schema-identity.ts';

/** Framescaper 1.0 has one exact writable media destination: its project bin. */
export const FRAMESCAPER_PROJECT_WATCH_BIN_ID = 'project-bin' as const;

export interface FramescaperProjectWatchContextAuthority {
	readonly writable: boolean;
	readonly videoImportAvailable: boolean;
	readonly proxyGenerationAvailable: boolean;
}

export function framescaperProjectWatchTargetAvailable(
	project: unknown,
	authority: FramescaperProjectWatchContextAuthority,
): boolean {
	if (!authority.writable || !authority.videoImportAvailable
		|| !project || typeof project !== 'object' || Array.isArray(project)) return false;
	const row = project as Readonly<Record<string, unknown>>;
	try {
		if (classifyProjectSchemaIdentity(row, FRAMESCAPER_PROJECT_SCHEMA_FAMILY).disposition
			!== 'current') return false;
	} catch { return false; }
	const bin = data(row, 'projectBin');
	if (!bin || typeof bin !== 'object' || Array.isArray(bin)
		|| Reflect.ownKeys(bin).length !== 1) return false;
	return Array.isArray(data(bin as Readonly<Record<string, unknown>>, 'clips'));
}

function data(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		? descriptor.value : undefined;
}
