/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { SoundscaperDesktopProjectLibraryCatalog } from '../desktop/soundscaper-project-library-catalog.ts';
import { createSoundscaperDesktopProjectLibraryHandshake, createSoundscaperDesktopProjectLibraryPaths } from '../desktop/soundscaper-project-library-contract.ts';
import { initializeSoundscaperDesktopProjectLibraryDatabase } from '../desktop/soundscaper-project-library-database.ts';
import { createSoundscaperDesktopLibraryFreezeMediaBinding } from '../desktop/soundscaper-project-library-media-binding.ts';
import type { SoundscaperDesktopProjectLibraryPublicationPlan } from '../desktop/soundscaper-project-library-publication-contract.ts';
import { SoundscaperDesktopProjectLibraryPublicationHost } from '../desktop/soundscaper-project-library-publication-host.ts';
import {
	stageSoundscaperDesktopProjectLibraryPublication,
} from '../desktop/soundscaper-project-library-publication-files.ts';
import { createSoundscaperDesktopProjectLibraryTransferBodies } from '../desktop/soundscaper-project-library-transfer-contract.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('a rename publication reuses PCM and copies only its metadata when hard links are unsupported', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-no-hardlink-rename-'));
	const database = new DatabaseSync(':memory:');
	context.after(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const catalog = SoundscaperDesktopProjectLibraryCatalog.create({
		database,
		owner: { product: 'soundscaper', processId: 932, instanceId: 'no-hardlink-publisher' },
		randomId: () => 'f'.repeat(48),
	});
	catalog.acceptHandshake(handshake);
	const lease = catalog.acquireLease({ ttlMs: 30_000 });
	let secondPublication = false;
	let noPcmStage = false;
	let id = 0;
	const host = SoundscaperDesktopProjectLibraryPublicationHost.create({
		database, appDataPath: root,
		randomId: () => (++id).toString(16).padStart(48, '0'),
		checkpoint: (phase: string) => {
			if (secondPublication && phase === 'prepared') {
				noPcmStage = !readdirSync(join(host.paths.libraryRoot, 'stage'))
					.some((name) => name.endsWith('-0001.stage'));
			}
		},
	});
	host.acceptHandshake(handshake);
	const bodyBytes = Uint8Array.from({ length: 36 }, (_value, index) => index);
	const project = frozenProject(digest(bodyBytes));
	const body = createSoundscaperDesktopProjectLibraryTransferBodies(project,
		digest(new TextEncoder().encode(JSON.stringify(project))))[0]!;
	const mediaPath = join(host.paths.managedMediaRoot,
		createSoundscaperDesktopLibraryFreezeMediaBinding(
			body.sourceId, body.storageKey, body.byteLength, body.sha256).relativeFile);
	const first = await host.publish({
		lease, expectedMetadataRevision: 0, expectedProject: null, project,
		bodies: [{ descriptor: body, chunks: { async *[Symbol.asyncIterator]() { yield bodyBytes; } } }],
	});
	assert.deepEqual([...await readFile(mediaPath)], [...bodyBytes]);
	const links: Array<readonly [string, string]> = [];
	const unavailableLink: typeof link = async (source, destination): Promise<void> => {
		links.push([String(source), String(destination)]);
		throw Object.assign(new Error('hard links unavailable'), { code: 'EOPNOTSUPP' });
	};
	const renamed = applySoundscaperProjectCommand(project, { type: 'project/rename', title: 'Renamed project' });
	const renamedBody = createSoundscaperDesktopProjectLibraryTransferBodies(renamed,
		digest(new TextEncoder().encode(JSON.stringify(renamed))))[0]!;
	secondPublication = true;
	const second = await host.publish({
		lease, expectedMetadataRevision: first.metadataRevision,
		expectedProject: { projectRevision: first.project.projectRevision, projectSha256: first.project.sha256 },
		project: renamed,
		bodies: [{ descriptor: renamedBody,
			chunks: { [Symbol.asyncIterator]() { throw new Error('Reused PCM was streamed'); } } }],
	}, undefined, undefined, new Set([0]), unavailableLink);
	assert.equal(second.project.name, 'Renamed project');
	assert.equal(noPcmStage, true);
	assert.deepEqual([...await readFile(mediaPath)], [...bodyBytes]);
	assert.equal(links.length, 2);
	assert.match(links[0]![0], /media[/\\]freeze/u);
	assert.match(links[1]![1], /projects[/\\]/u);
});

