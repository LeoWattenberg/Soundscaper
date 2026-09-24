/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperDesktopProjectLibraryTransferBodies,
	validateSoundscaperDesktopProjectLibraryHostBundle,
} from '../desktop/soundscaper-project-library-transfer-contract.ts';
import {
	createLegacySoundscaperDesktopLibraryFreezeMediaBinding,
	freezeRelativeFileForSoundscaperDesktopLibraryBinding,
} from '../desktop/soundscaper-project-library-media-binding.ts';
import { createSoundscaperDesktopProjectLibraryHandshake, createSoundscaperDesktopProjectLibraryPaths } from '../desktop/soundscaper-project-library-contract.ts';
import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts';
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

test('a metadata save negotiates existing frozen PCM without upload or a temporary copy', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-reused-freeze-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Uint8Array.from({ length: 36 }, (_value, index) => index);
	const project = frozenProject(createHash('sha256').update(bytes).digest('hex'));
	const descriptor = createSoundscaperDesktopProjectLibraryTransferBodies(project, documentDigest(project))[0]!;
	const paths = createSoundscaperDesktopProjectLibraryPaths(root);
	const mediaPath = join(paths.managedMediaRoot,
		freezeRelativeFileForSoundscaperDesktopLibraryBinding(descriptor.bindingId));
	let inspectReusedStage = false;
	let reusedStageSharesBody = false;
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 931, instanceId: 'reused-freeze-main' },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: {
			leaseTtlMs: 30_000,
			renewIntervalMs: 10_000,
			checkpoint: (phase: string) => {
				if (!inspectReusedStage || phase !== 'prepared') return;
				const stage = readdirSync(join(paths.libraryRoot, 'stage'))
					.find((name) => name.endsWith('-0001.stage'));
				assert.ok(stage);
				const staged = lstatSync(join(paths.libraryRoot, 'stage', stage));
				const existing = lstatSync(mediaPath);
				reusedStageSharesBody = staged.dev === existing.dev && staged.ino === existing.ino;
			},
		},
	});
	context.after(() => main.close());
	const session = main.openSession(createSoundscaperDesktopProjectLibraryHandshake());
	context.after(() => session.close());
	const firstId = '1'.repeat(48);
	const firstAdmission = await session.beginPublication({
		publicationId: firstId, expectedMetadataRevision: 0, expectedProject: null,
		project, bodies: [descriptor],
	});
	assert.deepEqual(firstAdmission.requiredBodyIndexes, [0]);
	assert.equal((await session.writePublicationChunk({
		publicationId: firstId, bodyIndex: 0, offset: 0, bytes,
	})).complete, true);
	const first = await session.finishPublication({ publicationId: firstId });
	inspectReusedStage = true;
	const renamed = applySoundscaperProjectCommand(project, { type: 'project/rename', title: 'Renamed project' });
	const secondId = '2'.repeat(48);
	const secondAdmission = await session.beginPublication({
		publicationId: secondId, expectedMetadataRevision: first.metadataRevision,
		expectedProject: { projectRevision: first.project.projectRevision, projectSha256: first.project.sha256 },
		project: renamed, bodies: createSoundscaperDesktopProjectLibraryTransferBodies(renamed, documentDigest(renamed)),
	});
	assert.deepEqual(secondAdmission.requiredBodyIndexes, []);
	await assert.rejects(session.writePublicationChunk({
		publicationId: secondId, bodyIndex: 0, offset: 0, bytes,
	}), /sequential/iu);
	const second = await session.finishPublication({ publicationId: secondId });
	assert.equal(second.project.name, 'Renamed project');
	assert.equal(reusedStageSharesBody, true);

	inspectReusedStage = false;
	await rm(mediaPath);
	const third = applySoundscaperProjectCommand(renamed, { type: 'project/rename', title: 'Restored body' });
	const thirdId = '3'.repeat(48);
	const thirdAdmission = await session.beginPublication({
		publicationId: thirdId, expectedMetadataRevision: second.metadataRevision,
		expectedProject: { projectRevision: second.project.projectRevision, projectSha256: second.project.sha256 },
		project: third, bodies: createSoundscaperDesktopProjectLibraryTransferBodies(third, documentDigest(third)),
	});
	assert.deepEqual(thirdAdmission.requiredBodyIndexes, [0]);
	await session.writePublicationChunk({ publicationId: thirdId, bodyIndex: 0, offset: 0, bytes });
	const restored = await session.finishPublication({ publicationId: thirdId });
	assert.equal(restored.project.name, 'Restored body');

	await writeFile(mediaPath, new Uint8Array(bytes.byteLength));
	const fourth = applySoundscaperProjectCommand(third, { type: 'project/rename', title: 'Again' });
	await assert.rejects(session.beginPublication({
		publicationId: '4'.repeat(48), expectedMetadataRevision: restored.metadataRevision,
		expectedProject: { projectRevision: restored.project.projectRevision, projectSha256: restored.project.sha256 },
		project: fourth, bodies: createSoundscaperDesktopProjectLibraryTransferBodies(fourth, documentDigest(fourth)),
	}), /SHA-256/iu);
});

function frozenProject(contentSha256 = 'a'.repeat(64)) {
	const live = audioSource('live-source', 'live-storage', 'b'.repeat(64));
	const freeze = audioSource('freeze-source', 'freeze-storage', contentSha256);
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
