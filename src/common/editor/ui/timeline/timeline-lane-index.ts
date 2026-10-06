/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TimelineLaneGeometry {
	readonly trackId: string;
	readonly top: number;
	readonly bottom: number;
	readonly label?: boolean;
}

/** Track rows are disjoint vertical intervals; retain geometry until layout changes. */
export function createTimelineLaneIndex(read: () => readonly TimelineLaneGeometry[]) {
	let lanes: readonly TimelineLaneGeometry[] | null = null;
	let audioLanes: readonly TimelineLaneGeometry[] = [];
	let byTrack = new Map<string, TimelineLaneGeometry>();
	const current = () => {
		if (lanes === null) {
			lanes = read().filter(lane => lane.bottom > lane.top).sort((a, b) => a.top - b.top);
			audioLanes = lanes.filter(lane => !lane.label);
			byTrack = new Map(lanes.map(lane => [lane.trackId, lane]));
		}
		return lanes;
	};
	const firstEndingAfter = (values: readonly TimelineLaneGeometry[], top: number) => {
		let low = 0; let high = values.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (values[middle]!.bottom <= top) low = middle + 1;
			else high = middle;
		}
		return low;
	};
	return {
		invalidate() { lanes = null; },
		prepare() { current(); },
		trackAt(y: number) {
			current();
			const lane = audioLanes[firstEndingAfter(audioLanes, y)];
			return lane && lane.top <= y ? lane.trackId : null;
		},
		selection(startTrackId: string, y: number): string[] | null {
			const values = current();
			const start = byTrack.get(startTrackId);
			if (!start) return null;
			const anchor = (start.top + start.bottom) / 2;
			const top = Math.min(anchor, y); const bottom = Math.max(anchor, y);
			const selected = new Set<string>();
			for (let index = firstEndingAfter(values, top); index < values.length && values[index]!.top <= bottom; index++) {
				selected.add(values[index]!.trackId);
			}
			selected.add(startTrackId);
			return [...selected];
		},
	};
}
