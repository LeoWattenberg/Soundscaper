/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	FramescaperVideoProxyCleanupCoordinatorRetime,
	createFramescaperVideoProxyCleanupCoordinatorRetime,
	type FramescaperVideoProxyCleanupPortsRetime,
	type FramescaperVideoProxyCleanupStoreRetime,
} from '../src/framescaper/editor-video-proxy-cleanup-retime.ts';

type Data = Record<string, unknown>;

const JOURNAL_KEY = 'framescaper:selected-video-proxy-cleanup:v1';
const PROXY_KEY = `video-proxy-sha256:${'34'.repeat(32)}`;
const TIMING_KEY = `video-timing-sha256:${'56'.repeat(32)}`;
const OTHER_TIMING_KEY = `video-timing-sha256:${'78'.repeat(32)}`;

test('the coordinator refuses ports that omit any journal, inventory or deletion method', () => {
	const complete: Data = {
		loadJournal: () => [], saveJournal: () => undefined,
		listCurrentProjects: () => [], deleteBody: () => undefined,
	};
	for (const method of ['loadJournal', 'saveJournal', 'listCurrentProjects', 'deleteBody']) {
		const ports: Data = { ...complete, [method]: 'not callable' };
		assert.throws(
			() => new FramescaperVideoProxyCleanupCoordinatorRetime(ports as never),
			(error: Error) => error instanceof TypeError
				&& error.message === `Selected video-proxy cleanup requires ${method}.`,
		);
	}
	assert.throws(() => new FramescaperVideoProxyCleanupCoordinatorRetime(null as never), TypeError);
});

test('preparing a replacement records one durable claim naming both content-addressed bodies', async () => {
	const fixture = harness();
	const claim = await fixture.coordinator.prepareReplacement(
		projectFixture(4, attachment()), 'video-source');
	assert.deepEqual(claim, claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]));
	assert.equal(claim.expectedProjectRevision, 5, 'the claim expects the revision the swap will write');
	assert.deepEqual(claim.storageKeys, [PROXY_KEY, TIMING_KEY]);
	assert.ok(Object.isFrozen(claim));
	assert.deepEqual(fixture.saved, [[claim]]);
});

test('preparing the same replacement twice returns the recorded claim without rewriting the journal', async () => {
	const fixture = harness();
	const project = projectFixture(4, attachment());
	const first = await fixture.coordinator.prepareReplacement(project, 'video-source');
	const second = await fixture.coordinator.prepareReplacement(project, 'video-source');
	assert.deepEqual(second, first);
	assert.equal(fixture.saved.length, 1);
});

test('preparing a replacement refuses a source with no proxy body or an unusable attachment', async () => {
	const fixture = harness();
	await assert.rejects(
		fixture.coordinator.prepareReplacement(projectFixture(4, null), 'video-source'),
		(error: Error) => error instanceof RangeError
			&& error.message === 'Video source video-source has no proxy body to replace.',
	);
	await assert.rejects(
		fixture.coordinator.prepareReplacement(
			projectFixture(4, { ...attachment(), boundaryCount: 12 }),
			'video-source',
		),
		RangeError,
	);
	assert.deepEqual(fixture.saved, []);
});

test('preparing a replacement refuses a source that is absent, not video, or has no proxy field', async () => {
	const { coordinator } = harness();
	await assert.rejects(
		coordinator.prepareReplacement(projectFixture(4, attachment()), 'absent-source'),
		(error: Error) => error instanceof ReferenceError
			&& error.message === 'Video source absent-source is unavailable for proxy cleanup.',
	);
	await assert.rejects(coordinator.prepareReplacement(
		{ id: 'p', revision: 1, sources: [{ kind: 'audio', id: 's', proxyAttachment: null }] },
		's',
	), ReferenceError);
	await assert.rejects(coordinator.prepareReplacement(
		{ id: 'p', revision: 1, sources: [{ kind: 'video', id: 's' }] },
		's',
	), ReferenceError);
	await assert.rejects(coordinator.prepareReplacement(
		{ id: 'p', revision: 1, sources: [null, 7, ['s']] },
		's',
	), ReferenceError);
	await assert.rejects(coordinator.prepareReplacement({ id: 'p', revision: 1 }, 's'),
		(error: Error) => error instanceof TypeError
			&& error.message === 'The proxy cleanup source list is invalid.');
});

