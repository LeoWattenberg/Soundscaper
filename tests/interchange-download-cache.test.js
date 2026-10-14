/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cachedInterchangeWheel, interchangeCacheIdentity } from '../scripts/lib/interchange-download-cache.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('authenticated wheel');
const entry = { name: 'example', version: '1.0', wheel: 'example-1.0-py3-none-any.whl', sha256: digest(bytes) };
const identity = interchangeCacheIdentity({ packages: [entry] }, 'cpython-3.12-linux', ['py3-none-any']);

async function fixture(context) {
	const cacheRoot = await mkdtemp(join(tmpdir(), 'interchange-wheel-cache-'));
	context.after(() => rm(cacheRoot, { recursive: true, force: true }));
	const calls = [];
	const options = {
		cacheRoot, cacheIdentity: identity,
		release: async (name, version) => {
			calls.push('metadata');
			return { info: { name, version }, urls: [{
				filename: entry.wheel, url: `https://files.pythonhosted.org/${entry.wheel}`,
				digests: { sha256: digest(bytes) },
			}] };
		},
		download: async () => { calls.push('wheel'); return bytes; },
		selectPlatformWheel: files => files[0],
	};
	return { cacheRoot, calls, options };
}

test('a warm interchange cache authenticates wheels without metadata or wheel network calls', async context => {
	const { calls, options } = await fixture(context);
	assert.deepEqual((await cachedInterchangeWheel(entry, options)).bytes, bytes);
	assert.deepEqual((await cachedInterchangeWheel(entry, options)).bytes, bytes);
	assert.deepEqual(calls, ['metadata', 'wheel']);
});

test('interchange cache identities bind versions, pinned digests, ABI and supported wheel tags', () => {
	const key = (config = { packages: [entry] }, abi = 'cpython-3.12-linux', tags = ['py3-none-any']) =>
		interchangeCacheIdentity(config, abi, tags);
	assert.equal(key(), identity);
	assert.notEqual(key({ packages: [{ ...entry, version: '2.0' }] }), identity);
	assert.notEqual(key({ packages: [{ ...entry, sha256: 'a'.repeat(64) }] }), identity);
	assert.notEqual(key(undefined, 'cpython-3.13-linux'), identity);
	assert.notEqual(key(undefined, undefined, ['cp312-linux-x64']), identity);
	assert.equal(key(undefined, undefined, ['py3-none-any', 'cp312-linux-x64']),
		key(undefined, undefined, ['cp312-linux-x64', 'py3-none-any']));
});

test('damaged metadata is refreshed while an independently pinned wheel remains reusable', async context => {
	const { cacheRoot, calls, options } = await fixture(context);
	await cachedInterchangeWheel(entry, options);
	const directory = join(cacheRoot, identity);
	const metadata = (await readdir(directory)).find(name => name.endsWith('.json'));
	await writeFile(join(directory, metadata), '{truncated');
	assert.deepEqual((await cachedInterchangeWheel(entry, options)).bytes, bytes);
	assert.deepEqual(calls, ['metadata', 'wheel', 'metadata']);
});

test('a corrupted wheel is downloaded again and invalid replacement bytes fail closed', async context => {
	const { cacheRoot, calls, options } = await fixture(context);
	await cachedInterchangeWheel(entry, options);
	const wheel = join(cacheRoot, identity, `${entry.sha256}.whl`);
	await writeFile(wheel, 'corrupted');
	assert.deepEqual((await cachedInterchangeWheel(entry, options)).bytes, bytes);
	assert.deepEqual(calls, ['metadata', 'wheel', 'wheel']);
	await writeFile(wheel, 'corrupted again');
	await assert.rejects(cachedInterchangeWheel(entry, {
		...options, download: async () => Buffer.from('bad replacement'),
	}), /integrity check/u);
	assert.deepEqual((await cachedInterchangeWheel(entry, options)).bytes, bytes);
});

test('platform wheels retain their published digest and selection is reapplied to cached metadata', async context => {
	const { calls, options } = await fixture(context);
	let selections = 0;
	const platform = { ...entry, wheel: 'platform', sha256: null };
	const selected = { ...options, selectPlatformWheel: files => { selections += 1; return files[0]; } };
	assert.deepEqual((await cachedInterchangeWheel(platform, selected)).bytes, bytes);
	assert.deepEqual((await cachedInterchangeWheel(platform, selected)).bytes, bytes);
	assert.equal(selections, 2);
	assert.deepEqual(calls, ['metadata', 'wheel']);
});

test('cached symbolic wheel entries are replaced without changing their external target', async context => {
	const { cacheRoot, options } = await fixture(context);
	const directory = join(cacheRoot, identity);
	await mkdir(directory);
	const outside = join(cacheRoot, 'outside');
	await writeFile(outside, 'unowned bytes');
	await symlink(outside, join(directory, `${entry.sha256}.whl`));
	assert.deepEqual((await cachedInterchangeWheel(entry, options)).bytes, bytes);
	assert.equal(await readFile(outside, 'utf8'), 'unowned bytes');
});
