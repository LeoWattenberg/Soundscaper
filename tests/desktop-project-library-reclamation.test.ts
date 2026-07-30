/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createDesktopLibraryProjectMetadataFile,
	createDesktopProjectLibraryPaths,
	type DesktopLibraryLease,
	type DesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import { createDesktopLibraryProjectQuarantineFile } from '../desktop/project-library-file-inventory.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { DesktopLibraryProjectReclaimer } from '../desktop/project-library-reclamation.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import { createAudioEditorProjectV9 } from '../src/common/editor/project-v9.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'reclamation-soundscaper-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'reclamation-framescaper-b',
});
const ENTRY_A = 'reclaim-entry-a';
const ENTRY_B = 'reclaim-entry-b';
const ENTRY_CASE = 'Reclaim-Case-Entry';

test('reclamation protects current and pending journal documents before recovery', async (context) => {
	const fixture = await createFixture(context);
	let preparedCount = 0;
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: (phase) => {
			if (phase === 'prepared' && ++preparedCount === 2) {
				throw new Error('simulated exit with a prepared project catalog');
			}
		},
	});
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const firstProject = currentProject('shared recovery identity', 1);
	const first = await projects.commitProject({ ...commitOptions(ENTRY_A, firstProject), lease });
	const secondProject = currentProject('shared recovery identity', 2);
	const secondPath = immutablePath(fixture.paths.projectsRoot, ENTRY_A, secondProject);
	await assert.rejects(
		() => projects.commitProject({ ...commitOptions(ENTRY_A, secondProject), lease }),
		/prepared project catalog/u,
	);
	assert.equal(await exists(secondPath), true, 'the losing immutable file exists before recovery');

	const orphan = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: 'orphan-entry-01',
		revision: 7,
		digest: 'b'.repeat(64),
		stageId: 'd'.repeat(32),
	});
	const stagePath = join(fixture.paths.projectsRoot, 'orphan-entry-01', `.${'c'.repeat(32)}.stage`);
	await writeFile(stagePath, 'unrecognized stage remains conservative');
	const reclaimer = new DesktopLibraryProjectReclaimer(fixture.paths, { now: fixture.now });

	const beforeRecovery = await reclaimer.reclaim({ lease });
	assert.equal(beforeRecovery.canonicalFiles, 3);
	assert.equal(beforeRecovery.protectedFiles, 2);
	assert.equal(beforeRecovery.reclaimedFiles, 1);
	assert.equal(await exists(join(fixture.paths.projectsRoot, first.catalog.metadataFile)), true);
	assert.equal(await exists(secondPath), true);
	assert.equal(await exists(orphan.path), false);
	assert.equal(await exists(stagePath), true);

	assert.deepEqual(await library.recoverMetadata({ lease }), {
		outcome: 'interrupted',
		previousRevision: 1,
		publishedRevision: null,
		restoredPrevious: false,
	});
	const afterRecovery = await reclaimer.reclaim({ lease });
	assert.equal(afterRecovery.protectedFiles, 1);
	assert.equal(afterRecovery.reclaimedFiles, 1);
	assert.equal(await exists(secondPath), false);
	assert.deepEqual(await projects.readProject(ENTRY_A), first);
	assert.equal((await reclaimer.reclaim({ lease })).reclaimedFiles, 0, 'reclamation is idempotent');
});

test('committed recovery keeps the published revision and reclaims its predecessor', async (context) => {
	const fixture = await createFixture(context);
	let committedCount = 0;
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: (phase) => {
			if (phase === 'committed' && ++committedCount === 2) {
				throw new Error('simulated exit with a committed project catalog');
			}
		},
	});
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const first = await projects.commitProject({
		...commitOptions(ENTRY_A, currentProject('committed recovery identity', 1)),
		lease,
	});
	const publishedProject = currentProject('committed recovery identity', 2);
	const publishedPath = immutablePath(fixture.paths.projectsRoot, ENTRY_A, publishedProject);
	await assert.rejects(
		() => projects.commitProject({ ...commitOptions(ENTRY_A, publishedProject), lease }),
		/committed project catalog/u,
	);
	const reclaimer = new DesktopLibraryProjectReclaimer(fixture.paths, { now: fixture.now });
	const beforeRecovery = await reclaimer.reclaim({ lease });
	assert.equal(beforeRecovery.protectedFiles, 2);
	assert.equal(beforeRecovery.reclaimedFiles, 0);
	assert.equal(await exists(join(fixture.paths.projectsRoot, first.catalog.metadataFile)), true);
	assert.equal(await exists(publishedPath), true);

	assert.deepEqual(await library.recoverMetadata({ lease }), {
		outcome: 'committed',
		previousRevision: 1,
		publishedRevision: 2,
		restoredPrevious: false,
	});
	const afterRecovery = await reclaimer.reclaim({ lease });
	assert.equal(afterRecovery.protectedFiles, 1);
	assert.equal(afterRecovery.reclaimedFiles, 1);
	assert.equal(await exists(join(fixture.paths.projectsRoot, first.catalog.metadataFile)), false);
	assert.equal(await exists(publishedPath), true);
	assert.deepEqual((await projects.readProject(ENTRY_A))?.project, publishedProject);
});

