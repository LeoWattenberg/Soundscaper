/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createClipboardEditService, type ClipboardEditProject } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { commitPasteWithLinkedSourceAliases } from '../src/common/editor/controller/edit/internal/paste-linked-source-aliases.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import { createAudioEditorSessionClipboard } from '../src/common/editor/session-clipboard-codec.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { encodeWav } from '../src/common/editor/wav.js';

const NOW = '2026-09-24T09:00:00.000Z';
const LOCATOR_ID = 'locator_paste_audio_000001';
const LOCATOR_REVISION = 'revision_paste_audio_0001';

test('a pasted linked audio source survives saving B and deleting A in the real store', async (context) => {
	const encoded = encodeWav([Float32Array.of(-1, 0.5)], {
		float: true, dither: false, sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	const wav = new Blob([bytes], { type: 'audio/wav' });
	const released: unknown[] = [];
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-paste-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: {
			load: (_kind: unknown, _locatorId: unknown, { expectedRevision }: { expectedRevision: string | null }) => ({
				blob: wav,
				locatorRevision: expectedRevision ?? LOCATOR_REVISION,
			}),
			release: (reference: unknown) => { released.push(reference); return true; },
		},
	});
	context.after(async () => { await store.close(); });
	const source = createAudioSource({
		id: 'linked-source', storageKey: 'linked-source', mimeType: 'audio/wav',
		frameCount: 2, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'source-clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 2, durationFrames: 2,
	});
	const origin = createCurrentAudioEditorProject({
		id: 'linked-paste-A', now: NOW, sampleRate: 48_000,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'origin-track', clipIds: [clip.id] }, 48_000)],
	});
	let destination = createCurrentAudioEditorProject({
		id: 'linked-paste-B', now: NOW, sampleRate: 48_000,
	});
	const binding = await store.bindLinkedAudioOriginal(origin.id, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION, expectedSnapshot: wav,
	});
	await store.saveProject(origin);
	await store.saveProject(destination);
	const session = createAudioEditorSessionClipboard(origin, {
		startFrame: 0, endFrame: 2, trackIds: ['origin-track'],
	});
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	let nextId = 0;
	const clipboard = createClipboardEditService({
		lifetime,
		state: { selectedTrackId: null, selectedClipId: null, clipboard: session.descriptor },
		copy: { noSilencesFound: 'No silences found.', track: 'Track' },
		session: {
			setClipboard: () => ({ clipboard: session }),
			clipboardForProject: () => session,
		},
		sourceBuffers: new Map(),
		getProject: () => projectForCommand(destination as unknown as Record<string, unknown>) as unknown as ClipboardEditProject,
		editingBlocked: () => false,
		getPositionFrames: () => 0,
		normalizeFrame: Number,
		snapFrame: Number,
		createId: (prefix) => `${prefix}-${++nextId}`,
		commit: () => undefined,
		setStatus: () => undefined,
	});
	const command = clipboard.prepareControllerPaste('overlap', 0);
	await commitPasteWithLinkedSourceAliases({
		command,
		originProjectId: origin.id,
		projectId: destination.id,
		store,
		assertCurrent: () => undefined,
		commit: (prepared) => { destination = applyEditorCommand(destination, prepared, { now: NOW }); },
	});
	await store.saveProject(destination);
	const alias = await store.getLinkedOriginalBinding(destination.id, source.id);
	assert.ok(alias);
	assert.notEqual(alias.bindingToken, binding.bindingToken);
	await store.deleteProject(origin.id);
	assert.deepEqual(released, []);
	const saved = await store.loadProject(destination.id);
	assert.ok(saved);
	assert.ok((saved.clips as readonly Readonly<{ sourceId: string }>[])
		.some((candidate) => candidate.sourceId === source.id));
	const resolved = await store.resolveLinkedAudioOriginal(destination.id, source);
	assert.equal(resolved?.blob.size, wav.size);
	assert.deepEqual([...(await store.readSourceChunk(source.storageKey, 0)).channels[0]], [-1, 0.5]);
});

test('a failed cross-project paste rolls back only its newly copied binding', async (context) => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-paste-rollback-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	const source = createAudioSource({
		id: 'source-a', storageKey: 'source-a', mimeType: 'audio/wav',
		frameCount: 1, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const originBinding = await store.linkedOriginalBindingRepository.putIfCurrent({
		schemaVersion: 2, kind: 'audio', projectId: 'project-A', sourceId: source.id,
		storageKey: source.storageKey, locatorId: 'locator_rollback_00000001',
		locatorRevision: 'revision_rollback_000001', mimeType: source.mimeType,
		byteLength: 1, sha256: 'a'.repeat(64),
		sourceShape: {
			frameCount: source.frameCount, channelCount: source.channelCount,
			sampleRate: source.sampleRate, originalSampleRate: source.originalSampleRate,
			sampleFormat: 'float32', chunkFrames: source.chunkFrames,
		},
	}, null);
	assert.ok(originBinding);
	const failure = new Error('planned paste commit failure');
	await assert.rejects(async () => commitPasteWithLinkedSourceAliases({
		command: { type: 'batch', commands: [{ type: 'source/add', source }, { type: 'clipboard/paste', clipboard: {
			schemaVersion: 2, sampleRate: 48_000, durationFrames: 1, tracks: [],
		}, atFrame: 0, mode: 'overlap' }] },
		originProjectId: 'project-A', projectId: 'project-B', store,
		assertCurrent: () => undefined,
		commit: () => { throw failure; },
	}), (error: unknown) => error === failure);
	assert.equal(await store.getLinkedOriginalBinding('project-B', source.id), null);
	assert.deepEqual(await store.getLinkedOriginalBinding('project-A', source.id), originBinding);
});
