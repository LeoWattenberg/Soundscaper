/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { zipSync } from 'fflate';

test('the provisioner reinstalls verified cached readers with all network calls disabled', async context => {
	if (spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }).status !== 0) {
		context.skip('Python is unavailable.');
		return;
	}
	const root = await mkdtemp(join(tmpdir(), 'interchange-provision-cache-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'scripts/lib'), { recursive: true });
	await mkdir(join(root, 'config'));
	await Promise.all([
		copyFile(new URL('../scripts/provision-interchange-conformance.mjs', import.meta.url), join(root, 'scripts/provision-interchange-conformance.mjs')),
		copyFile(new URL('../scripts/lib/interchange-download-cache.mjs', import.meta.url), join(root, 'scripts/lib/interchange-download-cache.mjs')),
	]);
	const module = 'class Adapter:\n    def __init__(self, name): self.name = name\n'
		+ 'class Manifest:\n    adapters = [Adapter(name) for name in ["cmx_3600", "fcpx_xml", "otio_json"]]\n'
		+ 'class plugins:\n    ActiveManifest = Manifest\n';
	const bytes = Buffer.from(zipSync({ 'opentimelineio/__init__.py': Buffer.from(module) }));
	const filename = 'fixture_reader-1.0-py3-none-any.whl';
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	await writeFile(join(root, 'wheel.whl'), bytes);
	await writeFile(join(root, 'config/interchange-conformance-tools.json'), JSON.stringify({
		pythonMinimumVersion: '3.9', packages: [{ name: 'fixture-reader', version: '1.0', license: 'MIT', wheel: filename, sha256 }],
	}));
	await writeFile(join(root, 'release.json'), JSON.stringify({
		info: { name: 'fixture-reader', version: '1.0' },
		urls: [{ filename, url: `https://files.pythonhosted.org/${filename}`, digests: { sha256 } }],
	}));
	const preload = join(root, 'fetch.mjs');
	await writeFile(preload, `import { appendFileSync, readFileSync } from 'node:fs';
globalThis.fetch = async url => {
	if (process.env.SCAPE_TEST_BLOCK_NETWORK === '1') throw new Error('Unexpected warm-cache network request');
	appendFileSync(new URL('./network.log', import.meta.url), url + '\\n');
	return new Response(readFileSync(new URL(url.startsWith('https://pypi.org/') ? './release.json' : './wheel.whl', import.meta.url)));
};\n`);
	const script = join(root, 'scripts/provision-interchange-conformance.mjs');
	const invoke = env => execFileSync(process.execPath, ['--import', preload, script], {
		cwd: root, encoding: 'utf8', env: { ...process.env, SOUNDSCAPER_PYTHON: 'python3', ...env },
	});
	assert.match(invoke({}), /reference adapters ready/u);
	const before = await readFile(join(root, 'network.log'), 'utf8');
	assert.equal(before.trim().split('\n').length, 2);
	const installed = join(root, 'vendor/interchange-conformance');
	await writeFile(join(installed, 'unowned.txt'), 'old installed tree');
	await writeFile(join(installed, 'opentimelineio/__init__.py'), 'raise RuntimeError("damaged installed tree")\n');
	assert.match(invoke({ SCAPE_TEST_BLOCK_NETWORK: '1' }), /reference adapters ready/u);
	assert.equal(await readFile(join(root, 'network.log'), 'utf8'), before);
	await assert.rejects(readFile(join(installed, 'unowned.txt')), { code: 'ENOENT' });
	assert.equal(await readFile(join(installed, 'opentimelineio/__init__.py'), 'utf8'), module);
});