test('preparing a replacement refuses malformed projects, identifiers and revisions', async () => {
	const { coordinator } = harness();
	const project = projectFixture(4, attachment());
	const cases: readonly (readonly [unknown, unknown])[] = [
		[null, 'video-source'],
		['project', 'video-source'],
		[[], 'video-source'],
		[{ revision: 1, sources: [] }, 'video-source'],
		[{ id: 'has space', revision: 1, sources: [] }, 'video-source'],
		[{ id: 'a'.repeat(257), revision: 1, sources: [] }, 'video-source'],
		[{ id: 'p', revision: -1, sources: [] }, 'video-source'],
		[{ id: 'p', revision: 1.5, sources: [] }, 'video-source'],
		[project, ''],
		[project, 42],
	];
	for (const [value, sourceId] of cases) {
		await assert.rejects(coordinator.prepareReplacement(value, sourceId), TypeError);
	}
});

test('preparing a replacement refuses a project revision that cannot advance', async () => {
	const fixture = harness();
	await assert.rejects(
		fixture.coordinator.prepareReplacement(
			projectFixture(Number.MAX_SAFE_INTEGER, attachment()), 'video-source'),
		(error: Error) => error instanceof RangeError
			&& error.message === 'The proxy cleanup project revision cannot advance.',
	);
	assert.deepEqual(fixture.saved, []);
});

test('preparing a replacement refuses to grow a journal that already holds its maximum claims', async () => {
	const full = Array.from({ length: 4_096 }, (_value, index) => (
		claimRecord('proxy-project', `filler-${index}`, 5, [PROXY_KEY, TIMING_KEY])
	));
	const fixture = harness({ journal: full });
	await assert.rejects(
		fixture.coordinator.prepareReplacement(projectFixture(4, attachment()), 'video-source'),
		(error: Error) => error instanceof RangeError
			&& error.message === 'The selected video-proxy cleanup journal is full.',
	);
	assert.deepEqual(fixture.saved, []);
});

test('a journal that is not an array or exceeds its bound is rejected before any claim is read', async () => {
	for (const journal of [{}, 'journal', 7, Array.from({ length: 4_097 }, () => null)]) {
		await assert.rejects(harness({ journal }).coordinator.recover(), (error: Error) => (
			error instanceof TypeError
			&& error.message === 'The selected video-proxy cleanup journal is invalid or exceeds its bound.'
		));
	}
});

test('a missing journal reads as empty and leaves recovery with nothing to do', async () => {
	for (const journal of [null, undefined]) {
		const fixture = harness({ journal });
		await fixture.coordinator.recover();
		assert.deepEqual(fixture.saved, []);
		assert.deepEqual(fixture.deleted, []);
	}
});

test('a journal holding the same claim twice is rejected as invalid', async () => {
	const entry = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	await assert.rejects(
		harness({ journal: [entry, { ...entry }] }).coordinator.recover(),
		(error: Error) => error instanceof TypeError
			&& error.message === 'The selected video-proxy cleanup journal is invalid.'
			&& (error.cause as Error).message
				=== 'The selected video-proxy cleanup journal has a duplicate claim.',
	);
});

test('a journal claim that fails validation is reported as an invalid journal with its cause', async () => {
	const entry = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	await assert.rejects(
		harness({ journal: [{ ...entry, id: 'ab'.repeat(32) }] }).coordinator.recover(),
		(error: Error) => error instanceof TypeError
			&& error.message === 'The selected video-proxy cleanup journal is invalid.'
			&& (error.cause as Error).message
				=== 'The selected video-proxy cleanup journal contains a forged claim.',
	);
});

