/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { resolveDesktopAssistanceHandoffRevision } from '../scripts/desktop-prepare.mjs';
import {
	createDesktopTestRuntimeSnapshot,
	DESKTOP_TEST_RUNTIME_TARGETS,
	stageDesktopTestRuntimeSnapshot,
} from '../scripts/lib/desktop-test-assistance-runtime-snapshots.mjs';

const TARGET = 'linux-x64';
const REVISION = 'a'.repeat(40);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const CONFIG_FILES = [
	'assistance-runtime-distribution.json',
	'assistance-native-runtime-manifest.json',
	'assistance-runtime-family-supply-candidates.json',
	'assistance-kokoro-g2p-runtime-manifest.json',
];

test('the pinned snapshot stages exact handoff bytes without building runtimes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-test-runtime-snapshot-'));
	try {
		const handoffRoot = join(root, 'source');
		await mkdir(join(handoffRoot, 'config'), { recursive: true });
		const handoff = `${JSON.stringify({ schemaVersion: 1, sourceRevision: REVISION, targetId: TARGET })}\n`;
		await writeFile(join(handoffRoot, 'handoff.json'), handoff);
	for (const [index, name] of CONFIG_FILES.entries()) {
		const value = name === 'assistance-runtime-distribution.json'
			? { schemaVersion: 1, targetId: TARGET, bundles: Array(5).fill({}) }
			: { targetId: TARGET, index };
		await writeFile(join(handoffRoot, 'config', name), `${JSON.stringify(value)}\n`);
		}
		const archive = await createDesktopTestRuntimeSnapshot({ handoffRoot, targetId: TARGET });
		const snapshotRoot = join(root, 'snapshots');
		await mkdir(snapshotRoot);
		await writeFile(join(snapshotRoot, `${TARGET}.json.gz`), archive);
		const lock = { schemaVersion: 1, targets: { [TARGET]: {
			sourceRevision: REVISION, byteLength: archive.byteLength, sha256: sha256(archive),
		} } };
		const outputRoot = join(root, 'staged');
		const staged = await stageDesktopTestRuntimeSnapshot({
			targetId: TARGET, snapshotRoot, outputRoot, lock,
		});
		assert.equal(staged.sourceRevision, REVISION);
		assert.equal(await readFile(join(outputRoot, 'handoff.json'), 'utf8'), handoff);
		for (const name of CONFIG_FILES) {
			assert.deepEqual(await readFile(join(outputRoot, 'config', name)),
				await readFile(join(handoffRoot, 'config', name)));
		}
		await assert.rejects(() => stageDesktopTestRuntimeSnapshot({
			targetId: TARGET, snapshotRoot, outputRoot,
			lock: { ...lock, targets: { [TARGET]: { ...lock.targets[TARGET], sha256: '0'.repeat(64) } } },
		}), /digest/u);
		await assert.rejects(() => stageDesktopTestRuntimeSnapshot({
			targetId: 'win-x64', snapshotRoot, outputRoot, lock,
		}), /target/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('only diagnostic snapshot mode can use an older runtime handoff revision', () => {
	const current = 'b'.repeat(40);
	assert.equal(resolveDesktopAssistanceHandoffRevision(current, {}), current);
	assert.equal(resolveDesktopAssistanceHandoffRevision(current, {
		SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT: 'true',
		SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT_SOURCE_REVISION: REVISION,
	}), REVISION);
	assert.throws(() => resolveDesktopAssistanceHandoffRevision(current, {
		SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT: 'true',
	}), /pinned source revision/u);
});

test('every committed desktop test target has a valid pinned runtime handoff', async () => {
	const root = resolve(import.meta.dirname, '..');
	const lock = JSON.parse(await readFile(join(root, 'config/desktop-test-assistance-runtime-snapshots.json'), 'utf8'));
	const output = await mkdtemp(join(tmpdir(), 'desktop-test-pinned-runtime-'));
	try {
		for (const targetId of DESKTOP_TEST_RUNTIME_TARGETS) {
			const staged = await stageDesktopTestRuntimeSnapshot({
				targetId, lock,
				snapshotRoot: join(root, 'config/desktop-test-assistance-runtime-snapshots'),
				outputRoot: join(output, targetId),
			});
			assert.equal(staged.sourceRevision, lock.targets[targetId].sourceRevision);
		}
	} finally {
		await rm(output, { recursive: true, force: true });
	}
});
