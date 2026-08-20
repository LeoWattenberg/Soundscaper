/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoClip,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import {
	DESKTOP_SHARED_VIDEO_ENCODING,
	type DesktopSharedManagedVideoSourceDescriptor,
	type DesktopSharedSourceTransferStore,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import {
	DesktopSharedProjectRepository,
	type DesktopSharedProjectBridge,
	type DesktopSharedProjectRepositoryOptions,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import {
	LinkedVideoOriginalResolver,
	type LinkedVideoOriginalPort,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';

const NOW = '2026-08-02T10:11:12.345Z';
const LOCATOR_ID = 'locator_workflow_00000001';
const LOCATOR_REVISION = 'snapshot_workflow_00000001';
const VIDEO_TEXT = 'linked retained video workflow body';

test('an exact linked original admits a fresh descriptor-free shared load without owned media writes', async () => {
	const source = videoSource();
	const project = videoProject(source);
	const linked = await linkedOriginalFixture(project, source);
	const owned = guardedOwnedMediaStore();
	const repository = sharedRepository({
		bridge: documentOnlyBridge(project),
		linkedVideoOriginals: linked.resolver,
		shadow: linked.shadow,
		sourceAvailability: owned.store,
		sourceTransfer: owned.store,
	});

	assert.deepEqual(await repository.load(project.id), project);
	assert.deepEqual(await linked.shadow.load(project.id), project);
	assert.deepEqual(linked.platformReads, [{
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	}]);
	assert.deepEqual(owned.calls, []);
});

test('a source-shape-mismatched linked binding cannot authorize a shared load', async () => {
	const boundSource = videoSource();
	const boundProject = videoProject(boundSource);
	const linked = await linkedOriginalFixture(boundProject, boundSource);
	const changedSource = createVideoSource({ ...boundSource, width: 1_280 });
	const changedProject = videoProject(changedSource);
	const owned = guardedOwnedMediaStore();
	const repository = sharedRepository({
		bridge: documentOnlyBridge(changedProject),
		linkedVideoOriginals: linked.resolver,
		shadow: linked.shadow,
		sourceAvailability: owned.store,
		sourceTransfer: owned.store,
	});

	await assert.rejects(
		repository.load(changedProject.id),
		/binding.*project source|binding.*source|source.*binding/iu,
	);
	assert.deepEqual(linked.platformReads, [], 'source mismatch must reject before privileged locator I/O');
	assert.equal(await linked.shadow.load(changedProject.id), null);
	assert.deepEqual(owned.calls, []);
});

test('a stale linked locator revision cannot authorize a shared load', async () => {
	const source = videoSource();
	const project = videoProject(source);
	const linked = await linkedOriginalFixture(project, source);
	linked.setLocatorRevision('snapshot_workflow_00000002');
	const owned = guardedOwnedMediaStore();
	const repository = sharedRepository({
		bridge: documentOnlyBridge(project),
		linkedVideoOriginals: linked.resolver,
		shadow: linked.shadow,
		sourceAvailability: owned.store,
		sourceTransfer: owned.store,
	});

	await assert.rejects(repository.load(project.id), /linked.*unavailable|linked.*changed/iu);
	assert.deepEqual(linked.platformReads, [{
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	}]);
	assert.equal(await linked.shadow.load(project.id), null);
	assert.deepEqual(owned.calls, []);
});

test('prepareHandoff publishes a linked original Blob through the maintained managed sender', async () => {
	const source = videoSource();
	const project = videoProject(source);
	const linked = await linkedOriginalFixture(project, source);
	const owned = guardedOwnedMediaStore();
	const publication = linkedVideoPublicationBridge(project, source, linked.binding);
	const repository = sharedRepository({
		bridge: publication.bridge,
		linkedVideoOriginals: linked.resolver,
		shadow: linked.shadow,
		sourceAvailability: owned.store,
		sourceTransfer: owned.store,
	});

	assert.deepEqual(await repository.prepareHandoff(project), [publication.descriptor]);
	assert.equal(new TextDecoder().decode(publication.uploadedBytes()), VIDEO_TEXT);
	assert.equal(publication.finished(), 1);
	assert.equal(publication.aborted(), 0);
	assert.deepEqual(linked.platformReads, [{
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	}]);
	assert.deepEqual(owned.calls, []);
});

type VideoSource = ReturnType<typeof createVideoSource>;

interface LinkedDesktopRepositoryOptions extends Omit<
	DesktopSharedProjectRepositoryOptions,
	'onLocalCleanupError'
> {
	readonly linkedVideoOriginals: LinkedVideoOriginalResolver;
}

function sharedRepository(options: LinkedDesktopRepositoryOptions): DesktopSharedProjectRepository {
	return new DesktopSharedProjectRepository({
		...options,
		onLocalCleanupError: () => undefined,
	});
}

function videoSource(): VideoSource {
	return createVideoSource({
		id: 'linked-workflow-source',
		storageKey: 'linked-workflow-storage',
		name: 'Linked workflow video.mp4',
		mimeType: 'video/mp4',
		frameCount: 90,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	});
}

function videoProject(source: VideoSource): AudioEditorProjectCurrent {
	const clip = createVideoClip({
		id: 'linked-workflow-clip',
		sourceId: source.id,
		durationFrames: source.sampleFrameCount,
		sourceDurationFrames: source.sampleFrameCount,
		binItemId: 'linked-workflow-bin-item',
	});
	return createCurrentAudioEditorProject({
		id: 'linked-workflow-project',
		title: 'Linked workflow project',
		revision: 3,
		now: NOW,
		sources: [source],
		projectBin: { clips: [clip] },
	});
}

async function linkedOriginalFixture(project: AudioEditorProjectCurrent, source: VideoSource) {
	const body = new Blob([VIDEO_TEXT], { type: source.mimeType });
	let locatorRevision = LOCATOR_REVISION;
	const platformReads: Array<Readonly<{
		locatorId: string;
		expectedRevision: string | null;
	}>> = [];
	const port: LinkedVideoOriginalPort = {
		async load(locatorId, { expectedRevision }) {
			platformReads.push({ locatorId, expectedRevision });
			if (locatorId !== LOCATOR_ID
				|| expectedRevision !== null && expectedRevision !== locatorRevision) return null;
			return { blob: body, locatorRevision };
		},
	};
	const memory = getMemoryDatabase(`linked-workflow-${Date.now()}-${Math.random()}`);
	const storagePort = { memory, database: async () => null };
	const bindings = new LinkedVideoOriginalRepository(storagePort, {
		now: () => new Date(NOW),
		createBindingToken: () => 'binding_workflow_00000001',
	});
	const resolver = new LinkedVideoOriginalResolver(bindings, port);
	const binding = await resolver.bind(project.id, source, LOCATOR_ID);
	platformReads.length = 0;
	return {
		binding,
		body,
		platformReads,
		resolver,
		setLocatorRevision(value: string) { locatorRevision = value; },
		shadow: new ProjectRepository(storagePort, 5),
	};
}

function documentOnlyBridge(project: AudioEditorProjectCurrent): DesktopSharedProjectBridge {
	return {
		listSharedProjects: async () => [],
		async readSharedProject(projectId) {
			assert.equal(projectId, project.id);
			return serializeScapeProjectDocument(project);
		},
		commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
		deleteSharedProject: async () => true,
	};
}

function guardedOwnedMediaStore(): Readonly<{
	calls: string[];
	store: DesktopSharedSourceTransferStore;
}> {
	const calls: string[] = [];
	const unexpected = (method: string): never => {
		calls.push(method);
		throw new Error(`Owned media ${method} must not run for a linked original.`);
	};
	return {
		calls,
		store: {
			getSourceMetadata() { return unexpected('getSourceMetadata'); },
			readSourceChunks() { return unexpected('readSourceChunks'); },
			getMediaAssetMetadata() { return unexpected('getMediaAssetMetadata'); },
			loadMediaAsset() { return unexpected('loadMediaAsset'); },
			async beginMediaAssetWrite() { return unexpected('beginMediaAssetWrite'); },
			async beginSourceWrite() { return unexpected('beginSourceWrite'); },
			discardSourceIfCurrent() { return unexpected('discardSourceIfCurrent'); },
		},
	};
}

function linkedVideoPublicationBridge(
	project: AudioEditorProjectCurrent,
	source: VideoSource,
	binding: Awaited<ReturnType<LinkedVideoOriginalRepository['get']>>,
) {
	assert.ok(binding);
	const descriptor: DesktopSharedManagedVideoSourceDescriptor = Object.freeze({
		bindingId: `v${'a'.repeat(64)}`,
		byteLength: binding.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING,
		kind: 'video',
		sha256: binding.sha256,
		sourceId: source.id,
		storageKey: source.storageKey,
	});
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let finishCalls = 0;
	let abortCalls = 0;
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
		deleteSharedProject: async () => true,
		async beginSharedSourceWrite(declaration) {
			assert.deepEqual(declaration, {
				byteLength: binding.byteLength,
				encoding: DESKTOP_SHARED_VIDEO_ENCODING,
				projectId: project.id,
				projectRevision: project.revision,
				sha256: binding.sha256,
				sourceId: source.id,
			});
			return { status: 'ready', chunkSize: 7, writeId: 'linked-workflow-write' };
		},
		async writeSharedSourceChunk({ bytes, offset, writeId }) {
			assert.equal(writeId, 'linked-workflow-write');
			assert.equal(offset, byteLength);
			chunks.push(bytes.slice());
			byteLength += bytes.byteLength;
			return { nextOffset: byteLength };
		},
		async finishSharedSourceWrite({ sha256, writeId }) {
			finishCalls += 1;
			assert.equal(writeId, 'linked-workflow-write');
			assert.equal(sha256, binding.sha256);
			return descriptor;
		},
		async abortSharedSourceWrite() { abortCalls += 1; return true; },
		async readSharedSourceChunk() { throw new Error('sender must not read a managed body'); },
	};
	return {
		aborted: () => abortCalls,
		bridge,
		descriptor,
		finished: () => finishCalls,
		uploadedBytes() {
			const output = new Uint8Array(byteLength);
			let offset = 0;
			for (const chunk of chunks) {
				output.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return output;
		},
	};
}
