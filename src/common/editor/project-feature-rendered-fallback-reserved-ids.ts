/* SPDX-License-Identifier: AGPL-3.0-only */

/** Collision scan shared by whole-project audio and video rendered-fallback projections. */

type RecordValue = Readonly<Record<string, unknown>>;

export interface ProjectFeatureRenderedFallbackReservedIdAccessors {
	readonly dataProperty: (value: RecordValue, key: string, name: string) => unknown;
	readonly arrayValue: (value: unknown, name: string) => readonly unknown[];
	readonly recordValue: (value: unknown, name: string) => RecordValue;
	readonly isRecord: (value: unknown) => value is RecordValue;
}

export function assertProjectFeatureRenderedFallbackReservedIdsAvailable(
	project: RecordValue,
	ids: Readonly<{ readonly track: string; readonly clip: string }>,
	accessors: ProjectFeatureRenderedFallbackReservedIdAccessors,
): void {
	for (const [collection, id, kind] of [
		['tracks', ids.track, 'track'],
		['clips', ids.clip, 'clip'],
	] as const) {
		const values = accessors.arrayValue(accessors.dataProperty(project, collection, 'project'), `project.${collection}`);
		if (values.some((candidate, index) => accessors.isRecord(candidate)
			&& accessors.dataProperty(candidate, 'id', `project.${collection}[${String(index)}]`) === id)) {
			throw new RangeError(`The reserved rendered-fallback ${kind} ID collides with project state.`);
		}
	}
	const projectBin = accessors.recordValue(
		accessors.dataProperty(project, 'projectBin', 'project'), 'project.projectBin',
	);
	const binClips = accessors.arrayValue(
		accessors.dataProperty(projectBin, 'clips', 'project.projectBin'), 'project.projectBin.clips',
	);
	if (binClips.some((candidate, index) => accessors.isRecord(candidate)
		&& accessors.dataProperty(candidate, 'id', `project.projectBin.clips[${String(index)}]`) === ids.clip)) {
		throw new RangeError('The reserved rendered-fallback clip ID collides with Project Bin state.');
	}
}
