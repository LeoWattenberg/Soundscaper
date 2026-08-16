/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopPluginQuarantine,
	type PluginFaultOutcome,
	type PluginQuarantineFileSystem,
	PluginQuarantineError,
	MAXIMUM_QUARANTINE_FILE_BYTES,
	MAXIMUM_QUARANTINED_DIGESTS,
	PLUGIN_FAULT_KINDS,
	PLUGIN_HOST_FAULT_WINDOW_MS,
	PLUGIN_NON_FAULT_KINDS,
	PLUGIN_QUARANTINE_SCHEMA_VERSION,
} from '../desktop/plugin-quarantine.ts';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);
const FILE = '/userData/plugin-quarantine.json';

/** A digest that is distinct per index, for the capacity ceiling. */
function digestFor(index: number): string {
	return index.toString(16).padStart(64, '0');
}

interface Disk {
	contents: string | null;
	writes: number;
	readonly fileSystem: PluginQuarantineFileSystem;
	failReadWith: NodeJS.ErrnoException | null;
}

function createDisk(contents: string | null = null): Disk {
	const disk: Disk = {
		contents,
		writes: 0,
		failReadWith: null,
		fileSystem: {
			readFile: async (path: string) => {
				assert.equal(path, FILE);
				if (disk.failReadWith) throw disk.failReadWith;
				if (disk.contents === null) {
					const error = new Error('no such file') as NodeJS.ErrnoException;
					error.code = 'ENOENT';
					throw error;
				}
				return disk.contents;
			},
			writeFile: async (path: string, next: string) => {
				assert.equal(path, FILE);
				disk.contents = next;
				disk.writes += 1;
			},
		},
	};
	return disk;
}

interface Harness {
	readonly store: DesktopPluginQuarantine;
	readonly disk: Disk;
	clock: number;
}

function createStore(disk: Disk = createDisk(), startAt = 1_700_000_000_000): Harness {
	const harness = { disk, clock: startAt } as Harness;
	return Object.assign(harness, {
		store: new DesktopPluginQuarantine({
			filePath: FILE,
			fileSystem: disk.fileSystem,
			now: () => harness.clock,
		}),
	});
}

function quarantined(outcome: PluginFaultOutcome): Readonly<{ kind: string; scope: string; already: boolean }> {
	assert.equal(outcome.status, 'quarantined', JSON.stringify(outcome));
	if (outcome.status !== 'quarantined') throw new Error('unreachable');
	return { kind: outcome.record.kind, scope: outcome.record.scope, already: outcome.alreadyQuarantined };
}

function accrued(outcome: PluginFaultOutcome): number {
	assert.equal(outcome.status, 'accrued', JSON.stringify(outcome));
	if (outcome.status !== 'accrued') throw new Error('unreachable');
	return outcome.faults;
}

async function quarantineErrorCode(operation: () => unknown): Promise<string> {
	try {
		await operation();
	} catch (error) {
		assert.ok(error instanceof PluginQuarantineError, `expected a PluginQuarantineError, saw ${String(error)}`);
		return error.code;
	}
	throw new Error('the operation was expected to throw');
}

