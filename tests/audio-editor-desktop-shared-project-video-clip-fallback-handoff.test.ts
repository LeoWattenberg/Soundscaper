/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoSourceV10,
} from '../src/common/editor/project-v10.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { createDesktopLibraryVideoMediaBinding } from '../desktop/project-library-media-binding.ts';
import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	verifyProjectFallbackIntegrity,
	type ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
import {
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	acquireDesktopSharedProjectMedia,
	DESKTOP_SHARED_VIDEO_ENCODING,
	prepareDesktopSharedProjectMediaHandoff,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import {
	managedSourceBinding,
	type ManagedVideoSource,
} from '../src/common/editor/storage/desktop-shared-project-media-sources.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const SAMPLE_RATE = 48_000;
const VIDEO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;

test('fresh recipient activates an exact clip-render fallback after managed handoff', async (context) => {
	const fixture = clipFallbackFixture();
	const canonicalDocument = serializeScapeProjectDocument(fixture.project);
	const sender = memoryStore(context, 'sender');
	for (const source of fixture.sources) {
		await sender.writeMediaAsset(
			source.storageKey,
			mediaBlob(requiredBody(fixture.bodyBySourceId, source.id), source.mimeType),
			{ name: source.name, mimeType: source.mimeType },
		);
	}
	const transport = handoffTransport(fixture.project, fixture.sources);

	const descriptors = await prepareDesktopSharedProjectMediaHandoff(
		fixture.project,
		transport.bridge,
		sender,
	);

	assert.deepEqual(transport.declaredSourceIds, [
		fixture.targetSourceId,
		fixture.unaffectedSourceId,
		fixture.fallbackSourceId,
	]);
	assert.deepEqual(descriptors, fixture.sources.map((source) => ({
		bindingId: videoBinding(fixture.project, source),
		byteLength: requiredBody(fixture.bodyBySourceId, source.id).byteLength,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING,
		kind: 'video',
		sha256: digest(requiredBody(fixture.bodyBySourceId, source.id)),
		sourceId: source.id,
		storageKey: source.storageKey,
	})));
	for (const descriptor of descriptors) {
		assert.deepEqual(
			transport.bodyByBinding.get(descriptor.bindingId),
			requiredBody(fixture.bodyBySourceId, descriptor.sourceId),
		);
	}
	assertCanonicalRelationship(fixture.project, fixture, canonicalDocument);

	const recipient = memoryStore(context, 'recipient');
	for (const source of fixture.sources) {
		assert.equal(await recipient.getMediaAssetMetadata(source.storageKey), null);
	}
	const acquisition = await acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		descriptors,
		transport.bridge,
		recipient,
	);
	assert.deepEqual(
		[...acquisition.trustedSourceIds],
		[fixture.targetSourceId, fixture.unaffectedSourceId, fixture.fallbackSourceId],
	);
	for (const source of fixture.sources) {
		assert.deepEqual(
			await readMediaBytes(recipient, source.storageKey),
			requiredBody(fixture.bodyBySourceId, source.id),
		);
	}
	await recipient.saveProject(fixture.project);
	acquisition.commit();
	const reopened = await recipient.loadProject(fixture.project.id, {
		revision: fixture.project.revision,
	});
	assert.ok(reopened);
	if (!validateCurrentAudioEditorProject(reopened)) throw new Error('Recipient did not reopen an exact V9 project.');
	assert.notStrictEqual(reopened, fixture.project);
	assertCanonicalRelationship(reopened, fixture, canonicalDocument);

	const selector: ProjectVideoFallbackIntegritySelector = {
		requirementId: 'publisher-video-effects-render',
		featureId: VIDEO_EFFECTS,
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: fixture.fallbackSourceId,
		sha256: fixture.fallbackDigest,
		targetClipId: fixture.targetClipId,
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(reopened, recipient, {
			videoFallback: { ...selector, targetClipId: fixture.unaffectedClipId },
		}),
		/selected video rendered fallback/iu,
	);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(reopened, recipient, {
			videoFallback: { ...selector, role: 'project-video-render-v1', targetClipId: null },
		}),
		/selected video rendered fallback/iu,
	);
	const admission = await verifyProjectFallbackIntegrity(reopened, recipient, {
		videoFallback: selector,
	});
	admission.assertCurrent(reopened);
	assert.deepEqual(
		new Uint8Array(await admission.getVerifiedVideoBlob(selector).arrayBuffer()),
		requiredBody(fixture.bodyBySourceId, fixture.fallbackSourceId),
	);

	const playbackProjects = createPlaybackProjectService({ videoEffects: false });
	assertProjectedClipFallback(
		playbackProjects.projectForPlayback(reopened),
		fixture,
		reopened,
	);
	assertProjectedClipFallback(
		playbackProjects.projectForVideoRenderedFallbackDelivery(reopened),
		fixture,
		reopened,
	);
	assertCanonicalRelationship(fixture.project, fixture, canonicalDocument);
	assertCanonicalRelationship(reopened, fixture, canonicalDocument);
});

