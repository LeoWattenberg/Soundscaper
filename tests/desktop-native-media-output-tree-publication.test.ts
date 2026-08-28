/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createNativeMediaOutputTreeIdentity,
	sealNativeMediaOutputTree,
	type NativeMediaAuthenticatedOutputTree,
} from '../desktop/native-media-output-tree.ts';
import { createFramescaperNativePublicationNodePort } from '../desktop/native-services-publication-node-port.ts';
import { publishVerifiedNativeMediaOutput } from '../desktop/native-services-publication.ts';
import type { FramescaperNativeRootGrant } from '../desktop/native-services-root-repository.ts';
import { createNativeMediaPublicationPlan } from '../src/common/editor/native-media-atomic-publication.ts';

const JOB_ID = 'ab'.repeat(20);
const PLAN = 'cd'.repeat(32);
const ROOT_GRANT_ID = 'ef'.repeat(16);
const SOURCE = '12'.repeat(32);

test('sealed output trees publish atomically and reconcile only their exact crash replay', async (t) => {
	const fixture = await treeFixture(t);
	const events: string[] = [];
	const port = createFramescaperNativePublicationNodePort(fixture.root, {
		renameDirectory: async (source, destination) => {
			events.push('rename-enter');
			assert.equal(await exists(source), true);
			assert.equal(await exists(destination), false);
			await rename(source, destination);
			assert.equal(await exists(source), false);
			assert.equal(await exists(destination), true);
			events.push('rename-exit');
		},
	});
	const request = publicationRequest(fixture);
	assert.equal((await publishVerifiedNativeMediaOutput(request, port)).outcome, 'published');
	assert.deepEqual(events, ['rename-enter', 'rename-exit']);
	assert.equal(await readFile(join(fixture.finalPath, 'frame-00000000.png'), 'utf8'), 'png-frame');
	assert.equal(await exists(fixture.temporaryPath), false);
	assert.equal((await publishVerifiedNativeMediaOutput(request, port)).outcome, 'already-published');
	assert.deepEqual(events, ['rename-enter', 'rename-exit']);

	const stalePlan = createNativeMediaPublicationPlan({
		jobId: '34'.repeat(20), relativeDestination: fixture.plan.relativeDestination,
		planFingerprint: PLAN,
	});
	await assert.rejects(() => publishVerifiedNativeMediaOutput({
		...request, plan: stalePlan,
	}, port), /stale against its job/iu);
});

test('tree publication is no-clobber and never copies after a cross-device rename failure', async (t) => {
	const occupied = await treeFixture(t, 'occupied');
	await mkdir(occupied.finalPath);
	await writeFile(join(occupied.finalPath, 'owner.txt'), 'existing');
	let attempted = false;
	const occupiedPort = createFramescaperNativePublicationNodePort(occupied.root, {
		renameDirectory: async () => { attempted = true; },
	});
	await assert.rejects(
		() => publishVerifiedNativeMediaOutput(publicationRequest(occupied), occupiedPort),
		/manifest|output tree/iu,
	);
	assert.equal(attempted, false);
	assert.equal(await readFile(join(occupied.finalPath, 'owner.txt'), 'utf8'), 'existing');
	assert.equal(await exists(occupied.temporaryPath), true);

	const crossDevice = await treeFixture(t, 'cross-device');
	const crossDevicePort = createFramescaperNativePublicationNodePort(crossDevice.root, {
		renameDirectory: async () => {
			throw Object.assign(new Error('simulated cross-device rename'), { code: 'EXDEV' });
		},
	});
	await assert.rejects(
		() => publishVerifiedNativeMediaOutput(publicationRequest(crossDevice), crossDevicePort),
		/cross-device/iu,
	);
	assert.equal(await exists(crossDevice.temporaryPath), true);
	assert.equal(await exists(crossDevice.finalPath), false);
});

test('broker trees are non-empty and a concurrent completed destination cannot be replaced', async (t) => {
	const fixture = await treeFixture(t, 'concurrent-winner');
	assert.ok(fixture.output.tree.fileCount >= 2,
		'an authenticated tree contains at least one frame and its native manifest');
	const port = createFramescaperNativePublicationNodePort(fixture.root, {
		renameDirectory: async (source, destination) => {
			await mkdir(destination);
			await writeFile(join(destination, 'winner.txt'), 'completed broker winner');
			await rename(source, destination);
		},
	});
	await assert.rejects(
		() => publishVerifiedNativeMediaOutput(publicationRequest(fixture), port),
		/(?:not empty|exist|directory)/iu,
	);
	assert.equal(await readFile(join(fixture.finalPath, 'winner.txt'), 'utf8'), 'completed broker winner');
	assert.equal(await exists(fixture.temporaryPath), true);
});

