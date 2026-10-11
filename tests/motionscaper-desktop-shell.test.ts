/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOTIONSCAPER_DESKTOP, motionscaperDesktopDocumentUrl, motionscaperDesktopEnvironment } from '../desktop/motionscaper-desktop-contract.ts';
import { createMotionscaperProtocolHandler } from '../desktop/motionscaper-protocol.ts';

test('Motionscaper desktop identity and advertised native capabilities are isolated', () => {
	assert.equal(MOTIONSCAPER_DESKTOP.appId, 'org.motionscaper.desktop');
	assert.equal(MOTIONSCAPER_DESKTOP.origin, 'motionscaper-app://bundle');
	assert.equal(MOTIONSCAPER_DESKTOP.partition, 'persist:motionscaper-production');
	assert.equal(MOTIONSCAPER_DESKTOP.extension, '.mscape');
	assert.equal(MOTIONSCAPER_DESKTOP.updateTagPrefix, 'motionscaper-v');
	const environment = motionscaperDesktopEnvironment('0.1.0-alpha.1', 'linux');
	assert.equal(environment.productId, 'motionscaper');
	assert.deepEqual(environment.nativeCapabilities, ['project-files-v1']);
	assert.equal(motionscaperDesktopDocumentUrl('motionscaper-app://bundle/de/index.html'), true);
	for (const url of ['soundscaper-app://bundle/', 'framescaper-app://bundle/', 'https://motionscaper.org/', 'motionscaper-app://bundle/assets/index.html', 'motionscaper-app://other/']) {
		assert.equal(motionscaperDesktopDocumentUrl(url), false, url);
	}
});

test('Motionscaper protocol serves its own confined shell with capture denied and isolation headers', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-protocol-'));
	try {
		const renderer = join(root, 'renderer');
		await mkdir(renderer);
		await writeFile(join(renderer, 'index.html'), '<html><script>window.test = 1;</script></html>');
		await writeFile(join(root, 'secret.txt'), 'private');
		await symlink(join(root, 'secret.txt'), join(renderer, 'escape.txt'));
		const handle = createMotionscaperProtocolHandler(renderer);
		const response = await handle(new Request(`${MOTIONSCAPER_DESKTOP.origin}/`));
		assert.equal(response.status, 200);
		assert.match(await response.text(), /window.test/u);
		assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
		assert.match(response.headers.get('Content-Security-Policy') ?? '', /sha256-/u);
		assert.match(response.headers.get('Permissions-Policy') ?? '', /camera=\(\)/u);
		assert.equal((await handle(new Request(`${MOTIONSCAPER_DESKTOP.origin}/escape.txt`))).status, 403);
		assert.equal((await handle(new Request('framescaper-app://bundle/'))).status, 403);
		assert.equal((await handle(new Request(`${MOTIONSCAPER_DESKTOP.origin}/`, { method: 'POST' }))).status, 405);
		assert.equal((await handle(new Request(`${MOTIONSCAPER_DESKTOP.origin}/missing.js`))).status, 404);
		assert.equal(await (await handle(new Request(`${MOTIONSCAPER_DESKTOP.origin}/`, { method: 'HEAD' }))).text(), '');
	} finally { await rm(root, { recursive: true, force: true }); }
});
