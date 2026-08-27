/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	exportProjectTransferBundle,
	importProjectTransferBundle,
	PROJECT_TRANSFER_ENTRY_MIME_TYPE,
	ProjectTransferRefusalError,
	type ProjectTransferProgress,
} from '../src/common/transfer/project-transfer-bundle.ts';
import {
	archiveBytes,
	collectExport,
	createFakeArchive,
	FakeStore,
	transferEntries,
} from './project-transfer-bundle-fixture.ts';

test('a multi-project library round trips between two stores', async () => {
	const source = new FakeStore([
		{ id: 'project-a', title: 'Opening Titles', product: 'framescaper' },
		{ id: 'project-b', title: 'Field Recording', product: 'soundscaper' },
		{ id: 'project-c', title: 'Rough Cut', product: 'framescaper' },
	]);
	const archive = createFakeArchive();
	const exported = await collectExport(exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
	}));

	assert.equal(exported.entries.length, 3);
	assert.deepEqual(exported.entries.map((entry) => entry.projectId), ['project-a', 'project-b', 'project-c']);
	assert.equal(exported.entries[0].fileName, 'Opening Titles.scape');
	assert.equal(exported.entries[0].mimeType, PROJECT_TRANSFER_ENTRY_MIME_TYPE);
	assert.ok(exported.entries[0].byteLength > 0);
	assert.deepEqual(exported.summary, { kind: 'summary', total: 3, exported: 3, failed: 0 });

	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: transferEntries(exported.entries),
	});

	assert.deepEqual(
		result.entries.map((record) => [record.outcome, record.projectId]),
		[['imported', 'project-a'], ['imported', 'project-b'], ['imported', 'project-c']],
	);
	assert.deepEqual(
		{ total: result.total, imported: result.imported, skipped: result.skipped, failed: result.failed },
		{ total: 3, imported: 3, skipped: 0, failed: 0 },
	);
	assert.deepEqual({ completed: result.completed, stopped: result.stopped }, { completed: true, stopped: null });
	assert.deepEqual([...receiving.projects.keys()], ['project-a', 'project-b', 'project-c']);
	assert.deepEqual(archive.collisions, ['cancel', 'cancel', 'cancel']);
});

test('the caller selects which product transfers', async () => {
	const source = new FakeStore([
		{ id: 'project-a', title: 'Opening Titles', product: 'framescaper' },
		{ id: 'project-b', title: 'Field Recording', product: 'soundscaper' },
	]);
	const archive = createFakeArchive();
	const exported = await collectExport(exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
		select: (project) => project.product === 'framescaper',
	}));

	assert.deepEqual(exported.entries.map((entry) => entry.projectId), ['project-a']);
	assert.deepEqual(archive.exportCalls, ['project-a']);
	assert.deepEqual(exported.summary, { kind: 'summary', total: 1, exported: 1, failed: 0 });
});

test('each project is exported only when its predecessor has been yielded', async () => {
	const source = new FakeStore([{ id: 'project-a', title: 'A' }, { id: 'project-b', title: 'B' }]);
	const archive = createFakeArchive();
	const progress: ProjectTransferProgress[] = [];
	const events = exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
		onProgress: (value) => progress.push(value),
	});

	assert.deepEqual(archive.exportCalls, []);
	const first = await events.next();
	assert.equal(first.value?.kind, 'entry');
	assert.deepEqual(archive.exportCalls, ['project-a']);
	const second = await events.next();
	assert.equal(second.value?.kind, 'entry');
	assert.deepEqual(archive.exportCalls, ['project-a', 'project-b']);
	const summary = await events.next();
	assert.equal(summary.value?.kind, 'summary');
	assert.deepEqual(progress.map((value) => [value.completed, value.total, value.projectId]), [
		[0, 2, 'project-a'],
		[1, 2, 'project-b'],
		[2, 2, null],
	]);
});

