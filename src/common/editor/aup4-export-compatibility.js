/* SPDX-License-Identifier: AGPL-3.0-only */

// What an AUP4 export has to tell the user it could not carry. Audacity 4 has
// no video, and its realtime racks accept only the effects with a native
// profile, so the exporter drops that content deliberately and records each
// omission by name in the compatibility report rather than letting it vanish.
// Split out of aup4-export.js; no behaviour changes here.

import { AUP4_REALTIME_EFFECT_PROFILES, canEncodeAup4NativeRealtimeEffect } from './aup4-effects.js';
import { audioEffectLabel } from './effects.js';
import { addAup4CompatibilityItem } from './aup4-profile.js';
import { isAup4AudioTrack, isAup4VideoClip, isAup4VideoTrack } from './aup4-omitted-features.js';

export function reportAup4EffectCompatibility(project, report) {
	for (const track of project.tracks || []) {
		if (!isAup4AudioTrack(track)) continue;
		reportRackEffects(track.effects, {
			kind: 'track',
			trackId: track.id,
			name: track.name,
		}, report, track.effectsActive !== false);
	}
	reportRackEffects(
		project.master?.effects,
		{ kind: 'master' },
		report,
		project.master?.effectsActive !== false,
	);
}

export function omitVideoContent(normalizedProject, originalProject) {
	const sourceById = new Map((originalProject.sources || []).map((source) => [source.id, source]));
	const videoTrackIds = new Set((originalProject.tracks || [])
		.filter(isAup4VideoTrack)
		.map((track) => String(track.id)));
	const videoClipIds = new Set((originalProject.clips || [])
		.filter((clip) => isAup4VideoClip(clip, sourceById))
		.map((clip) => String(clip.id)));
	for (const track of originalProject.tracks || []) {
		if (!isAup4VideoTrack(track)) continue;
		for (const clipId of track.clipIds || []) videoClipIds.add(String(clipId));
	}

	normalizedProject.clips = (normalizedProject.clips || [])
		.filter((clip) => !videoClipIds.has(String(clip.id)))
		.map((clip) => (
			Object.hasOwn(clip, 'avLinkId') ? { ...clip, avLinkId: null } : clip
		));
	normalizedProject.tracks = (normalizedProject.tracks || [])
		.filter((track) => !videoTrackIds.has(String(track.id)) && !isAup4VideoTrack(track))
		.map((track) => (
			Array.isArray(track.clipIds)
				? {
					...track,
					clipIds: track.clipIds.filter((clipId) => !videoClipIds.has(String(clipId))),
					...(Object.hasOwn(track, 'laneGroupId') ? { laneGroupId: null } : {}),
				}
				: track
		));

	const retainedTrackIds = new Set(normalizedProject.tracks.map((track) => String(track.id)));
	const retainedClipIds = new Set(normalizedProject.clips.map((clip) => String(clip.id)));
	if (normalizedProject.selection) {
		if (Array.isArray(normalizedProject.selection.trackIds)) {
			normalizedProject.selection.trackIds = filterRetainedIds(
				normalizedProject.selection.trackIds,
				retainedTrackIds,
			);
		}
		if (Array.isArray(normalizedProject.selection.clipIds)) {
			normalizedProject.selection.clipIds = filterRetainedIds(
				normalizedProject.selection.clipIds,
				retainedClipIds,
			);
		}
	}
	if (normalizedProject.view) {
		if (Array.isArray(normalizedProject.view.selectedTrackIds)) {
			normalizedProject.view.selectedTrackIds = filterRetainedIds(
				normalizedProject.view.selectedTrackIds,
				retainedTrackIds,
			);
		}
		if (Array.isArray(normalizedProject.view.selectedClipIds)) {
			normalizedProject.view.selectedClipIds = filterRetainedIds(
				normalizedProject.view.selectedClipIds,
				retainedClipIds,
			);
		}
	}
}

function filterRetainedIds(ids, retainedIds) {
	return ids.filter((id) => retainedIds.has(String(id)));
}

function reportRackEffects(effects, scope, report, rackActive) {
	for (const [effectIndex, effect] of (effects || []).entries()) {
		const active = rackActive && effect?.enabled !== false;
		if (effect?.type === 'missing') {
			addAup4CompatibilityItem(report, {
				code: 'MISSING_REALTIME_EFFECT',
				severity: active ? 'warning' : 'info',
				disposition: 'missing',
				scope: { ...scope, effectIndex, effectId: effect.id },
				data: {
					name: String(effect.missing?.name || 'Unknown effect'),
					nativeId: String(effect.missing?.nativeId || ''),
					reason: String(effect.missing?.reason || 'plugin-unavailable'),
					active,
				},
			});
			continue;
		}
		const nativeProfile = AUP4_REALTIME_EFFECT_PROFILES[effect?.type];
		if (nativeProfile && canEncodeAup4NativeRealtimeEffect(effect)) continue;
		let name = String(effect?.type || 'Unknown effect');
		try { name = audioEffectLabel(effect.type, 'en'); }
		catch { /* Keep the stable type as a bounded fallback. */ }
		addAup4CompatibilityItem(report, {
			code: nativeProfile
				? 'AUDACITY_EFFECT_UNSUPPORTED_STATE_EXPORTED_AS_MISSING'
				: 'SOUNDSCAPER_EFFECT_EXPORTED_AS_MISSING',
			severity: active ? 'warning' : 'info',
			disposition: 'missing',
			scope: { ...scope, effectIndex, effectId: effect.id },
			data: {
				name,
				type: effect?.type,
				active,
				...(nativeProfile ? {
					hasContext: effect?.context !== undefined,
					hasState: effect?.state !== undefined,
					extraParams: Object.keys(effect?.params || {}).filter((parameter) => {
						const known = new Set(nativeProfile.params
							.filter((descriptor) => descriptor.model)
							.map((descriptor) => descriptor.model));
						if (nativeProfile.curve) known.add('points');
						if (nativeProfile.bands) known.add('gains');
						return !known.has(parameter);
					}),
				} : {}),
			},
		});
	}
}