test('cancelling refuses a claim record with an unexpected shape, kind, version or identifier', async () => {
	const { coordinator } = harness();
	const valid = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const { sourceId: _dropped, ...missingField } = valid;
	const cases: readonly (readonly [unknown, RegExp])[] = [
		[null, /cleanup claim is invalid/u],
		['claim', /cleanup claim is invalid/u],
		[[], /cleanup claim is invalid/u],
		[{ ...valid, extra: 1 }, /cleanup claim is invalid/u],
		[missingField, /cleanup claim is invalid/u],
		[{ ...valid, kind: 'framescaper-other-cleanup' }, /contains an invalid claim/u],
		[{ ...valid, version: 2 }, /contains an invalid claim/u],
		[{ ...valid, id: 'not-a-digest' }, /contains an invalid claim/u],
		[{ ...valid, id: 'AB'.repeat(32) }, /contains an invalid claim/u],
		[{ ...valid, storageKeys: PROXY_KEY }, /contains an invalid claim/u],
		[{ ...valid, id: 'ab'.repeat(32) }, /contains a forged claim/u],
		[{ ...valid, expectedProjectRevision: 4 }, /contains a forged claim/u],
		[{ ...valid, expectedProjectRevision: 0 }, /positive proxy cleanup expected revision/u],
		[{ ...valid, expectedProjectRevision: 2.5 }, /non-negative proxy cleanup project revision/u],
		[{ ...valid, projectId: '' }, /valid proxy cleanup project ID/u],
		[{ ...valid, sourceId: 7 }, /valid proxy cleanup source ID/u],
	];
	for (const [value, message] of cases) {
		await assert.rejects(coordinator.cancel(value), (error: Error) => (
			error instanceof TypeError && message.test(error.message)
		));
	}
});

test('cancelling refuses a claim that does not name one or two exact body keys', async () => {
	const { coordinator } = harness();
	const base = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const cases: readonly unknown[][] = [
		[],
		[PROXY_KEY, TIMING_KEY, OTHER_TIMING_KEY],
		['not-a-body-key'],
		[`video-audio-sha256:${'34'.repeat(32)}`],
		[`video-proxy-sha256:${'3'.repeat(63)}`],
		[7],
		[null],
	];
	for (const storageKeys of cases) {
		await assert.rejects(coordinator.cancel({ ...base, storageKeys }), TypeError);
	}
});

test('cancelling removes only the claim matching the normalized identity it was given', async () => {
	const kept = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const dropped = claimRecord('other-project', 'other-source', 2, [PROXY_KEY]);
	const fixture = harness({ journal: [kept, dropped] });

	// A duplicated key normalizes to the single-key claim already in the journal.
	await fixture.coordinator.cancel({ ...dropped, storageKeys: [PROXY_KEY, PROXY_KEY] });
	assert.deepEqual(fixture.saved, [[kept]]);
	assert.deepEqual(fixture.deleted, []);
});

test('settling ignores a claim the journal no longer holds', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const fixture = harness({ journal: [], projects: [projectFixture(9, null)] });
	await fixture.coordinator.settle(claim);
	assert.deepEqual(fixture.saved, []);
	assert.deepEqual(fixture.deleted, []);
});

test('settling cancels the intent when the owning project still roots the old bodies', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const fixture = harness({ journal: [claim], projects: [projectFixture(5, attachment())] });
	await fixture.coordinator.settle(claim);
	assert.deepEqual(fixture.deleted, [], 'a rooted body is never reclaimed');
	assert.deepEqual(fixture.saved, [[]]);
});

test('settling cancels the intent when the owning project never advanced past the claim', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	// A crash before the pointer swap leaves the owner behind the revision the claim expects.
	const fixture = harness({ journal: [claim], projects: [projectFixture(4, null)] });
	await fixture.coordinator.settle(claim);
	assert.deepEqual(fixture.deleted, []);
	assert.deepEqual(fixture.saved, [[]]);
});