test('importing a project that is already present is a skip, not a duplicate', async () => {
	const source = new FakeStore([{ id: 'project-a', title: 'Opening Titles' }]);
	const archive = createFakeArchive();
	const exported = await collectExport(exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
	}));
	const receiving = new FakeStore();
	const entries = transferEntries(exported.entries);

	const first = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries,
	});
	const second = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries,
	});

	assert.equal(first.imported, 1);
	assert.equal(second.imported, 0);
	assert.equal(second.skipped, 1);
	assert.equal(second.entries[0].outcome, 'skipped');
	assert.equal(second.entries[0].reasonCode, 'already-present');
	assert.equal(second.entries[0].projectId, 'project-a');
	assert.match(second.entries[0].reason ?? '', /already present/u);
	assert.deepEqual(archive.importCalls, ['project-a'], 'a present project is never re-imported');
	assert.equal(receiving.projects.size, 1);
});

test('a failing entry is reported, leaves no residue and does not abort the run', async () => {
	const archive = createFakeArchive({
		failImport: (document) => (document.id === 'project-b' ? new Error('The archive is corrupt.') : null),
		partialWriteOnFailure: true,
	});
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [
			{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) },
			{ bytes: archiveBytes({ id: 'project-b', title: 'B' }) },
			{ bytes: archiveBytes({ id: 'project-c', title: 'C' }) },
		],
	});

	assert.deepEqual(result.entries.map((record) => record.outcome), ['imported', 'failed', 'imported']);
	assert.deepEqual(
		{ imported: result.imported, failed: result.failed, skipped: result.skipped },
		{ imported: 2, failed: 1, skipped: 0 },
	);
	const failure = result.entries[1];
	assert.equal(failure.projectId, 'project-b');
	assert.equal(failure.reasonCode, 'import-failed');
	assert.equal(failure.residue, 'cleared');
	assert.match(failure.reason ?? '', /The archive is corrupt\./u);
	assert.match(failure.reason ?? '', /was removed/u);
	assert.deepEqual([...receiving.projects.keys()], ['project-a', 'project-c']);
	assert.deepEqual(receiving.deletions, ['project-b']);
});

test('a failed import that left nothing behind reports no residue', async () => {
	const archive = createFakeArchive({ failImport: () => new Error('The archive is truncated.') });
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) }],
	});

	assert.equal(result.entries[0].residue, 'none');
	assert.deepEqual(receiving.deletions, []);
	assert.equal(receiving.projects.size, 0);
});

test('an unreadable archive is recorded without reaching the import', async () => {
	const archive = createFakeArchive({
		failInspect: (bytes) => (bytes.byteLength === 0 ? new Error('The .scape archive is empty.') : null),
	});
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [
			{ projectId: 'unknown', title: 'Damaged', bytes: new Uint8Array(0) },
			{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) },
		],
	});

	assert.equal(result.entries[0].outcome, 'failed');
	assert.equal(result.entries[0].reasonCode, 'archive-unreadable');
	assert.equal(result.entries[0].projectId, 'unknown');
	assert.equal(result.entries[0].title, 'Damaged');
	assert.match(result.entries[0].reason ?? '', /empty/u);
	assert.deepEqual(archive.importCalls, ['project-a']);
	assert.equal(result.imported, 1);
});

test('a read-only archive is skipped with the migration reason', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A', readOnly: true, reason: 'Newer schema.' }) }],
	});

	assert.equal(result.entries[0].outcome, 'skipped');
	assert.equal(result.entries[0].reasonCode, 'archive-read-only');
	assert.equal(result.entries[0].reason, 'Newer schema.');
	assert.deepEqual(archive.importCalls, []);
	assert.equal(receiving.projects.size, 0);
});

test('an export failure is reported per project and the run continues', async () => {
	const source = new FakeStore([{ id: 'project-a', title: 'A' }, { id: 'project-b', title: 'B' }]);
	const archive = createFakeArchive({
		failExport: (project) => (project.id === 'project-a' ? new Error('The source media is missing.') : null),
	});
	const exported = await collectExport(exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
	}));

	assert.deepEqual(exported.entries.map((entry) => entry.projectId), ['project-b']);
	assert.equal(exported.failures.length, 1);
	assert.equal(exported.failures[0].projectId, 'project-a');
	assert.equal(exported.failures[0].code, null);
	assert.match(exported.failures[0].reason, /source media is missing/u);
	assert.deepEqual(exported.summary, { kind: 'summary', total: 2, exported: 1, failed: 1 });
});

