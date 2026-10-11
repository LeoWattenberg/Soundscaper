/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMotionReleaseWebArtifact, verifyMotionReleaseWebBuild } from '../scripts/lib/motionscaper-release-web-build.ts';
import { readProductReleaseLinesSync } from '../scripts/lib/product-release-lines.mjs';

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-web-build-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
	const lines = structuredClone(readProductReleaseLinesSync());
	lines.products.motionscaper.applicationVersionChannel = 'stable'; lines.products.motionscaper.releaseChannel = 'stable';
	await mkdir(join(root, 'config')); await writeFile(join(root, 'config/product-release-lines.json'), JSON.stringify(lines));
	await writeFile(join(root, '.gitignore'), 'dist/\nrelease/\n');
	await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { 'build:pages': 'node build.cjs' } }));
	await writeFile(join(root, 'build.cjs'), `const fs = require('node:fs');
if (process.env.SCAPE_PRODUCT !== 'motionscaper' || process.env.MOTIONSCAPER_SITE !== 'https://motionscaper.org') throw Error('wrong owner');
for (const p of ['dist/en','dist/docs']) fs.mkdirSync(p,{recursive:true});
fs.writeFileSync('dist/en/index.html','<html data-product="motionscaper"><link rel="canonical" href="https://motionscaper.org/en/"></html>');
fs.writeFileSync('dist/docs/index.html','<link rel="canonical" href="https://motionscaper.org/docs/">');
fs.writeFileSync('dist/manifest-motionscaper.webmanifest','{}');
fs.writeFileSync('dist/offline-shell.json',JSON.stringify({workers:{motionscaper:{}}}));
fs.writeFileSync('dist/current.js','// exact tagged build');
`);
	git('init'); git('config', 'user.name', 'Motion fixture'); git('config', 'user.email', 'fixture@example.invalid');
	git('add', '.'); git('commit', '-m', 'build fixture'); git('tag', 'motionscaper-v1.0.0');
	await mkdir(join(root, 'release')); await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist/stale.js'), '// previous site');
	return { root, tag: 'motionscaper-v1.0.0', expectedChannel: 'stable' as const, sourceRevision: git('rev-parse', 'HEAD'), directory: join(root, 'dist'), evidence: join(root, 'release/artifact.json'), environment: { ...process.env, SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://motionscaper.org' } };
}

test('Motion artifact executes the canonical npm build from a clean own tag, removes stale output and revalidates actual bytes', async () => {
	const f = await fixture();
	try {
		const artifact = await buildMotionReleaseWebArtifact(f);
		assert.equal(artifact.sourceRevision, f.sourceRevision); assert.ok(artifact.files.some(file => file.path === 'current.js'));
		await assert.rejects(readFile(join(f.directory, 'stale.js')), /ENOENT/u);
		assert.deepEqual(await verifyMotionReleaseWebBuild(f), artifact);
		await writeFile(join(f.directory, 'current.js'), '// tampered');
		await assert.rejects(verifyMotionReleaseWebBuild(f), /inventory|bytes/u);
	} finally { await rm(f.root, { recursive: true, force: true }); }
});

test('Motion artifact cannot annotate stale output, failed builds, a changed checkout, or a foreign production origin', async () => {
	for (const mode of ['stale', 'failed', 'changed', 'revision', 'origin'] as const) {
		const f = await fixture(); let calls = 0;
		try {
			await assert.rejects(buildMotionReleaseWebArtifact({ ...f,
				sourceRevision: mode === 'revision' ? 'a'.repeat(40) : f.sourceRevision,
				environment: mode === 'origin' ? { ...f.environment, MOTIONSCAPER_SITE: 'https://custom.example.org' } : f.environment,
				run: async request => {
					calls++; assert.deepEqual(request.args, ['run', 'build:pages']);
					if (mode === 'failed') throw new Error('actual build failed');
					if (mode === 'changed') await writeFile(join(f.root, 'build.cjs'), '// modified during build');
				},
			}), /ENOENT|build failed|clean|source revision|origin/u);
			await assert.rejects(readFile(f.evidence), /ENOENT/u);
			assert.equal(calls, mode === 'revision' || mode === 'origin' ? 0 : 1);
		} finally { await rm(f.root, { recursive: true, force: true }); }
	}
});