test('host startup reclaims obsolete revisions and catalog-only deletes', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const first = await projects.commitProject({
		...commitOptions(ENTRY_A, currentProject('current identity', 1)),
		lease,
	});
	const current = await projects.commitProject({
		...commitOptions(ENTRY_A, currentProject('current identity', 2)),
		lease,
	});
	const deleted = await projects.commitProject({
		...commitOptions(ENTRY_B, currentProject('deleted identity', 1)),
		lease,
	});
	assert.equal(await projects.deleteProjectById({ lease, projectId: 'deleted identity' }), true);
	const stagePath = join(fixture.paths.projectsRoot, ENTRY_A, `.${'e'.repeat(32)}.stage`);
	const foreignPath = join(fixture.paths.projectsRoot, ENTRY_A, 'notes.txt');
	await writeFile(stagePath, 'leave stage files outside this collector');
	await writeFile(foreignPath, 'leave unknown files untouched');
	await library.releaseLease(lease);
	library.close();

	const host = await DesktopProjectLibraryHost.start({
		appDataPath: fixture.appDataRoot,
		owner: OWNER_B,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	assert.equal(host.snapshot().reclamation.complete, true);
	assert.equal(host.snapshot().reclamation.reclaimedFiles, 2);
	assert.deepEqual(await host.readProjectById('current identity'), current);
	assert.equal(await exists(join(fixture.paths.projectsRoot, current.catalog.metadataFile)), true);
	assert.equal(await exists(join(fixture.paths.projectsRoot, first.catalog.metadataFile)), false);
	assert.equal(await exists(join(fixture.paths.projectsRoot, deleted.catalog.metadataFile)), false);
	assert.equal(await exists(stagePath), true);
	assert.equal(await readFile(foreignPath, 'utf8'), 'leave unknown files untouched');
});

test('host startup releases its lease when reclamation fails', async (context) => {
	const fixture = await createFixture(context);
	const prototype = DesktopLibraryProjectReclaimer.prototype;
	const originalReclaim = prototype.reclaim;
	prototype.reclaim = () => Promise.reject(new Error('simulated reclamation failure'));
	try {
		await assert.rejects(
			() => DesktopProjectLibraryHost.start({
				appDataPath: fixture.appDataRoot,
				owner: OWNER_A,
				leaseTtlMs: 1_000,
				renewIntervalMs: 100,
			}),
			/simulated reclamation failure/u,
		);
	} finally {
		prototype.reclaim = originalReclaim;
	}
	const observer = await SharedDesktopProjectLibrary.open(fixture.paths);
	context.after(() => observer.close());
	const replacement = await observer.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	assert.equal(replacement.owner.product, 'framescaper');
	await observer.releaseLease(replacement);
});

test('a higher fencing token can reuse a discovered orphan before stale reclamation resumes', async (context) => {
	const fixture = await createFixture(context);
	const firstLibrary = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	const secondLibrary = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => {
		firstLibrary.close();
		secondLibrary.close();
	});
	const original = await firstLibrary.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const project = currentProject('reused identity', 1);
	const candidate = await materializeUnreachableFile({
		library: firstLibrary,
		lease: original,
		paths: fixture.paths,
		entryId: ENTRY_A,
		revision: project.revision,
		digest: createHash('sha256').update(serializeScapeProjectDocument(project), 'utf8').digest('hex'),
		stageId: '1'.repeat(32),
		contents: serializeScapeProjectDocument(project),
	});
	let confirmPlanned: (() => void) | undefined;
	let continueReclamation: (() => void) | undefined;
	const planned = new Promise<void>((resolvePromise) => { confirmPlanned = resolvePromise; });
	const allowed = new Promise<void>((resolvePromise) => { continueReclamation = resolvePromise; });
	const staleReclaimer = new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
		checkpoint: async (phase) => {
			if (phase !== 'planned') return;
			confirmPlanned?.();
			await allowed;
		},
	});
	const staleRun = staleReclaimer.reclaim({ lease: original });
	await planned;

	fixture.clock.value = original.expiresAtMs + 1;
	const replacement = await secondLibrary.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });
	const secondProjects = new DesktopLibraryProjectStore(secondLibrary);
	const committed = await secondProjects.commitProject({ ...commitOptions(ENTRY_A, project), lease: replacement });
	continueReclamation?.();
	await assert.rejects(staleRun, /no longer owns the lease/u);
	assert.deepEqual(await secondProjects.readProject(ENTRY_A), committed);
	assert.equal(await exists(candidate.path), true);
	const replacementResult = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease: replacement });
	assert.equal(replacementResult.protectedFiles, 1);
	assert.equal(replacementResult.reclaimedFiles, 0);
});

