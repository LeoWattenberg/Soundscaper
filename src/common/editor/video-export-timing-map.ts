/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BoundVideoSourceTimingView } from './video-source-timing-view.ts';

type TimingEntry = readonly [string, BoundVideoSourceTimingView];

const TIMING_MAPS = new WeakMap<object, ReadonlyMap<string, BoundVideoSourceTimingView>>();

/** Build a process-owned read-only map whose internal slots cannot be mutated through Map intrinsics. */
export function createVideoExportTimingMap(
	entries: readonly TimingEntry[],
): ReadonlyMap<string, BoundVideoSourceTimingView> {
	const values = new Map<string, BoundVideoSourceTimingView>();
	for (const [sourceId, timing] of entries) {
		if (values.has(sourceId)) throw new RangeError(`Duplicate video export timing source ${sourceId}.`);
		values.set(sourceId, timing);
	}
	const view = new ImmutableVideoExportTimingMap(values);
	TIMING_MAPS.set(view, values);
	return Object.freeze(view);
}

export function isVideoExportTimingMap(
	value: unknown,
): value is ReadonlyMap<string, BoundVideoSourceTimingView> {
	return Boolean(value && typeof value === 'object' && TIMING_MAPS.has(value));
}

/** Snapshot authenticated timing entries without invoking caller-owned iterator methods. */
export function videoExportTimingMapEntries(
	value: ReadonlyMap<string, BoundVideoSourceTimingView>,
): readonly TimingEntry[] {
	const values = TIMING_MAPS.get(value as object);
	if (!values) throw new TypeError('An authenticated video export timing map is required.');
	return Object.freeze([...values].map(([sourceId, timing]): TimingEntry => (
		Object.freeze([sourceId, timing])
	)));
}

class ImmutableVideoExportTimingMap implements ReadonlyMap<string, BoundVideoSourceTimingView> {
	readonly [Symbol.toStringTag] = 'VideoExportTimingMap';

	constructor(values: ReadonlyMap<string, BoundVideoSourceTimingView>) {
		TIMING_MAPS.set(this, values);
	}

	get size(): number { return this.store().size; }

	get(key: string): BoundVideoSourceTimingView | undefined { return this.store().get(key); }

	has(key: string): boolean { return this.store().has(key); }

	entries(): MapIterator<[string, BoundVideoSourceTimingView]> { return this.store().entries(); }

	keys(): MapIterator<string> { return this.store().keys(); }

	values(): MapIterator<BoundVideoSourceTimingView> { return this.store().values(); }

	forEach(
		callback: (value: BoundVideoSourceTimingView, key: string, map: ReadonlyMap<string, BoundVideoSourceTimingView>) => void,
		thisArgument?: unknown,
	): void {
		this.store().forEach((value, key) => callback.call(thisArgument, value, key, this));
	}

	[Symbol.iterator](): MapIterator<[string, BoundVideoSourceTimingView]> { return this.entries(); }

	set(): never { throw new TypeError('Video export timing tokens are immutable.'); }

	delete(): never { throw new TypeError('Video export timing tokens are immutable.'); }

	clear(): never { throw new TypeError('Video export timing tokens are immutable.'); }

	private store(): ReadonlyMap<string, BoundVideoSourceTimingView> {
		const values = TIMING_MAPS.get(this);
		if (!values) throw new TypeError('The video export timing map is not authenticated.');
		return values;
	}
}
