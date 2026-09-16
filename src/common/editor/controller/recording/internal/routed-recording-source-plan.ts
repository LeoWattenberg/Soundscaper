/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingRoute, RecordingTrack, RoutedTrackRoute } from '../recording-transaction-types.ts';

export interface RoutedRecordingSourcePlan {
	readonly assigned: readonly RoutedTrackRoute[];
	readonly skippedTrackIds: readonly string[];
	readonly groups: readonly Readonly<{
		readonly sourceKey: string;
		readonly routes: readonly RoutedTrackRoute[];
	}>[];
}

/** Create a deterministic, display-first permission plan without touching UI state. */
export function planRoutedRecordingSources(
	tracks: readonly RecordingTrack[],
	routes: Readonly<Record<string, RecordingRoute>>,
	sourceKey: (route: RecordingRoute) => string,
): RoutedRecordingSourcePlan {
	const assigned: RoutedTrackRoute[] = [];
	const skippedTrackIds: string[] = [];
	const groups = new Map<string, RoutedTrackRoute[]>();
	for (const track of tracks) {
		const route = routes[track.id];
		if (!route) {
			skippedTrackIds.push(track.id);
			continue;
		}
		const item = Object.freeze({ track, route, sourceKey: sourceKey(route) });
		assigned.push(item);
		const group = groups.get(item.sourceKey) || [];
		group.push(item);
		groups.set(item.sourceKey, group);
	}
	const ordered = [...groups.entries()]
		.sort(([left], [right]) => (left === 'display' ? -1 : right === 'display' ? 1 : 0))
		.map(([key, groupRoutes]) => Object.freeze({ sourceKey: key, routes: Object.freeze(groupRoutes) }));
	return Object.freeze({
		assigned: Object.freeze(assigned),
		skippedTrackIds: Object.freeze(skippedTrackIds),
		groups: Object.freeze(ordered),
	});
}
