/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
	createDesktopProjectLibraryPaths,
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
} from '../desktop/project-library-contract.ts';
import {
	DesktopLibraryLeaseBusyError,
	SharedDesktopProjectLibrary,
} from '../desktop/project-library.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'soundscaper-instance-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'framescaper-instance-b',
});

test('shared desktop library paths stay in one fixed appData scope', async (context) => {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-app-data-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataRoot);

	assert.equal(isAbsolute(paths.libraryRoot), true);
	assert.equal(relative(appDataRoot, paths.libraryRoot), join('kw.media', 'scape-project-library', 'v1'));
	assert.equal(relative(paths.libraryRoot, paths.databasePath), 'library.sqlite3');
	assert.equal(relative(paths.libraryRoot, paths.projectsRoot), 'projects');
	assert.equal(relative(paths.libraryRoot, paths.managedMediaRoot), 'media');
	assert.equal(Object.isFrozen(paths), true);
	assert.equal(Object.values(paths).some((path) => /indexeddb|chromium|profile/iu.test(path)), false);
	assert.throws(() => createDesktopProjectLibraryPaths('relative/app-data'), /absolute appData path/u);
	assert.throws(() => createDesktopProjectLibraryPaths(`${appDataRoot}\0escape`), /NUL/u);
});

test('metadata publication is atomic, scoped, and strictly validated', async (context) => {
	const fixture = await createFixture(context);
	let confirmPrepared: (() => void) | undefined;
	let continuePublication: (() => void) | undefined;
	const prepared = new Promise<void>((resolvePromise) => { confirmPrepared = resolvePromise; });
	const publicationAllowed = new Promise<void>((resolvePromise) => { continuePublication = resolvePromise; });
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: async (phase) => {
			if (phase !== 'prepared') return;
			confirmPrepared?.();
			await publicationAllowed;
		},
	});
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const lease = await first.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });

	assert.deepEqual(first.readMetadata(), emptyMetadata());
	const revision = populatedMetadata(1);
	const publication = first.publishMetadata({ lease, metadata: revision });
	await prepared;
	assert.deepEqual(second.readMetadata(), emptyMetadata());
	continuePublication?.();
	assert.deepEqual(await publication, revision);
	assert.deepEqual(second.readMetadata(), revision);

	await assert.rejects(
		() => first.publishMetadata({
			lease,
			metadata: {
				...populatedMetadata(2),
				media: [{ ...populatedMetadata(2).media[0], relativeFile: '../outside.wav' }],
			},
		}),
		/scoped relative path/u,
	);
	assert.deepEqual(second.readMetadata(), revision);
	assert.equal((await stat(fixture.paths.libraryRoot)).isDirectory(), true);
	assert.equal((await stat(fixture.paths.databasePath)).mode & 0o777, 0o600);
});

test('metadata paths remain portable across supported desktop filesystems', () => {
	for (const relativeFile of ['CON/original.wav', 'project./original.wav', 'aux.txt']) {
		assert.throws(
			() => validateDesktopLibraryMetadata({
				...populatedMetadata(1),
				media: [{ ...populatedMetadata(1).media[0], relativeFile }],
			}),
			/portable filesystem path/u,
		);
	}
	assert.throws(
		() => validateDesktopLibraryMetadata({
			...populatedMetadata(1),
			projects: [
				...populatedMetadata(1).projects,
				{
					...populatedMetadata(1).projects[0],
					id: 'shared-project-2',
					metadataFile: 'SHARED-PROJECT-1/PROJECT.JSON',
				},
			],
		}),
		/duplicate project metadata path/u,
	);
});

test('cross-process leases expose owners and expiry and fence stale holders', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	const original = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	assert.deepEqual(first.currentLease(), original);
	await assert.rejects(
		() => first.renewLease({ ...original, owner: OWNER_B }, 1_000),
		/no longer owns/u,
	);

	await assert.rejects(
		() => second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 }),
		(error: unknown) => {
			assert.equal(error instanceof DesktopLibraryLeaseBusyError, true);
			assert.deepEqual((error as DesktopLibraryLeaseBusyError).holder.owner, OWNER_A);
			return true;
		},
	);

	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	assert.equal(replacement.tookOverStaleLease, true);
	assert.equal(replacement.fencingToken > original.fencingToken, true);
	await assert.rejects(() => first.renewLease(original, 1_000), /no longer owns/u);
	await assert.rejects(
		() => first.publishMetadata({ lease: original, metadata: populatedMetadata(1) }),
		/no longer owns/u,
	);
	assert.equal(await first.releaseLease(original), false);
	assert.equal(await second.releaseLease(replacement), true);
	assert.equal(second.currentLease(), null);
});

