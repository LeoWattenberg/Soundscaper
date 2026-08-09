/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	acquireDesktopSharedProjectAudio,
	DESKTOP_SHARED_AUDIO_ENCODING,
	type DesktopSharedManagedSourceDescriptor,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';

test('managed rollback preserves a concurrent legitimate source replacement', async (context) => {
	const fixture = audioFixture();
	const store = memoryStore(context, 'rollback-replacement');
	const acquisition = await acquireDesktopSharedProjectAudio(
		fixture.project, null, [fixture.descriptor], fixture.bridge, store,
	);
	const acquired = await store.getSourceMetadata(fixture.source.storageKey);
	assert.ok(acquired);
	const replacement = await writeReplacement(store, fixture.source.storageKey, 0.875);

	await acquisition.rollback();

	assert.deepEqual(await store.getSourceMetadata(fixture.source.storageKey), replacement);
	assert.equal(await readOnlySample(store, fixture.source.storageKey), 0.875);
});

test('managed acquisition loses an absent-publication race without replacing the winner or retaining staging', async (context) => {
	const fixture = audioFixture();
	const store = memoryStore(context, 'absent-publication-race');
	let winner: Readonly<Record<string, unknown>> | null = null;
	const racingStore = {
		getSourceMetadata: (sourceId: string) => store.getSourceMetadata(sourceId),
		discardSourceIfCurrent: (source: Readonly<Record<string, unknown>>) => (
			store.discardSourceIfCurrent(source)
		),
		async beginSourceWrite(sourceId: string, metadata: Record<string, unknown>) {
			const staged = await store.beginSourceWrite(sourceId, metadata);
			return {
				get framesWritten() { return staged.framesWritten; },
				write: staged.write.bind(staged),
				async commit(extraMetadata?: Record<string, unknown>, options?: Readonly<{
					signal?: AbortSignal;
					ifAbsent?: boolean;
				}>) {
					winner = await writeReplacement(store, sourceId, 0.625);
					return staged.commit(extraMetadata, options);
				},
				abort: staged.abort.bind(staged),
			};
		},
	};

	await assert.rejects(
		acquireDesktopSharedProjectAudio(
			fixture.project, null, [fixture.descriptor], fixture.bridge, racingStore as never,
		),
		/already exists|if absent|absent publication/iu,
	);
	const winnerRecord = winner as Readonly<Record<string, unknown>> | null;
	assert.ok(winnerRecord);
	assert.deepEqual(await store.getSourceMetadata(fixture.source.storageKey), winnerRecord);
	assert.equal(await readOnlySample(store, fixture.source.storageKey), 0.625);
	assert.deepEqual(
		[...new Set([...store.memory.sourceChunks.values()].map((record) => (
			String((record as Record<string, unknown>).sourceToken)
		)))],
		[String(winnerRecord.sourceToken)],
		'the staged acquisition loser must be deleted',
	);
});

function audioFixture() {
	const source = createAudioSourceV9({
		id: 'ownership-source', storageKey: 'ownership-storage', name: 'ownership.wav',
		mimeType: 'audio/wav', frameCount: 1, channelCount: 1, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 1,
	});
	const clip = createAudioClipV9({
		id: 'ownership-clip', sourceId: source.id, durationFrames: 1, sourceDurationFrames: 1,
	});
	const project = createCurrentAudioEditorProject({
		id: 'ownership-project', title: 'Managed ownership', revision: 1,
		now: '2026-08-01T12:00:00.000Z', sources: [source], clips: [clip],
		tracks: [createAudioTrackV9({ id: 'ownership-track', clipIds: [clip.id] })],
	});
	const bytes = new Uint8Array(8);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 1, true);
	view.setFloat32(4, 0.25, true);
	const descriptor: DesktopSharedManagedSourceDescriptor = Object.freeze({
		bindingId: `m${'a'.repeat(64)}`,
		byteLength: bytes.byteLength,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		kind: 'audio',
		sha256: createHash('sha256').update(bytes).digest('hex'),
		sourceId: source.id,
		storageKey: source.storageKey,
	});
	return {
		bridge: { async readSharedSourceChunk({ length, offset }: { length: number; offset: number }) {
			return bytes.slice(offset, offset + length);
		} },
		descriptor,
		project,
		source,
	};
}

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `managed-ownership-${label}-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function writeReplacement(
	store: AudioEditorProjectStore,
	storageKey: string,
	sample: number,
) {
	const writer = await store.beginSourceWrite(storageKey, {
		name: 'replacement.wav', mimeType: 'audio/wav', sampleRate: 48_000,
		channelCount: 1, chunkFrames: 1,
	});
	await writer.write([Float32Array.of(sample)]);
	return writer.commit({ sampleRate: 48_000, channelCount: 1, chunkFrames: 1 });
}

async function readOnlySample(store: AudioEditorProjectStore, storageKey: string): Promise<number> {
	for await (const chunk of store.readSourceChunks(storageKey, { migrateLegacyPcmOnAccess: false })) {
		return chunk.channels[0][0] as number;
	}
	throw new Error('Expected one PCM sample.');
}