test('an abort between projects stops the export where it stood', async () => {
	const source = new FakeStore([{ id: 'project-a', title: 'A' }, { id: 'project-b', title: 'B' }]);
	const archive = createFakeArchive();
	const controller = new AbortController();
	const events = exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
		signal: controller.signal,
	});

	const first = await events.next();
	assert.equal(first.value?.kind, 'entry');
	controller.abort();
	await assert.rejects(() => events.next(), (error: Error) => error.name === 'AbortError');
	assert.deepEqual(archive.exportCalls, ['project-a'], 'no further project is exported after the abort');
});

test('the export refuses a selection over the admitted entry count', async () => {
	const source = new FakeStore([
		{ id: 'project-a', title: 'A' },
		{ id: 'project-b', title: 'B' },
		{ id: 'project-c', title: 'C' },
	]);
	const archive = createFakeArchive();
	const events = exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
		maximumEntries: 2,
	});

	await assert.rejects(() => collectExport(events), (error: unknown) => {
		assert.ok(error instanceof ProjectTransferRefusalError);
		assert.equal(error.code, 'entry-limit');
		assert.match(error.message, /at most 2 entries/u);
		return true;
	});
	assert.deepEqual(archive.exportCalls, [], 'the count is refused before any project is exported');
});

test('an entry over the admitted byte bound is refused by name', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		maximumEntryBytes: 8,
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'Opening Titles' }) }],
	});

	assert.equal(result.completed, false);
	assert.equal(result.stopped?.code, 'entry-too-large');
	assert.equal(result.stopped?.index, 0);
	assert.match(result.stopped?.reason ?? '', /over the 8 byte entry limit/u);
	assert.deepEqual(result.entries, []);
	assert.deepEqual(archive.inspectCalls, []);
	assert.equal(receiving.projects.size, 0);
});

test('an oversized export is refused by name and does not abort the run', async () => {
	const source = new FakeStore([{ id: 'project-a', title: 'A' }, { id: 'project-b', title: 'B' }]);
	const archive = createFakeArchive({
		bytesFor: (project) => (project.id === 'project-a'
			? new Uint8Array(64)
			: archiveBytes({ id: project.id, title: project.title })),
	});
	const exported = await collectExport(exportProjectTransferBundle({
		store: source,
		exportProject: archive.exportProject,
		maximumEntryBytes: 32,
	}));

	assert.equal(exported.failures.length, 1);
	assert.equal(exported.failures[0].code, 'entry-too-large');
	assert.match(exported.failures[0].reason, /over the 32 byte entry limit/u);
	assert.deepEqual(exported.entries.map((entry) => entry.projectId), ['project-b']);
	assert.deepEqual(exported.summary, { kind: 'summary', total: 2, exported: 1, failed: 1 });
});

test('an inadmissible bound is refused before any work starts', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	for (const bound of [0, -1, 1.5, Number.NaN, 100_001]) {
		await assert.rejects(
			() => importProjectTransferBundle({
				store: receiving,
				inspectProject: archive.inspectProject,
				importProject: archive.importProject,
				maximumEntries: bound,
				entries: [],
			}),
			(error: unknown) => error instanceof ProjectTransferRefusalError && error.code === 'invalid-bound',
		);
	}
	await assert.rejects(
		() => importProjectTransferBundle({
			store: receiving,
			inspectProject: archive.inspectProject,
			importProject: archive.importProject,
			maximumEntryBytes: 8 * 1024 * 1024 * 1024 + 1,
			entries: [],
		}),
		(error: unknown) => error instanceof ProjectTransferRefusalError && error.code === 'invalid-bound',
	);
});