test('tree publication refuses extra files, symlink substitution, and root revocation', async (t) => {
	const tampered = await treeFixture(t, 'tampered');
	await writeFile(join(tampered.temporaryPath, 'extra.png'), 'extra');
	await assert.rejects(
		() => publishVerifiedNativeMediaOutput(
			publicationRequest(tampered), createFramescaperNativePublicationNodePort(tampered.root),
		),
		/manifest authentication/iu,
	);
	assert.equal(await exists(tampered.finalPath), false);

	const linked = await treeFixture(t, 'linked');
	const outside = join(linked.directory, 'outside');
	await mkdir(outside);
	await rm(linked.temporaryPath, { recursive: true });
	await symlink(outside, linked.temporaryPath, 'dir');
	await assert.rejects(
		() => publishVerifiedNativeMediaOutput(
			publicationRequest(linked), createFramescaperNativePublicationNodePort(linked.root),
		),
		/symbolic link/iu,
	);

	const revoked = await treeFixture(t, 'revoked');
	const revokedRoot = Object.freeze({ ...revoked.root, revokedAtMs: 99 });
	await assert.rejects(
		() => publishVerifiedNativeMediaOutput(
			publicationRequest(revoked), createFramescaperNativePublicationNodePort(revokedRoot),
		),
		/revoked/iu,
	);
});

test('a lost post-rename fence removes the exact published tree before advertisement', async (t) => {
	const fixture = await treeFixture(t, 'cancelled');
	const phases: string[] = [];
	await assert.rejects(() => publishVerifiedNativeMediaOutput(
		publicationRequest(fixture), createFramescaperNativePublicationNodePort(fixture.root), {
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', projectRevision: 0,
			beforePublication: async () => { phases.push('before'); },
			afterPublication: async () => {
				phases.push('after');
				throw new Error('queue cancellation revoked the writer fence');
			},
		},
	), /queue cancellation/iu);
	assert.deepEqual(phases, ['before', 'after']);
	assert.equal(await exists(fixture.finalPath), false);
	assert.equal(await exists(fixture.temporaryPath), false);
});

interface TreeFixture {
	readonly directory: string;
	readonly root: FramescaperNativeRootGrant;
	readonly plan: ReturnType<typeof createNativeMediaPublicationPlan>;
	readonly temporaryPath: string;
	readonly finalPath: string;
	readonly output: NativeMediaAuthenticatedOutputTree;
}

async function treeFixture(t: TestContext,
	name = 'success'): Promise<TreeFixture> {
	const directory = await mkdtemp(join(tmpdir(), `framescaper-output-tree-publication-${name}-`));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const rootPath = join(directory, 'exports');
	await mkdir(rootPath);
	const rootDetails = await lstat(rootPath, { bigint: true });
	const root = Object.freeze({
		grantId: ROOT_GRANT_ID, rootPath,
		volumeIdentity: `device:${rootDetails.dev.toString(16)}`,
		directoryIdentity: `device:${rootDetails.dev.toString(16)}:inode:${rootDetails.ino.toString(16)}`,
		authorizedAtMs: 1, revokedAtMs: null,
	});
	const relativeDestination = `sequences/${name}`;
	const plan = createNativeMediaPublicationPlan({
		jobId: JOB_ID, relativeDestination, planFingerprint: PLAN,
	});
	const finalPath = join(rootPath, ...relativeDestination.split('/'));
	const temporaryPath = join(rootPath, ...plan.temporaryRelativePath.split('/'));
	await mkdir(join(rootPath, 'sequences'));
	await mkdir(temporaryPath);
	const frame = Buffer.from('png-frame');
	await writeFile(join(temporaryPath, 'frame-00000000.png'), frame);
	const nativeManifest = Buffer.from(JSON.stringify({
		schemaVersion: 1, profileId: 'encode-png-sequence', frameCount: 1,
		frames: [{ ordinal: 0, fileName: 'frame-00000000.png',
			byteLength: frame.byteLength, sha256: digest(frame) }],
	}));
	await writeFile(join(temporaryPath, 'manifest.json'), nativeManifest);
	const identity = createNativeMediaOutputTreeIdentity({
		jobId: JOB_ID, planFingerprint: PLAN, rootGrantId: root.grantId,
		relativeDestination, sources: [{ sourceId: 'video-source', contentSha256: SOURCE }],
		profileId: 'encode-png-sequence', frameCount: 1,
	});
	const output = await sealNativeMediaOutputTree({
		path: temporaryPath, maximumBytes: 1024 * 1024, identity,
		nativeManifestSha256: digest(nativeManifest),
	});
	return Object.freeze({ directory, root, plan, temporaryPath, finalPath, output });
}

function publicationRequest(fixture: TreeFixture) {
	return Object.freeze({
		plan: fixture.plan, currentPlanFingerprint: PLAN, finalized: true,
		declaredByteLength: fixture.output.byteLength, declaredSha256: fixture.output.sha256,
		tree: fixture.output.tree,
	});
}

async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