interface ClipFallbackFixture {
	readonly bodyBySourceId: ReadonlyMap<string, Uint8Array>;
	readonly fallbackDigest: string;
	readonly fallbackSourceId: string;
	readonly project: AudioEditorProjectCurrent;
	readonly sources: readonly FixtureVideoSource[];
	readonly targetClipId: string;
	readonly targetSourceId: string;
	readonly unaffectedClipId: string;
	readonly unaffectedSourceId: string;
}

interface FixtureVideoSource extends ManagedVideoSource {
	readonly id: string;
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
}

function clipFallbackFixture(): ClipFallbackFixture {
	const targetSourceId = 'canonical-target-video';
	const unaffectedSourceId = 'canonical-unaffected-video';
	const fallbackSourceId = 'rendered-target-video';
	const targetClipId = 'target-video-clip';
	const unaffectedClipId = 'unaffected-video-clip';
	const targetSource = createVideoSourceV10({
		id: targetSourceId, storageKey: 'canonical-target-video-storage',
		name: 'Target.mp4', mimeType: 'video/mp4', sampleFrameCount: 192_000,
		sourceFrameCount: 120, sampleRate: SAMPLE_RATE, width: 1_920, height: 1_080,
		frameRate: { num: 30, den: 1 },
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}) as unknown as FixtureVideoSource;
	const unaffectedSource = createVideoSourceV10({
		id: unaffectedSourceId, storageKey: 'canonical-unaffected-video-storage',
		name: 'Unaffected.mp4', mimeType: 'video/mp4', sampleFrameCount: 48_000,
		sourceFrameCount: 24, sampleRate: SAMPLE_RATE, width: 1_280, height: 720,
		frameRate: { num: 24, den: 1 },
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}) as unknown as FixtureVideoSource;
	const fallbackSource = createVideoSourceV10({
		id: fallbackSourceId, storageKey: 'rendered-target-video-storage',
		name: 'Rendered target.mp4', mimeType: 'video/mp4', sampleFrameCount: 32_000,
		sourceFrameCount: 20, sampleRate: SAMPLE_RATE, width: 1_920, height: 1_080,
		frameRate: { num: 30, den: 1 }, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}) as unknown as FixtureVideoSource;
	const targetClip = {
		kind: 'video',
		id: targetClipId, sourceId: targetSourceId, title: 'Effect shot',
		sequenceId: 'main-sequence', sequenceStartFrame: 12, sequenceFrameCount: 20,
		sourceInFrame: 8, sourceFrameCount: 40,
		trimStartFrames: 2, trimEndFrames: 3, speedRatio: 2,
		groupId: 'scene-a',
		videoEffects: [createVideoEffect('pixelate', { id: 'pixelate-target' })],
	};
	const unaffectedClip = {
		kind: 'video',
		id: unaffectedClipId, sourceId: unaffectedSourceId, title: 'Unaffected shot',
		sequenceId: 'main-sequence', sequenceStartFrame: 48, sequenceFrameCount: 12,
		sourceInFrame: 2, sourceFrameCount: 12, groupId: 'scene-b',
	};
	const fallbackBody = Uint8Array.of(0x66, 0x61, 0x6c, 0x6c, 0x62, 0x61, 0x63, 0x6b);
	const project = createCurrentAudioEditorProject({
		id: 'managed-clip-fallback-project', title: 'Managed clip fallback', revision: 3,
		now: '2026-08-03T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: [targetSource, unaffectedSource, fallbackSource],
		clips: [targetClip, unaffectedClip],
		tracks: [createVideoTrackV9({
			id: 'video-track', name: 'Picture', clipIds: [targetClipId, unaffectedClipId],
		})],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-video-effects-render',
				featureId: VIDEO_EFFECTS,
				displayName: 'Publisher video effects render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'video-clip-render-v1', kind: 'video', sourceId: fallbackSourceId,
					sha256: digest(fallbackBody), targetClipId,
				},
			}],
		},
	});
	return Object.freeze({
		bodyBySourceId: new Map([
			[targetSourceId, Uint8Array.of(0x74, 0x61, 0x72, 0x67, 0x65, 0x74)],
			[unaffectedSourceId, Uint8Array.of(0x6f, 0x74, 0x68, 0x65, 0x72)],
			[fallbackSourceId, fallbackBody],
		]),
		fallbackDigest: digest(fallbackBody),
		fallbackSourceId,
		project,
		sources: [targetSource, unaffectedSource, fallbackSource],
		targetClipId,
		targetSourceId,
		unaffectedClipId,
		unaffectedSourceId,
	});
}

