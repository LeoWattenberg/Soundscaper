/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import {
	type DesktopLibraryCommitProjectOptions,
	DesktopLibraryProjectStore,
} from '../desktop/project-library-projects.ts';
import { createAudioEditorProjectV9 } from '../src/common/editor/project-v9.ts';

const SOUNDSCAPER_OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'handoff-soundscaper-a',
});
const FRAMESCAPER_OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'handoff-framescaper-b',
});
const SOUNDSCAPER_RETURN_OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 303,
	instanceId: 'handoff-soundscaper-c',
});
const ENTRY_ID = 'handoff-entry-1';

test('desktop hosts hand a current project across products through orderly lease transfer', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-handoff-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const soundscaper = await startHost(appDataPath, SOUNDSCAPER_OWNER);
	context.after(() => soundscaper.close());
	assert.equal(soundscaper.snapshot().fencingToken, 1);
	const first = await soundscaper.commitProject(commitOptions(1, 'soundscaper', 10_001));
	await assert.rejects(
		() => startHost(appDataPath, FRAMESCAPER_OWNER),
		/leased by soundscaper/u,
	);

	await soundscaper.close();
	await assert.rejects(() => soundscaper.readProject(ENTRY_ID), /host is closed/u);
	await assert.rejects(
		() => soundscaper.commitProject(commitOptions(2, 'soundscaper', 10_002)),
		/host is closed/u,
	);

	const framescaper = await startHost(appDataPath, FRAMESCAPER_OWNER);
	context.after(() => framescaper.close());
	assert.deepEqual(framescaper.snapshot(), {
		closed: false,
		owner: FRAMESCAPER_OWNER,
		fencingToken: 2,
		tookOverStaleLease: false,
		recovery: {
			outcome: 'clean',
			previousRevision: null,
			publishedRevision: null,
			restoredPrevious: false,
		},
		reclamation: {
			canonicalFiles: 1,
			complete: true,
			liveStageFiles: 0,
			protectedFiles: 1,
			reclaimedFiles: 0,
			reclaimedStageFiles: 0,
			scannedEntries: 1,
			stageFiles: 0,
		},
		managedMediaReclamation: {
			canonicalFiles: 0,
			catalogRowsRetired: 0,
			complete: true,
			liveStageFiles: 0,
			protectedFiles: 0,
			reclaimedFiles: 0,
			reclaimedStageFiles: 0,
			scannedEntries: 0,
			stageFiles: 0,
		},
	});
	assert.deepEqual(await framescaper.readProject(ENTRY_ID), first);
	const second = await framescaper.commitProject(commitOptions(2, 'framescaper', 10_002));
	assert.equal(framescaper.readCatalog().revision, 2);
	assert.equal(second.catalog.preferredProduct, 'framescaper');
	await framescaper.close();

	const returned = await startHost(appDataPath, SOUNDSCAPER_RETURN_OWNER);
	context.after(() => returned.close());
	assert.equal(returned.snapshot().fencingToken, 3);
	assert.equal(returned.snapshot().tookOverStaleLease, false);
	assert.deepEqual(await returned.readProject(ENTRY_ID), second);
	await returned.close();
});

test('desktop host close fences late work and drains an admitted project commit', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-drain-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const prototype = DesktopLibraryProjectStore.prototype as unknown as {
		commitProject: DesktopLibraryProjectStore['commitProject'];
	};
	const originalCommitProject = prototype.commitProject;
	let continueCommit: (() => void) | undefined;
	let confirmStarted: (() => void) | undefined;
	const commitAllowed = new Promise<void>((resolvePromise) => { continueCommit = resolvePromise; });
	const started = new Promise<void>((resolvePromise) => { confirmStarted = resolvePromise; });
	prototype.commitProject = async function commitProject(options) {
		confirmStarted?.();
		await commitAllowed;
		return originalCommitProject.call(this, options);
	};
	context.after(() => { prototype.commitProject = originalCommitProject; });
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
	});
	context.after(() => host.close());
	const commit = host.commitProject(commitOptions(1, 'soundscaper', 10_001));
	await started;
	const closing = host.close();
	await assert.rejects(() => host.readProject(ENTRY_ID), /host is closed/u);
	await assert.rejects(
		() => host.commitProject(commitOptions(2, 'soundscaper', 10_002)),
		/host is closed/u,
	);
	await delay(1_100);
	continueCommit?.();
	const committed = await commit;
	await closing;

	const observer = await startHost(appDataPath, FRAMESCAPER_OWNER);
	context.after(() => observer.close());
	assert.deepEqual(await observer.readProject(ENTRY_ID), committed);
});

test('desktop host serializes concurrent project commits under one lease', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-commits-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const host = await startHost(appDataPath, SOUNDSCAPER_OWNER);
	context.after(() => host.close());
	const [first, second] = await Promise.all([
		host.commitProject(commitOptions(1, 'soundscaper', 10_001)),
		host.commitProject(commitOptions(2, 'soundscaper', 10_002)),
	]);

	assert.equal(host.readCatalog().revision, 2);
	assert.equal(first.catalog.projectRevision, 1);
	assert.equal(second.catalog.projectRevision, 2);
	assert.deepEqual(await host.readProject(ENTRY_ID), second);
});

function startHost(
	appDataPath: string,
	owner: typeof SOUNDSCAPER_OWNER | typeof FRAMESCAPER_OWNER | typeof SOUNDSCAPER_RETURN_OWNER,
) {
	return DesktopProjectLibraryHost.start({
		appDataPath,
		owner,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
}

function commitOptions(
	revision: number,
	preferredProduct: 'soundscaper' | 'framescaper',
	updatedAtMs: number,
): Omit<DesktopLibraryCommitProjectOptions, 'lease'> {
	return {
		entryId: ENTRY_ID,
		name: 'Shared handoff project',
		project: {
			...createAudioEditorProjectV9({
				id: 'shared handoff project identity',
				title: 'Shared handoff project',
				revision,
				now: '2026-07-29T12:00:00.000Z',
			}),
			handoffState: new Uint8Array([2, 4, 6, revision]),
		},
		preferredProduct,
		updatedAtMs,
	};
}
