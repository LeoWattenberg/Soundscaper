/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertFrame } from '../project.js';
import { requireStableCommandId } from './shared-runtime.js';

type Payload = { clipId?: unknown; sourceStartFrame?: unknown; sourceInFrame?: unknown; sourceFrameCount?: unknown };
type Range = { sourceStartFrame: number; sourceDurationFrames?: number };
/** Mapping normally allocates one outer array and one discarded tuple for every clip. */
export function sourceCommandRanges(entries: Payload[], reprobe: boolean): Map<string, Range> {
	if (entries.length < 16 || Object.getPrototypeOf(entries) !== Array.prototype || Object.hasOwn(entries, 'map') || Object.hasOwn(entries, 'forEach') || Object.hasOwn(entries, 'constructor')) {
		return new Map(entries.map(entry => [requireStableCommandId(entry?.clipId, 'clip'), reprobe ? {
			sourceStartFrame: assertFrame(entry.sourceInFrame, 'clip.sourceInFrame'),
			sourceDurationFrames: assertFrame(entry.sourceFrameCount, 'clip.sourceFrameCount'),
		} : { sourceStartFrame: assertFrame(entry.sourceStartFrame, 'clip.sourceStartFrame') }]));
	}
	const result = new Map<string, Range>(), length = entries.length;
	let visited = 0;
	entries.forEach(entry => {
		const id = requireStableCommandId(entry?.clipId, 'clip');
		const value = reprobe ? {
			sourceStartFrame: assertFrame(entry.sourceInFrame, 'clip.sourceInFrame'),
			sourceDurationFrames: assertFrame(entry.sourceFrameCount, 'clip.sourceFrameCount'),
		} : { sourceStartFrame: assertFrame(entry.sourceStartFrame, 'clip.sourceStartFrame') };
		result.set(id, value); visited++;
	});
	// map preserves holes; Map's iterator rejects the first missing tuple after
	// every map callback has run. Preserve that diagnostic and publication point.
	if (visited !== length) throw new TypeError('Iterator value undefined is not an entry object');
	return result;
}