test('the durable state must be loaded before anything consults it', async () => {
	const { store } = createStore();
	assert.equal(store.snapshot().loaded, false);
	assert.equal(await quarantineErrorCode(() => store.isQuarantined(DIGEST_A)), 'not-loaded');
	assert.equal(await quarantineErrorCode(() => store.describe(DIGEST_A)), 'not-loaded');
	assert.equal(await quarantineErrorCode(() => store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' })),
		'not-loaded');
	assert.equal(await quarantineErrorCode(() => store.clear(DIGEST_A, 'rescan')), 'not-loaded');

	const load = await store.load();
	assert.deepEqual(load, { status: 'empty', digests: 0, dropped: 0, detail: '' });
	assert.equal(store.isQuarantined(DIGEST_A), false);
	assert.equal(store.snapshot().degraded, false);
});

test('a store still reading its file has not loaded yet', async () => {
	let openRead = (): void => undefined;
	const reading = new Promise<void>((resolve) => {
		openRead = () => {
			resolve();
		};
	});
	const disk = createDisk(JSON.stringify({
		schemaVersion: PLUGIN_QUARANTINE_SCHEMA_VERSION,
		quarantined: [{ digest: DIGEST_A, scope: 'scanner', kind: 'crash', quarantinedAt: 10 }],
		faults: [],
	}));
	const store = new DesktopPluginQuarantine({
		filePath: FILE,
		fileSystem: {
			readFile: async (path: string) => {
				await reading;
				return disk.fileSystem.readFile(path);
			},
			writeFile: disk.fileSystem.writeFile,
		},
		now: () => 1_700_000_000_000,
	});

	const loading = store.load();
	// The durable state is still on its way in, so nothing may be answered from
	// the empty map that is standing in for it — least of all a fault, which
	// would be written over the file this read has not finished yet.
	assert.equal(store.snapshot().loaded, false);
	assert.equal(await quarantineErrorCode(() => store.record({ digest: DIGEST_B, scope: 'scanner', kind: 'crash' })),
		'not-loaded');
	assert.equal(await quarantineErrorCode(() => store.isQuarantined(DIGEST_A)), 'not-loaded');
	assert.equal(disk.writes, 0, 'nothing may be written before the read that it would overwrite');

	openRead();
	assert.equal((await loading).status, 'loaded');
	assert.equal(store.isQuarantined(DIGEST_A), true);
	assert.equal(store.isQuarantined(DIGEST_B), false, 'the refused fault left no trace');
});

test('the quarantine keeps no more digests than it declares, and keeps the newest', async () => {
	const harness = createStore();
	await harness.store.load();
	for (let index = 0; index < MAXIMUM_QUARANTINED_DIGESTS; index += 1) {
		harness.clock += 1;
		await harness.store.record({ digest: digestFor(index), scope: 'scanner', kind: 'crash' });
	}
	assert.equal(harness.store.snapshot().records.length, MAXIMUM_QUARANTINED_DIGESTS);

	harness.clock += 1;
	const newest = digestFor(MAXIMUM_QUARANTINED_DIGESTS);
	const outcome = await harness.store.record({ digest: newest, scope: 'scanner', kind: 'crash' });
	assert.equal(outcome.status, 'quarantined');
	if (outcome.status !== 'quarantined') throw new Error('unreachable');
	assert.equal(harness.store.snapshot().records.length, MAXIMUM_QUARANTINED_DIGESTS, 'the declared ceiling holds');
	assert.equal(harness.store.isQuarantined(newest), true, 'the digest that just misbehaved is the one kept');
	assert.equal(outcome.evicted, digestFor(0), 'the oldest gave way, and the outcome says which');
	assert.equal(harness.store.isQuarantined(digestFor(0)), false);

	// What the running store holds is exactly what comes back, so nothing is
	// quarantined in memory and quietly forgotten by the next start.
	const restarted = createStore(harness.disk, harness.clock);
	const load = await restarted.store.load();
	assert.equal(load.digests, MAXIMUM_QUARANTINED_DIGESTS);
	assert.equal(load.dropped, 0);
	assert.equal(restarted.store.isQuarantined(newest), true);
});

test('a file above the ceiling keeps its most recent quarantines', async () => {
	const harness = createStore(createDisk(JSON.stringify({
		schemaVersion: PLUGIN_QUARANTINE_SCHEMA_VERSION,
		quarantined: Array.from({ length: MAXIMUM_QUARANTINED_DIGESTS + 2 }, (_unused, index) => ({
			digest: digestFor(index),
			scope: 'scanner',
			kind: 'crash',
			quarantinedAt: index + 1,
		})),
		faults: [],
	})));
	const load = await harness.store.load();
	assert.equal(load.digests, MAXIMUM_QUARANTINED_DIGESTS);
	assert.equal(load.dropped, 2);
	assert.equal(harness.store.isQuarantined(digestFor(MAXIMUM_QUARANTINED_DIGESTS + 1)), true);
	assert.equal(harness.store.isQuarantined(digestFor(0)), false, 'file order must never decide what survives');
});

test('host faults that aged out are not retained', async () => {
	const harness = createStore();
	await harness.store.load();
	for (const digest of [DIGEST_A, DIGEST_B, DIGEST_C]) {
		assert.equal(accrued(await harness.store.record({ digest, scope: 'host', kind: 'crash' })), 1);
	}
	assert.equal(harness.store.snapshot().pendingFaults, 3);

	harness.clock += PLUGIN_HOST_FAULT_WINDOW_MS + 1;
	// One entry per digest that ever faulted would be kept for the life of the
	// process otherwise, and the window has already discarded these three.
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_D, scope: 'host', kind: 'crash' })), 1);
	assert.equal(harness.store.snapshot().pendingFaults, 1);

	const writes = harness.disk.writes;
	assert.equal(await harness.store.clear(DIGEST_A, 'rescan'), false);
	assert.equal(harness.disk.writes, writes, 'a digest with nothing held has nothing to persist');
});