test('the lease serializes a separate desktop process through the shared database', async (context) => {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-process-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const readyPath = join(appDataRoot, 'holder-ready.json');
	const releasePath = join(appDataRoot, 'holder-release');
	const child = spawn(process.execPath, [
		'--import',
		'tsx',
		fileURLToPath(new URL('fixtures/desktop-project-library-holder.ts', import.meta.url)),
		appDataRoot,
		readyPath,
		releasePath,
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	let childError = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => { childError += chunk; });
	context.after(() => {
		if (child.exitCode === null) child.kill();
	});
	const childExit = once(child, 'exit');
	let holder: { processId: number; product: string } | null = null;
	for (let attempt = 0; attempt < 500 && !holder; attempt += 1) {
		try {
			holder = JSON.parse(await readFile(readyPath, 'utf8')) as { processId: number; product: string };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			if (child.exitCode !== null) throw new Error(`Desktop library holder exited before acquiring its lease: ${childError}`);
			await delay(10);
		}
	}
	assert.ok(holder, `Desktop library holder did not become ready: ${childError}`);
	assert.equal(holder.processId, child.pid);
	assert.equal(holder.product, 'framescaper');

	const paths = createDesktopProjectLibraryPaths(appDataRoot);
	const library = await SharedDesktopProjectLibrary.open(paths);
	context.after(() => library.close());
	await assert.rejects(
		() => library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 }),
		(error: unknown) => {
			assert.equal(error instanceof DesktopLibraryLeaseBusyError, true);
			assert.equal((error as DesktopLibraryLeaseBusyError).holder.owner.processId, child.pid);
			return true;
		},
	);
	await writeFile(releasePath, 'release', { flag: 'wx' });
	const [exitCode, signal] = await childExit;
	assert.equal(signal, null);
	assert.equal(exitCode, 0);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	assert.equal(lease.owner.product, 'soundscaper');
	await library.releaseLease(lease);
});

test('waiting for a lease is bounded and abortable', async (context) => {
	const fixture = await createFixture(context);
	const first = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const second = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		first.close();
		second.close();
	});
	await first.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const controller = new AbortController();
	const pending = second.acquireLease({
		owner: OWNER_B,
		ttlMs: 1_000,
		waitMs: 5_000,
		pollIntervalMs: 10,
		signal: controller.signal,
	});
	setTimeout(() => controller.abort(new Error('test cancellation')), 25);
	await assert.rejects(pending, (error: unknown) => {
		assert.equal((error as Error).name, 'AbortError');
		return true;
	});
});

test('recovery journals restore interrupted writes and recognize committed writes', async (context) => {
	const fixture = await createFixture(context);
	const initial = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	let lease = await initial.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	await initial.publishMetadata({ lease, metadata: populatedMetadata(1) });
	await initial.releaseLease(lease);
	initial.close();

	const interrupted = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: (phase) => {
			if (phase === 'prepared') throw new Error('simulated process exit after prepare');
		},
	});
	lease = await interrupted.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	await assert.rejects(
		() => interrupted.publishMetadata({ lease, metadata: populatedMetadata(2) }),
		/simulated process exit/u,
	);
	interrupted.close();

	const raw = new DatabaseSync(fixture.paths.databasePath);
	raw.prepare('UPDATE library_metadata SET json = ?, digest = ? WHERE singleton = 1')
		.run('{interrupted', 'invalid-digest');
	raw.close();
	fixture.clock.value += 1_001;
	const recovering = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	lease = await recovering.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	assert.deepEqual(await recovering.recoverMetadata({ lease }), {
		outcome: 'interrupted',
		previousRevision: 1,
		publishedRevision: null,
		restoredPrevious: true,
	});
	assert.deepEqual(recovering.readMetadata(), populatedMetadata(1));
	await recovering.releaseLease(lease);
	recovering.close();

	const committing = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: (phase) => {
			if (phase === 'committed') throw new Error('simulated process exit after commit');
		},
	});
	lease = await committing.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	await assert.rejects(
		() => committing.publishMetadata({ lease, metadata: populatedMetadata(2) }),
		/simulated process exit/u,
	);
	committing.close();

	fixture.clock.value += 1_001;
	const verifying = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	lease = await verifying.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	assert.deepEqual(await verifying.recoverMetadata({ lease }), {
		outcome: 'committed',
		previousRevision: 1,
		publishedRevision: 2,
		restoredPrevious: false,
	});
	assert.deepEqual(verifying.readMetadata(), populatedMetadata(2));
	await verifying.releaseLease(lease);
	verifying.close();
});

test('malformed persisted metadata fails closed without a valid recovery journal', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	library.close();
	const raw = new DatabaseSync(fixture.paths.databasePath);
	raw.prepare('UPDATE library_metadata SET json = ?, digest = ? WHERE singleton = 1')
		.run('{malformed', '0'.repeat(64));
	raw.close();
	await assert.rejects(
		() => SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now }),
		/not valid JSON|integrity/u,
	);
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	return {
		clock,
		now: () => clock.value,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

function emptyMetadata(): DesktopLibraryMetadata {
	return { schemaVersion: 1, revision: 0, projects: [], media: [] };
}

function populatedMetadata(revision: number): DesktopLibraryMetadata {
	return {
		schemaVersion: 1,
		revision,
		projects: [{
			id: 'shared-project-1',
			name: 'Shared project',
			metadataFile: 'shared-project-1/project.json',
			preferredProduct: 'soundscaper',
			updatedAtMs: 9_000 + revision,
		}],
		media: [{
			id: 'managed-media-1',
			relativeFile: 'ab/managed-media-1.wav',
			byteLength: 48_000,
			sha256: 'a'.repeat(64),
		}],
	};
}
