/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { unzipSync, zipSync } from 'fflate';

import { stageDesktopReleaseSources } from '../scripts/lib/desktop-release-sources.mjs';

const execute = promisify(execFile);

test('one reproducible sources.zip preserves the exact application, codec, and SDK inputs', async (context) => {
	const fixture = await sourceFixture(context);
	const result = await stageDesktopReleaseSources(fixture.options);
	const bytes = await readFile(join(fixture.options.outputRoot, 'sources.zip'));
	assert.deepEqual(result, { name: 'sources.zip', ...descriptor(bytes) });
	const entries = unzipSync(bytes);
	assert.deepEqual(Buffer.from(entries['sdk/clap/clap.tar.gz']), fixture.sdkBytes);
	assert.deepEqual(Buffer.from(entries['bundled-codecs/codecs.zip']), fixture.codecBytes);
	const application = unzipSync(entries['application.zip']);
	assert.equal(Buffer.from(application['application/source.txt']).toString(), 'committed application source');
	assert.equal(Object.hasOwn(application, 'application/untracked.txt'), false);
	const manifest = JSON.parse(Buffer.from(entries['SOURCE_MANIFEST.json']).toString());
	assert.equal(manifest.sourceRevision, fixture.options.sourceRevision);
	assert.deepEqual(manifest.files.map(({ path }) => path),
		['application.zip', 'bundled-codecs/codecs.zip', 'sdk/clap/clap.tar.gz']);
	for (const file of manifest.files) assert.deepEqual(descriptor(entries[file.path]),
		{ byteLength: file.byteLength, sha256: file.sha256 });
	const secondOutput = join(fixture.root, 'second-output');
	await mkdir(secondOutput);
	await stageDesktopReleaseSources({
		...fixture.options, outputRoot: secondOutput, inputs: [...fixture.options.inputs].reverse(),
	});
	assert.deepEqual(await readFile(join(secondOutput, 'sources.zip')), bytes);
});

test('source bundling refuses altered, symbolic, conflicting, or unsafe input archives', async (context) => {
	for (const failure of ['altered', 'symbolic', 'conflicting', 'unsafe']) {
		const fixture = await sourceFixture(context);
		const input = fixture.options.inputs[0];
		const path = join(fixture.options.sourceInputsRoot, input.name);
		if (failure === 'altered') await writeFile(path, 'changed source');
		else if (failure === 'symbolic') {
			await rm(path);
			await symlink(join(fixture.root, 'source.txt'), path);
		} else if (failure === 'conflicting') fixture.options.inputs[1].bundlePath = input.bundlePath;
		else input.bundlePath = '../escape.tar.gz';
		await assert.rejects(stageDesktopReleaseSources(fixture.options), /source.*(digest|bytes|regular|conflict|path)/iu, failure);
		await assert.rejects(readFile(join(fixture.options.outputRoot, 'sources.zip')), { code: 'ENOENT' });
	}
});

async function sourceFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-release-sources-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await execute('git', ['init', '--quiet'], { cwd: root });
	await writeFile(join(root, 'source.txt'), 'committed application source');
	await execute('git', ['add', 'source.txt'], { cwd: root });
	await execute('git', ['-c', 'user.name=Source Test', '-c', 'user.email=source@example.test',
		'commit', '--quiet', '-m', 'Source fixture'], { cwd: root });
	const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
	await writeFile(join(root, 'source.txt'), 'uncommitted change');
	await writeFile(join(root, 'untracked.txt'), 'not release source');
	const sourceInputsRoot = join(root, 'inputs');
	const outputRoot = join(root, 'output');
	await Promise.all([mkdir(sourceInputsRoot), mkdir(outputRoot)]);
	const sdkBytes = Buffer.from('authenticated SDK archive');
	const codecBytes = Buffer.from(zipSync({ 'codec/source.c': Buffer.from('codec source') }));
	await writeFile(join(sourceInputsRoot, 'clap.tar.gz'), sdkBytes);
	await writeFile(join(sourceInputsRoot, 'codecs.zip'), codecBytes);
	const sdk = { name: 'clap.tar.gz', bundlePath: 'sdk/clap/clap.tar.gz', ...descriptor(sdkBytes) };
	return { root, sdkBytes, codecBytes, options: {
		repositoryRoot: root, sourceRevision: stdout.trim(), sourceInputsRoot, outputRoot,
		inputs: [sdk, { name: 'codecs.zip', bundlePath: 'bundled-codecs/codecs.zip', ...descriptor(codecBytes) }, { ...sdk }],
	} };
}

function descriptor(bytes) {
	return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
