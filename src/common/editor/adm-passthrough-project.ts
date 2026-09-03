/* SPDX-License-Identifier: AGPL-3.0-only */

import { isSoundscaperProductionProject } from './project-schema-version.ts';

export interface AdmPassthroughTimelineSource {
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

export function isNeutralAdmSignalPath(project: unknown): boolean {
	const candidate = record(project);
	const mixer = record(candidate?.mixer);
	if (!candidate || !mixer || !Array.isArray(candidate.tracks)) return false;
	const exactV21 = isSoundscaperProductionProject(candidate) && mixer.schemaVersion === 1;
	return isNeutralStrip(candidate.master, exactV21)
		&& candidate.tracks.every((track) => record(track)?.type !== 'audio' || isNeutralStrip(track, exactV21))
		&& (exactV21
			? isNeutralV21MixerGraph(candidate, mixer)
			: Array.isArray(mixer.groups) && mixer.groups.length === 0
				&& Array.isArray(mixer.sends) && mixer.sends.length === 0
				&& isNeutralRoutes(mixer.routes));
}

export function resolveExactAdmPassthroughTimelineSource(
	project: unknown,
	expectedFrameCount: number,
): AdmPassthroughTimelineSource | null {
	const candidate = record(project);
	if (!candidate
		|| !Array.isArray(candidate.sources)
		|| !Array.isArray(candidate.clips)
		|| !Array.isArray(candidate.tracks)) return null;
	const audioSources = candidate.sources.map(record).filter(isAudioRecord);
	const audioClips = candidate.clips.map(record).filter(isAudioRecord);
	if (audioSources.length !== 1 || audioClips.length !== 1) return null;
	const source = audioSources[0];
	const clip = audioClips[0];
	if (!isExpectedSource(source, expectedFrameCount)
		|| !isExactFullSourceClip(clip, source.id, expectedFrameCount)) return null;
	const activeAudioTracks = candidate.tracks
		.map(record)
		.filter((track) => track?.type === 'audio' && Array.isArray(track.clipIds) && track.clipIds.length > 0);
	if (activeAudioTracks.length !== 1
		|| !sameArray(activeAudioTracks[0]?.clipIds, [clip.id])) return null;
	return Object.freeze({
		id: source.id,
		storageKey: source.storageKey,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		frameCount: source.frameCount,
	});
}

function isExpectedSource(
	source: Readonly<Record<string, unknown>>,
	expectedFrameCount: number,
): source is Readonly<Record<string, unknown>> & AdmPassthroughTimelineSource {
	return typeof source.id === 'string'
		&& typeof source.storageKey === 'string'
		&& typeof source.mimeType === 'string'
		&& Number.isSafeInteger(source.sampleRate) && Number(source.sampleRate) > 0
		&& Number.isSafeInteger(source.channelCount) && Number(source.channelCount) > 0
		&& source.frameCount === expectedFrameCount;
}

function isExactFullSourceClip(
	clip: Readonly<Record<string, unknown>>,
	sourceId: unknown,
	frameCount: number,
): boolean {
	return typeof clip.id === 'string'
		&& clip.sourceId === sourceId
		&& clip.timelineStartFrame === 0
		&& clip.sourceStartFrame === 0
		&& clip.sourceDurationFrames === frameCount
		&& clip.durationFrames === frameCount
		&& clip.trimStartFrames === 0
		&& clip.trimEndFrames === 0
		&& clip.gain === 1
		&& clip.fadeInFrames === 0
		&& clip.fadeOutFrames === 0
		&& clip.reversed === false
		&& clip.inverted === false
		&& Array.isArray(clip.envelope) && clip.envelope.length === 0
		&& clip.pitchCents === 0
		&& clip.speedRatio === 1
		&& clip.preserveFormants === false
		&& clip.stretchToTempo === false;
}

function isNeutralStrip(value: unknown, envelopeMayBeOmitted = false): boolean {
	const candidate = record(value);
	return candidate?.gain === 1
		&& candidate.pan === 0
		&& candidate.mute === false
		&& candidate.solo === false
		&& (Array.isArray(candidate.envelope)
			? candidate.envelope.length === 0
			: envelopeMayBeOmitted && !Object.hasOwn(candidate, 'envelope'))
		&& Array.isArray(candidate.effects) && candidate.effects.length === 0;
}

function isNeutralV21MixerGraph(
	project: Readonly<Record<string, unknown>>,
	mixer: Readonly<Record<string, unknown>>,
): boolean {
	if (!Array.isArray(project.automationLanes) || project.automationLanes.length !== 0
		|| !Array.isArray(project.tracks)
		|| !emptyArray(mixer.groups) || !emptyArray(mixer.sends)
		|| !emptyArray(mixer.cues) || !emptyArray(mixer.vcas)
		|| !Array.isArray(mixer.outputs) || mixer.outputs.length !== 1
		|| !Array.isArray(mixer.edges)) return false;
	const masterChannels = project.masterChannels;
	if (!Number.isSafeInteger(masterChannels) || Number(masterChannels) < 1 || Number(masterChannels) > 32) return false;
	const output = record(mixer.outputs[0]);
	if (!output || typeof output.id !== 'string' || output.role !== 'main'
		|| output.channelCount !== masterChannels) return false;
	const trackIds = project.tracks
		.filter((track) => record(track)?.type === 'audio')
		.map((track) => record(track)?.id);
	if (trackIds.some((id) => typeof id !== 'string')
		|| new Set(trackIds).size !== trackIds.length
		|| mixer.edges.length !== trackIds.length + 1) return false;
	const remainingTrackIds = new Set(trackIds as string[]);
	let mainOutputEdges = 0;
	for (const value of mixer.edges) {
		const edge = record(value);
		const source = record(edge?.source);
		const destination = record(edge?.destination);
		if (!edge || !source || !destination
			|| edge.kind !== 'assignment' || edge.position !== 'post-fader'
			|| edge.level !== 1 || edge.enabled !== true
			|| !identityChannelMap(edge.channelMap, Number(masterChannels))) return false;
		if (source.kind === 'track' && typeof source.id === 'string'
			&& destination.kind === 'master' && remainingTrackIds.delete(source.id)) continue;
		if (source.kind === 'master' && destination.kind === 'output'
			&& destination.id === output.id) {
			mainOutputEdges += 1;
			continue;
		}
		return false;
	}
	return remainingTrackIds.size === 0 && mainOutputEdges === 1;
}

function emptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0;
}

function identityChannelMap(value: unknown, channelCount: number): boolean {
	return Array.isArray(value)
		&& value.length === channelCount
		&& value.every((sourceChannel, destinationChannel) => sourceChannel === destinationChannel);
}

function isNeutralRoutes(value: unknown): boolean {
	const routes = record(value);
	return routes !== null && Object.values(routes).every((route) => {
		const candidate = record(route);
		const sends = record(candidate?.sends);
		return candidate?.groupId == null && sends !== null && Object.keys(sends).length === 0;
	});
}

function isAudioRecord(value: Readonly<Record<string, unknown>> | null): value is Readonly<Record<string, unknown>> {
	return value?.kind === 'audio';
}

function sameArray(value: unknown, expected: readonly unknown[]): boolean {
	return Array.isArray(value)
		&& value.length === expected.length
		&& value.every((item, index) => item === expected[index]);
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}
