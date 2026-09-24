/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createVideoClip, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

test('one in-memory editor cannot delete a project still owned by another open editor', async () => {
	const options = {
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
		databaseName: `memory-session-retention-${crypto.randomUUID()}`,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		const project = await first.createProjectIfAbsent({ id: 'project-a', revision: 0 });
		assert.ok(project);

		await assert.rejects(second.deleteProject(project.id), /another editor session still owns local project history/iu);
		assert.ok(await first.loadProject(project.id));

		await first.close();
		await second.deleteProject(project.id);
		assert.equal(await second.loadProject(project.id), null);
	} finally {
		await first.close();
		await second.close();
	}
});

test('memory source pruning retains unsaved history while another editor is open', async () => {
	const databaseName = `memory-source-retention-${crypto.randomUUID()}`;
	const options = { indexedDB: null, memoryFallback: true, preferOpfs: false, databaseName };
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	const memory = getMemoryDatabase(databaseName);
	try {
		await first.ready();
		await second.ready();
		memory.sources.set('source-a', {
			id: 'source-a', storage: 'indexeddb-chunks', sourceToken: 'source-token-a',
			committedAt: '2020-01-01T00:00:00.000Z',
		});

		const protectedPrune = await second.pruneUnreferencedSources({ minimumAgeMs: 0 });
		assert.deepEqual(protectedPrune.deletedSourceIds, []);
		assert.ok(memory.sources.has('source-a'));

		await first.close();
		const finalPrune = await second.pruneUnreferencedSources({ minimumAgeMs: 0 });
		assert.deepEqual(finalPrune.deletedSourceIds, ['source-a']);
		assert.equal(memory.sources.has('source-a'), false);
	} finally {
		await first.close();
		await second.close();
	}
});

test('memory clear preserves another open editor until that session closes', async () => {
	const options = {
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
		databaseName: `memory-clear-retention-${crypto.randomUUID()}`,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		await second.ready();
		await first.saveProject({ id: 'project-a', revision: 0 });

		await assert.rejects(second.clear(), /another editor session still owns local source history/iu);
		assert.ok(await first.loadProject('project-a'));

		await first.close();
		await second.clear();
		assert.equal(await second.loadProject('project-a'), null);
	} finally {
		await first.close();
		await second.close();
	}
});

test('memory locator cleanup holds admission until a new editor has registered', async () => {
	const options = {
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
		databaseName: `memory-admission-retention-${crypto.randomUUID()}`,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	let beginCleanup!: () => void;
	const cleanupStarted = new Promise<void>((resolve) => { beginCleanup = resolve; });
	let finishCleanup!: () => void;
	const cleanupGate = new Promise<void>((resolve) => { finishCleanup = resolve; });
	try {
		await first.ready();
		const cleanup = first.retentionRepository.withSoleSession(async () => {
			await first.loadProject('missing-project');
			beginCleanup();
			await cleanupGate;
			return true;
		});
		await cleanupStarted;
		let secondReady = false;
		const opening = second.ready().then(() => { secondReady = true; });
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		assert.equal(secondReady, false);
		finishCleanup();
		assert.deepEqual(await cleanup, { admitted: true, value: true });
		await opening;
		assert.equal(secondReady, true);
	} finally {
		finishCleanup();
		await first.close();
		await second.close();
	}
});

test('memory source replacement waits until another editor releases unsaved history', async () => {
	const options = {
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
		databaseName: `memory-replacement-retention-${crypto.randomUUID()}`,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	try {
		await first.ready();
		const originalWriter = await first.beginSourceWrite('source-a', { sampleRate: 48_000 });
		await originalWriter.write([Float32Array.of(0.25)]);
		const original = await originalWriter.commit();
		if (typeof original.sourceToken !== 'string') throw new Error('A committed source requires a generation token.');
		await second.ready();

		const rejectedWriter = await second.beginSourceWrite('source-a', { sampleRate: 48_000 });
		await rejectedWriter.write([Float32Array.of(0.5)]);
		await assert.rejects(
			rejectedWriter.commit({}, { ifAbsent: false, expectedSourceToken: original.sourceToken }),
			{ name: 'SourceReplacementRetainedError' },
		);
		assert.equal((await second.readSourceChunk('source-a', 0))?.channels[0]?.[0], 0.25);

		await first.close();
		const replacementWriter = await second.beginSourceWrite('source-a', { sampleRate: 48_000 });
		await replacementWriter.write([Float32Array.of(0.75)]);
		await replacementWriter.commit({}, { ifAbsent: false, expectedSourceToken: original.sourceToken });
		assert.equal((await second.readSourceChunk('source-a', 0))?.channels[0]?.[0], 0.75);
	} finally {
		await first.close();
		await second.close();
	}
});

test('memory linked binding pruning retains another editor\'s unsaved history', async () => {
	const released: unknown[] = [];
	const options = {
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
		revisionLimit: 2,
		databaseName: `memory-binding-retention-${crypto.randomUUID()}`,
		linkedVideoOriginalPort: {
			load: (_locatorId: string, { expectedRevision }: { expectedRevision: string | null }) => ({
				blob: new Blob(['linked video'], { type: 'video/mp4' }),
				locatorRevision: expectedRevision ?? 'snapshot-memory-retention-0001',
			}),
			release: (reference: unknown) => { released.push(reference); return true; },
		},
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	const source = createVideoSource({
		id: 'source-a', storageKey: 'storage-a', name: 'source-a.mp4', mimeType: 'video/mp4',
		frameCount: 48_000, sampleRate: 48_000, width: 16, height: 9,
		frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const clip = createVideoClip({
		id: 'clip-a', sourceId: source.id, title: source.name,
		durationFrames: source.sampleFrameCount, sourceDurationFrames: source.sampleFrameCount,
	});
	const linkedProject = createCurrentAudioEditorProject({
		id: 'project-a', revision: 1, sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'track-a', clipIds: [clip.id] })],
	});
	try {
		await first.ready();
		await second.ready();
		await first.saveProject(linkedProject, { protectedLinkedVideoSourceIds: [source.id] });
		await first.bindLinkedVideoOriginal('project-a', source, 'locator-memory-retention-0001');
		await first.saveProject(createCurrentAudioEditorProject({
			id: 'project-a', revision: 2, sources: [source], clips: [clip],
			tracks: [createVideoTrack({ id: 'track-a', clipIds: [clip.id] })],
		}), { protectedLinkedVideoSourceIds: [source.id] });
		await second.saveProject(createCurrentAudioEditorProject({ id: 'project-a', revision: 3 }), {
			protectedLinkedVideoSourceIds: [],
		});
		await second.saveProject(createCurrentAudioEditorProject({ id: 'project-a', revision: 4 }), {
			protectedLinkedVideoSourceIds: [],
		});

		assert.ok(await first.getLinkedVideoOriginalBinding('project-a', source.id));
		assert.deepEqual(released, []);

		await first.close();
		await second.saveProject(createCurrentAudioEditorProject({ id: 'project-a', revision: 5 }), {
			protectedLinkedVideoSourceIds: [],
		});
		assert.equal(await second.getLinkedVideoOriginalBinding('project-a', source.id), null);
		assert.deepEqual(released, [{
			locatorId: 'locator-memory-retention-0001',
			locatorRevision: 'snapshot-memory-retention-0001',
		}]);
	} finally {
		await first.close();
		await second.close();
	}
});
