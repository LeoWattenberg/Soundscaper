/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { normalizeDesktopReleaseArtifacts } from '../scripts/lib/desktop-release-artifact-names.mjs';

test('packaging normalizes Linux download architecture names without changing package bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'release-artifact-names-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const names = ['Soundscaper-1.0.0-linux-x86_64.AppImage', 'Soundscaper-1.0.0-linux-amd64.deb',
		'Framescaper-1.0.0-linux-aarch64.AppImage', 'Framescaper-1.0.0-linux-arm64.deb',
		'Soundscaper-1.0.0-win-x64.exe', 'Soundscaper-1.0.0-mac-arm64.dmg'];
	for (const name of names) await writeFile(join(root, name), `package bytes: ${name}`);
	const paths = await normalizeDesktopReleaseArtifacts(names.map((name) => join(root, name)));
	assert.deepEqual(paths.map((path) => basename(path)), names.map((name) =>
		name.replace('x86_64', 'x64').replace('amd64', 'x64').replace('aarch64', 'arm64')));
	for (const [index, path] of paths.entries()) assert.equal(await readFile(path, 'utf8'), `package bytes: ${names[index]}`);
});

test('artifact normalization refuses to overwrite an existing canonical download', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'release-artifact-collision-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'packages'));
	const original = join(root, 'packages', 'Soundscaper-1.0.0-linux-amd64.deb');
	const canonical = original.replace('amd64', 'x64');
	await writeFile(original, 'new package');
	await writeFile(canonical, 'existing package');
	await assert.rejects(normalizeDesktopReleaseArtifacts([original]), /EEXIST/u);
	assert.equal(await readFile(original, 'utf8'), 'new package');
	assert.equal(await readFile(canonical, 'utf8'), 'existing package');
});
