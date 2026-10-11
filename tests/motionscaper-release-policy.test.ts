/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readProductReleaseLinesSync } from '../scripts/lib/product-release-lines.mjs';
import { admitMotionRelease, bindMotionReleaseSource, motionReleaseVersionChannel, verifyMotionRelease } from '../scripts/lib/motionscaper-release-policy.ts';

test('Motion release defaults to its active candidate and requires an explicitly selected active stable channel', () => {
	const lines = readProductReleaseLinesSync();
	assert.equal(admitMotionRelease({ lines, tag: 'motionscaper-v0.1.0-alpha.1' }).channel, 'candidate');
	assert.throws(() => admitMotionRelease({ lines, tag: 'motionscaper-v1.0.0', expectedChannel: 'stable' }), /not active/u);
	const stable = structuredClone(lines);
	stable.products.motionscaper.applicationVersionChannel = 'stable';
	stable.products.motionscaper.releaseChannel = 'stable';
	assert.deepEqual(admitMotionRelease({ lines: stable, tag: 'motionscaper-v1.0.0', expectedChannel: 'stable' }), {
		productId: 'motionscaper', tag: 'motionscaper-v1.0.0', channel: 'stable', version: '1.0.0',
	});
	assert.throws(() => admitMotionRelease({ lines: stable, tag: 'motionscaper-v1.0.0' }), /expected candidate/u);
	for (const tag of ['v1.0.0', 'framescaper-v1.0.0-rc.13', 'motionscaper-v1.0.1', 'motionscaper-v0.1.0-alpha.1']) {
		assert.throws(() => admitMotionRelease({ lines: stable, tag, expectedChannel: 'stable' }));
	}
	assert.throws(() => admitMotionRelease({ lines, tag: 'motionscaper-v0.1.0-alpha.1', expectedChannel: 'nightly' }), /channel/u);
});

test('Motion tagged source refuses staged, unstaged and untracked changes while permitting ignored build outputs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-release-git-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
	try {
		git('init'); git('config', 'user.name', 'Motion fixture'); git('config', 'user.email', 'fixture@example.invalid');
		await mkdir(join(root, 'config')); await writeFile(join(root, 'config/product-release-lines.json'), JSON.stringify(readProductReleaseLinesSync()));
		await writeFile(join(root, '.gitignore'), 'dist/\nrelease/\n'); await writeFile(join(root, 'source.ts'), 'export const original = true;\n');
		git('add', '.'); git('commit', '-m', 'fixture'); git('tag', 'motionscaper-v0.1.0-alpha.1');
		const sourceRevision = git('rev-parse', 'HEAD'); const options = { root, tag: 'motionscaper-v0.1.0-alpha.1', sourceRevision };
		assert.equal(verifyMotionRelease(options).sourceRevision, sourceRevision);
		await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist/generated.js'), '// ignored');
		assert.equal(verifyMotionRelease(options).sourceRevision, sourceRevision);
		await writeFile(join(root, 'untracked.ts'), '// must not ship'); assert.throws(() => verifyMotionRelease(options), /clean/u); await rm(join(root, 'untracked.ts'));
		await writeFile(join(root, 'source.ts'), '// changed'); assert.throws(() => verifyMotionRelease(options), /clean/u);
		git('add', 'source.ts'); assert.throws(() => verifyMotionRelease(options), /clean/u);
		git('commit', '-m', 'different source'); assert.throws(() => verifyMotionRelease(options), /source revision/u);
		git('tag', '-f', options.tag); assert.throws(() => verifyMotionRelease(options), /source revision/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Motion package versions admit canonical stable and candidate versions only', () => {
	assert.equal(motionReleaseVersionChannel('1.0.0'), 'stable');
	assert.equal(motionReleaseVersionChannel('0.1.0-alpha.1'), 'candidate');
	assert.equal(motionReleaseVersionChannel('1.0.0-rc.Oct.10.a'), 'candidate');
	for (const version of ['01.0.0', '1.0.0-alpha.01', '1.0.0-alphaX1', '1.0.0-alpha.1_foo', '1.0.0+foreign', '1.0', '1.0.0-preview.1', '../1.0.0', '1.0.0\n']) {
		assert.throws(() => motionReleaseVersionChannel(version), /version/u);
	}
});

test('Motion release binds its own tag commit to both checkout and independently expected source', () => {
	const selection = admitMotionRelease({ tag: 'motionscaper-v0.1.0-alpha.1' });
	const source = 'a'.repeat(40); const different = 'b'.repeat(40);
	assert.equal(bindMotionReleaseSource(selection, source, source, source).sourceRevision, source);
	for (const revisions of [[source, different, source], [source, source, different], ['main', source, source]]) {
		assert.throws(() => bindMotionReleaseSource(selection, revisions[0]!, revisions[1]!, revisions[2]), /source revision/u);
	}
});
