/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createMemoryFfmpeg,
	deferred,
} from './helpers/audio-editor-controller-fixtures.js';
import {
	COPY,
	createAudioEditorController,
	createCurrentAudioEditorProject,
	createMemoryEngine,
	createProjectStore,
} from './helpers/audio-editor-controller-harness.js';

interface PasteRevisionSnapshot {
	readonly history: Readonly<{ readonly hasClipboard: boolean }>;
	readonly project: Readonly<{
		readonly title: string;
		readonly clips: readonly Readonly<{ readonly id: string }>[];
		readonly sources: readonly unknown[];
	}>;
	readonly selectedTrackId: string | null;
	readonly status: unknown;
}

interface MonoDecisionDeferred {
	readonly promise: Promise<Readonly<{ readonly accepted: boolean; readonly dontShowAgain: boolean }>>;
	resolve(value: Readonly<{ readonly accepted: boolean; readonly dontShowAgain: boolean }>): void;
}

test('a converted paste refuses to overwrite an intervening edit on the same project', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `paste-revision-fence-${Date.now()}-${Math.random()}`,
	});
	await writeSource(store, 'mono-source', [Float32Array.of(1, 0, -1, 0)]);
	await writeSource(store, 'stereo-source', [
		Float32Array.of(1, 0, -1, 0),
		Float32Array.of(-1, 0, 1, 0),
	]);
	const project = createCurrentAudioEditorProject({
		id: 'paste-revision-project',
		title: 'Before',
		now: '2026-09-10T12:00:00.000Z',
		sources: [
			source('mono-source', 1),
			source('stereo-source', 2),
		],
		tracks: [
			{ type: 'audio', id: 'mono-track', name: 'Mono', clipIds: ['mono-clip'] },
			{ type: 'audio', id: 'stereo-track', name: 'Stereo', clipIds: ['stereo-clip'] },
		],
		clips: [
			clip('mono-clip', 'mono-source'),
			clip('stereo-clip', 'stereo-source'),
		],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const decision = deferred() as unknown as MonoDecisionDeferred;
	const requests: Array<Readonly<{ signal?: AbortSignal }>> = [];
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		confirmMonoConversion: (value: Readonly<{ signal?: AbortSignal }>) => {
			requests.push(value);
			return decision.promise;
		},
	} as never);
	try {
		await controller.ready;
		controller.actions.timeline.selectClip('stereo-clip');
		controller.actions.edit.copy();
		assert.equal(snapshot(controller).history.hasClipboard, true);
		controller.actions.edit.commit({ type: 'track/remove', trackId: 'stereo-track' });
		controller.actions.timeline.selectClip('mono-clip');
		assert.equal(snapshot(controller).selectedTrackId, 'mono-track');
		const paste = controller.actions.edit.paste() as PromiseLike<unknown> | undefined;
		assert.ok(paste && typeof paste.then === 'function', JSON.stringify({
			pasteType: typeof paste,
			request: requests[0],
			status: snapshot(controller).status,
			sources: snapshot(controller).project.sources,
			clips: snapshot(controller).project.clips,
		}));
		assert.ok(requests[0]?.signal instanceof AbortSignal);

		controller.actions.edit.commit({ type: 'project/rename', title: 'Intervening edit' });
		decision.resolve({ accepted: true, dontShowAgain: false });

		await assert.rejects(Promise.resolve(paste), { name: 'AbortError' });
		const current = snapshot(controller);
		assert.equal(current.project.title, 'Intervening edit');
		assert.deepEqual(current.project.clips.map(({ id }) => id), ['mono-clip']);
		assert.equal(current.project.sources.length, 2);
	} finally {
		await controller.dispose();
	}
});

function snapshot(controller: ReturnType<typeof createAudioEditorController>): PasteRevisionSnapshot {
	const value = controller.getSnapshot();
	if (!value.project) throw new Error('Expected a loaded project snapshot.');
	return value as unknown as PasteRevisionSnapshot;
}

function source(id: string, channelCount: number) {
	return {
		id,
		storageKey: id,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	};
}

function clip(id: string, sourceId: string) {
	return {
		id,
		sourceId,
		title: id,
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 4,
		durationFrames: 4,
	};
}

async function writeSource(
	store: ReturnType<typeof createProjectStore>,
	id: string,
	channels: readonly Float32Array[],
): Promise<void> {
	const writer = await store.beginSourceWrite(id, {
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: channels.length,
		chunkFrames: 65_536,
	});
	await writer.write(channels);
	await writer.commit({ sampleRate: 48_000, channelCount: channels.length, chunkFrames: 65_536 });
}
