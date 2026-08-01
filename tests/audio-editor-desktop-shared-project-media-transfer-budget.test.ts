/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import {
	scapeAudioSourceLayout,
	SCAPE_MAXIMUM_AUDIO_CHUNKS,
	type ScapeAudioSource,
} from '../src/common/editor/scape-archive-media.ts';
import {
	acquireDesktopSharedProjectAudio,
	DESKTOP_SHARED_AUDIO_ENCODING,
	prepareDesktopSharedProjectAudioHandoff,
	type DesktopSharedManagedSourceDescriptor,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';

test('recipient preflights aggregate managed PCM budgets before local or shared media I/O', async (context) => {
	const framesAtRawLimit = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes
		/ (64 * Float32Array.BYTES_PER_ELEMENT);
	const chunksPerSource = Math.floor(SCAPE_MAXIMUM_AUDIO_CHUNKS / 2) + 1;
	const cases = [
		{
			label: 'canonical byte limit',
			pattern: /expanded-byte limit/iu,
			project: metadataAudioProject('recipient-byte-limit', [
				{ id: 'bytes-a', storageKey: 'bytes-storage-a', frameCount: framesAtRawLimit / 2, channelCount: 64 },
				{ id: 'bytes-b', storageKey: 'bytes-storage-b', frameCount: framesAtRawLimit / 2, channelCount: 64 },
			]),
		},
		{
			label: 'canonical chunk limit',
			pattern: /PCM chunk limit/iu,
			project: metadataAudioProject('recipient-chunk-limit', [
				{ id: 'chunks-a', storageKey: 'chunks-storage-a', frameCount: chunksPerSource, chunkFrames: 1 },
				{ id: 'chunks-b', storageKey: 'chunks-storage-b', frameCount: chunksPerSource, chunkFrames: 1 },
			]),
		},
	];

	for (const entry of cases) {
		await context.test(entry.label, async () => {
			const guarded = guardedAcquisitionPorts();
			await assert.rejects(
				acquireDesktopSharedProjectAudio(
					entry.project,
					null,
					managedDescriptors(entry.project),
					guarded.bridge,
					guarded.store,
				),
				entry.pattern,
			);
			assert.equal(guarded.ioCalls(), 0);
		});
	}
});

test('recipient budget preflight counts aliased audio storage geometry only once', async () => {
	const failure = new Error('recipient metadata read reached');
	const frameCount = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes
		/ (64 * Float32Array.BYTES_PER_ELEMENT * 2);
	const project = metadataAudioProject('recipient-deduplicated-limit', [
		{ id: 'alias-a', storageKey: 'recipient-aliased-storage', frameCount, channelCount: 64 },
		{ id: 'alias-b', storageKey: 'recipient-aliased-storage', frameCount, channelCount: 64 },
	]);
	const guarded = guardedAcquisitionPorts(failure);

	await assert.rejects(
		acquireDesktopSharedProjectAudio(
			project,
			null,
			managedDescriptors(project),
			guarded.bridge,
			guarded.store,
		),
		(error) => error === failure,
	);
	assert.equal(guarded.ioCalls(), 1);
});

test('sender and recipient reject excess logical source references before media I/O', async () => {
	const sourceCount = SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 1;
	const project = metadataAudioProject('logical-source-limit', Array.from(
		{ length: sourceCount },
		(_, index) => ({
			id: `logical-source-${String(index)}`,
			storageKey: `logical-storage-${String(index)}`,
			frameCount: 1,
			chunkFrames: 1,
		}),
	));
	await assert.rejects(
		prepareDesktopSharedProjectAudioHandoff(project, null as never, null as never),
		/source.*limit|structural traversal node limit/iu,
	);
	const guarded = guardedAcquisitionPorts();
	await assert.rejects(
		acquireDesktopSharedProjectAudio(project, null, [], guarded.bridge, guarded.store),
		/source.*limit|structural traversal node limit/iu,
	);
	assert.equal(guarded.ioCalls(), 0);
});

function metadataAudioProject(
	id: string,
	specifications: readonly Readonly<{
		id: string;
		storageKey: string;
		frameCount: number;
		channelCount?: number;
		chunkFrames?: number;
	}>[],
): AudioEditorProjectV9 {
	const sources = specifications.map((value) => createAudioSourceV9({
		...value,
		name: `${value.id}.wav`,
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		channelCount: value.channelCount ?? 1,
		chunkFrames: value.chunkFrames ?? 65_536,
	}));
	const clips = sources.map((source) => createAudioClipV9({
		id: `${source.id}-clip`, sourceId: source.id,
		durationFrames: source.frameCount, sourceDurationFrames: source.frameCount,
	}));
	return createAudioEditorProjectV9({
		id, title: 'Recipient metadata-only preflight', revision: 1,
		now: '2026-08-01T12:00:00.000Z', sources, clips,
		tracks: [createAudioTrackV9({ id: `${id}-track`, clipIds: clips.map(({ id: clipId }) => clipId) })],
	});
}

function managedDescriptors(project: AudioEditorProjectV9): readonly DesktopSharedManagedSourceDescriptor[] {
	return project.sources.map((source, index) => {
		const audio = source as unknown as ScapeAudioSource & Readonly<{ storageKey: string }>;
		return Object.freeze({
			bindingId: `m${String(index + 1).repeat(64)}`,
			byteLength: scapeAudioSourceLayout(audio).archiveBytes,
			encoding: DESKTOP_SHARED_AUDIO_ENCODING,
			kind: 'audio',
			sha256: String(index + 1).repeat(64),
			sourceId: audio.id,
			storageKey: audio.storageKey,
		});
	});
}

function guardedAcquisitionPorts(failure = new Error('unexpected recipient media I/O')) {
	let calls = 0;
	const unexpected = (): never => {
		calls += 1;
		throw failure;
	};
	return {
		bridge: { async readSharedSourceChunk() { return unexpected(); } },
		store: {
			getSourceMetadata() { return unexpected(); },
			async beginSourceWrite() { return unexpected(); },
			discardSourceIfCurrent() { return unexpected(); },
		},
		ioCalls: () => calls,
	};
}
