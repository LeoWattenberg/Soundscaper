/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { AudioBufferLike } from './source-audio.ts';
import {
	findControllerClip,
	findControllerClipTrack,
	findControllerSource,
	findControllerTrack,
	type ControllerEffect,
	type ControllerProject,
	type ControllerSource,
	type ControllerTrack,
	type MutableControllerProject,
} from './track-domain-types.ts';

export interface MixRenderPlan {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly tailFrames: number;
	readonly preRollFrames: number;
	readonly outputFrames: number;
	readonly outputBytes: number;
	readonly streamToStorage: boolean;
}

export interface MixRenderCommit {
	readonly type: 'mix-render';
	readonly command: Extract<AudioEditorCommand, { readonly type: 'batch' }>;
	readonly trackId: string;
	readonly clipId: string;
}

export function selectAudioTracksForMix(
	project: ControllerProject,
	selectedTrackId: string | null,
	selectedClipId: string | null,
): ControllerTrack[] {
	const selectionIds = new Set((project.selection?.trackIds || []).filter((trackId) => (
		findControllerTrack(project, trackId)?.type === 'audio'
	)));
	if (!selectionIds.size) {
		const focusedTrack = findControllerTrack(project, selectedTrackId);
		if (focusedTrack?.type === 'audio') selectionIds.add(focusedTrack.id);
	}
	if (!selectionIds.size && selectedClipId) {
		const clipTrack = findControllerClipTrack(project, selectedClipId);
		if (clipTrack?.type === 'audio') selectionIds.add(clipTrack.id);
	}
	return project.tracks.filter((track) => track.type === 'audio' && selectionIds.has(track.id));
}

export function createMixRenderPlan(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	tailFrames: number,
	memoryLimitBytes: number,
): MixRenderPlan | null {
	const clips = targetTracks.flatMap((track) => track.clipIds
		.map((clipId) => findControllerClip(project, clipId))
		.filter((clip): clip is NonNullable<typeof clip> => Boolean(clip)));
	if (!targetTracks.length || !clips.length) return null;
	const startFrame = Math.min(...clips.map((clip) => clip.timelineStartFrame));
	const endFrame = Math.max(...clips.map((clip) => clip.timelineStartFrame + clip.durationFrames));
	const preRollFrames = Math.min(startFrame, project.sampleRate * 10);
	const outputFrames = endFrame - startFrame + tailFrames;
	const outputBytes = outputFrames * 2 * Float32Array.BYTES_PER_ELEMENT;
	const processingBytes = (outputFrames + preRollFrames) * 2 * Float32Array.BYTES_PER_ELEMENT * 3;
	return Object.freeze({
		startFrame,
		endFrame,
		tailFrames,
		preRollFrames,
		outputFrames,
		outputBytes,
		streamToStorage: processingBytes > memoryLimitBytes,
	});
}

export function createMixRenderSnapshot(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
): MutableControllerProject {
	const snapshot = cloneProject(project);
	const targetIds = new Set(targetTracks.map((track) => track.id));
	const multipleTracks = targetTracks.length > 1;
	const relevantBusIds = multipleTracks ? mixRenderBusIds(snapshot, targetIds) : new Set<string>();
	const relevantBuses = [...snapshot.mixer.groups, ...snapshot.mixer.sends]
		.filter((bus) => relevantBusIds.has(bus.id));
	const controlTrackIds = new Set(targetTracks
		.flatMap((track) => track.effectsActive === false ? [] : track.effects || [])
		.concat(relevantBuses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects || []))
		.filter(isActiveAutoDuckEffect)
		.map((effect) => String(effect.context?.controlTrackId || ''))
		.filter((trackId) => findControllerTrack(snapshot, trackId)?.type === 'audio'));
	const renderTrackIds = new Set([...targetIds, ...controlTrackIds]);
	snapshot.tracks = snapshot.tracks
		.filter((track) => track.type === 'audio' && renderTrackIds.has(track.id))
		.map((track) => targetIds.has(track.id)
			? { ...track, mute: false, solo: false }
			: { ...track, gain: 0, pan: 0, mute: false, solo: false, effects: [], envelope: [] });
	const clipIds = new Set(snapshot.tracks.flatMap((track) => track.clipIds));
	snapshot.clips = snapshot.clips.filter((clip) => clipIds.has(clip.id));
	const sourceIds = new Set(snapshot.clips.map((clip) => clip.sourceId));
	snapshot.sources = snapshot.sources.filter((source) => sourceIds.has(source.id));
	snapshot.selection = {
		startFrame: 0,
		endFrame: 0,
		trackIds: [],
		clipIds: [],
		frequencyRange: null,
	};
	if (!multipleTracks) {
		snapshot.mixer = { groups: [], sends: [], routes: {} };
		return snapshot;
	}
	const routes: MutableControllerProject['mixer']['routes'] = {};
	for (const trackId of renderTrackIds) {
		const route = snapshot.mixer.routes[trackId];
		if (!route) continue;
		routes[trackId] = {
			...route,
			groupId: route.groupId && relevantBusIds.has(route.groupId) ? route.groupId : null,
			sends: Object.fromEntries(Object.entries(route.sends || {})
				.filter(([sendId]) => relevantBusIds.has(sendId))),
		};
	}
	snapshot.mixer = {
		groups: snapshot.mixer.groups.filter((bus) => relevantBusIds.has(bus.id)),
		sends: snapshot.mixer.sends.filter((bus) => relevantBusIds.has(bus.id)),
		routes,
	};
	return snapshot;
}

