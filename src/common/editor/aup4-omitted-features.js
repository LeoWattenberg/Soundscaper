/* SPDX-License-Identifier: AGPL-3.0-only */

import { addAup4CompatibilityItem } from './aup4-profile.js';

/**
 * What an AUP4 save leaves behind, and how it says so.
 *
 * Split out of the exporter so that "write the AUP4 document" and "report what
 * the AUP4 document cannot hold" stay separate concerns. The track-kind
 * predicates live here too, because every one of them exists to answer the same
 * question: which parts of this project does an audio-only format have no place
 * for.
 */

export function reportOmittedProjectFeatures(project, normalizedProject, report) {
	const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
	const videoTrackIds = new Set((project.tracks || [])
		.filter(isAup4VideoTrack)
		.map((track) => String(track.id)));
	const videoTrackClipIds = new Set((project.tracks || [])
		.filter(isAup4VideoTrack)
		.flatMap((track) => track.clipIds || [])
		.map(String));
	const timelineVideoClips = (project.clips || []).filter((clip) => (
		isAup4VideoClip(clip, sourceById) || videoTrackClipIds.has(String(clip.id))
	));
	const projectBinVideoClips = (project.projectBin?.clips || []).filter((clip) => (
		isAup4VideoClip(clip, sourceById)
	));
	const videoSources = (project.sources || []).filter(isAup4VideoSource);
	if (videoTrackIds.size || timelineVideoClips.length || projectBinVideoClips.length || videoSources.length) {
		addAup4CompatibilityItem(report, {
			code: 'VIDEO_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			message: 'AUP4 is audio-only. Video tracks, clips, and media were omitted from this exported copy.',
			scope: { kind: 'project' },
			data: {
				reason: 'aup4-audio-only',
				trackCount: videoTrackIds.size,
				timelineClipCount: timelineVideoClips.length,
				projectBinClipCount: projectBinVideoClips.length,
				sourceCount: videoSources.length,
			},
		});
	}

	const projectBinClips = Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
	if (projectBinClips.length) {
		addAup4CompatibilityItem(report, {
			code: 'PROJECT_BIN_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: {
				clipCount: projectBinClips.length,
				sourceCount: new Set(projectBinClips.map((clip) => clip.sourceId)).size,
			},
		});
	}
	if (Object.hasOwn(normalizedProject, 'projectBin')) normalizedProject.projectBin = { clips: [] };

	const mixer = project.mixer || {};
	for (const [buses, code] of [
		[mixer.groups, 'MIXER_GROUPS_OMITTED'],
		[mixer.sends, 'MIXER_SENDS_OMITTED'],
	]) {
		if (!Array.isArray(buses) || !buses.length) continue;
		const envelopes = buses.map((bus) => Array.isArray(bus?.envelope) ? bus.envelope : []);
		addAup4CompatibilityItem(report, {
			code,
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'mixer' },
			data: {
				count: buses.length,
				envelopeBusCount: envelopes.filter((envelope) => envelope.length > 0).length,
				envelopePointCount: envelopes.reduce((count, envelope) => count + envelope.length, 0),
			},
		});
	}
	for (const [busType, buses] of [['group', mixer.groups], ['send', mixer.sends]]) {
		for (const bus of buses || []) {
			if (!Array.isArray(bus.effects) || !bus.effects.length) continue;
			addAup4CompatibilityItem(report, {
				code: 'BUS_EFFECTS_OMITTED',
				severity: 'warning',
				disposition: 'omitted',
				scope: { kind: 'mixer-bus', busType, busId: bus.id },
				data: { count: bus.effects.length },
			});
		}
	}
	const routeCount = Object.keys(mixer.routes || {}).length;
	if (routeCount) addAup4CompatibilityItem(report, {
		code: 'MIXER_ROUTES_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		scope: { kind: 'mixer' },
		data: { count: routeCount },
	});
	normalizedProject.mixer = { groups: [], sends: [], routes: {} };

	const masterFields = [
		['gain', 1],
		['pan', 0],
		['mute', false],
		['solo', false],
	];
	for (const [field, nativeDefault] of masterFields) {
		const value = project.master?.[field] ?? nativeDefault;
		if (value === nativeDefault) continue;
		addAup4CompatibilityItem(report, {
			code: `MASTER_${field.toUpperCase()}_OMITTED`,
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'master' },
			data: { value },
		});
		normalizedProject.master[field] = nativeDefault;
	}
	if (Array.isArray(project.master?.envelope) && project.master.envelope.length) {
		addAup4CompatibilityItem(report, {
			code: 'MASTER_ENVELOPE_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'master' },
			data: { pointCount: project.master.envelope.length },
		});
		normalizedProject.master.envelope = [];
	}
	if (Number(project.masterChannels ?? 2) !== 2) {
		addAup4CompatibilityItem(report, {
			code: 'MASTER_CHANNEL_LAYOUT_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'master' },
			data: { channelCount: Number(project.masterChannels) },
		});
		normalizedProject.masterChannels = 2;
	}
	if (project.loop?.enabled || Number(project.loop?.startFrame || 0) !== 0 || Number(project.loop?.endFrame || 0) !== 0) {
		addAup4CompatibilityItem(report, {
			code: 'LOOP_REGION_OMITTED',
			severity: 'info',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: {
				startFrame: project.loop.startFrame,
				endFrame: project.loop.endFrame,
			},
		});
		normalizedProject.loop = { enabled: false, startFrame: 0, endFrame: 0 };
	}
	if (project.view?.panelState && Object.keys(project.view.panelState).length) {
		addAup4CompatibilityItem(report, {
			code: 'EDITOR_PANEL_STATE_OMITTED',
			severity: 'info',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: {},
		});
		normalizedProject.view.panelState = {};
	}
	for (let index = 0; index < project.tracks.length; index += 1) {
		const track = project.tracks[index];
		if (!isAup4AudioTrack(track)) continue;
		if (track.armed) {
			addAup4CompatibilityItem(report, {
				code: 'TRACK_ARMED_STATE_OMITTED',
				severity: 'info',
				disposition: 'omitted',
				scope: { kind: 'track', trackId: track.id },
				data: {},
			});
			normalizedProject.tracks[index].armed = false;
		}
		if (track.displayMode === 'half-wave') addAup4CompatibilityItem(report, {
			code: 'HALF_WAVE_DISPLAY_CONVERTED',
			severity: 'info',
			disposition: 'converted',
			scope: { kind: 'track', trackId: track.id },
			data: { displayMode: 'waveform' },
		});
	}
}

export function isAup4AudioTrack(track) {
	return !isAup4VideoTrack(track) && (track?.type || track?.kind || 'audio') !== 'label';
}

export function isAup4VideoTrack(track) {
	return (track?.type || track?.kind) === 'video';
}

export function isAup4VideoClip(clip, sourceById) {
	return clip?.kind === 'video' || isAup4VideoSource(sourceById.get(clip?.sourceId));
}

export function isAup4VideoSource(source) {
	return source?.kind === 'video';
}
