/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferStore,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import {
	DesktopSharedProjectRepository,
	type DesktopSharedProjectBridge,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { DesktopSharedProjectSourceAvailability } from '../src/common/editor/storage/desktop-shared-project-source-availability.ts';
import type {
	ProjectDocument,
	ProjectRepositoryPort,
} from '../src/common/editor/storage/project-repository.ts';

const NOW = '2026-08-01T12:00:00.000Z';
const SAMPLE = 0.375;

test('managed acquisition rolls back when the local shadow save fails', async () => {
	const failure = new Error('shadow unavailable');
	const scenario = managedLoadScenario(async () => { throw failure; });

	await assert.rejects(scenario.repository.load(scenario.project.id), (error) => error === failure);
	assert.deepEqual(scenario.deletedStorageKeys, [scenario.source.storageKey]);
	assert.equal(scenario.hasTransferredSource(), false);
});

test('managed acquisition rolls back every shadow result that is not the exact authoritative snapshot', async (context) => {
	const cases: readonly Readonly<{
		label: string;
		mutate(project: AudioEditorProjectCurrent): ProjectDocument;
		pattern: RegExp;
	}>[] = [
		{
			label: 'invalid current project',
			mutate(project) {
				const invalid = { ...project } as Record<string, unknown>;
				delete invalid.featureRequirements;
				return invalid as ProjectDocument;
			},
			pattern: /feature.*requirements/iu,
		},
		{
			label: 'changed identity',
			mutate: (project) => ({ ...project, id: 'different-shadow-project' }),
			pattern: /identity|revision/iu,
		},
		{
			label: 'changed revision',
			mutate: (project) => ({ ...project, revision: project.revision + 1 }),
			pattern: /identity|revision/iu,
		},
		{
			label: 'changed canonical document',
			mutate: (project) => ({ ...project, title: 'Changed by shadow' }),
			pattern: /authoritative/iu,
		},
	];

	for (const entry of cases) {
		await context.test(entry.label, async () => {
			const scenario = managedLoadScenario(async (project) => entry.mutate(project));
			await assert.rejects(scenario.repository.load(scenario.project.id), entry.pattern);
			assert.deepEqual(scenario.deletedStorageKeys, [scenario.source.storageKey]);
			assert.equal(scenario.hasTransferredSource(), false);
		});
	}
});

test('an accepted shadow commits managed acquisition before observing late cancellation', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel after durable shadow');
	const scenario = managedLoadScenario(async (project) => {
		controller.abort(reason);
		return structuredClone(project);
	});

	await assert.rejects(
		scenario.repository.load(scenario.project.id, { signal: controller.signal }),
		(error) => error === reason,
	);
	assert.deepEqual(scenario.deletedStorageKeys, []);
	assert.equal(
		scenario.hasTransferredSource(),
		true,
		'a canceled but durably shadowed project must not reference rolled-back PCM',
	);
});

function managedLoadScenario(
	save: (project: AudioEditorProjectCurrent) => Promise<ProjectDocument>,
) {
	const source = createAudioSource({
		id: 'managed-load-source',
		storageKey: 'managed-load-storage',
		name: 'managed-load.wav',
		mimeType: 'audio/wav',
		frameCount: 1,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 1,
	});
	const clip = createAudioClip({
		id: 'managed-load-clip',
		sourceId: source.id,
		durationFrames: 1,
		sourceDurationFrames: 1,
	});
	const project = createCurrentAudioEditorProject({
		id: 'managed-load-project',
		title: 'Managed load project',
		revision: 4,
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrack({ id: 'managed-load-track', clipIds: [clip.id] })],
	});
	const bytes = canonicalPcmBytes(SAMPLE);
	const descriptor: DesktopSharedManagedSourceDescriptor = Object.freeze({
		bindingId: `m${'a'.repeat(64)}`,
		byteLength: bytes.byteLength,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		kind: 'audio',
		sha256: createHash('sha256').update(bytes).digest('hex'),
		sourceId: source.id,
		storageKey: source.storageKey,
	});
	const transfer = transferStore();
	const repository = new DesktopSharedProjectRepository({
		bridge: managedBridge(project, descriptor, bytes),
		shadow: shadowRepository(save),
		sourceAvailability: availableAudio(source),
		sourceTransfer: transfer.store,
		onLocalCleanupError: () => undefined,
	});
	return {
		deletedStorageKeys: transfer.deletedStorageKeys,
		hasTransferredSource: () => transfer.committedStorageKeys.has(source.storageKey),
		project,
		repository,
		source,
	};
}

