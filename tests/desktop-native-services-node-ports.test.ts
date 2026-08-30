/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createFramescaperNativeServicesNodePorts } from '../desktop/native-services-node-ports.ts';
import { createFramescaperNativePublicationNodePort } from '../desktop/native-services-publication-node-port.ts';

const JOB_ID = 'ab'.repeat(20);
const PLAN = 'cd'.repeat(32);

test('node ports bind roots, non-recursive scans, scratch cleanup, and publication to exact filesystem identities', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-native-ports-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const durableRoot = join(temporary, 'exports');
	const scratchRoot = join(temporary, 'scratch');
	await mkdir(durableRoot);
	await mkdir(scratchRoot);
	await writeFile(join(durableRoot, 'source.mov'), 'source');
	await mkdir(join(durableRoot, 'nested'));
	await writeFile(join(durableRoot, 'nested', 'ignored.mov'), 'ignored');
	await symlink(join(durableRoot, 'source.mov'), join(durableRoot, 'linked.mov'));
	const ports = createFramescaperNativeServicesNodePorts({
		scratchRoot,
		selectDirectory: async () => durableRoot,
		now: () => 5_000,
		mintOpaqueId: () => '12'.repeat(16),
	});
	const selection = await ports.selectRoot();
	assert.ok(selection);
	assert.equal(selection.rootPath, durableRoot);
	assert.equal(selection.grantId, '12'.repeat(16));
	assert.equal((await ports.probeRoot({ ...selection, revokedAtMs: null })).exists, true);

	const entries = await ports.watchScan({
		schemaFamily: 'framescaper', schemaVersion: 1,
		ruleId: '34'.repeat(8), grantId: selection.grantId, projectId: 'project-1', binId: null,
		extensions: ['mov'], recursive: false, maximumDepth: 0, importMode: 'link', generateProxies: false,
		enabled: true, createdAtMs: 5_000,
	}, { ...selection, revokedAtMs: null });
	assert.deepEqual(entries.map((entry) => [entry.name, entry.isDirectory, entry.symbolicLink]), [
		['linked.mov', false, true], ['nested', true, false], ['source.mov', false, false],
	]);
	const source = entries.find((entry) => entry.name === 'source.mov');
	assert.ok(source);
	assert.deepEqual(await ports.watchProbe(source), {
		succeeded: true,
		contentSha256: createHash('sha256').update('source').digest('hex'),
	});

	const scratchDirectory = `job-${JOB_ID}`;
	await mkdir(join(scratchRoot, scratchDirectory));
	await writeFile(join(scratchRoot, scratchDirectory, 'manifest.json'), JSON.stringify({
		jobId: JOB_ID, manifestDigest: '56'.repeat(32), rootIdentity: selection.directoryIdentity,
	}));
	assert.deepEqual(await ports.scratchCleanup.inspect(scratchDirectory), {
		jobId: JOB_ID, manifestDigest: '56'.repeat(32), rootIdentity: selection.directoryIdentity,
	});
	const checkpoint = Object.freeze({
		version: 1 as const, jobId: JOB_ID, planFingerprint: PLAN,
		sourceInventoryDigest: '78'.repeat(32), plannedFrameCount: 2,
		manifest: Object.freeze([Object.freeze({
			frameIndex: 0, relativePath: 'frames/000001.png', byteLength: 8,
			sha256: '9a'.repeat(32), planFingerprint: PLAN,
			sourceInventoryDigest: '78'.repeat(32),
		})]),
	});
	await ports.checkpointStore.write(checkpoint);
	assert.deepEqual(await ports.checkpointStore.read(JOB_ID), checkpoint);
	const reopened = createFramescaperNativeServicesNodePorts({
		scratchRoot, selectDirectory: async () => null,
	});
	assert.deepEqual(await reopened.checkpointStore.read(JOB_ID), checkpoint);
	await ports.scratchCleanup.remove(scratchDirectory);
	assert.equal(await ports.scratchCleanup.inspect(scratchDirectory), null);

	const temporaryRelativePath = `programme.mov.${JOB_ID.slice(0, 16)}.partial`;
	await writeFile(join(durableRoot, temporaryRelativePath), 'finished');
	const publication = ports.publicationPortFor({ ...selection, revokedAtMs: null });
	assert.equal((await publication.inspect(temporaryRelativePath))?.sha256,
		createHash('sha256').update('finished').digest('hex'));
	await publication.renameTemporarySibling(temporaryRelativePath, 'programme.mov');
	assert.equal(await readFile(join(durableRoot, 'programme.mov'), 'utf8'), 'finished');
	assert.equal(await publication.inspect(temporaryRelativePath), null);
	assert.equal((await ports.checkpointInspectFor({ ...selection, revokedAtMs: null })({
		frameIndex: 0, relativePath: 'programme.mov', byteLength: 8,
		sha256: createHash('sha256').update('finished').digest('hex'),
		planFingerprint: PLAN, sourceInventoryDigest: '78'.repeat(32),
	}))?.byteLength, 8);
});