test('settling deletes both bodies and rewrites the journal after each one', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const fixture = harness({ journal: [claim], projects: [projectFixture(5, null)] });
	await fixture.coordinator.settle(claim);
	assert.deepEqual(fixture.deleted, [PROXY_KEY, TIMING_KEY]);
	assert.equal(fixture.saved.length, 2);
	const resumable = fixture.saved[0] as readonly Data[];
	assert.deepEqual(resumable.map((entry) => entry.storageKeys), [[TIMING_KEY]],
		'a crash mid-drain resumes on the bodies that are still unreclaimed');
	assert.notEqual(resumable[0]?.id, claim.id, 'the resumed claim re-derives its own identity');
	assert.deepEqual(fixture.saved[1], []);
	assert.deepEqual(fixture.journal(), []);
});

test('settling keeps a body that another current project still roots', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const sibling = projectFixture(2, attachment('34', '78'), { id: 'other-project' });
	const fixture = harness({ journal: [claim], projects: [projectFixture(5, null), sibling] });
	await fixture.coordinator.settle(claim);
	assert.deepEqual(fixture.deleted, [TIMING_KEY]);
	assert.deepEqual(fixture.journal(), []);
});

test('a project inventory ignores non-video sources and video sources without a proxy', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const owner: Data = {
		id: 'proxy-project', revision: 5,
		sources: [
			{ kind: 'audio', id: 'audio-source', proxyAttachment: attachment() },
			{ kind: 'video', id: 'no-proxy', proxyAttachment: null },
			{ kind: 'video', id: 'unset-proxy' },
		],
	};
	const fixture = harness({ journal: [claim], projects: [owner] });
	await fixture.coordinator.settle(claim);
	assert.deepEqual(fixture.deleted, [PROXY_KEY, TIMING_KEY]);
});

test('a project with a malformed source list or source record is rejected', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	await assert.rejects(
		harness({ journal: [claim], projects: [{ id: 'proxy-project', revision: 5, sources: {} }] })
			.coordinator.recover(),
		(error: Error) => error instanceof TypeError
			&& error.message === 'A proxy cleanup project has an invalid source inventory.',
	);
	await assert.rejects(
		harness({ journal: [claim], projects: [{ id: 'proxy-project', revision: 5, sources: [7] }] })
			.coordinator.recover(),
		(error: Error) => error instanceof TypeError
			&& error.message === 'A proxy cleanup project has an invalid source record.',
	);
	await assert.rejects(
		harness({ journal: [claim] }).coordinator.settle(claim, { id: 'proxy-project', revision: 5 }),
		(error: Error) => error instanceof TypeError
			&& error.message === 'A proxy cleanup project has an invalid source inventory.',
	);
});

test('recovery refuses a current-project inventory that is not a bounded array', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	for (const projects of [null, {}, 'projects', Array.from({ length: 100_001 }, () => null)]) {
		await assert.rejects(harness({ journal: [claim], projects }).coordinator.recover(),
			(error: Error) => error instanceof TypeError
				&& error.message === 'The selected proxy cleanup project inventory is invalid.');
	}
});

test('settling treats the supplied current project as authoritative over the listed inventory', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	// The inventory is stale and still shows the old pointer; the caller holds the committed project.
	const fixture = harness({ journal: [claim], projects: [projectFixture(4, attachment())] });
	await fixture.coordinator.settle(claim, projectFixture(5, null));
	assert.deepEqual(fixture.deleted, [PROXY_KEY, TIMING_KEY]);
});

test('settling adds a supplied current project the inventory has not listed yet', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const fixture = harness({ journal: [claim], projects: [] });
	await fixture.coordinator.settle(
		claim, projectFixture(1, attachment('34', '78'), { id: 'sibling-project' }));
	assert.deepEqual(fixture.deleted, [TIMING_KEY], 'the unlisted project still roots the proxy body');
});

