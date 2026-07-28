/* SPDX-License-Identifier: AGPL-3.0-only */

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
	return isNeutralStrip(candidate.master)
		&& candidate.tracks.every((track) => record(track)?.type !== 'audio' || isNeutralStrip(track))
		&& Array.isArray(mixer.groups) && mixer.groups.length === 0
		&& Array.isArray(mixer.sends) && mixer.sends.length === 0
		&& isNeutralRoutes(mixer.routes);
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
		&& Array.isArray(clip.envelope) && clip.envelope.length === 0
		&& clip.pitchCents === 0
		&& clip.speedRatio === 1
		&& clip.preserveFormants === false
		&& clip.stretchToTempo === false;
}

function isNeutralStrip(value: unknown): boolean {
	const candidate = record(value);
	return candidate?.gain === 1
		&& candidate.pan === 0
		&& candidate.mute === false
		&& candidate.solo === false
		&& Array.isArray(candidate.envelope) && candidate.envelope.length === 0
		&& Array.isArray(candidate.effects) && candidate.effects.length === 0;
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