function assertProjectedClipFallback(
	projection: Readonly<{
		project: AudioEditorProjectCurrent;
		videoRenderedFallback: Readonly<{
			role: string;
			sourceId: string;
			targetClipId?: string;
		}> | null;
		requiredVideoSourceIds: readonly string[];
	}>,
	fixture: ClipFallbackFixture,
	canonicalProject: AudioEditorProjectCurrent,
): void {
	assert.deepEqual(projection.videoRenderedFallback, {
		schemaVersion: 1,
		role: 'video-clip-render-v1',
		featureId: VIDEO_EFFECTS,
		requirementId: 'publisher-video-effects-render',
		sourceId: fixture.fallbackSourceId,
		targetClipId: fixture.targetClipId,
	});
	assert.deepEqual(projection.requiredVideoSourceIds, [fixture.fallbackSourceId]);
	const canonicalTarget = canonicalProject.clips.find(({ id }) => id === fixture.targetClipId)!;
	const canonicalUnaffected = canonicalProject.clips.find(({ id }) => id === fixture.unaffectedClipId)!;
	const projectedTarget = projection.project.clips.find(({ id }) => id === fixture.targetClipId)!;
	const projectedUnaffected = projection.project.clips.find(({ id }) => id === fixture.unaffectedClipId)!;
	assert.deepEqual(projectedTarget, {
		...canonicalTarget,
		sourceId: fixture.fallbackSourceId,
		sourceInFrame: 0,
		sourceFrameCount: 20,
		retimeMap: null,
		trimStartFrames: 0,
		trimEndFrames: 0,
		speedRatio: 1,
		videoEffects: [],
	});
	assert.strictEqual(projectedUnaffected, canonicalUnaffected);
	assert.strictEqual(projection.project.tracks, canonicalProject.tracks);
}

function assertCanonicalRelationship(
	project: AudioEditorProjectCurrent,
	fixture: ClipFallbackFixture,
	expectedDocument: string,
): void {
	assert.equal(serializeScapeProjectDocument(project), expectedDocument);
	assert.deepEqual(project.featureRequirements.requirements[0]?.fallback, {
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: fixture.fallbackSourceId,
		sha256: fixture.fallbackDigest,
		targetClipId: fixture.targetClipId,
	});
}

