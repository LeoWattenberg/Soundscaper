/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../common/editor/code-unit-order.ts';
import type { PlaybackProjectProjection } from
	'../common/editor/controller/playback-project-service.ts';

/** Preserve media required by an inherited playback layer without changing the outer projection. */
export function inheritFramescaperPlaybackAdmission<Project extends object>(
	outer: PlaybackProjectProjection<Project>,
	inner: PlaybackProjectProjection<object>,
): PlaybackProjectProjection<Project> {
	return Object.freeze({
		...outer,
		requiredAudioSourceIds: sourceIds(outer.requiredAudioSourceIds, inner.requiredAudioSourceIds),
		requiredVideoSourceIds: sourceIds(outer.requiredVideoSourceIds, inner.requiredVideoSourceIds),
	});
}

function sourceIds(...groups: readonly (readonly string[])[]): readonly string[] {
	return Object.freeze([...new Set(groups.flat())].sort(compareCodeUnits));
}
