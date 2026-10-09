/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { KeyValueEntry } from '../src/common/editor/storage/key-value-repository.ts';
import test from 'node:test';
import { capturePhotoDevelopPresetsArchiveV1 } from '../src/lightscaper/storage/photo-develop-presets-archive-v1.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function entry(value: unknown): KeyValueEntry { return value === undefined ? { present: false } : { present: true, value }; }

function row(name = 'Evening 界', revision = 37, partial = false) {
	return normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision,
		presets: [createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset', name,
			settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(),
				selection: { effectTypes: partial ? ['tone-ladder-v1'] : 'all', geometry: !partial, localAdjustments: !partial } }) })] }, 'catalog');
}

test('archive capture distinguishes physical absence from a retained empty positive revision', async () => {
	for (const expected of [undefined, { ...row(), revision: 91, presets: [] }, row()]) {
		const keys: string[] = [];
		const captured = await capturePhotoDevelopPresetsArchiveV1({ async readEntry(key) { keys.push(key); return entry(expected); } }, 'catalog');
		assert.deepEqual(captured.row, expected ?? null); await captured.verify();
		assert.deepEqual(keys, [photoDevelopPresetsKeyV1('catalog'), photoDevelopPresetsKeyV1('catalog')]);
	}
});

for (const drift of ['revision', 'name', 'selection', 'presence', 'removal'] as const) {
	test(`complete preset capture fences ${drift} drift independently of unchanged catalog revisions`, async () => {
		let actual: unknown = drift === 'presence' ? undefined : row();
		const captured = await capturePhotoDevelopPresetsArchiveV1({ readEntry: async () => entry(actual) }, 'catalog');
		actual = drift === 'presence' ? row() : drift === 'removal' ? undefined
			: drift === 'revision' ? row('Evening 界', 38) : drift === 'name' ? row('Changed without a revision') : row('Evening 界', 37, true);
		await assert.rejects(captured.verify(), { code: 'DEVELOP_PRESET_REVISION_CONFLICT' });
	});
}

test('capture detaches its row and pins the borrowed readEntry method and receiver before later replacements', async () => {
	const raw = structuredClone(row()), expected = structuredClone(raw);
	let actual: unknown = raw, calls = 0;
	const repository = { async readEntry() { assert.equal(this, repository); calls++; return entry(actual); } };
	const captured = await capturePhotoDevelopPresetsArchiveV1(repository, 'catalog');
	Reflect.set(raw.presets[0]!.identity, 'name', 'Changed by owner');
	assert.deepEqual(captured.row, expected); actual = expected;
	repository.readEntry = async () => { assert.fail('A later callback replacement must not run'); };
	await captured.verify(); assert.equal(calls, 2);
});

test('malformed, foreign, future, duplicate and accessor rows refuse closed admission', async () => {
	const valid = row(); let accessors = 0;
	for (const value of [null, { ...valid, catalogId: 'foreign' }, { ...valid, schemaVersion: 2 },
		{ ...valid, presets: [valid.presets[0], valid.presets[0]] },
		Object.defineProperty({ ...valid }, 'presets', { get() { accessors++; return []; } })]) {
		await assert.rejects(capturePhotoDevelopPresetsArchiveV1({ readEntry: async () => entry(value) }, 'catalog'));
	}
	assert.equal(accessors, 0);
});

for (const phase of ['capture', 'verify'] as const) test(`held ${phase} cancellation joins its read and preserves an opaque native reason`, async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let calls = 0, inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque read'); }, getPrototypeOf() { inspections++; throw new Error('Opaque prototype'); } });
	const repository = { async readEntry() { calls++; if (calls === (phase === 'capture' ? 1 : 2)) { entered.resolve(); await release.promise; } return entry(row()); } };
	let captured: Awaited<ReturnType<typeof capturePhotoDevelopPresetsArchiveV1>> | undefined;
	if (phase === 'verify') captured = await capturePhotoDevelopPresetsArchiveV1(repository, 'catalog', { signal: stop.signal });
	const work = captured ? captured.verify() : capturePhotoDevelopPresetsArchiveV1(repository, 'catalog', { signal: stop.signal });
	let failure: unknown; const joined = work.catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(joined), true);
		release.resolve(); await joined; assert.equal(failure, reason); assert.equal(inspections, 0);
	} finally { release.resolve(); await joined; }
});
