/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';

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
const ENTRY_ID = 'handoff-entry-1';

test('desktop hosts serialize cross-product writers while preserving V12 annotations and folders', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-handoff-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const soundscaper = await startHost(appDataPath, SOUNDSCAPER_OWNER);
	context.after(() => soundscaper.close());
	assert.equal(soundscaper.snapshot().closed, false);
	assert.equal(soundscaper.snapshot().activeWriter, null);
	assert.equal(soundscaper.snapshot().lastWriter?.fencingToken, 1);
	const first = await soundscaper.commitProject(commitOptions(1, 'soundscaper', 10_001));
	assertHandoffAnnotations(first.project, 1);
	const framescaper = await startHost(appDataPath, FRAMESCAPER_OWNER);
	context.after(() => framescaper.close());
	assert.equal(framescaper.snapshot().closed, false);
	assert.equal(framescaper.snapshot().activeWriter, null);
	assert.deepEqual(await framescaper.readProject(ENTRY_ID), first);
	const second = await framescaper.commitProject(commitOptions(2, 'framescaper', 10_002));
	assertHandoffAnnotations(second.project, 2);
	assert.ok((framescaper.snapshot().lastWriter?.fencingToken ?? 0)
		> (soundscaper.snapshot().lastWriter?.fencingToken ?? 0));
	assert.equal(framescaper.readCatalog().revision, 2);
	assert.equal(second.catalog.preferredProduct, 'framescaper');

	assert.deepEqual(await soundscaper.readProject(ENTRY_ID), second);
	const third = await soundscaper.commitProject(commitOptions(3, 'soundscaper', 10_003));
	assertHandoffAnnotations(third.project, 3);
	assert.ok((soundscaper.snapshot().lastWriter?.fencingToken ?? 0)
		> (framescaper.snapshot().lastWriter?.fencingToken ?? 0));
	assert.deepEqual(await framescaper.readProject(ENTRY_ID), third);
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
	// The commit below is held open past the lease TTL on purpose, so the renewal
	// timer is all that keeps the lease owned. Renewal throws once the stored
	// expiry falls behind the clock, and until close() marks the coordinator
	// closed that failure aborts the in-flight commit instead of being ignored.
	// A one-second TTL therefore tolerated only a one-second stall between the
	// commit starting and close() landing; a loaded runner exceeds that. Keep the
	// frequent renewals and widen the window the stall has to beat.
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 3_000,
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
	await delay(3_300);
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
	owner: typeof SOUNDSCAPER_OWNER | typeof FRAMESCAPER_OWNER,
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
			...createCurrentAudioEditorProject({
				id: 'shared handoff project identity',
				title: 'Shared handoff project',
				revision,
				now: '2026-07-29T12:00:00.000Z',
				tracks: [createAudioTrack({ id: 'handoff-track', name: 'Handoff track' })],
				trackFolders: [{ id: 'handoff-folder', name: 'Handoff folder', collapsed: true }],
				sequences: [{
					id: 'main-sequence',
					trackNodes: [
						{ kind: 'folder', id: 'handoff-folder', parentFolderId: null },
						{ kind: 'track', id: 'handoff-track', parentFolderId: 'handoff-folder' },
					],
				}],
				timelineAnnotations: [{
					id: 'handoff-marker',
					sequenceId: 'main-sequence',
					name: 'Cross-product marker',
					color: 'teal',
					batchId: 'handoff-annotation-batch',
					opaqueExtensions: {},
					kind: 'marker',
					anchor: 'sample',
					positionFrame: revision * 24_000,
				}, {
					id: 'handoff-region',
					sequenceId: 'main-sequence',
					name: 'Cross-product region',
					color: 'teal',
					batchId: 'handoff-annotation-batch',
					opaqueExtensions: {},
					kind: 'region',
					anchor: 'musical',
					startBeat: { num: 2, den: 1 },
					endBeat: { num: 4, den: 1 },
				}],
			}),
			handoffState: new Uint8Array([2, 4, 6, revision]),
		},
		preferredProduct,
		updatedAtMs,
	};
}

function assertHandoffAnnotations(value: unknown, revision: number): void {
	assert.equal(validateCurrentAudioEditorProject(value), true);
	const project = value as Readonly<Record<string, unknown>>;
	assert.deepEqual(project.trackFolders, [{
		id: 'handoff-folder',
		name: 'Handoff folder',
		collapsed: true,
		height: 40,
		hidden: false,
		mute: false,
		solo: false,
	}]);
	const sequences = project.sequences as readonly Readonly<Record<string, unknown>>[];
	assert.deepEqual(sequences[0]?.trackNodes, [
		{ kind: 'folder', id: 'handoff-folder', parentFolderId: null },
		{ kind: 'track', id: 'handoff-track', parentFolderId: 'handoff-folder' },
	]);
	assert.deepEqual(project.timelineAnnotations, [{
		id: 'handoff-marker',
		sequenceId: 'main-sequence',
		name: 'Cross-product marker',
		color: 'teal',
		batchId: 'handoff-annotation-batch',
		opaqueExtensions: {},
		kind: 'marker',
		anchor: 'sample',
		positionFrame: revision * 24_000,
	}, {
		id: 'handoff-region',
		sequenceId: 'main-sequence',
		name: 'Cross-product region',
		color: 'teal',
		batchId: 'handoff-annotation-batch',
		opaqueExtensions: {},
		kind: 'region',
		anchor: 'musical',
		startBeat: { num: 2, den: 1 },
		endBeat: { num: 4, den: 1 },
	}]);
}