test('recovery drains every claim recorded before the restart', async () => {
	const first = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const second = claimRecord('other-project', 'other-source', 3, [OTHER_TIMING_KEY]);
	const fixture = harness({ journal: [first, second], projects: [projectFixture(5, null)] });
	await fixture.coordinator.recover();
	assert.deepEqual(fixture.deleted, [PROXY_KEY, TIMING_KEY, OTHER_TIMING_KEY]);
	assert.deepEqual(fixture.journal(), []);
});

test('concurrent preparations queue so neither claim is lost from the journal', async () => {
	const fixture = harness();
	const project: Data = {
		id: 'proxy-project', revision: 4,
		sources: [
			{ kind: 'video', id: 'first-source', proxyAttachment: attachment('34', '56') },
			{ kind: 'video', id: 'second-source', proxyAttachment: attachment('9a', 'bc') },
		],
	};
	const [first, second] = await Promise.all([
		fixture.coordinator.prepareReplacement(project, 'first-source'),
		fixture.coordinator.prepareReplacement(project, 'second-source'),
	]);
	const recorded = (fixture.journal() as readonly Data[]).map((entry) => entry.id);
	assert.deepEqual([...recorded].sort(), [first.id, second.id].sort());
});

test('a rejected operation does not stall the operations queued behind it', async () => {
	const fixture = harness();
	const rejected = fixture.coordinator.prepareReplacement(projectFixture(4, null), 'video-source');
	const accepted = fixture.coordinator.prepareReplacement(
		projectFixture(4, attachment()), 'video-source');

	await assert.rejects(rejected, RangeError);
	assert.equal((await accepted).expectedProjectRevision, 5);
});

test('the factory reads and writes the journal through the analysis store under one key', async () => {
	const analysis = new Map<string, unknown>();
	const deleted: string[] = [];
	const cleanup = createFramescaperVideoProxyCleanupCoordinatorRetime({
		loadAnalysis: async (key) => analysis.get(key) ?? null,
		saveAnalysis: async (key, value) => analysis.set(key, structuredClone(value)),
		deleteMediaAsset: async (storageKey) => deleted.push(storageKey),
	}, {
		// The catalog entry already carries its sources, so no document load is needed.
		listProjects: async () => [projectFixture(5, null)],
		loadProject: async () => { throw new Error('the catalog entry was already a document'); },
	});

	await cleanup.prepareReplacement(projectFixture(4, attachment()), 'video-source');
	assert.deepEqual([...analysis.keys()], [JOURNAL_KEY]);
	await cleanup.recover();
	assert.deepEqual(deleted, [PROXY_KEY, TIMING_KEY]);
	assert.deepEqual(analysis.get(JOURNAL_KEY), []);
});

test('the factory refuses a project store that cannot both list and load documents', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const stores: readonly unknown[] = [
		null,
		{},
		{ listProjects: async () => [] },
		{ loadProject: async () => null },
		{ listProjects: 'list', loadProject: async () => null },
	];
	for (const store of stores) {
		const cleanup = createFramescaperVideoProxyCleanupCoordinatorRetime(
			bodyStore([claim], []), store as never);
		await assert.rejects(cleanup.recover(), (error: Error) => error instanceof TypeError
			&& error.message === 'Selected video-proxy cleanup requires a project document store.');
	}
});

test('the factory refuses a project catalog that is not a bounded array', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const catalogs: readonly unknown[] = [null, 'catalog', Array.from({ length: 100_001 }, () => null)];
	for (const listed of catalogs) {
		const cleanup = createFramescaperVideoProxyCleanupCoordinatorRetime(bodyStore([claim], []), {
			listProjects: async () => listed as readonly unknown[],
			loadProject: async () => null,
		});
		await assert.rejects(cleanup.recover(), (error: Error) => error instanceof TypeError
			&& error.message === 'The selected proxy cleanup project inventory is invalid.');
	}
});

