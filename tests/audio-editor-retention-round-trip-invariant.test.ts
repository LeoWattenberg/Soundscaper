/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { collectProjectSourceIds } from '../src/common/editor/retention.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import {
	ProjectRepository,
	type ProjectDocument,
} from '../src/common/editor/storage/project-repository.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	createFramescaperProjectV18,
	validateFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const NOW = '2026-08-13T10:00:00.000Z';
const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const RENDER_SHA = 'ab'.repeat(32);
const CAMERA_A_SHA = '12'.repeat(32);
const CAMERA_B_SHA = '34'.repeat(32);

interface PersistableDocument {
	readonly name: string;
	readonly project: Record<string, unknown>;
	readonly validate: (project: unknown) => boolean;
}

function persistableDocuments(): readonly PersistableDocument[] {
	return [
		{
			name: 'current V17',
			project: currentProject() as unknown as Record<string, unknown>,
			validate: (project) => validateCurrentAudioEditorProject(project),
		},
		{
			name: 'Framescaper V18',
			project: framescaperProject() as unknown as Record<string, unknown>,
			validate: (project) => validateFramescaperProjectV18(PROFILE, project),
		},
	];
}

/**
 * The write path must never strip what the read path demands: every source a
 * document references has to survive the compaction that save and load apply.
 */
for (const { name, project, validate } of persistableDocuments()) {
	test(`${name} retention roots every source the document itself references`, () => {
		assert.equal(validate(project), true);
		const declared = new Set((project.sources as readonly { id: string }[]).map(({ id }) => id));
		const referenced = referencedSourceIds(project, declared);
		const rooted = collectProjectSourceIds(project);

		assert.deepEqual([...referenced].sort(), [...declared].sort());
		assert.deepEqual(
			[...referenced].filter((sourceId) => !rooted.has(sourceId)),
			[],
		);
	});

	test(`${name} survives a repository save and load round trip`, async () => {
		const repository = memoryRepository(name);
		const saved = await repository.save(project as ProjectDocument);
		const loaded = await repository.load(project.id as string);

		assert.ok(loaded);
		assert.deepEqual(sourceIds(saved), sourceIds(project));
		assert.deepEqual(sourceIds(loaded), sourceIds(project));
		assert.equal(validate(loaded), true);
	});
}

function memoryRepository(label: string): ProjectRepository {
	const memory = getMemoryDatabase(`retention-round-trip-${label}-${String(Math.random())}`);
	return new ProjectRepository({ memory, database: async () => null }, 5);
}

function sourceIds(project: unknown): string[] {
	return ((project as { sources: readonly { id: string }[] }).sources).map(({ id }) => id);
}

/** Any `sourceId` naming an own source is a durable reference, whatever holds it. */
function referencedSourceIds(
	project: unknown,
	declared: ReadonlySet<string>,
	found = new Set<string>(),
	key = '',
): Set<string> {
	if (Array.isArray(project)) {
		for (const entry of project) referencedSourceIds(entry, declared, found, key);
		return found;
	}
	if (project && typeof project === 'object') {
		for (const [childKey, child] of Object.entries(project)) {
			referencedSourceIds(child, declared, found, childKey);
		}
		return found;
	}
	if (key === 'sourceId' && typeof project === 'string' && declared.has(project)) found.add(project);
	return found;
}

function currentProject(): Record<string, unknown> {
	return createCurrentAudioEditorProject({
		id: 'retention-round-trip-v17',
		title: 'Retention round trip V17',
		now: NOW,
		sources: [
			createAudioSource({
				id: 'clip-source', name: 'Clip', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSource({
				id: 'take-source', name: 'Take', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSource({
				id: 'render-source', name: 'Render', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		clips: [{
			kind: 'audio', id: 'audio-clip', sourceId: 'clip-source', title: 'Clip',
			sequenceId: 'main-sequence', start: 0, duration: 1_000, offset: 0,
		}],
		tracks: [createAudioTrack({ id: 'audio-track', name: 'Vocal', clipIds: ['audio-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['audio-track'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [takeGroup()],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [publisherRequirement('audio', 'project-audio-mix-v1')],
		},
	} as never) as unknown as Record<string, unknown>;
}

function takeGroup(): Record<string, unknown> {
	return {
		id: 'take-group', sequenceId: 'main-sequence', trackId: 'audio-track',
		startSample: 100, endSample: 500,
		laneOrder: ['lane-a'],
		lanes: [{ id: 'lane-a' }],
		takes: [{
			id: 'take-a', laneId: 'lane-a', sourceId: 'take-source',
			startSample: 100, endSample: 500, sourceStartSample: 0,
		}],
		compRegions: [{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 500 }],
	};
}

function framescaperProject(): Record<string, unknown> {
	return createFramescaperProjectV18(PROFILE, {
		id: 'retention-round-trip-v18',
		title: 'Retention round trip V18',
		now: NOW,
		sources: [
			videoSource('camera-a', CAMERA_A_SHA),
			videoSource('camera-b', CAMERA_B_SHA),
			videoSource('render-source', RENDER_SHA),
			createAudioSource({
				id: 'take-source', name: 'Take', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'camera-a', title: 'Camera A',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		projectBin: { clips: [{
			kind: 'video', id: 'camera-b-bin', binItemId: 'camera-b-item', sourceId: 'camera-b',
			title: 'Camera B', sequenceId: 'main-sequence', sequenceStartFrame: 0,
			sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}] },
		tracks: [
			createVideoTrack({ id: 'video-track', name: 'Video', clipIds: ['video-clip'] }),
			createAudioTrack({ id: 'audio-track', name: 'Vocal', clipIds: [] }),
		],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track', 'audio-track'],
		}],
		primarySequenceId: 'main-sequence',
		takeGroups: [takeGroup()],
		multicameraGroups: [{
			id: 'multicamera-a', projectId: 'retention-round-trip-v18', sequenceId: 'main-sequence',
			outputClipId: 'video-clip', activeMemberId: 'member-a', members: [
				{ id: 'member-a', groupId: 'multicamera-a', sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'member-b', groupId: 'multicamera-a', sourceId: 'camera-b', syncOffsetSamples: 0 },
			],
		}],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [publisherRequirement('video', 'project-video-render-v1')],
		},
	} as never) as unknown as Record<string, unknown>;
}

function videoSource(id: string, contentSha256: string): Record<string, unknown> {
	return createVideoSource({
		id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256,
		frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
		frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
	}) as unknown as Record<string, unknown>;
}

function publisherRequirement(
	kind: 'audio' | 'video',
	role: string,
): Record<string, unknown> {
	return {
		id: 'publisher.film-grain',
		featureId: 'org.example.film-grain',
		displayName: 'Film grain',
		disposition: 'rendered-fallback',
		fallback: { role, kind, sourceId: 'render-source', sha256: RENDER_SHA },
	};
}