test('batch boundaries permit lease renewal during a bounded reclamation pass', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const candidates: string[] = [];
	for (const index of Array.from({ length: 65 }, (_, candidateIndex) => candidateIndex)) {
		const revision = index + 1;
		const candidate = await materializeUnreachableFile({
			library,
			lease,
			paths: fixture.paths,
			entryId: 'batch-orphan-entry',
			revision,
			digest: revision.toString(16).padStart(64, '0'),
			stageId: revision.toString(16).padStart(32, '0'),
		});
		candidates.push(candidate.path);
	}
	let completedBatches = 0;
	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
		checkpoint: async (phase) => {
			if (phase !== 'batch' || ++completedBatches !== 1) return;
			fixture.clock.value = lease.expiresAtMs - 1;
			await library.renewLease(lease, 1_000);
			fixture.clock.value = lease.expiresAtMs + 1;
		},
	}).reclaim({ lease });
	assert.equal(completedBatches, 2);
	assert.equal(result.reclaimedFiles, candidates.length);
	assert.equal(await exists(candidates[0]), false);
	assert.equal(await exists(candidates.at(-1) ?? ''), false);
});

test('a bounded authoritative inventory reports incomplete work without blocking a later retry', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const projects = new DesktopLibraryProjectStore(library);
	const protectedProject = await projects.commitProject({
		...commitOptions(ENTRY_A, currentProject('bounded protected identity', 1)),
		lease,
	});
	const protectedPath = join(fixture.paths.projectsRoot, protectedProject.catalog.metadataFile);
	const orphan = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: 'bounded-orphan-entry',
		revision: 1,
		digest: '6'.repeat(64),
		stageId: '7'.repeat(32),
	});

	const bounded = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 1,
		now: fixture.now,
	}).reclaim({ lease });
	assert.equal(bounded.complete, false);
	assert.equal(bounded.scannedEntries, 1);
	assert.equal(bounded.reclaimedFiles, 0);
	assert.equal(await exists(protectedPath), true);
	assert.equal(await exists(orphan.path), true);
	const retry = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		maximumEntries: 2,
		now: fixture.now,
	}).reclaim({ lease });
	assert.equal(retry.complete, true);
	assert.equal(retry.reclaimedFiles, 1);
	assert.equal(await exists(protectedPath), true);
	assert.equal(await exists(orphan.path), false);
});

