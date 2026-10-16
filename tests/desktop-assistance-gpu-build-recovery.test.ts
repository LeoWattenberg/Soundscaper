/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSherpaGpuBuildWorkDirectory } from '../scripts/lib/desktop-assistance-sherpa-gpu-runtime.mjs';
import { prepareSherpaGpuSources } from '../scripts/lib/desktop-assistance-sherpa-gpu-sources.mjs';
import { stageFrozenKokoroG2pGpu } from '../scripts/lib/desktop-kokoro-g2p-gpu.mjs';

const pin = (path: string, bytes: Buffer) => ({ path, byteLength: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex') });

test('Windows Sherpa builds keep MSBuild tracking logs below MAX_PATH with a deep cache', async context => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-path-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const cacheRoot = join(root, 'repository-cache'.repeat(8));
	await mkdir(cacheRoot);
	const first = await createSherpaGpuBuildWorkDirectory({ cacheRoot, platform: 'win32' });
	const second = await createSherpaGpuBuildWorkDirectory({ cacheRoot, platform: 'win32' });
	context.after(() => Promise.all([first, second].map(path => rm(path, { recursive: true, force: true }))));
	assert.notEqual(first, second, 'concurrent target builds need exclusive workspaces');
	assert.ok(!first.startsWith(cacheRoot));
	const log = join(first, 'compiled/_deps/simple-sentencepiece-build/ssentencepiece/csrc/'
		+ 'ssentencepiece_core.dir/Release/ssentenc.76D5AA10.tlog/Lib-link.write.1.tlog');
	assert.ok(log.length < 260, log);
	const linux = await createSherpaGpuBuildWorkDirectory({ cacheRoot, platform: 'linux' });
	assert.ok(linux.startsWith(cacheRoot));
});

for (const status of [406, 429, 503]) test(`Sherpa retries HTTP ${status} and authenticates before caching`, async context => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-download-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Buffer.from('pinned Eigen source archive');
	const source = { ...pin('eigen', bytes), id: 'eigen', url: 'https://gitlab.com/fixture.tar.gz' };
	let requests = 0;
	const fetchImpl = () => Promise.resolve(++requests === 1
		? new Response('temporarily unavailable', { status }) : new Response(bytes));
	const options = { recipe: { sources: [source] }, cacheRoot: root,
		work: join(root, 'work'), targetId: 'linux-x64', fetchImpl };
	const result = await prepareSherpaGpuSources(options);
	assert.equal(requests, 2);
	const cached = join(root, 'sherpa-gpu-sources', source.sha256);
	assert.deepEqual(result.downloads, { eigen: cached });
	assert.deepEqual(await readFile(cached), bytes);
	await prepareSherpaGpuSources(options);
	assert.equal(requests, 2, 'a verified cached download needs no network');
});

test('Sherpa download retries stay bounded and never retry corrupt bytes or HTTP 403', async context => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-download-refusal-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const source = { ...pin('eigen', Buffer.from('abc')), id: 'eigen', url: 'https://gitlab.com/fixture.tar.gz' };
	for (const [status, body, expected, attempts] of [
		[406, 'unavailable', /406/u, 3], [403, 'forbidden', /403/u, 1], [200, 'abd', /digest/u, 1],
	] as const) {
		let requests = 0;
		await assert.rejects(prepareSherpaGpuSources({ recipe: { sources: [source] }, cacheRoot: root,
			work: join(root, 'work'), targetId: 'linux-x64', fetchImpl: () => {
				requests += 1;
				return Promise.resolve(new Response(body, { status }));
			} }), expected);
		assert.equal(requests, attempts);
		assert.deepEqual(await readdir(join(root, 'sherpa-gpu-sources')), []);
	}
});

test('Kokoro stages its authenticated native closure after freezing without rewriting bytes or modes', async context => {
	const root = await mkdtemp(join(tmpdir(), 'g2p-freeze-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sourceRoot = join(root, 'gpu');
	const frozenRoot = join(root, 'scape-gpu');
	await mkdir(sourceRoot);
	const bytes = Buffer.from('signed native library');
	const probe = Buffer.from('authenticated executable');
	const files = [pin('libnative.dylib', bytes), { ...pin('probe', probe), executable: true }];
	await writeFile(join(sourceRoot, files[0]!.path), bytes);
	await writeFile(join(sourceRoot, 'probe'), probe);
	await chmod(join(sourceRoot, 'probe'), 0o755);
	await stageFrozenKokoroG2pGpu(sourceRoot, frozenRoot, files);
	assert.deepEqual(await readFile(join(frozenRoot, files[0]!.path)), bytes);
	if (process.platform !== 'win32') assert.equal((await stat(join(frozenRoot, 'probe'))).mode & 0o777, 0o755);
	await assert.rejects(stageFrozenKokoroG2pGpu(sourceRoot, frozenRoot, files), /EEXIST/u);
	await writeFile(join(sourceRoot, files[0]!.path), 'replaced native bytes');
	await assert.rejects(stageFrozenKokoroG2pGpu(sourceRoot, join(root, 'corrupt'), files), /authenticated/u);
});
