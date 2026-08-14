/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts';
import { SoundscaperDesktopProjectLibraryV10Main } from '../desktop/soundscaper-project-library-v10-main.ts';
import {
	createSoundscaperDesktopProjectLibraryV10TransferBodies,
} from '../desktop/soundscaper-project-library-v10-transfer-contract.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T12:00:00.000Z';
const PCM = canonicalPcm([0.25, -0.5]);
const PCM_SHA256 = digest(PCM);

test('Soundscaper main publishes, reopens, duplicates, reads freeze PCM, and deletes by exact CAS', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-main-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const project = frozenProject('soundscaper-v21-main', 'Soundscaper V21 main');
	let main = await start(root, 'soundscaper-main-first');
	let session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	const published = await publish(session, project, 0, null, PCM, '01'.repeat(24));
	assert.equal(published.project.projectSchemaVersion, 21);
	assert.deepEqual(JSON.parse(published.document), project);
	assert.equal(published.bodies.length, 1);
	await session.close();
	await main.close();

	main = await start(root, 'soundscaper-main-recovery');
	session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	const reopened = await session.readProjectBundle(project.id);
	assert.ok(reopened);
	assert.deepEqual(JSON.parse(reopened.document), project);
	assert.deepEqual(await session.readBodyChunk({
		projectId: project.id,
		metadataRevision: reopened.metadataRevision,
		projectRevision: reopened.project.projectRevision,
		projectSha256: reopened.project.sha256,
		body: reopened.bodies[0], offset: 0, length: PCM.byteLength,
	}), PCM);

	const copy = await session.duplicateProject({
		sourceProjectId: project.id,
		copyProjectId: 'soundscaper-v21-main-copy',
		title: 'Soundscaper V21 main copy',
		timestamp: '2026-08-14T12:01:00.000Z',
		expectedMetadataRevision: reopened.metadataRevision,
		expectedSource: {
			projectRevision: reopened.project.projectRevision,
			projectSha256: reopened.project.sha256,
		},
	});
	assert.equal(copy.project.projectSchemaVersion, 21);
	assert.equal(JSON.parse(copy.document).id, 'soundscaper-v21-main-copy');
	assert.equal(copy.bodies.length, 1);
	assert.deepEqual(await session.readBodyChunk({
		projectId: copy.project.projectId,
		metadataRevision: copy.metadataRevision,
		projectRevision: copy.project.projectRevision,
		projectSha256: copy.project.sha256,
		body: copy.bodies[0], offset: 0, length: PCM.byteLength,
	}), PCM);

	const deleted = await session.deleteProject({
		projectId: project.id,
		expectedMetadataRevision: copy.metadataRevision,
		expectedProject: {
			projectRevision: reopened.project.projectRevision,
			projectSha256: reopened.project.sha256,
		},
	});
	assert.deepEqual(deleted, {
		projectId: project.id, metadataRevision: copy.metadataRevision + 1, deleted: true,
	});
	assert.equal(await session.readProjectBundle(project.id), null);
	assert.ok(await session.readProjectBundle(copy.project.projectId));
	assert.deepEqual((await session.listProjects()).projects.map(({ id }) => id), [copy.project.projectId]);
	await session.close();
	await main.close();
});