export function mixRenderBusIds(
	project: ControllerProject,
	targetIds: ReadonlySet<string>,
): Set<string> {
	const ids = new Set<string>();
	for (const trackId of targetIds) {
		const route = project.mixer.routes[trackId];
		if (route?.groupId) ids.add(route.groupId);
		for (const [sendId, gain] of Object.entries(route?.sends || {})) {
			if (Number(gain) > 0) ids.add(sendId);
		}
	}
	return ids;
}

export function mixRenderTailFrames(
	targetTracks: readonly ControllerTrack[],
	snapshot: ControllerProject,
	sampleRate: number,
	rackTailFrames: (effects: readonly ControllerEffect[], sampleRate: number, maximumSeconds: number) => number,
): number {
	const trackTail = Math.max(0, ...targetTracks.map((track) => (
		track.effectsActive === false ? 0 : rackTailFrames(track.effects || [], sampleRate, 10)
	)));
	const busTail = targetTracks.length > 1
		? Math.max(0, ...[...snapshot.mixer.groups, ...snapshot.mixer.sends]
			.map((bus) => bus.effectsActive === false ? 0 : rackTailFrames(bus.effects || [], sampleRate, 10)))
		: 0;
	return Math.min(sampleRate * 10, trackTail + busTail);
}

export function mixRenderOutputChannelCount(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	snapshot: ControllerProject,
	rendered: AudioBufferLike,
	isFixedStereoEffect: (type: string) => boolean,
): 1 | 2 {
	const allSourcesMono = targetTracks.every((track) => track.clipIds.every((clipId) => {
		const clip = findControllerClip(project, clipId);
		return findControllerSource(project, clip?.sourceId)?.channelCount === 1;
	}));
	const allTracksCentered = targetTracks.every((track) => Number(track.pan ?? 0) === 0);
	if (!allSourcesMono || !allTracksCentered) return 2;
	const buses = [...snapshot.mixer.groups, ...snapshot.mixer.sends];
	if (buses.some((bus) => Number(bus.pan ?? 0) !== 0)) return 2;
	const effects = targetTracks
		.flatMap((track) => track.effectsActive === false ? [] : track.effects || [])
		.concat(buses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects || []))
		.filter((effect) => effect.enabled !== false && effect.bypassed !== true);
	if (effects.some((effect) => isFixedStereoEffect(effect.type))) return 2;
	if (rendered.numberOfChannels < 2) return 1;
	const left = rendered.getChannelData(0);
	const right = rendered.getChannelData(1);
	if (left.length !== right.length) return 2;
	for (let frame = 0; frame < left.length; frame += 1) {
		if (left[frame] !== right[frame]) return 2;
	}
	return 1;
}

export function prepareMixRenderCommit(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	source: ControllerSource,
	options: Readonly<{
		startFrame: number;
		mixName: string;
		createId(prefix: string): string;
	}>,
): MixRenderCommit {
	if (!targetTracks.length) throw new TypeError('At least one target track is required.');
	const targetIds = new Set(targetTracks.map((track) => track.id));
	const bottomTrack = targetTracks[targetTracks.length - 1]!;
	const singleTrack = targetTracks.length === 1;
	const trackId = singleTrack ? bottomTrack.id : options.createId('mixed-track');
	const clipId = options.createId('mixed-clip');
	const commands: AudioEditorCommand[] = [createAddSourceCommand(source)];
	if (singleTrack) {
		commands.push(
			...bottomTrack.clipIds.map((clipIdToRemove): AudioEditorCommand => ({
				type: 'clip/remove', clipId: clipIdToRemove,
			})),
			...(bottomTrack.effects || []).map((effect): AudioEditorCommand => ({
				type: 'effect/remove', scope: 'track', trackId, effectId: effect.id,
			})),
			{
				type: 'track/update', trackId,
				changes: { gain: 1, pan: 0, mute: false, solo: false, armed: false, envelope: [] },
			},
		);
	} else {
		const bottomIndex = project.tracks.findIndex((track) => track.id === bottomTrack.id);
		const insertIndex = project.tracks.slice(0, bottomIndex).filter((track) => !targetIds.has(track.id)).length;
		commands.push(
			...targetTracks.map((track): AudioEditorCommand => ({ type: 'track/remove', trackId: track.id })),
			{
				...createAddTrackCommand({
					...bottomTrack,
					id: trackId,
					name: options.mixName,
					gain: 1,
					pan: 0,
					mute: false,
					solo: false,
					armed: false,
					envelope: [],
					effects: [],
					clipIds: [],
					opaqueExtensions: {},
				}),
				index: insertIndex,
			},
		);
	}
	commands.push(
		createAddClipCommand(trackId, {
			id: clipId,
			sourceId: source.id,
			title: options.mixName,
			timelineStartFrame: options.startFrame,
			sourceStartFrame: 0,
			sourceDurationFrames: source.frameCount,
			durationFrames: source.frameCount,
		}),
		{
			type: 'selection/set',
			startFrame: project.selection?.startFrame || 0,
			endFrame: project.selection?.endFrame || 0,
			trackIds: [trackId],
			clipIds: [],
			frequencyRange: null,
		},
	);
	const command: Extract<AudioEditorCommand, { readonly type: 'batch' }> = { type: 'batch', commands };
	return Object.freeze({
		type: 'mix-render',
		command,
		trackId,
		clipId,
	});
}

function isActiveAutoDuckEffect(effect: ControllerEffect): boolean {
	return effect.type === 'audacity-auto-duck' && effect.enabled !== false && effect.bypassed !== true;
}

function cloneProject(project: ControllerProject): MutableControllerProject {
	if (typeof structuredClone === 'function') return structuredClone(project) as MutableControllerProject;
	return JSON.parse(JSON.stringify(project)) as MutableControllerProject;
}
