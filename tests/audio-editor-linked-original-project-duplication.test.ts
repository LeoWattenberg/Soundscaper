/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createVideoClipV9,
	createVideoSourceV9,
} from '../src/common/editor/project-v9.ts';
import {
	duplicateProjectWithLinkedOriginals,
	type LinkedOriginalProjectDuplicationPort,
} from '../src/common/editor/storage/project-duplication.ts';
import type { LinkedOriginalSource } from '../src/common/editor/storage/linked-original-resolver.ts';

const SOURCE_PROJECT_ID = 'mixed-duplicate-source';
const COPY_PROJECT_ID = 'mixed-duplicate-copy';
const NOW = '2026-08-02T12:00:00.000Z';

test('generic duplication aliases every reachable audio and video source before publication', async () => {
	const source = mixedProject();
	const events: string[] = [];
	let admittedSources: readonly LinkedOriginalSource[] = [];
	const port: LinkedOriginalProjectDuplicationPort<{ readonly token: string }> = {
		aliases: {
			copyReachableAliases: async (_sourceId, _destinationId, sources) => {
				events.push('aliases');
				admittedSources = sources;
				return Object.freeze([{ token: 'mixed-alias-batch' }]);
			},
			rollbackAliases: async () => { events.push('rollback'); },
		},
		loadProject: async () => source,
		listProjects: async () => [source],
		createProjectIfAbsent: async (project) => {
			events.push('project');
			return project;
		},
	};

	const copy = await duplicateProjectWithLinkedOriginals(port, {
		sourceProjectId: SOURCE_PROJECT_ID,
		copyProjectId: COPY_PROJECT_ID,
		timestamp: NOW,
	});

	assert.equal(copy.id, COPY_PROJECT_ID);
	assert.deepEqual(events, ['aliases', 'project']);
	assert.deepEqual(admittedSources.map(({ kind, id }) => ({ kind, id })), [
		{ kind: 'audio', id: 'audio-source' },
		{ kind: 'video', id: 'video-source' },
	]);
});

test('generic duplication rolls back the exact mixed alias batch after publication failure', async () => {
	const source = mixedProject();
	const failure = new Error('planned project commit failure');
	const batch = Object.freeze([{ token: 'exact-mixed-alias-batch' }]);
	let rolledBack: readonly unknown[] | null = null;
	const port: LinkedOriginalProjectDuplicationPort<{ readonly token: string }> = {
		aliases: {
			copyReachableAliases: async () => batch,
			rollbackAliases: async (aliases) => { rolledBack = aliases; },
		},
		loadProject: async () => source,
		listProjects: async () => [source],
		createProjectIfAbsent: async () => { throw failure; },
	};

	await assert.rejects(duplicateProjectWithLinkedOriginals(port, {
		sourceProjectId: SOURCE_PROJECT_ID,
		copyProjectId: COPY_PROJECT_ID,
		timestamp: NOW,
	}), (error) => error === failure);
	assert.strictEqual(rolledBack, batch);
});

function mixedProject() {
	const audio = createAudioSourceV9({
		id: 'audio-source', storageKey: 'audio-storage', mimeType: 'audio/wav',
		frameCount: 120, channelCount: 2, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const video = createVideoSourceV9({
		id: 'video-source', storageKey: 'video-storage', mimeType: 'video/mp4',
		frameCount: 120, sampleRate: 48_000, width: 1_920, height: 1_080,
		frameRate: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
	});
	return createAudioEditorProjectV10({
		id: SOURCE_PROJECT_ID,
		title: 'Mixed linked originals',
		now: NOW,
		sources: [audio, video],
		clips: [
			createAudioClipV9({
				id: 'audio-clip', sourceId: audio.id, durationFrames: 120, sourceDurationFrames: 120,
			}),
			createVideoClipV9({
				id: 'video-clip', sourceId: video.id, durationFrames: 120, sourceDurationFrames: 120,
			}),
		],
	});
}