test('Soundscaper main accepts a higher coalesced project revision under exact base CAS', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-v10-main-jump-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const current = frozenProject('soundscaper-v21-main-jump', 'Soundscaper V21 current');
	const main = await start(root, 'soundscaper-main-jump');
	context.after(() => main.close());
	const session = main.openSession(createSoundscaperDesktopProjectLibraryV10Handshake());
	context.after(() => session.close());
	const first = await publish(session, current, 0, null, PCM, '11'.repeat(24));
	const expected = {
		projectRevision: first.project.projectRevision,
		projectSha256: first.project.sha256,
	};
	const coalesced = revise(current, 2, 'Soundscaper V21 coalesced');
	const jumped = await publish(
		session, coalesced, first.metadataRevision, expected, PCM, '12'.repeat(24),
	);
	assert.equal(jumped.metadataRevision, first.metadataRevision + 1);
	assert.equal(jumped.project.projectRevision, 2);
	assert.deepEqual(JSON.parse(jumped.document), coalesced);

	const jumpedExpected = {
		projectRevision: jumped.project.projectRevision,
		projectSha256: jumped.project.sha256,
	};
	await assert.rejects(
		publish(session, revise(coalesced, 2, 'Equal revision'), jumped.metadataRevision,
			jumpedExpected, PCM, '13'.repeat(24)),
		/strictly greater|higher project revision/iu,
	);
	await assert.rejects(
		publish(session, revise(coalesced, 1, 'Lower revision'), jumped.metadataRevision,
			jumpedExpected, PCM, '14'.repeat(24)),
		/strictly greater|higher project revision/iu,
	);
	await assert.rejects(
		publish(session, revise(coalesced, 3, 'Divergent base'), jumped.metadataRevision, {
			...jumpedExpected,
			projectSha256: 'ff'.repeat(32),
		}, PCM, '15'.repeat(24)),
		/compare-and-swap/iu,
	);
	const retained = await session.readProjectBundle(current.id);
	assert.ok(retained);
	assert.equal(retained.metadataRevision, jumped.metadataRevision);
	assert.deepEqual(JSON.parse(retained.document), coalesced);
});

async function start(appDataPath: string, instanceId: string) {
	return SoundscaperDesktopProjectLibraryV10Main.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 901, instanceId },
		handshake: createSoundscaperDesktopProjectLibraryV10Handshake(),
	});
}

async function publish(
	session: ReturnType<SoundscaperDesktopProjectLibraryV10Main['openSession']>,
	project: ReturnType<typeof frozenProject>,
	expectedMetadataRevision: number,
	expectedProject: Readonly<{ projectRevision: number; projectSha256: string }> | null,
	body: Uint8Array,
	publicationId: string,
) {
	const document = JSON.stringify(project);
	const descriptors = createSoundscaperDesktopProjectLibraryV10TransferBodies(project, digest(document));
	const admission = await session.beginPublication({
		publicationId, expectedMetadataRevision, expectedProject, project, bodies: descriptors,
	});
	assert.equal(admission.bodyCount, 1);
	assert.deepEqual(await session.writePublicationChunk({
		publicationId, bodyIndex: 0, offset: 0, bytes: body,
	}), { bodyIndex: 0, nextOffset: body.byteLength, complete: true });
	return session.finishPublication({ publicationId });
}

function frozenProject(id: string, title: string) {
	const source = createAudioSourceV10({
		id: 'live-source', storageKey: 'pcm:live-source', frameCount: 2, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const derived = createAudioSourceV10({
		id: 'freeze-source', storageKey: 'derived:freeze-source', contentSha256: PCM_SHA256,
		frameCount: 2, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClipV10({
		id: 'live-clip', sourceId: source.id, title: 'Live', timelineStartFrame: 0,
		durationFrames: 2, sourceStartFrame: 0, sourceDurationFrames: 2,
	});
	const track = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: [clip.id], audioFreeze: {
			schemaVersion: 1, derivedSourceId: derived.id,
			inputDigestSha256: '11'.repeat(32), rackDigestSha256: '22'.repeat(32),
			automationDigestSha256: '33'.repeat(32), freshnessDigestSha256: '44'.repeat(32),
			renderStartFrame: 0, renderFrameCount: 2, capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProjectV21({
		id, title, now: NOW, sources: [source, derived], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }], primarySequenceId: 'main-sequence',
	});
}

function revise(
	project: ReturnType<typeof frozenProject>,
	revision: number,
	title: string,
): ReturnType<typeof frozenProject> {
	return {
		...structuredClone(project),
		revision,
		title,
		updatedAt: `2026-08-14T12:${String(revision).padStart(2, '0')}:00.000Z`,
	};
}

function canonicalPcm(samples: readonly number[]): Uint8Array {
	const result = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	result.writeUInt32LE(samples.length, 0);
	for (const [index, sample] of samples.entries()) result.writeFloatLE(sample, 4 + index * 4);
	return Uint8Array.from(result);
}

function digest(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
