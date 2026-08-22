/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
type LinkedClipKind = 'audio' | 'video';

/** Keep a fresh linked video and its audio peer in one inherited V19 segment. */
export function framescaperV20FreshVideoAddAvLinkIds(command: unknown): readonly string[] {
	const type = commandType(command);
	if (type !== 'clip/add' && type !== 'project-bin/add') return Object.freeze([]);
	const clip = commandClip(command, type);
	if (dataProperty(clip, 'kind', `${type} clip`) !== 'video') return Object.freeze([]);
	const avLinkId = optionalDataProperty(clip, 'avLinkId', `${type} clip`);
	return typeof avLinkId === 'string' && avLinkId.length > 0
		? Object.freeze([avLinkId])
		: Object.freeze([]);
}

export function framescaperV20SegmentContainsAvLinkPeer(
	commands: readonly unknown[],
	avLinkId: string,
): boolean {
	return segmentAvLinkKinds(commands, avLinkId).size > 0;
}

export function framescaperV20SegmentContainsAvLinkPair(
	commands: readonly unknown[],
	avLinkId: string,
): boolean {
	const kinds = segmentAvLinkKinds(commands, avLinkId);
	return kinds.has('audio') && kinds.has('video');
}

function segmentAvLinkKinds(
	commands: readonly unknown[],
	avLinkId: string,
): ReadonlySet<LinkedClipKind> {
	const kinds = new Set<LinkedClipKind>();
	for (const command of commands) {
		const type = commandType(command);
		if (type !== 'clip/add' && type !== 'project-bin/add') continue;
		const clip = commandClip(command, type);
		if (optionalDataProperty(clip, 'avLinkId', `${type} clip`) !== avLinkId) continue;
		const kind = dataProperty(clip, 'kind', `${type} clip`);
		if (kind === 'audio' || kind === 'video') kinds.add(kind);
	}
	return kinds;
}

function commandClip(command: unknown, type: string): DataRecord {
	const record = dataRecord(command, `Framescaper V20 ${type} command`);
	return dataRecord(
		dataProperty(record, 'clip', `Framescaper V20 ${type} command`),
		`${type} clip`,
	);
}

function commandType(value: unknown): string {
	const record = dataRecord(value, 'Framescaper V20 command');
	const type = dataProperty(record, 'type', 'Framescaper V20 command');
	if (typeof type !== 'string' || type.length === 0) {
		throw new TypeError('Framescaper V20 command.type must be a non-empty string.');
	}
	return type;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function dataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
