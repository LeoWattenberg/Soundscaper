/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioTrackFreezeV1, AudioTrackFreezeDigestsV1 } from '../../src/common/editor/audio-track-freeze-v21.ts';

export function freezeWorkFixture(count = 120, installed = false) {
	const sha = 'a'.repeat(64);
	const digests: AudioTrackFreezeDigestsV1 = { inputDigestSha256: sha, rackDigestSha256: sha,
		automationDigestSha256: sha, freshnessDigestSha256: sha };
	const freeze: AudioTrackFreezeV1 = { schemaVersion: 1, derivedSourceId: 'derived', ...digests,
		renderStartFrame: 0, renderFrameCount: count * 10, capturePosition: 'post-insert-pre-strip' };
	const clips = Array.from({ length: count }, (_, index) => ({ id: `clip-${String(index)}`, kind: 'audio',
		sourceId: `source-${String(index)}`, timelineStartFrame: index * 10, sourceStartFrame: 0,
		sourceDurationFrames: 10, durationFrames: 10 }));
	const sources: Record<string, unknown>[] = clips.map(clip => ({ id: clip.sourceId, kind: 'audio',
		storageKey: clip.sourceId, contentSha256: sha, channelCount: 1, sampleRate: 48_000, frameCount: 100 }));
	const derivedSource = { id: 'derived', kind: 'audio', storageKey: 'derived', contentSha256: sha,
		frameCount: count * 10, channelCount: 1, sampleRate: 48_000 };
	const tracks: Record<string, unknown>[] = [{ id: 'target', type: 'audio', clipIds: clips.map(clip => clip.id),
		effects: [], gain: 1, pan: 0, mute: false, solo: false, effectsActive: true }];
	for (let index = 1; index < count; index++) tracks.push({ id: `other-${String(index)}`, type: 'audio', clipIds: [], effects: [] });
	if (installed) { tracks[0]!.audioFreeze = { ...freeze }; sources.push({ ...derivedSource }); }
	const project = { schemaVersion: 21, sampleRate: 48_000, masterChannels: 1, tracks, clips, sources,
		automationLanes: [], mixer: { schemaVersion: 1, sentinel: 'retained' }, projectBin: { clips: [] } };
	const sourceContentIdentities = clips.map(clip => ({ sourceId: clip.sourceId, contentSha256: sha }));
	const derivedClip = { id: 'committed', kind: 'audio', sourceId: 'derived', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: count * 10, sourceStartFrame: 0, sourceDurationFrames: count * 10, trimStartFrames: 0,
		trimEndFrames: 0, gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, pitchCents: 0,
		speedRatio: 1, envelope: [] };
	return { project, freeze, digests, derivedSource, sourceContentIdentities, derivedClip };
}

export function descriptorReadCounter(targets: readonly object[], property: string) {
	const watched = new Set(targets);
	const original = Object.getOwnPropertyDescriptor;
	let reads = 0;
	Object.getOwnPropertyDescriptor = (value: unknown, key: PropertyKey) => {
		if (typeof value === 'object' && value !== null && watched.has(value) && key === property) reads++;
		return original(value, key);
	};
	return { reads: () => reads, restore: () => { Object.getOwnPropertyDescriptor = original; } };
}

/** Selected-only copies have not had their ID consumed by the preceding search. */
export function selectedFreezeRecordCounter(prefix: string, field: string) {
	const original = Object.freeze; let selectedOnly = 0;
	Object.freeze = function <T>(value: T): Readonly<T> {
		const frozen = original(value);
		if (!frozen || typeof frozen !== 'object' || Object.getPrototypeOf(frozen) !== null) return frozen;
		const id = Object.getOwnPropertyDescriptor(frozen, 'id')?.value as unknown;
		if (typeof id !== 'string' || !id.startsWith(prefix)) return frozen;
		let idReads = 0;
		return new Proxy(frozen, { get(target, key, receiver) {
			if (key === 'id') idReads++;
			if (key === field && idReads === 0) selectedOnly++;
			return Reflect.get(target, key, receiver) as unknown;
		} });
	};
	return { reads: () => selectedOnly, restore: () => { Object.freeze = original; } };
}
