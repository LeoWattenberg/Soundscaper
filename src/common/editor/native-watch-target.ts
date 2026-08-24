/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected V28 has one exact writable media destination: its project bin. */
export const FRAMESCAPER_SELECTED_V28_WATCH_BIN_ID = 'project-bin' as const;

export interface FramescaperSelectedV28WatchContextAuthority {
	readonly writable: boolean;
	readonly videoImportAvailable: boolean;
	readonly proxyGenerationAvailable: boolean;
}

export function framescaperSelectedV28WatchTargetAvailable(
	project: unknown,
	authority: FramescaperSelectedV28WatchContextAuthority,
): boolean {
	if (!authority.writable || !authority.videoImportAvailable
		|| !project || typeof project !== 'object' || Array.isArray(project)) return false;
	const row = project as Readonly<Record<string, unknown>>;
	if (data(row, 'schemaVersion') !== 28) return false;
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
