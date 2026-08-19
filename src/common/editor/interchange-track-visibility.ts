/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMixerGraphAudibilityV21 } from './mixer-graph-audibility-v21.ts';
import { createVisibleVideoTrackPredicate } from './video-track-visibility.js';

/**
 * Which tracks an interchange profile may describe.
 *
 * An interchange file states what the programme is. If it describes tracks the
 * render would not produce, or omits tracks the render would, it is wrong in the
 * way that is hardest to notice — the file looks plausible and disagrees with the
 * editor. Playback and export are the same render here, and an exported edit
 * list is a statement about that render, so it answers to the same rules.
 *
 * Two rules, and they are not the same rule:
 *
 * - **Picture** composes unless hidden, and `mute` is explicitly independent of
 *   composition (`video-track-visibility.js`) so a future UI can use it for
 *   media audio without changing what is on screen. Solo is a statement about
 *   the whole set: while any video track is soloed, only soloed tracks compose.
 * - **Sound** is audible unless muted, with the same set-wide solo rule applied
 *   to audio tracks.
 *
 * The two exporters share this because they previously drifted: both tested
 * `hidden || mute` for every track, which dropped a muted video track that does
 * compose and kept unsoloed tracks that do not. The EDL adapter, which used the
 * shared video predicate, disagreed with both.
 */

interface TrackLike extends Readonly<Record<string, unknown>> {
	readonly type?: unknown;
	readonly hidden?: unknown;
	readonly mute?: unknown;
	readonly solo?: unknown;
}

export interface InterchangeVisibility {
	/** True when this track contributes to the programme an export would render. */
	readonly contributes: (track: TrackLike) => boolean;
	/** Why a track was left out, for the delivery report. */
	readonly reason: (track: TrackLike) => string;
}

export function createInterchangeVisibility(
	tracks: readonly TrackLike[],
	project?: unknown,
): InterchangeVisibility {
	const all = Array.isArray(tracks) ? tracks : [];
	const videoComposes = createVisibleVideoTrackPredicate(all);
	const audioSoloed = all.some((track) => track?.type === 'audio' && track.solo === true);
	// Once a routing graph exists, a track's own flags are not the whole answer:
	// solo is resolved over the routing, a group or send carries its own mute, and
	// a muted VCA zeroes every strip in it. The render honours all of that, so a
	// file that describes the render has to as well.
	const graph = project === undefined ? null : createMixerGraphAudibilityV21(project);

	const contributes = (track: TrackLike): boolean => {
		if (track?.type === 'video') return videoComposes(track);
		if (track?.type !== 'audio') return false;
		if (graph) return graph.audibleTrack(String(track.id));
		if (track.mute === true) return false;
		return audioSoloed ? track.solo === true : true;
	};

	return Object.freeze({
		contributes,
		reason: (track: TrackLike): string => {
			if (track?.type === 'video') {
				if (track.hidden === true) return 'hidden';
				return 'not soloed while another video track is';
			}
			if (graph) {
				const reason = graph.reason(String(track.id));
				if (reason === 'muted') return 'muted';
				return reason === 'not-soloed'
					? 'not soloed while another strip is'
					: 'routed only through strips that silence it';
			}
			if (track?.mute === true) return 'muted';
			return 'not soloed while another audio track is';
		},
	});
}
