/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudacitySampleBlockStoragePlan } from '../../../../aup4-import-block-storage.ts';
import type { NativeAup4Client, NativeProjectDocument, NativeProjectServiceRuntime } from '../../native-project-types.ts';
import { persistNativeProjectSource } from './native-project-source-persistence.ts';
import { isAudioMediaKind } from '../../../../audio-media-kind.ts';
import type { NativeProjectAudioSource } from '../../native-project-types.ts';

/** Persist shared PCM before publishing any logical source that depends on it. */
export async function persistNativeAudacitySampleBlocks(
	runtime: Pick<NativeProjectServiceRuntime, 'store' | 'sourceChunkFrames'>,
	client: NativeAup4Client,
	nativeId: string,
	project: NativeProjectDocument,
	plan: AudacitySampleBlockStoragePlan,
	persisted: string[],
	signal: AbortSignal,
	assertCurrent: () => void,
	onWritten: (bytes: number) => void,
): Promise<void> {
	if (!runtime.store.writeSampleBlockSource || !client.readSourceChunks) throw new Error('Shared Audacity sample-block storage is unavailable.');
	const backingProject = { ...project, sources: plan.backingSources.map((source) => ({
		kind: 'audio' as const, id: source.sourceId, storageKey: source.sourceId,
		name: 'Audacity sample blocks', mimeType: 'audio/x-audacity-sampleblocks',
		sampleRate: source.sampleRate, channelCount: source.channelCount, frameCount: source.frameCount,
	})) };
	for (const source of backingProject.sources) {
		assertCurrent();
		await persistNativeProjectSource(runtime, backingProject, source.id,
			client.readSourceChunks(nativeId, source.id, { signal }), persisted, assertCurrent, onWritten);
	}
	for (const sequence of plan.sequences) {
		assertCurrent();
		const source = project.sources.find((candidate): candidate is NativeProjectAudioSource =>
			candidate.id === sequence.sourceId && isAudioMediaKind(candidate.kind));
		if (!source) throw new Error('An Audacity sample-block source is missing from its project.');
		await runtime.store.writeSampleBlockSource(source.id, sequence.baseSourceId, sequence.channels, {
			name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate,
			channelCount: source.channelCount, frameCount: source.frameCount, chunkFrames: runtime.sourceChunkFrames,
		});
		persisted.push(source.id);
		assertCurrent();
	}
}