test('a SharedArrayBuffer-backed payload is refused', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const shared = new Uint8Array(new SharedArrayBuffer(16));
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [{ bytes: shared }],
	});

	assert.equal(result.completed, false);
	assert.equal(result.stopped?.code, 'shared-memory');
	assert.match(result.stopped?.reason ?? '', /SharedArrayBuffer/u);
	assert.deepEqual(result.entries, []);
	assert.deepEqual(archive.inspectCalls, []);
});

test('malformed entries are refused fail-closed', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const request = (entry: unknown) => importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [entry],
	});
	const malformed: readonly unknown[] = [
		null,
		'archive',
		[archiveBytes({ id: 'project-a', title: 'A' })],
		{ bytes: archiveBytes({ id: 'project-a', title: 'A' }).buffer },
		{ bytes: new Uint16Array(4) },
		{ bytes: archiveBytes({ id: 'project-a', title: 'A' }), unexpected: 1 },
		{ bytes: archiveBytes({ id: 'project-a', title: 'A' }), byteLength: 3 },
		{ bytes: archiveBytes({ id: 'project-a', title: 'A' }), title: 7 },
	];
	for (const entry of malformed) {
		const result = await request(entry);
		assert.equal(result.completed, false, `${JSON.stringify(String(entry))} must stop the run`);
		assert.equal(result.stopped?.code, 'malformed-entry');
		assert.equal(result.stopped?.index, 0);
		assert.deepEqual(result.entries, []);
	}
	assert.deepEqual(archive.inspectCalls, []);
});

test('an archive without a project identity fails that entry alone', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: async () => ({ id: '', title: 'Nameless', exists: false, readOnly: false }),
		importProject: archive.importProject,
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) }],
	});

	assert.equal(result.entries[0].outcome, 'failed');
	assert.equal(result.entries[0].reasonCode, 'archive-identity');
	assert.deepEqual(archive.importCalls, []);
});

test('the archive input factory is injectable and the store contract is enforced', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const wrapped: unknown[] = [];
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		toArchiveInput: (bytes) => {
			wrapped.push(bytes);
			return bytes;
		},
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) }],
	});

	assert.equal(result.imported, 1);
	assert.equal(wrapped.length, 2, 'inspect and import each receive their own archive input');
	await assert.rejects(
		() => collectExport(exportProjectTransferBundle({
			store: { listProjects: async () => [{ title: 'no id' }] },
			exportProject: archive.exportProject,
		})),
		(error: unknown) => error instanceof ProjectTransferRefusalError && error.code === 'store-contract',
	);
});

test('a project that appears between inspect and the failure is never deleted', async () => {
	const receiving = new FakeStore();
	const archive = createFakeArchive({
		beforeImport: (document, store) => {
			if (document.id !== 'project-b') return;
			// Another tab autosaves at this identity after the transfer inspected
			// the archive and was told the id was free.
			store.projects.set('project-b', { id: 'project-b', title: 'Another tab' });
		},
	});
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [
			{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) },
			{ bytes: archiveBytes({ id: 'project-b', title: 'B' }) },
		],
	});

	assert.deepEqual(result.entries.map((record) => record.outcome), ['imported', 'failed']);
	const failure = result.entries[1];
	assert.equal(failure.reasonCode, 'import-failed');
	assert.equal(failure.residue, 'retained');
	assert.match(failure.reason ?? '', /already exists/u);
	assert.match(failure.reason ?? '', /kept/u);
	assert.deepEqual(
		receiving.projects.get('project-b'),
		{ id: 'project-b', title: 'Another tab' },
		'the concurrent writer keeps its project',
	);
	assert.deepEqual(receiving.deletions, [], 'nothing this transfer did not write is deleted');
});

test('residue is removed only while it is still the exact document this entry created', async () => {
	const receiving = new FakeStore();
	const archive = createFakeArchive({
		failImport: () => new Error('The archive is corrupt.'),
		partialWriteOnFailure: true,
	});
	receiving.onLoad = (projectId) => {
		if (!receiving.projects.has(projectId)) return;
		// The residue guard looks, and in that instant another writer replaces
		// the row with its own document.
		receiving.projects.set(projectId, { id: projectId, title: 'Another tab' });
		receiving.onLoad = null;
	};

	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) }],
	});

	assert.equal(result.entries[0].outcome, 'failed');
	assert.equal(result.entries[0].residue, 'retained');
	assert.match(result.entries[0].reason ?? '', /no longer the project this transfer created/u);
	assert.deepEqual(receiving.projects.get('project-a'), { id: 'project-a', title: 'Another tab' });
	assert.deepEqual(receiving.deletions, []);
});