test('every scanner fault quarantines that digest immediately and durably', async () => {
	for (const kind of PLUGIN_FAULT_KINDS) {
		const harness = createStore();
		await harness.store.load();
		const outcome = quarantined(await harness.store.record({ digest: DIGEST_A, scope: 'scanner', kind }));
		assert.deepEqual(outcome, { kind, scope: 'scanner', already: false });
		assert.equal(harness.store.isQuarantined(DIGEST_A), true);
		assert.equal(harness.disk.writes, 1, 'the quarantine is written before it is reported');
		assert.equal(harness.store.isQuarantined(DIGEST_B), false, 'only the offending digest is quarantined');

		const repeat = quarantined(await harness.store.record({ digest: DIGEST_A, scope: 'scanner', kind }));
		assert.equal(repeat.already, true);
		assert.equal(harness.disk.writes, 1, 'a digest already quarantined is not rewritten');
	}
});

test('a host digest is quarantined only after two qualifying faults', async () => {
	const harness = createStore();
	await harness.store.load();
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' })), 1);
	assert.equal(harness.store.isQuarantined(DIGEST_A), false, 'one host fault may be a one-off');
	assert.equal(harness.disk.writes, 1, 'the accrued fault is durable too');

	harness.clock += 60_000;
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_B, scope: 'host', kind: 'hang' })), 1,
		'faults accrue per digest, never across binaries');
	const outcome = quarantined(await harness.store.record({ digest: DIGEST_A, scope: 'host', kind: 'hang' }));
	assert.deepEqual(outcome, { kind: 'hang', scope: 'host', already: false });
	assert.equal(harness.store.isQuarantined(DIGEST_B), false);
});