test('the factory skips a catalog entry whose project document has since been deleted', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const deleted: string[] = [];
	const loaded: string[] = [];
	const cleanup = createFramescaperVideoProxyCleanupCoordinatorRetime(bodyStore([claim], deleted), {
		listProjects: async () => [{ id: 'proxy-project', revision: 7 }],
		loadProject: async (projectId) => { loaded.push(projectId); return null; },
	});
	await cleanup.recover();
	assert.deepEqual(loaded, ['proxy-project']);
	assert.deepEqual(deleted, [PROXY_KEY, TIMING_KEY]);
});

test('the factory refuses a catalog entry whose loaded document has a different identity', async () => {
	const claim = claimRecord('proxy-project', 'video-source', 5, [PROXY_KEY, TIMING_KEY]);
	const cleanup = createFramescaperVideoProxyCleanupCoordinatorRetime(bodyStore([claim], []), {
		listProjects: async () => [{ id: 'proxy-project', revision: 7 }],
		loadProject: async () => projectFixture(5, null, { id: 'renamed-project' }),
	});
	await assert.rejects(cleanup.recover(), (error: Error) => (
		error.constructor === Error
		&& error.message === 'The proxy cleanup project inventory changed identity while loading.'
	));
});

function harness(options: { journal?: unknown; projects?: unknown } = {}): Readonly<{
	coordinator: FramescaperVideoProxyCleanupCoordinatorRetime;
	deleted: string[];
	saved: unknown[][];
	journal(): unknown;
}> {
	const { journal: initialJournal, projects = [] } = options;
	let journal: unknown = initialJournal;
	const deleted: string[] = [];
	const saved: unknown[][] = [];
	const ports: FramescaperVideoProxyCleanupPortsRetime = {
		loadJournal: () => structuredClone(journal),
		saveJournal(value) {
			saved.push(structuredClone(value) as unknown[]);
			journal = structuredClone(value);
		},
		listCurrentProjects: () => projects as readonly unknown[],
		deleteBody(storageKey) { deleted.push(storageKey); },
	};
	return {
		coordinator: new FramescaperVideoProxyCleanupCoordinatorRetime(ports), deleted, saved,
		journal: () => journal,
	};
}

function bodyStore(
	initialJournal: unknown,
	deleted: string[],
): FramescaperVideoProxyCleanupStoreRetime {
	let journal = initialJournal;
	return {
		loadAnalysis: async () => structuredClone(journal),
		saveAnalysis: async (_key, value) => { journal = structuredClone(value); },
		deleteMediaAsset: async (storageKey) => { deleted.push(storageKey); },
	};
}

function claimRecord(
	projectId: string,
	sourceId: string,
	expectedProjectRevision: number,
	storageKeys: readonly string[],
): Data {
	const keys = [...new Set(storageKeys)].sort();
	const material = JSON.stringify([projectId, sourceId, expectedProjectRevision, keys]);
	return {
		kind: 'framescaper-selected-video-proxy-cleanup', version: 1,
		id: bytesToHex(sha256(new TextEncoder().encode(material))),
		projectId, sourceId, expectedProjectRevision, storageKeys: keys,
	};
}

function projectFixture(
	revision: number,
	proxyAttachment: unknown,
	options: { id?: string; sourceId?: string } = {},
): Data {
	return {
		id: options.id ?? 'proxy-project', revision,
		sources: [{ kind: 'video', id: options.sourceId ?? 'video-source', proxyAttachment }],
	};
}

function attachment(proxyByte = '34', timingByte = '56'): Data {
	const proxySha256 = proxyByte.repeat(32);
	const timingSha256 = timingByte.repeat(32);
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha256}`,
		mimeType: 'video/mp4', byteLength: 1_024, sha256: proxySha256,
		originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256, sourceSha256: proxySha256,
			byteLength: 112, frameCount: 10, timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