test('portable path aliases remain protected across filesystem case rules', async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const committed = await projects.commitProject({
		...commitOptions(ENTRY_CASE, currentProject('portable path identity', 1)),
		lease,
	});
	const livePath = join(fixture.paths.projectsRoot, committed.catalog.metadataFile);
	const aliasPath = join(fixture.paths.projectsRoot, committed.catalog.metadataFile.toLowerCase());
	assert.notEqual(aliasPath, livePath);
	const liveDirectory = join(fixture.paths.projectsRoot, ENTRY_CASE);
	const aliasDirectory = join(fixture.paths.projectsRoot, ENTRY_CASE.toLowerCase());
	await mkdir(aliasDirectory, { recursive: true });
	const [liveDirectoryMetadata, aliasDirectoryMetadata] = await Promise.all([
		stat(liveDirectory),
		stat(aliasDirectory),
	]);
	if (liveDirectoryMetadata.dev === aliasDirectoryMetadata.dev
		&& liveDirectoryMetadata.ino === aliasDirectoryMetadata.ino) {
		const intermediate = join(fixture.paths.projectsRoot, 'portable-case-intermediate');
		await rename(liveDirectory, intermediate);
		await rename(intermediate, aliasDirectory);
	} else {
		await writeFile(aliasPath, await readFile(livePath));
	}
	const aliasMetadataFile = committed.catalog.metadataFile.toLowerCase();
	library.reserveProjectFile({ lease, metadataFile: aliasMetadataFile });
	library.materializeProjectFile({ lease, metadataFile: aliasMetadataFile, stageFile: null });

	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease });
	assert.ok(result.canonicalFiles >= 1);
	assert.equal(result.protectedFiles, result.canonicalFiles);
	assert.equal(result.reclaimedFiles, 0);
	assert.equal(await exists(livePath), true);
	assert.equal(await exists(aliasPath), true);
});

test('reclamation ignores foreign entries and symlinked project directories', {
	skip: process.platform === 'win32',
}, async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const directory = join(fixture.paths.projectsRoot, ENTRY_A);
	await mkdir(directory, { recursive: true });
	const stagePath = join(directory, `.${'a'.repeat(32)}.stage`);
	const foreignPath = join(directory, 'project.json');
	const quarantinePath = join(directory, `.${'b'.repeat(32)}.orphan`);
	await Promise.all([
		writeFile(stagePath, 'stage'),
		writeFile(foreignPath, 'foreign'),
		writeFile(quarantinePath, 'abandoned quarantine'),
	]);
	const tracked = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: ENTRY_A,
		revision: 1,
		digest: 'd'.repeat(64),
		stageId: 'e'.repeat(32),
	});
	const trackedQuarantinePath = join(
		fixture.paths.projectsRoot,
		...createDesktopLibraryProjectQuarantineFile(tracked.metadataFile).split('/'),
	);
	await rename(tracked.path, trackedQuarantinePath);
	const outside = join(fixture.appDataRoot, 'outside-projects');
	await mkdir(outside);
	const outsideCanonical = join(outside, `1-${'c'.repeat(64)}.json`);
	await writeFile(outsideCanonical, 'outside');
	await symlink(outside, join(fixture.paths.projectsRoot, 'symlink-entry-1'), 'dir');
	library.reserveProjectFile({
		lease,
		metadataFile: createDesktopLibraryProjectMetadataFile('symlink-entry-1', 1, 'c'.repeat(64)),
	});

	const result = await new DesktopLibraryProjectReclaimer(fixture.paths, {
		now: fixture.now,
	}).reclaim({ lease });
	assert.equal(result.canonicalFiles, 2);
	assert.equal(result.reclaimedFiles, 1, 'only the collector-owned quarantine is reclaimed');
	assert.equal(await exists(stagePath), true);
	assert.equal(await exists(foreignPath), true);
	assert.equal(await readFile(quarantinePath, 'utf8'), 'abandoned quarantine');
	assert.equal(await exists(trackedQuarantinePath), false);
	assert.equal(await readFile(outsideCanonical, 'utf8'), 'outside');
	assert.equal((await lstat(join(fixture.paths.projectsRoot, 'symlink-entry-1'))).isSymbolicLink(), true);
});

test('reclamation refuses a symlinked projects root', {
	skip: process.platform === 'win32',
}, async (context) => {
	const fixture = await createFixture(context);
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, { now: fixture.now });
	context.after(() => library.close());
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	const outside = join(fixture.appDataRoot, 'outside-project-root');
	const outsideEntry = join(outside, 'outside-entry-01');
	const outsideCanonical = join(outsideEntry, `1-${'7'.repeat(64)}.json`);
	await mkdir(outsideEntry, { recursive: true });
	await writeFile(outsideCanonical, 'outside project must survive');
	await rename(fixture.paths.projectsRoot, join(fixture.paths.libraryRoot, 'projects-original'));
	await symlink(outside, fixture.paths.projectsRoot, 'dir');

	await assert.rejects(
		() => new DesktopLibraryProjectReclaimer(fixture.paths, { now: fixture.now }).reclaim({ lease }),
		/reclamation root.*direct filesystem directory/iu,
	);
	assert.equal(await readFile(outsideCanonical, 'utf8'), 'outside project must survive');
});

