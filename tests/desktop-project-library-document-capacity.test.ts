/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { createDesktopProjectLibraryPaths } from '../desktop/project-library-contract.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';

const OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 811,
	instanceId: 'document-capacity-instance',
});

test('an insufficient destination refuses project-document staging before directory work', async (context) => {
	let statCalls = 0;
	const fixture = await capacityFixture(context, async () => {
		statCalls += 1;
		return { bavail: 1n, bsize: 1n };
	});

	await assert.rejects(
		fixture.commit('capacity-entry-0001'),
		/below the staged project document size/iu,
	);

	assert.equal(statCalls, 1);
	assert.deepEqual(fixture.store.readCatalog().projects, [], 'a refused commit publishes no catalog row');
	assert.deepEqual(
		await readdir(fixture.paths.projectsRoot).catch(() => []),
		[],
		'a refused commit creates no project scope directory or stage file',
	);
});

test('failed or malformed capacity information fails closed before staging', async (context) => {
	const failing = await capacityFixture(context, async () => {
		throw new Error('statfs unavailable');
	});
	await assert.rejects(
		failing.commit('capacity-entry-0002'),
		/could not inspect filesystem capacity for the project document/iu,
	);

	const malformed = await capacityFixture(context, async () => ({ bavail: 7, bsize: 'many' }));
	await assert.rejects(
		malformed.commit('capacity-entry-0003'),
		/capacity information is invalid/iu,
	);
	assert.deepEqual(malformed.store.readCatalog().projects, []);
});

test('an admitted document stages, publishes, and reads back after one capacity check', async (context) => {
	let statCalls = 0;
	const fixture = await capacityFixture(context, async () => {
		statCalls += 1;
		return { bavail: 1024n * 1024n, bsize: 1024n };
	});

	const committed = await fixture.commit('capacity-entry-0004');

	assert.equal(statCalls, 1);
	assert.equal(committed.catalog.id, 'capacity-entry-0004');
	const loaded = await fixture.store.readProject('capacity-entry-0004');
	assert.equal(loaded?.project.id, fixture.project.id);
	assert.equal(loaded?.catalog.projectRevision, fixture.project.revision);
});

async function capacityFixture(
	context: TestContext,
	statfsImpl: (path: string, options: Readonly<{ bigint: true }>) => Promise<unknown>,
) {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-library-document-capacity-'));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const library = await SharedDesktopProjectLibrary.open(paths);
	const lease = await library.acquireLease({ owner: OWNER, ttlMs: 5_000 });
	context.after(async () => {
		await library.releaseLease(lease).catch(() => undefined);
		library.close();
		await rm(appDataPath, { recursive: true, force: true });
	});
	const store = new DesktopLibraryProjectStore(library, { statfsImpl });
	const project = createCurrentAudioEditorProject({
		id: 'document-capacity-project',
		title: 'Document capacity project',
		revision: 1,
		now: '2026-08-08T12:00:00.000Z',
	});
	return {
		paths,
		project,
		store,
		commit: (entryId: string) => store.commitProject({
			lease,
			entryId,
			name: 'Document capacity project',
			project,
			preferredProduct: 'soundscaper',
			updatedAtMs: 60_000,
		}),
	};
}
