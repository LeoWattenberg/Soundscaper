/* SPDX-License-Identifier: AGPL-3.0-only */

type ClipRecord = Record<string, unknown>;

/** The direct-handler compatibility path keeps spread/snapshot behavior for exotic collections. */
export function ordinarySourceClipCollection(value: unknown): value is ClipRecord[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| Object.hasOwn(value, Symbol.iterator)) return false;
	for (let index = 0; index < value.length; index++) {
		const entry = Object.getOwnPropertyDescriptor(value, String(index));
		if (!entry || !Object.hasOwn(entry, 'value')) return false;
		const clip = entry.value as unknown;
		if (!clip || typeof clip !== 'object' || (Object.getPrototypeOf(clip) !== Object.prototype && Object.getPrototypeOf(clip) !== null)) return false;
		const source = Object.getOwnPropertyDescriptor(clip, 'sourceId');
		if (!source || !Object.hasOwn(source, 'value')) return false;
		for (const key of ['sourceStartFrame', 'sourceDurationFrames', 'durationFrames']) {
			const bound = Object.getOwnPropertyDescriptor(clip, key);
			if (!bound || !Object.hasOwn(bound, 'value') || typeof bound.value !== 'number') return false;
		}
	}
	return true;
}

export function sourceReferences<T extends { sourceId: unknown }>(timeline: T[], bin: T[], sourceId: unknown): T[] {
	if (timeline.length + bin.length < 16 || !ordinarySourceClipCollection(timeline) || !ordinarySourceClipCollection(bin)) {
		return [...timeline, ...bin].filter(clip => clip.sourceId === sourceId);
	}
	const result: T[] = [];
	for (const clips of [timeline, bin]) for (const clip of clips) if (clip.sourceId === sourceId) result.push(clip);
	return result;
}

/** One first-match lookup remains authoritative even for duplicate source IDs. */
export function sourceForBounds<T extends { id: unknown }>(sources: T[], sourceId: unknown): T | undefined {
	if (Object.getPrototypeOf(sources) !== Array.prototype || Object.hasOwn(sources, 'find') || Object.hasOwn(sources, 'constructor')) return undefined;
	for (let index = 0; index < sources.length; index++) {
		const entry = Object.getOwnPropertyDescriptor(sources, String(index));
		if (!entry || !Object.hasOwn(entry, 'value')) return undefined;
		const value = entry.value as unknown;
		if (!value || typeof value !== 'object') return undefined;
		const id = Object.getOwnPropertyDescriptor(value, 'id');
		if (!id || !Object.hasOwn(id, 'value')) return undefined;
	}
	const source = sources.find(candidate => candidate.id === sourceId);
	if (!source || (Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null)) return undefined;
	const kind = Object.getOwnPropertyDescriptor(source, 'kind');
	const frames = Object.getOwnPropertyDescriptor(source, kind?.value === 'video' ? 'sourceFrameCount' : 'frameCount');
	if (!kind || !Object.hasOwn(kind, 'value') || typeof kind.value !== 'string' || !frames || !Object.hasOwn(frames, 'value') || typeof frames.value !== 'number') return undefined;
	for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(source))) {
		if (!Object.hasOwn(descriptor, 'value')) return undefined;
	}
	return source;
}

export function* sourceClipCollections<T>(timeline: T[], bin: T[]): Generator<T> {
	for (const clip of timeline) yield clip;
	for (const clip of bin) yield clip;
}

/** The reference array is invocation-local; retain ID getter order without a mapped intermediate. */
export function sourceReferenceIds<T extends { id: unknown }>(references: T[]): Set<unknown> {
	const ids = new Set<unknown>();
	references.forEach(clip => ids.add(clip.id));
	return ids;
}
