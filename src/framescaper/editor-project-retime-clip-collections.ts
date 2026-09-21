/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared timeline/Project Bin traversal for retime state and command projections. */

type DataRecord = Record<string, unknown>;
export type FramescaperRetimeClipScope = 'timeline' | 'project-bin';

export interface FramescaperRetimeClipAccessors {
	readonly record: (value: unknown, name: string) => DataRecord;
	readonly dataProperty: (value: DataRecord, key: string, name: string) => unknown;
}

export function visitFramescaperRetimeClipCollections(
	project: DataRecord,
	visit: (clip: DataRecord, name: string, scope: FramescaperRetimeClipScope) => void,
	accessors: FramescaperRetimeClipAccessors,
): void {
	visitClipArray(
		accessors.dataProperty(project, 'clips', 'Framescaper retime project'),
		'Framescaper retime project.clips', 'timeline', visit, accessors.record,
	);
	const projectBin = accessors.record(
		accessors.dataProperty(project, 'projectBin', 'Framescaper retime project'),
		'Framescaper retime project.projectBin',
	);
	visitClipArray(
		accessors.dataProperty(projectBin, 'clips', 'Framescaper retime project.projectBin'),
		'Framescaper retime project.projectBin.clips', 'project-bin', visit, accessors.record,
	);
}

function visitClipArray(
	value: unknown,
	name: string,
	scope: FramescaperRetimeClipScope,
	visit: (clip: DataRecord, name: string, scope: FramescaperRetimeClipScope) => void,
	record: FramescaperRetimeClipAccessors['record'],
): void {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		visit(record(descriptor.value, `${name}[${String(index)}]`), `${name}[${String(index)}]`, scope);
	}
}