test('node ports reject a selected symlink and never follow a symlink publication component', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-native-ports-symlink-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const durableRoot = join(temporary, 'exports');
	const rootLink = join(temporary, 'exports-link');
	await mkdir(durableRoot);
	await symlink(durableRoot, rootLink);
	const selectingLink = createFramescaperNativeServicesNodePorts({
		scratchRoot: join(temporary, 'scratch'), selectDirectory: async () => rootLink,
	});
	await assert.rejects(() => selectingLink.selectRoot(), /symbolic link/iu);
	const ports = createFramescaperNativeServicesNodePorts({
		scratchRoot: join(temporary, 'scratch'), selectDirectory: async () => durableRoot,
	});
	const selection = await ports.selectRoot();
	assert.ok(selection);
	await mkdir(join(durableRoot, 'real'));
	await symlink(join(durableRoot, 'real'), join(durableRoot, 'alias'));
	await assert.rejects(() => ports.publicationPortFor({ ...selection, revokedAtMs: null })
		.inspect('alias/output.mov'), /symbolic link/iu);
});

test('file publication falls back to same-filesystem rename when hard links are unsupported', async (t) => {
	const rootPath = await mkdtemp(join(tmpdir(), 'framescaper-native-no-links-'));
	t.after(() => rm(rootPath, { recursive: true, force: true }));
	const rootStat = await lstat(rootPath, { bigint: true });
	const grant = Object.freeze({
		grantId: 'ef'.repeat(16), rootPath,
		volumeIdentity: `device:${rootStat.dev.toString(16)}`,
		directoryIdentity: `device:${rootStat.dev.toString(16)}:inode:${rootStat.ino.toString(16)}`,
		authorizedAtMs: 1, revokedAtMs: null,
	});
	const temporary = `output.mov.${'a'.repeat(16)}.partial`;
	await writeFile(join(rootPath, temporary), 'finished');
	let renamed = false;
	const publication = createFramescaperNativePublicationNodePort(grant, {
		linkFile: async () => { throw Object.assign(new Error('links unsupported'), { code: 'ENOTSUP' }); },
		renameFile: async (source, destination) => { renamed = true; await rename(source, destination); },
	});
	await publication.renameTemporarySibling(temporary, 'output.mov');
	assert.equal(renamed, true);
	assert.equal(await readFile(join(rootPath, 'output.mov'), 'utf8'), 'finished');
	assert.equal(await publication.inspect(temporary), null);
});

test('watch locator registration keeps the path main-private and rejects post-registration tamper', async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), 'framescaper-native-watch-locator-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const durableRoot = join(temporary, 'watched');
	await mkdir(durableRoot);
	const videoPath = join(durableRoot, 'clip.mp4');
	await writeFile(videoPath, 'video-one');
	let entry = null as Awaited<ReturnType<ReturnType<typeof createFramescaperNativeServicesNodePorts>['watchScan']>>[number] | null;
	const paths: string[] = [];
	const released: string[] = [];
	let tamper = false;
	const ports = createFramescaperNativeServicesNodePorts({
		scratchRoot: join(temporary, 'scratch'), selectDirectory: async () => durableRoot,
		watchLocator: {
			registerPath: async (path) => {
				paths.push(path);
				if (tamper) await writeFile(path, 'video-two');
				assert.ok(entry);
				return Object.freeze({
					locatorId: 'a'.repeat(32), locatorRevision: 'b'.repeat(32),
					name: entry.name, size: entry.sizeBytes, mimeType: 'video/mp4',
					lastModified: entry.modifiedAtMs,
				});
			},
			release: async (locator) => { released.push(locator.locatorId); return true; },
		},
	});
	const root = await ports.selectRoot();
	assert.ok(root);
	const entries = await ports.watchScan({
		schemaFamily: 'framescaper', schemaVersion: 1,
		ruleId: '34'.repeat(8), grantId: root.grantId, projectId: 'project-1', binId: null,
		extensions: ['mp4'], recursive: false, maximumDepth: 0, importMode: 'link',
		generateProxies: false, enabled: true, createdAtMs: 0,
	}, { ...root, revokedAtMs: null });
	entry = entries[0] ?? null;
	assert.ok(entry);
	const digest = createHash('sha256').update('video-one').digest('hex');
	const locator = await ports.watchRegisterLocator(entry, digest, Object.freeze({ owner: 1 }));
	assert.equal(paths[0], videoPath);
	assert.equal('path' in locator, false);

	await writeFile(videoPath, 'video-one');
	const refreshed = await ports.watchScan({
		schemaFamily: 'framescaper', schemaVersion: 1,
		ruleId: '34'.repeat(8), grantId: root.grantId, projectId: 'project-1', binId: null,
		extensions: ['mp4'], recursive: false, maximumDepth: 0, importMode: 'link',
		generateProxies: false, enabled: true, createdAtMs: 0,
	}, { ...root, revokedAtMs: null });
	entry = refreshed[0] ?? null;
	assert.ok(entry);
	tamper = true;
	await assert.rejects(
		() => ports.watchRegisterLocator(entry!, digest, Object.freeze({ owner: 2 })),
		/changed during locator registration/iu,
	);
	assert.deepEqual(released, ['a'.repeat(32)]);
});