function managedBridge(
	project: AudioEditorProjectCurrent,
	descriptor: DesktopSharedManagedSourceDescriptor,
	body: Uint8Array,
): DesktopSharedProjectBridge {
	return {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
		deleteSharedProject: async () => true,
		readSharedProjectBundle: async () => ({
			document: serializeScapeProjectDocument(project),
			sources: [descriptor],
		}),
		beginSharedSourceWrite: async () => { throw new Error('unexpected managed upload'); },
		writeSharedSourceChunk: async () => { throw new Error('unexpected managed upload'); },
		finishSharedSourceWrite: async () => { throw new Error('unexpected managed upload'); },
		abortSharedSourceWrite: async () => false,
		async readSharedSourceChunk({ bindingId, length, offset }) {
			assert.equal(bindingId, descriptor.bindingId);
			return body.slice(offset, offset + length);
		},
	};
}

function transferStore(): Readonly<{
	committedStorageKeys: Set<string>;
	deletedStorageKeys: string[];
	store: DesktopSharedSourceTransferStore;
}> {
	const committedStorageKeys = new Set<string>();
	const deletedStorageKeys: string[] = [];
	const store: DesktopSharedSourceTransferStore = {
		getSourceMetadata(sourceId) {
			return committedStorageKeys.has(sourceId) ? { id: sourceId } : null;
		},
		getMediaAssetMetadata() {
			throw new Error('audio-only acquisition must not read retained-media metadata');
		},
		loadMediaAsset() {
			throw new Error('audio-only acquisition must not read retained-media bytes');
		},
		beginMediaAssetWrite() {
			throw new Error('audio-only acquisition must not write retained media');
		},
		readSourceChunks() {
			throw new Error('recipient acquisition must not read its transfer store');
		},
		async beginSourceWrite(sourceId) {
			let framesWritten = 0;
			return {
				get framesWritten() { return framesWritten; },
				async write(inputChannels) {
					if (!Array.isArray(inputChannels) || !(inputChannels[0] instanceof Float32Array)) {
						throw new TypeError('expected decoded PCM channels');
					}
					framesWritten += inputChannels[0].length;
				},
				async commit() {
					committedStorageKeys.add(sourceId);
					return { id: sourceId } as never;
				},
				async abort() { committedStorageKeys.delete(sourceId); },
			};
		},
		async discardSourceIfCurrent(source) {
			const sourceId = String(source.id);
			deletedStorageKeys.push(sourceId);
			committedStorageKeys.delete(sourceId);
			return true;
		},
	};
	return { committedStorageKeys, deletedStorageKeys, store };
}

function availableAudio(
	source: ReturnType<typeof createAudioSource>,
): DesktopSharedProjectSourceAvailability {
	return {
		async getSourceMetadata(sourceId) {
			assert.equal(sourceId, source.storageKey);
			return {
				id: source.storageKey,
				storage: 'indexeddb-chunks',
				sourceToken: 'managed-load-token',
				committedAt: NOW,
				frameCount: 1,
				channelCount: 1,
				sampleRate: 48_000,
				chunkFrames: 1,
				chunkCount: 1,
			};
		},
		readSourceChunks(sourceId) {
			assert.equal(sourceId, source.storageKey);
			return (async function* chunks() {
				yield { index: 0, frames: 1, channels: [Float32Array.of(SAMPLE)] };
			})();
		},
		async getMediaAssetMetadata() { throw new Error('unexpected video metadata read'); },
		async loadMediaAsset() { throw new Error('unexpected video body read'); },
	};
}

function shadowRepository(
	save: (project: AudioEditorProjectCurrent) => Promise<ProjectDocument>,
): ProjectRepositoryPort {
	return {
		save: (project) => save(project as AudioEditorProjectCurrent),
		load: async () => null,
		list: async () => [],
		listRevisions: async () => [],
		delete: async () => undefined,
	};
}

function canonicalPcmBytes(sample: number): Uint8Array {
	const bytes = new Uint8Array(8);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 1, true);
	view.setFloat32(4, sample, true);
	return bytes;
}