test('corrupt pending journal metadata fails closed before filesystem mutation', async (context) => {
	const fixture = await createFixture(context);
	let preparedCount = 0;
	const library = await SharedDesktopProjectLibrary.open(fixture.paths, {
		now: fixture.now,
		checkpoint: (phase) => {
			if (phase === 'prepared' && ++preparedCount === 2) throw new Error('leave corruptible journal');
		},
	});
	context.after(() => library.close());
	const projects = new DesktopLibraryProjectStore(library);
	const lease = await library.acquireLease({ owner: OWNER_A, ttlMs: 5_000 });
	await projects.commitProject({ ...commitOptions(ENTRY_A, currentProject('corrupt identity', 1)), lease });
	await assert.rejects(
		() => projects.commitProject({ ...commitOptions(ENTRY_A, currentProject('corrupt identity', 2)), lease }),
		/corruptible journal/u,
	);
	const orphan = await materializeUnreachableFile({
		library,
		lease,
		paths: fixture.paths,
		entryId: 'orphan-entry-02',
		revision: 3,
		digest: 'f'.repeat(64),
		stageId: '2'.repeat(32),
		contents: 'must survive corrupt reference metadata',
	});
	const raw = new DatabaseSync(fixture.paths.databasePath);
	raw.prepare("UPDATE metadata_journal SET previous_digest = 'invalid' WHERE state = 'prepared'").run();
	raw.close();

	await assert.rejects(
		() => new DesktopLibraryProjectReclaimer(fixture.paths, { now: fixture.now }).reclaim({ lease }),
		/journal previous metadata.*digest|integrity/iu,
	);
	assert.equal(await exists(orphan.path), true);
});

async function createFixture(context: TestContext) {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-reclamation-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const clock = { value: 10_000 };
	return {
		appDataRoot,
		clock,
		now: () => clock.value,
		paths: createDesktopProjectLibraryPaths(appDataRoot),
	};
}

function currentProject(id: string, revision: number) {
	return createAudioEditorProjectV9({
		id,
		title: 'Reclamation project',
		revision,
		now: '2026-07-30T12:00:00.000Z',
	});
}

function commitOptions(
	entryId: string,
	project: ReturnType<typeof currentProject>,
) {
	return {
		entryId,
		name: 'Reclamation project',
		project,
		preferredProduct: 'soundscaper' as const,
		updatedAtMs: 10_000 + project.revision,
	};
}

function immutablePath(projectsRoot: string, entryId: string, project: ReturnType<typeof currentProject>): string {
	const json = serializeScapeProjectDocument(project);
	const sha256 = createHash('sha256').update(json, 'utf8').digest('hex');
	return join(
		projectsRoot,
		createDesktopLibraryProjectMetadataFile(entryId, project.revision, sha256),
	);
}

async function materializeUnreachableFile(options: Readonly<{
	library: SharedDesktopProjectLibrary;
	lease: DesktopLibraryLease;
	paths: DesktopProjectLibraryPaths;
	entryId: string;
	revision: number;
	digest: string;
	stageId: string;
	contents?: string;
}>): Promise<Readonly<{ metadataFile: string; path: string }>> {
	const metadataFile = createDesktopLibraryProjectMetadataFile(options.entryId, options.revision, options.digest);
	const stageFile = `${options.entryId}/.${options.stageId}.stage`;
	const stagePath = join(options.paths.projectsRoot, ...stageFile.split('/'));
	await mkdir(join(options.paths.projectsRoot, options.entryId), { recursive: true });
	options.library.reserveProjectFile({ lease: options.lease, metadataFile });
	await writeFile(stagePath, options.contents ?? `unreachable project ${options.revision}`);
	options.library.materializeProjectFile({ lease: options.lease, metadataFile, stageFile });
	return Object.freeze({
		metadataFile,
		path: join(options.paths.projectsRoot, ...metadataFile.split('/')),
	});
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}
