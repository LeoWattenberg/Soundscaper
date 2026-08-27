/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { generateOfflineApplicationShell } from '../scripts/lib/offline-application-shell.mjs';

test('a Soundscaper build keeps the retired path on its offline shell until it is asked to retire it', async (context) => {
	const outputRoot = await shellFixture(context);

	await generateOfflineApplicationShell({ outputRoot, repositoryRoot: resolve('.'), environment: {} });

	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8'));
	assert.equal(audit.workers.framescaper.retired, undefined);
	assert.deepEqual(audit.workers.framescaper.fallbacks, {
		standard: '/framescaper/en/', embedded: '/framescaper/embed/en/',
	});
	const worker = await readFile(join(outputRoot, 'framescaper/service-worker.js'), 'utf8');
	assert.match(worker, /const OFFLINE_SHELL = \{/u);
	assert.doesNotMatch(worker, /RETIRED_SHELL/u);
});

test('the retired path is served by a tombstone while the surviving worker and documents are untouched', async (context) => {
	const outputRoot = await shellFixture(context);

	await generateOfflineApplicationShell({
		outputRoot,
		repositoryRoot: resolve('.'),
		environment: { FRAMESCAPER_TOMBSTONE: '1' },
	});

	const audit = JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8'));
	assert.deepEqual(Object.keys(audit.workers), ['framescaper', 'soundscaper']);
	assert.deepEqual(Object.keys(audit.workers.framescaper).sort(), [
		'releaseId', 'retired', 'scope', 'scriptUrl', 'targetOrigin', 'workerSha256',
	]);
	assert.deepEqual(
		{
			retired: audit.workers.framescaper.retired,
			scriptUrl: audit.workers.framescaper.scriptUrl,
			scope: audit.workers.framescaper.scope,
			targetOrigin: audit.workers.framescaper.targetOrigin,
		},
		{
			retired: true,
			scriptUrl: '/framescaper/service-worker.js',
			scope: '/framescaper/',
			targetOrigin: 'https://framescaper.org',
		},
	);

	const retired = await readFile(join(outputRoot, 'framescaper/service-worker.js'), 'utf8');
	assert.match(retired, /const RETIRED_SHELL = \{"schemaVersion":1,"productId":"framescaper"/u);
	assert.doesNotMatch(retired, /const OFFLINE_SHELL/u);

	const surviving = await readFile(join(outputRoot, 'service-worker.js'), 'utf8');
	assert.match(surviving, /const OFFLINE_SHELL = \{/u);
	assert.match(surviving, new RegExp(audit.workers.soundscaper.releaseId, 'u'));
	assert.deepEqual(audit.workers.soundscaper.foreignScopes, ['/framescaper/']);
	assert.equal(audit.workers.soundscaper.installUrls.includes('/framescaper/en/'), false);

	assert.equal(audit.assets.some(({ url }) => url === '/framescaper/en/'), true, 'retained for the retention window');
	assert.equal(audit.assets.some(({ url }) => url === '/framescaper/service-worker.js'), false);
	const manifest = JSON.parse(await readFile(join(outputRoot, 'manifest-framescaper.webmanifest'), 'utf8'));
	assert.equal(manifest.scope, '/framescaper/');
});

test('a Framescaper build refuses to tombstone the worker it serves at its own root', async (context) => {
	const outputRoot = await shellFixture(context);

	await assert.rejects(
		() => generateOfflineApplicationShell({
			outputRoot,
			repositoryRoot: resolve('.'),
			environment: { SCAPE_PRODUCT: 'framescaper', FRAMESCAPER_TOMBSTONE: '1' },
		}),
		/cannot retire the service worker a framescaper build serves at its own root/u,
	);
});

async function shellFixture(context) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-tombstone-test-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const routes = ['en', 'embed/en', 'framescaper/en', 'framescaper/embed/en'];
	await Promise.all([
		fixtureFile(outputRoot, 'index.html', '<!doctype html><title>Root</title>'),
		...routes.map((route) => fixtureFile(outputRoot, `${route}/index.html`, `<!doctype html><title>${route}</title>`)),
		fixtureFile(outputRoot, 'assets/application-abc.js', 'export const application = 1;'),
		fixtureFile(outputRoot, 'assets/shared.js', 'export const shared = 1;'),
		fixtureFile(outputRoot, 'assets/soundscaper-core.js', 'export const soundscaper = 1;'),
		fixtureFile(outputRoot, 'assets/framescaper-core.js', 'export const framescaper = 1;'),
		fixtureFile(outputRoot, 'logo/framescaper-icon.svg', '<svg viewBox="0 0 1 1" />'),
		fixtureFile(outputRoot, 'logo/logo-klein-schwarz.svg', '<svg viewBox="0 0 1 1" />'),
		fixtureFile(outputRoot, 'logo/logo-klein-weiß.svg', '<svg viewBox="0 0 1 1" />'),
		fixtureFile(outputRoot, '_headers', 'test headers'),
		fixtureFile(outputRoot, '.offline-build-manifest.json', JSON.stringify({
			'index.html': { file: 'assets/application-abc.js', isEntry: true, imports: ['_shared.js'] },
			'_shared.js': { file: 'assets/shared.js' },
			'src/soundscaper/ui/SoundscaperAudioEditorBootstrapV30.tsx': {
				file: 'assets/soundscaper-core.js', imports: ['_shared.js'], isDynamicEntry: true,
			},
			'src/framescaper/ui/FramescaperAudioEditorBootstrapV31.tsx': {
				file: 'assets/framescaper-core.js', imports: ['_shared.js'], isDynamicEntry: true,
			},
		})),
	]);
	return outputRoot;
}

async function fixtureFile(root, relativePath, contents) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}
