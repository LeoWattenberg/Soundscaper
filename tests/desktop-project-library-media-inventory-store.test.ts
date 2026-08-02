/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createDesktopProjectLibraryPaths } from '../desktop/project-library-contract.ts';
import {
	createDesktopLibraryManagedMediaStageFile,
} from '../desktop/project-library-media-inventory.ts';
import {
	DesktopLibraryManagedMediaInventoryStore,
} from '../desktop/project-library-media-inventory-store.ts';
import {
	createDesktopLibraryMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
} from '../desktop/project-library-media-binding.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';

const OWNER_A = Object.freeze({
	product: 'soundscaper' as const,
	processId: 901,
	instanceId: 'managed-media-inventory-store-a',
});
const OWNER_B = Object.freeze({
	product: 'framescaper' as const,
	processId: 902,
	instanceId: 'managed-media-inventory-store-b',
});

test('managed-media inventory store fences reserve, promotion, and cleanup with the live lease', async (context) => {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-managed-media-inventory-store-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataRoot);
	const clock = { value: 10_000 };
	const now = (): number => clock.value;
	const first = await SharedDesktopProjectLibrary.open(paths, { now });
	const second = await SharedDesktopProjectLibrary.open(paths, { now });
	context.after(() => {
		first.close();
		second.close();
	});
	const lease = await first.acquireLease({ owner: OWNER_A, ttlMs: 1_000 });
	const inventory = new DesktopLibraryManagedMediaInventoryStore(paths, { now });
	context.after(() => inventory.close());

	const firstReservation = reservation('a', lease, '1'.repeat(32));
	assert.equal(inventory.reserve(firstReservation).state, 'planned');
	const firstStagePath = join(paths.managedMediaRoot, ...firstReservation.stageFile.split('/'));
	await mkdir(dirname(firstStagePath), { recursive: true });
	await writeFile(firstStagePath, 'first managed body', { flag: 'wx' });
	inventory.materialize(firstReservation);
	const firstFinalPath = join(
		paths.managedMediaRoot,
		...firstReservation.descriptor.relativeFile.split('/'),
	);
	assert.equal(await readFile(firstFinalPath, 'utf8'), 'first managed body');
	await assert.rejects(() => stat(firstStagePath), /ENOENT/u);

	const staleReservation = reservation('b', lease, '2'.repeat(32));
	inventory.reserve(staleReservation);
	const staleStagePath = join(paths.managedMediaRoot, ...staleReservation.stageFile.split('/'));
	await mkdir(dirname(staleStagePath), { recursive: true });
	await writeFile(staleStagePath, 'stale managed body', { flag: 'wx' });
	clock.value = lease.expiresAtMs + 1;
	await second.acquireLease({ owner: OWNER_B, ttlMs: 1_000 });

	assert.equal(inventory.discard({ ...staleReservation, removeFile: true }), false);
	assert.equal(await readFile(staleStagePath, 'utf8'), 'stale managed body');
	assert.throws(
		() => inventory.materialize(staleReservation),
		/no longer owns the lease/iu,
	);
});

function reservation(
	seed: string,
	lease: Awaited<ReturnType<SharedDesktopProjectLibrary['acquireLease']>>,
	stageId: string,
) {
	const projectId = `managed-media-inventory-store-project-${seed}`;
	const projectRevision = 1;
	const projectSha256 = seed.repeat(64);
	const storageKey = `managed-media-inventory-store-source-${seed}`;
	const descriptor = Object.freeze({
		...createDesktopLibraryMediaBinding(
			DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
			projectId,
			storageKey,
			projectRevision,
			projectSha256,
		),
		byteLength: 18,
		sha256: seed.repeat(64),
	});
	return Object.freeze({
		lease,
		descriptor,
		encoding: DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
		projectId,
		projectRevision,
		projectSha256,
		storageKey,
		stageFile: createDesktopLibraryManagedMediaStageFile(descriptor.id, stageId, 'upload'),
		stageKind: 'upload' as const,
	});
}