test('reused-body staging does not swallow collisions, missing files, I/O errors, or content corruption', async (context) => {
	for (const code of ['EEXIST', 'ENOENT', 'EIO']) {
		const fixture = await publicationFixture(context);
		const refusedLink = async (): Promise<void> => {
			throw Object.assign(new Error(`link failed: ${code}`), { code });
		};
		await assert.rejects(stageSoundscaperDesktopProjectLibraryPublication(
			fixture.paths, fixture.transactionId, fixture.plan, undefined, new Set([0]), refusedLink),
			(error: unknown) => error instanceof Error && error.message === `link failed: ${code}`);
	}
	const fixture = await publicationFixture(context);
	await writeFile(fixture.mediaPath, new Uint8Array(fixture.bodyBytes.byteLength));
	await assert.rejects(stageSoundscaperDesktopProjectLibraryPublication(
		fixture.paths, fixture.transactionId, fixture.plan, undefined, new Set([0]),
		async () => { throw new Error('A corrupted body reached the link step'); }), /SHA-256/iu);
});

async function publicationFixture(context: { after(callback: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-no-hardlink-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const paths = createSoundscaperDesktopProjectLibraryPaths(root);
	const bodyBytes = Uint8Array.from([1, 2, 3, 4]);
	const bodySha256 = digest(bodyBytes);
	const binding = createSoundscaperDesktopLibraryFreezeMediaBinding('freeze-source', 'freeze-store',
		bodyBytes.byteLength, bodySha256);
	const mediaPath = join(paths.managedMediaRoot, binding.relativeFile);
	await mkdir(dirname(mediaPath), { recursive: true });
	await writeFile(mediaPath, bodyBytes);
	const document = '{"id":"project","revision":1}';
	const plan = {
		document,
		projectRelativeFile: `entry0001/1-${digest(new TextEncoder().encode(document))}.json`,
		bundle: { project: { sha256: digest(new TextEncoder().encode(document)) } },
		bodies: [{
			bodyId: binding.id,
			mediaRelativeFile: binding.relativeFile,
			descriptor: { byteLength: bodyBytes.byteLength, sha256: bodySha256 },
			chunks: { [Symbol.asyncIterator]() { throw new Error('Reused PCM was streamed'); } },
		}],
	} as unknown as SoundscaperDesktopProjectLibraryPublicationPlan;
	return { paths, plan, mediaPath, bodyBytes, document, transactionId: 'a'.repeat(48) };
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function frozenProject(contentSha256: string) {
	const live = createAudioSource({
		id: 'live-source', storageKey: 'live-storage', contentSha256: 'b'.repeat(64),
		frameCount: 4, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const freeze = createAudioSource({
		id: 'freeze-source', storageKey: 'freeze-storage', contentSha256,
		frameCount: 4, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'live-clip', sourceId: live.id, title: 'Live clip', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
	});
	const track = createAudioTrack({
		id: 'frozen-track', name: 'Frozen track', clipIds: [clip.id],
		audioFreeze: {
			schemaVersion: 1, derivedSourceId: freeze.id,
			inputDigestSha256: '1'.repeat(64), rackDigestSha256: '2'.repeat(64),
			automationDigestSha256: '3'.repeat(64), freshnessDigestSha256: '4'.repeat(64),
			renderStartFrame: 0, renderFrameCount: 4, capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProject({
		id: 'no-hardlink-project', title: 'Original project', sources: [live, freeze], clips: [clip],
		tracks: [track], sequences: [{ id: 'main-sequence', trackIds: [track.id] }],
		primarySequenceId: 'main-sequence',
	});
}