test('the ten-minute host window is exact at both of its edges', async () => {
	const inside = createStore();
	await inside.store.load();
	await inside.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' });
	inside.clock += PLUGIN_HOST_FAULT_WINDOW_MS - 1;
	quarantined(await inside.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' }));

	const outside = createStore();
	await outside.store.load();
	await outside.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' });
	outside.clock += PLUGIN_HOST_FAULT_WINDOW_MS;
	assert.equal(accrued(await outside.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' })), 1,
		'a fault exactly ten minutes old has aged out');
	assert.equal(outside.store.isQuarantined(DIGEST_A), false);

	outside.clock += 1;
	quarantined(await outside.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' }));
});

test('an identity change is immediate in the host scope as well', async () => {
	const harness = createStore();
	await harness.store.load();
	const outcome = quarantined(await harness.store.record({
		digest: DIGEST_A,
		scope: 'host',
		kind: 'identity-change',
	}));
	assert.deepEqual(outcome, { kind: 'identity-change', scope: 'host', already: false });
});

test('cancellation, device loss and shutdown are not faults', async () => {
	const harness = createStore();
	await harness.store.load();
	for (const scope of ['scanner', 'host'] as const) {
		for (const kind of PLUGIN_NON_FAULT_KINDS) {
			const outcome = await harness.store.record({ digest: DIGEST_A, scope, kind });
			assert.deepEqual(outcome, { status: 'ignored', reason: 'not-a-fault' }, `${scope}/${kind}`);
		}
	}
	assert.equal(harness.store.isQuarantined(DIGEST_A), false);
	assert.equal(harness.disk.writes, 0, 'an ordinary event writes nothing');

	// They do not accrue either: a real host fault afterwards is still the first.
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' })), 1);
});

test('quarantine and accrued host faults both survive a restart', async () => {
	const disk = createDisk();
	const first = createStore(disk);
	await first.store.load();
	await first.store.record({ digest: DIGEST_A, scope: 'scanner', kind: 'malformed-answer' });
	await first.store.record({ digest: DIGEST_B, scope: 'host', kind: 'crash' });

	const second = createStore(disk, first.clock + 1_000);
	const load = await second.store.load();
	assert.equal(load.status, 'loaded');
	assert.equal(load.digests, 1);
	assert.equal(load.dropped, 0);
	assert.equal(second.store.isQuarantined(DIGEST_A), true, 'quarantine outlives the process that recorded it');
	assert.equal(second.store.describe(DIGEST_A)?.kind, 'malformed-answer');
	assert.equal(second.store.describe(DIGEST_A)?.scope, 'scanner');
	// The single host fault came back with it, so a crash-restart-crash loop is
	// still two faults inside the window rather than two fresh first faults.
	quarantined(await second.store.record({ digest: DIGEST_B, scope: 'host', kind: 'crash' }));

	const third = createStore(disk, first.clock + PLUGIN_HOST_FAULT_WINDOW_MS + 1);
	await third.store.load();
	assert.equal(third.store.isQuarantined(DIGEST_A), true, 'time never clears a quarantine');
});

test('a host fault older than the window is not restored', async () => {
	const disk = createDisk();
	const first = createStore(disk);
	await first.store.load();
	await first.store.record({ digest: DIGEST_B, scope: 'host', kind: 'crash' });

	const later = createStore(disk, first.clock + PLUGIN_HOST_FAULT_WINDOW_MS);
	await later.store.load();
	assert.equal(accrued(await later.store.record({ digest: DIGEST_B, scope: 'host', kind: 'crash' })), 1);
});

test('quarantine is cleared only by an explicit rescan or re-enable', async () => {
	const harness = createStore();
	await harness.store.load();
	await harness.store.record({ digest: DIGEST_A, scope: 'scanner', kind: 'crash' });
	harness.clock += PLUGIN_HOST_FAULT_WINDOW_MS * 100;
	assert.equal(harness.store.isQuarantined(DIGEST_A), true, 'waiting is not a remedy');

	assert.equal(await quarantineErrorCode(() => harness.store.clear(DIGEST_A, 'expiry' as never)), 'unknown-event');
	assert.equal(await harness.store.clear(DIGEST_A, 'rescan'), true);
	assert.equal(harness.store.isQuarantined(DIGEST_A), false);
	assert.equal(await harness.store.clear(DIGEST_A, 're-enable'), false);

	const reloaded = createStore(harness.disk, harness.clock);
	await reloaded.store.load();
	assert.equal(reloaded.store.isQuarantined(DIGEST_A), false, 'the clearance is durable as well');
});

test('a re-enabled digest starts its fault history over', async () => {
	const harness = createStore();
	await harness.store.load();
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' })), 1);
	await harness.store.clear(DIGEST_A, 're-enable');
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_A, scope: 'host', kind: 'crash' })), 1,
		're-enabling must not leave the digest one fault from quarantine');
});

