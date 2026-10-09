/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { finalizeDesktopReleaseAssets } from '../scripts/lib/desktop-release-evidence.mjs';

test('runtime manifests stay in CI and one SHA256SUMS covers all public downloads including Flatpak', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'desktop-release-evidence-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const assetRoot = join(root, 'desktop');
	const evidenceRoot = join(root, 'desktop-ci');
	await mkdir(assetRoot);
	const evidenceNames = ['runtime-manifest-soundscaper-linux-x64.json', 'Soundscaper-professional-native-compliance.json'];
	const publicNames = ['Soundscaper-1.0.0-linux-x64.AppImage', 'Soundscaper-1.0.0-linux-x64.deb',
		'Soundscaper-1.0.0-linux-x64.flatpak', 'Soundscaper-1.0.0-linux-arm64.flatpak',
		'sources.zip', 'THIRD_PARTY_LICENSES.md'];
	for (const name of [...evidenceNames, ...publicNames]) await writeFile(join(assetRoot, name), `content: ${name}`);
	await finalizeDesktopReleaseAssets({ assetRoot, evidenceRoot, evidenceNames });
	assert.deepEqual((await readdir(assetRoot)).sort(), [...publicNames, 'SHA256SUMS'].sort());
	assert.deepEqual((await readdir(evidenceRoot)).sort(), [...evidenceNames].sort());
	const expected = [...publicNames].sort().map((name) =>
		`${createHash('sha256').update(`content: ${name}`).digest('hex')}  ${name}\n`).join('');
	assert.equal(await readFile(join(assetRoot, 'SHA256SUMS'), 'utf8'), expected);
	for (const name of evidenceNames) assert.equal(await readFile(join(evidenceRoot, name), 'utf8'), `content: ${name}`);
});

test('release finalization refuses a CI directory inside the public asset directory', async () => {
	await assert.rejects(finalizeDesktopReleaseAssets({
		assetRoot: '/tmp/release-assets', evidenceRoot: '/tmp/release-assets/ci', evidenceNames: [],
	}), /outside.*release/iu);
});
