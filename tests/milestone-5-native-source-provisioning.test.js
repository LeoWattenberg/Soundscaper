/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { MILESTONE_5_NATIVE_SOURCE_IDS } from '../scripts/lib/milestone-5-native-source-acquisitions.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const provisioner = resolve(repositoryRoot, 'scripts/provision-milestone-5-native-sources.mjs');

/**
 * These run offline. The provisioner's network path is exercised by actually
 * provisioning a cache; what has to hold on every machine is that it never
 * reports a cache as authenticated unless the auditor would, and never leaves
 * unauthenticated bytes behind where the auditor would later read them.
 */
function provision(args) {
	try {
		return {
			status: 0,
			output: execFileSync(process.execPath, [provisioner, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
		};
	} catch (error) {
		return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
	}
}

test('an absent cache is reported as absent for every registered source and fails closed', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'm5-provision-absent-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const { status, output } = provision(['--check', '--root', join(root, 'cache')]);
	assert.equal(status, 1, 'an unprovisioned cache is never a success');
	for (const id of MILESTONE_5_NATIVE_SOURCE_IDS) assert.match(output, new RegExp(`absent\\s+${id}\\b`, 'u'));
	assert.match(output, /0\/10 exact archive\/extracted-tree inputs authenticated/u);
});

test('an archive that does not match its pin provisions nothing', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'm5-provision-forged-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const archives = join(root, 'archives');
	mkdirSync(archives);
	// Named exactly as the pinned LV2 archive, so only the digest can refuse it.
	writeFileSync(join(archives, 'lv2-1.18.10.tar.gz'), Buffer.from('not the pinned archive\n'));
	const cache = join(root, 'cache');
	const { status, output } = provision([
		'--source', 'lv2', '--archive-directory', archives, '--root', cache,
	]);
	assert.equal(status, 1);
	assert.match(output, /failed\s+lv2\s+archive drifted from its pin/u);
	assert.equal(existsSync(join(cache, 'lv2')), false, 'a refused archive leaves no cache entry');
	assert.deepEqual(readdirSync(cache), [], 'no staging directory survives a refused source');
});

test('a cache entry holding anything but its exact pair is reported as drifted', async (context) => {
	// The auditor throws outright on such an entry, so the provisioner has to
	// recognise it as drift rather than hand it on as authenticated — which is
	// how a download artefact left beside the archive first went unnoticed.
	const root = await mkdtemp(join(tmpdir(), 'm5-provision-stray-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const entry = join(root, 'cache', 'lv2');
	mkdirSync(join(entry, 'source'), { recursive: true });
	writeFileSync(join(entry, 'lv2-1.18.10.tar.gz'), Buffer.from('archive\n'));
	writeFileSync(join(entry, 'download'), Buffer.from('leftover\n'));
	const { status, output } = provision(['--check', '--source', 'lv2', '--root', join(root, 'cache')]);
	assert.equal(status, 1);
	assert.match(output, /drifted\s+lv2\s+the cache entry is not the exact archive\/source pair/u);
});

test('an unknown source or a flag without its value is refused before anything is written', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'm5-provision-arguments-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const [args, expected] of [
		[['--source', 'not-a-source'], /Unknown Milestone 5 source not-a-source/u],
		[['--source'], /--source requires a value/u],
		[['--nonsense'], /Unknown argument --nonsense/u],
	]) {
		const { status, output } = provision([...args, '--check', '--root', join(root, 'cache')]);
		assert.notEqual(status, 0);
		assert.match(output, expected);
	}
	assert.equal(existsSync(join(root, 'cache')), false);
});