test('a store that cannot prove authorship keeps the residue and says why', async () => {
	const receiving = new FakeStore();
	const archive = createFakeArchive({
		failImport: () => new Error('The archive is corrupt.'),
		partialWriteOnFailure: true,
	});
	// A receiving store with only the blind seams: it can write, load and
	// delete, but it cannot hand back a document that identifies its writer.
	const blindStore = {
		projects: receiving.projects,
		loadProject: (projectId: string) => receiving.loadProject(projectId),
		deleteProject: (projectId: string) => receiving.deleteProject(projectId),
	};
	const result = await importProjectTransferBundle({
		store: blindStore,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) }],
	});

	assert.equal(result.entries[0].residue, 'retained');
	assert.match(result.entries[0].reason ?? '', /cannot prove/u);
	assert.equal(receiving.projects.size, 1, 'an unattributable project is kept, not guessed away');
	assert.deepEqual(receiving.deletions, []);
});

test('an abort hands back the records of everything already imported', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const controller = new AbortController();
	async function* entries(): AsyncGenerator<unknown> {
		yield { bytes: archiveBytes({ id: 'project-a', title: 'A' }) };
		controller.abort();
		yield { bytes: archiveBytes({ id: 'project-b', title: 'B' }) };
	}

	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: entries(),
		signal: controller.signal,
	});

	assert.equal(result.completed, false);
	assert.equal(result.stopped?.code, 'aborted');
	assert.equal(result.stopped?.index, 1);
	assert.deepEqual(result.entries.map((record) => [record.outcome, record.projectId]), [['imported', 'project-a']]);
	assert.equal(result.imported, 1);
	assert.deepEqual(archive.importCalls, ['project-a']);
	assert.deepEqual([...receiving.projects.keys()], ['project-a']);
});

test('the entry limit stops the run and still reports what landed', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		maximumEntries: 1,
		entries: [
			{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) },
			{ bytes: archiveBytes({ id: 'project-b', title: 'B' }) },
		],
	});

	assert.equal(result.completed, false);
	assert.equal(result.stopped?.code, 'entry-limit');
	assert.equal(result.stopped?.index, 1);
	assert.match(result.stopped?.reason ?? '', /at most 1 entries/u);
	assert.deepEqual(result.entries.map((record) => record.projectId), ['project-a']);
	assert.equal(result.imported, 1);
	assert.deepEqual(archive.importCalls, ['project-a'], 'nothing past the bound is imported');
	assert.deepEqual([...receiving.projects.keys()], ['project-a']);
});

test('a malformed entry stops the run and still reports what landed', async () => {
	const archive = createFakeArchive();
	const receiving = new FakeStore();
	const result = await importProjectTransferBundle({
		store: receiving,
		inspectProject: archive.inspectProject,
		importProject: archive.importProject,
		entries: [
			{ bytes: archiveBytes({ id: 'project-a', title: 'A' }) },
			{ bytes: archiveBytes({ id: 'project-b', title: 'B' }), unexpected: 1 },
			{ bytes: archiveBytes({ id: 'project-c', title: 'C' }) },
		],
	});

	assert.equal(result.completed, false);
	assert.equal(result.stopped?.code, 'malformed-entry');
	assert.equal(result.stopped?.index, 1);
	assert.match(result.stopped?.reason ?? '', /unknown field unexpected/u);
	assert.deepEqual(result.entries.map((record) => record.projectId), ['project-a']);
	assert.equal(result.imported, 1);
	assert.deepEqual(archive.importCalls, ['project-a'], 'the run does not resume past a refusal');
	assert.deepEqual([...receiving.projects.keys()], ['project-a']);
});
