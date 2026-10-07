/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;
const UNSAFE = Symbol('unsafe command data');
function record(value: unknown): value is DataRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function field(value: DataRecord, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return !descriptor ? undefined : Object.hasOwn(descriptor, 'value') ? descriptor.value as unknown : UNSAFE;
}
function ordinaryArray(value: unknown): value is unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.hasOwn(value, Symbol.iterator)) return false;
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
	}
	return true;
}
export function removedClipIds(tracks: readonly { clipIds?: unknown }[]): Set<unknown> {
	if (Object.getPrototypeOf(tracks) !== Array.prototype || Object.hasOwn(tracks, 'flatMap') || Object.hasOwn(tracks, 'constructor')) {
		return new Set(tracks.flatMap(track => track.clipIds || []));
	}
	// Both levels skip absent entries and snapshot length, like flatMap.
	const result = new Set<unknown>();
	Array.prototype.forEach.call(tracks, (track: { clipIds?: unknown }) => {
		const members = track.clipIds || [];
		if (Array.isArray(members)) Array.prototype.forEach.call(members, (id: unknown) => result.add(id));
		else result.add(members);
	});
	return result;
}

export interface LaneBlocks<T> { readonly blocks: T[][]; readonly firstBlock: ReadonlyMap<string, number> }
export function indexedLaneBlocks<T extends { id: unknown; laneGroupId?: unknown }>(tracks: T[]): LaneBlocks<T> | null {
	if (Object.hasOwn(tracks, 'filter') || Object.hasOwn(tracks, 'constructor') || !ordinaryArray(tracks)) return null;
	const groups = new Map<unknown, T[]>();
	for (const track of tracks) {
		if (!record(track) || typeof field(track, 'id') !== 'string' || field(track, 'laneGroupId') === UNSAFE) return null;
		const group = track.laneGroupId;
		if (group && typeof group !== 'string') return null;
		if (!group) continue;
		const members = groups.get(group) || [];
		if (!groups.has(group)) groups.set(group, members);
		members.push(track);
	}
	const blocks: T[][] = [], firstBlock = new Map<string, number>(), consumed = new Set<unknown>();
	for (const track of tracks) {
		const group = track.laneGroupId;
		if (group && consumed.has(group)) continue;
		if (group) consumed.add(group);
		const members = group ? groups.get(group)! : [track];
		for (const member of members) if (!firstBlock.has(member.id as string)) firstBlock.set(member.id as string, blocks.length);
		blocks.push(members);
	}
	return { blocks, firstBlock };
}

