/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAudacityRackEffectType } from '../effects.js';
import { isSoundscaperProductionProject } from '../project-schema-version.ts';
import {
	findControllerClip,
	findControllerSource,
	type ControllerEffect,
	type ControllerProject,
	type ControllerTrack,
} from './track-domain-types.ts';

const BUILTIN_STEREO_EXPANDING_EFFECTS: ReadonlySet<string> = new Set([
	'convolver',
	'reverb',
]);

/** Predict the exact persisted layout of one combined Mix and Render output. */
export function predictMixRenderOutputChannelCount(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	renderEffects = true,
): number | null {
	return predictOutputChannelCount(project, targetTracks, renderEffects, true);
}

/** Predict one route-preserving individual track print, excluding downstream buses. */
export function predictIndividualMixRenderOutputChannelCount(
	project: ControllerProject,
	targetTrack: ControllerTrack,
	renderEffects = true,
): number | null {
	return predictOutputChannelCount(project, [targetTrack], renderEffects, false);
}

function predictOutputChannelCount(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	renderEffects: boolean,
	includeDownstream: boolean,
): number | null {
	if (typeof renderEffects !== 'boolean') {
		throw new TypeError('Mix and Render option renderEffects must be a boolean.');
	}
	const targets = nonemptyAudioTargets(project, targetTracks);
	if (!targets.length) return null;
	if (isSoundscaperProductionProject(project)) return productionMasterChannelCount(project);
	if (!targets.every((track) => trackSourcesAreMono(project, track))) return 2;
	if (targets.some((track) => Number(track.pan ?? 0) !== 0)) return 2;
	const buses = includeDownstream ? routedMixerStrips(project, targets) : [];
	if (buses.some((bus) => Number(bus.pan ?? 0) !== 0)) return 2;
	if (renderEffects && activeEffects(targets, buses).some(effectExpandsStereo)) return 2;
	return 1;
}

export function nonemptyAudioTargets(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
): ControllerTrack[] {
	return targetTracks.filter((track) => track.type === 'audio' && track.clipIds.some((clipId) => (
		findControllerClip(project, clipId) !== null
	)));
}

function productionMasterChannelCount(project: ControllerProject): number {
	const channelCount = Number(project.masterChannels);
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32) {
		throw new RangeError('A Soundscaper mix render requires between 1 and 32 master channels.');
	}
	return channelCount;
}

function trackSourcesAreMono(project: ControllerProject, track: ControllerTrack): boolean {
	return track.clipIds.every((clipId) => {
		const clip = findControllerClip(project, clipId);
		return !clip || findControllerSource(project, clip.sourceId)?.channelCount === 1;
	});
}

function routedMixerStrips(
	project: ControllerProject,
	targets: readonly ControllerTrack[],
): readonly ControllerMixerStrip[] {
	const ids = new Set<string>();
	for (const track of targets) {
		const route = project.mixer.routes[track.id];
		if (route?.groupId) ids.add(route.groupId);
		for (const [sendId, gain] of Object.entries(route?.sends ?? {})) {
			if (Number(gain) > 0) ids.add(sendId);
		}
	}
	return [...project.mixer.groups, ...project.mixer.sends].filter(({ id }) => ids.has(id));
}

function activeEffects(
	tracks: readonly ControllerTrack[],
	buses: readonly ControllerMixerStrip[],
): ControllerEffect[] {
	return tracks.flatMap((track) => track.effectsActive === false ? [] : track.effects ?? [])
		.concat(buses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects ?? []))
		.filter((effect) => effect.enabled !== false && effect.bypassed !== true);
}

function effectExpandsStereo(effect: ControllerEffect): boolean {
	const type = effect.type.toLowerCase();
	return BUILTIN_STEREO_EXPANDING_EFFECTS.has(type) || isAudacityRackEffectType(type);
}

type ControllerMixerStrip = ControllerProject['mixer']['groups'][number];
