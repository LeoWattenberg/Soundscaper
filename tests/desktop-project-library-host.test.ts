/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createDesktopProjectLibraryPaths } from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { DesktopLibraryLeaseBusyError, SharedDesktopProjectLibrary } from '../desktop/project-library.ts';

const SOUNDSCAPER_OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'soundscaper-host-instance',
});
const FRAMESCAPER_OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 202,
	instanceId: 'framescaper-host-instance',
});

test('desktop host opens the product-neutral appData library and releases it on close', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	assert.deepEqual(host.snapshot(), {
		closed: false,
		owner: SOUNDSCAPER_OWNER,
		fencingToken: 1,
		tookOverStaleLease: false,
		recovery: {
			outcome: 'clean',
			previousRevision: null,
			publishedRevision: null,
			restoredPrevious: false,
		},
		reclamation: {
			canonicalFiles: 0,
			complete: true,
			protectedFiles: 0,
			reclaimedFiles: 0,
			scannedEntries: 0,
		},
	});

	const observer = await SharedDesktopProjectLibrary.open(createDesktopProjectLibraryPaths(appDataPath));
	context.after(() => observer.close());
	await assert.rejects(
		() => observer.acquireLease({ owner: FRAMESCAPER_OWNER, ttlMs: 1_000 }),
		(error: unknown) => error instanceof DesktopLibraryLeaseBusyError
			&& error.holder.owner.product === 'soundscaper',
	);
	await host.close();
	const replacement = await observer.acquireLease({ owner: FRAMESCAPER_OWNER, ttlMs: 1_000 });
	assert.equal(replacement.owner.product, 'framescaper');
	await observer.releaseLease(replacement);
	assert.equal(host.snapshot().closed, true);
});

test('desktop host completes interrupted metadata recovery before returning', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-recovery-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const initial = await SharedDesktopProjectLibrary.open(paths);
	let lease = await initial.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	await initial.publishMetadata({ lease, metadata: metadata(1) });
	await initial.releaseLease(lease);
	initial.close();

	const interrupted = await SharedDesktopProjectLibrary.open(paths, {
		checkpoint: (phase) => {
			if (phase === 'prepared') throw new Error('simulated interruption');
		},
	});
	lease = await interrupted.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	await assert.rejects(
		() => interrupted.publishMetadata({ lease, metadata: metadata(2) }),
		/simulated interruption/u,
	);
	await interrupted.releaseLease(lease);
	interrupted.close();

	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: FRAMESCAPER_OWNER,
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => host.close());
	assert.deepEqual(host.snapshot().recovery, {
		outcome: 'interrupted',
		previousRevision: 1,
		publishedRevision: null,
		restoredPrevious: false,
	});
	const observer = await SharedDesktopProjectLibrary.open(paths);
	context.after(() => observer.close());
	assert.deepEqual(observer.readMetadata(), metadata(1));
});

test('desktop host cleans up a lease when startup recovery fails', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-failure-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const corrupting = await SharedDesktopProjectLibrary.open(paths, {
		checkpoint: (phase) => {
			if (phase === 'prepared') throw new Error('simulated interruption');
		},
	});
	const lease = await corrupting.acquireLease({ owner: SOUNDSCAPER_OWNER, ttlMs: 5_000 });
	await assert.rejects(
		() => corrupting.publishMetadata({ lease, metadata: metadata(1) }),
		/simulated interruption/u,
	);
	await corrupting.releaseLease(lease);
	corrupting.close();

	const database = await import('node:sqlite');
	const raw = new database.DatabaseSync(paths.databasePath);
	raw.prepare("UPDATE metadata_journal SET previous_digest = 'invalid' WHERE state = 'prepared'").run();
	raw.close();
	await assert.rejects(
		() => DesktopProjectLibraryHost.start({ appDataPath, owner: FRAMESCAPER_OWNER }),
		/journal previous metadata|digest/u,
	);
	const observer = await SharedDesktopProjectLibrary.open(paths).catch(() => null);
	assert.equal(observer, null, 'corrupt recovery input remains fail-closed');
});

test('desktop host suppresses a queued renewal failure after intentional close', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-host-close-race-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const prototype = SharedDesktopProjectLibrary.prototype as unknown as {
		renewLease: SharedDesktopProjectLibrary['renewLease'];
	};
	const originalRenewLease = prototype.renewLease;
	let rejectRenewal: ((error: Error) => void) | undefined;
	let renewalStarted: (() => void) | undefined;
	const started = new Promise<void>((resolvePromise) => { renewalStarted = resolvePromise; });
	prototype.renewLease = () => new Promise((_resolvePromise, reject) => {
		rejectRenewal = reject;
		renewalStarted?.();
	});
	context.after(() => { prototype.renewLease = originalRenewLease; });
	const leaseLosses: unknown[] = [];
	const host = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: SOUNDSCAPER_OWNER,
		leaseTtlMs: 1_000,
		renewIntervalMs: 100,
		onLeaseLost: (error) => { leaseLosses.push(error); },
	});
	context.after(() => host.close());

	await started;
	const closing = host.close();
	rejectRenewal?.(new Error('queued renewal failure'));
	await closing;
	await delay(0);
	assert.deepEqual(leaseLosses, []);
});

function metadata(revision: number) {
	return {
		schemaVersion: 2 as const,
		revision,
		projects: [],
		media: [],
	};
}
