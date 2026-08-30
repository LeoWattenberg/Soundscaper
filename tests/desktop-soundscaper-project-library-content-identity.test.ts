/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createSoundscaperDesktopProjectLibraryTransferBodies,
	validateSoundscaperDesktopProjectLibraryHostBundle,
} from '../desktop/soundscaper-project-library-transfer-contract.ts';
import {
	createLegacySoundscaperDesktopLibraryFreezeMediaBinding,
} from '../desktop/soundscaper-project-library-media-binding.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	soundscaperDesktopBodiesForProject,
	validateSoundscaperDesktopBundle,
} from '../src/soundscaper/desktop-project-library-renderer-contract.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile.ts';

test('unchanged freeze PCM keeps one content identity across project saves', () => {
	const first = frozenProject();
	const second = applySoundscaperProjectCommand(first, { type: 'project/rename', title: 'Renamed project' });
	const firstSha256 = documentDigest(first);
	const secondSha256 = documentDigest(second);
	assert.notEqual(firstSha256, secondSha256);
	assert.notEqual(first.revision, second.revision);

	const firstMain = createSoundscaperDesktopProjectLibraryTransferBodies(first, firstSha256);
	const secondMain = createSoundscaperDesktopProjectLibraryTransferBodies(second, secondSha256);
	assert.equal(firstMain[0]?.bindingId, secondMain[0]?.bindingId);
	assert.equal(firstMain[0]?.sha256, secondMain[0]?.sha256);

	const firstRenderer = soundscaperDesktopBodiesForProject(
		SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, first, firstSha256,
	).bodies;
	const secondRenderer = soundscaperDesktopBodiesForProject(
		SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, second, secondSha256,
	).bodies;
	assert.equal(firstRenderer[0]?.bindingId, secondRenderer[0]?.bindingId);
	assert.deepEqual(firstRenderer, firstMain);
	assert.deepEqual(secondRenderer, secondMain);
});

test('content-addressed readers retain compatibility with revision-addressed freeze bodies', () => {
	const project = frozenProject();
	const document = JSON.stringify(project);
	const projectSha256 = documentDigest(project);
	const bytes = new TextEncoder().encode(document);
	const currentBody = createSoundscaperDesktopProjectLibraryTransferBodies(project, projectSha256)[0]!;
	const legacyBinding = createLegacySoundscaperDesktopLibraryFreezeMediaBinding(
		String(project.id),
		JSON.stringify([currentBody.sourceId, currentBody.storageKey]),
		Number(project.revision),
		projectSha256,
	);
	const legacyBody = Object.freeze({ ...currentBody, bindingId: legacyBinding.id });
	const projectRow = {
		id: 'contentidentity',
		projectId: project.id,
		name: project.title,
		metadataFile: `contentidentity/${String(project.revision)}-${projectSha256}.json`,
		preferredProduct: 'soundscaper',
		updatedAtMs: 0,
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		projectRevision: project.revision,
		byteLength: bytes.byteLength,
		sha256: projectSha256,
	} as const;
	const metadata = {
		schemaVersion: 1,
		revision: 1,
		projects: [projectRow],
		media: [{
			id: legacyBinding.id,
			relativeFile: legacyBinding.relativeFile,
			category: 'audio-freeze',
			byteLength: legacyBody.byteLength,
			sha256: legacyBody.sha256,
		}],
	} as const;

	assert.equal(validateSoundscaperDesktopProjectLibraryHostBundle({
		metadata, document, bodies: [legacyBody],
	}, String(project.id)).bodies[0]?.bindingId, legacyBinding.id);
	assert.equal(validateSoundscaperDesktopBundle(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, {
		metadataRevision: 1, project: projectRow, document, bodies: [legacyBody],
	}, String(project.id)).bundle.bodies[0]?.bindingId, legacyBinding.id);
});

function frozenProject() {
	const live = audioSource('live-source', 'live-storage', 'b'.repeat(64));
	const freeze = audioSource('freeze-source', 'freeze-storage', 'a'.repeat(64));
	const clip = createAudioClip({
		id: 'live-clip',
		sourceId: live.id,
		title: 'Live clip',
		timelineStartFrame: 0,
		durationFrames: 4,
		sourceStartFrame: 0,
		sourceDurationFrames: 4,
	});
	const track = createAudioTrack({
		id: 'frozen-track',
		name: 'Frozen track',
		clipIds: [clip.id],
		audioFreeze: {
			schemaVersion: 1,
			derivedSourceId: freeze.id,
			inputDigestSha256: '1'.repeat(64),
			rackDigestSha256: '2'.repeat(64),
			automationDigestSha256: '3'.repeat(64),
			freshnessDigestSha256: '4'.repeat(64),
			renderStartFrame: 0,
			renderFrameCount: 4,
			capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProject({
		id: 'content-identity-project',
		title: 'Content identity project',
		sources: [live, freeze],
		clips: [clip],
		tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }],
		primarySequenceId: 'main-sequence',
	});
}

function audioSource(id: string, storageKey: string, contentSha256: string) {
	return createAudioSource({
		id,
		storageKey,
		contentSha256,
		frameCount: 4,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	});
}

function documentDigest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