function handoffTransport(project: AudioEditorProjectCurrent, sources: readonly FixtureVideoSource[]): {
	readonly bodyByBinding: ReadonlyMap<string, Uint8Array>;
	readonly bridge: DesktopSharedSourceTransferBridge;
	readonly declaredSourceIds: readonly string[];
} {
	type Declaration = Parameters<DesktopSharedSourceTransferBridge['beginSharedSourceWrite']>[0];
	const sourceById = new Map(sources.map((source) => [source.id, source]));
	const sessions = new Map<string, { declaration: Declaration; chunks: Uint8Array[] }>();
	const bodyByBinding = new Map<string, Uint8Array>();
	const declaredSourceIds: string[] = [];
	const bridge: DesktopSharedSourceTransferBridge = {
		async beginSharedSourceWrite(declaration) {
			assert.equal(declaration.encoding, DESKTOP_SHARED_VIDEO_ENCODING);
			declaredSourceIds.push(declaration.sourceId);
			const writeId = `write-${declaration.sourceId}`;
			sessions.set(writeId, { declaration, chunks: [] });
			return { status: 'ready', chunkSize: 3, writeId };
		},
		async writeSharedSourceChunk({ bytes, offset, writeId }) {
			const session = requiredSession(sessions, writeId);
			assert.equal(offset, session.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
			session.chunks.push(bytes.slice());
			return { nextOffset: offset + bytes.byteLength };
		},
		async finishSharedSourceWrite({ sha256, writeId }) {
			const session = requiredSession(sessions, writeId);
			const source = sourceById.get(session.declaration.sourceId);
			if (!source) throw new Error('Unexpected managed source');
			const body = joinBytes(session.chunks);
			assert.equal(sha256, session.declaration.sha256);
			assert.equal(digest(body), sha256);
			const descriptor: DesktopSharedManagedSourceDescriptor = Object.freeze({
				bindingId: videoBinding(project, source),
				byteLength: body.byteLength,
				encoding: DESKTOP_SHARED_VIDEO_ENCODING,
				kind: 'video',
				sha256,
				sourceId: source.id,
				storageKey: source.storageKey,
			});
			bodyByBinding.set(descriptor.bindingId, body);
			return descriptor;
		},
		async abortSharedSourceWrite(writeId) {
			return sessions.delete(writeId);
		},
		async readSharedSourceChunk({ bindingId, length, offset }) {
			const body = bodyByBinding.get(bindingId);
			if (!body) throw new Error('Unexpected managed binding');
			return body.slice(offset, offset + length);
		},
	};
	return { bodyByBinding, bridge, declaredSourceIds };
}

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `clip-fallback-handoff-${label}-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

function requiredBody(bodies: ReadonlyMap<string, Uint8Array>, sourceId: string): Uint8Array {
	const body = bodies.get(sourceId);
	if (!body) throw new Error(`Missing fixture body for ${sourceId}`);
	return body;
}

function requiredSession<Value>(sessions: ReadonlyMap<string, Value>, writeId: string): Value {
	const session = sessions.get(writeId);
	if (!session) throw new Error(`Missing upload session ${writeId}`);
	return session;
}

async function readMediaBytes(store: AudioEditorProjectStore, storageKey: string): Promise<Uint8Array | null> {
	const blob = await store.loadMediaAsset(storageKey);
	return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

function mediaBlob(bytes: Uint8Array, type: string): Blob {
	return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function videoBinding(project: AudioEditorProjectCurrent, source: FixtureVideoSource): string {
	const projectDigest = createHash('sha256')
		.update(serializeScapeProjectDocument(project), 'utf8')
		.digest('hex');
	return createDesktopLibraryVideoMediaBinding(
		project.id,
		managedSourceBinding(source),
		project.revision,
		projectDigest,
	).id;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