test('an untrustworthy file is reset and reported rather than silently believed', async () => {
	for (const [contents, note] of [
		['not json at all', 'unparseable'],
		[JSON.stringify({ schemaVersion: 99, quarantined: [] }), 'wrong schema'],
		[JSON.stringify(['quarantined']), 'not a record'],
		['x'.repeat(MAXIMUM_QUARANTINE_FILE_BYTES + 1), 'oversized'],
	] as const) {
		const harness = createStore(createDisk(contents));
		const load = await harness.store.load();
		assert.equal(load.status, 'reset', note);
		assert.equal(harness.store.snapshot().degraded, true, note);
		assert.notEqual(load.detail, '');
		// A degraded store still works, and its next write repairs the file.
		quarantined(await harness.store.record({ digest: DIGEST_A, scope: 'scanner', kind: 'crash' }));
		const repaired = createStore(harness.disk, harness.clock);
		assert.equal((await repaired.store.load()).status, 'loaded', note);
		assert.equal(repaired.store.isQuarantined(DIGEST_A), true, note);
	}
});

test('an unreadable file is a reset, and a missing one is an ordinary empty start', async () => {
	const disk = createDisk();
	disk.failReadWith = Object.assign(new Error('permission denied'), { code: 'EACCES' });
	const harness = createStore(disk);
	const load = await harness.store.load();
	assert.equal(load.status, 'reset');
	assert.equal(harness.store.snapshot().degraded, true);

	const missing = createStore();
	assert.equal((await missing.store.load()).status, 'empty');
	assert.equal(missing.store.snapshot().degraded, false);
});

test('unusable persisted entries are dropped and counted', async () => {
	const harness = createStore(createDisk(JSON.stringify({
		schemaVersion: PLUGIN_QUARANTINE_SCHEMA_VERSION,
		quarantined: [
			{ digest: DIGEST_A, scope: 'scanner', kind: 'crash', quarantinedAt: 10 },
			{ digest: 'nope', scope: 'scanner', kind: 'crash', quarantinedAt: 10 },
			{ digest: DIGEST_B, scope: 'sideways', kind: 'crash', quarantinedAt: 10 },
			{ digest: DIGEST_B, scope: 'host', kind: 'user-cancelled', quarantinedAt: 10 },
			{ digest: DIGEST_B, scope: 'host', kind: 'crash', quarantinedAt: -1 },
			'not a record',
		],
		faults: [{ digest: DIGEST_B, at: 'soon' }],
	})));
	const load = await harness.store.load();
	assert.equal(load.status, 'loaded');
	assert.equal(load.digests, 1);
	assert.equal(load.dropped, 6);
	assert.equal(harness.store.isQuarantined(DIGEST_A), true);
	assert.equal(harness.store.isQuarantined(DIGEST_B), false,
		'a malformed record must not quarantine a digest by accident');
	assert.equal(accrued(await harness.store.record({ digest: DIGEST_B, scope: 'host', kind: 'crash' })), 1);
});

test('the keys and events it accepts are a closed set', async () => {
	const harness = createStore();
	await harness.store.load();
	assert.equal(await quarantineErrorCode(() => harness.store.isQuarantined('short')), 'malformed-digest');
	assert.equal(await quarantineErrorCode(() => harness.store.isQuarantined(DIGEST_A.toUpperCase())),
		'malformed-digest');
	assert.equal(await quarantineErrorCode(() => harness.store.record({
		digest: DIGEST_A, scope: 'renderer' as never, kind: 'crash',
	})), 'unknown-event');
	assert.equal(await quarantineErrorCode(() => harness.store.record({
		digest: DIGEST_A, scope: 'host', kind: 'felt-wrong' as never,
	})), 'unknown-event');
	assert.equal(harness.disk.writes, 0);
});
