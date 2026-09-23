/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createPackage } from '@electron/asar';
import { getCurrentFuseWire } from '@electron/fuses';

import hardenDesktopNightlyTests from '../scripts/desktop-nightly-tests-after-pack.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * A restored node_modules cache can contain Electron's package metadata without
 * its platform executable or contain an unusable one. Electron's installer
 * checks only that the executable exists, so remove an invalid copy before
 * asking it to restore the runtime.
 */
async function ensureElectronDist() {
	const dist = join(ROOT, 'node_modules/electron/dist');
	const executable = join(dist, 'electron');
	try {
		await getCurrentFuseWire(executable);
	} catch (error) {
		if (!(error instanceof Error && (
			('code' in error && error.code === 'ENOENT')
			|| error.message.includes('Could not find sentinel')
		))) throw error;
		await rm(executable, { force: true });
		const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/electron/install.js')], {
			cwd: ROOT,
			stdio: 'inherit',
			encoding: 'utf8',
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, 'Electron runtime installation failed');
		await getCurrentFuseWire(executable);
	}
	return dist;
}

test('the hardened nightly launcher renders and updates its archived progress page', {
	skip: process.platform !== 'linux' || !process.env.DISPLAY
		? 'The packaged Electron regression requires Linux with a display (use xvfb-run).'
		: false,
}, async context => {
	const root = await mkdtemp(join(tmpdir(), 'nightly progress ü '));
	context.after(() => rm(root, { recursive: true, force: true }));
	const dist = await ensureElectronDist();
	const executable = join(root, 'electron');
	await copyFile(join(dist, 'electron'), executable);
	// Only the disposable executable is patched. Share the immutable Chromium
	// runtime files while giving this launcher its own resources/app.asar.
	for (const name of await readdir(dist)) {
		if (name !== 'electron' && name !== 'resources') await symlink(join(dist, name), join(root, name));
	}
	const source = join(root, 'source');
	await mkdir(source);
	for (const path of [
		'desktop/nightly-tests-progress-window.mjs',
		'desktop/nightly-tests-progress.html',
		'desktop/nightly-tests-progress-renderer.js',
		'desktop/nightly-tests-progress.css',
		'scripts/lib/desktop-nightly-tests-presentation.mjs',
	]) {
		await mkdir(dirname(join(source, path)), { recursive: true });
		await copyFile(join(ROOT, path), join(source, path));
	}
	await writeFile(join(source, 'package.json'), JSON.stringify({
		name: 'nightly-progress-regression', version: '1.0.0', type: 'module', main: 'main.mjs',
	}));
	await writeFile(join(source, 'main.mjs'), `
		import assert from 'node:assert/strict';
		import { app, BrowserWindow, protocol, session } from 'electron/main';
		import { createDesktopNightlyTestsProgressWindow, NIGHTLY_TESTS_PROGRESS_SCHEME,
			NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL } from './desktop/nightly-tests-progress-window.mjs';
		protocol.registerSchemesAsPrivileged([{
			scheme: NIGHTLY_TESTS_PROGRESS_SCHEME, privileges: { standard: true, secure: true },
		}]);
		void run();
		async function run() {
		try {
			await app.whenReady();
			const errors = [];
			const progress = await createDesktopNightlyTestsProgressWindow({
				BrowserWindow, protocol: session.defaultSession.protocol,
				initialProgress: { completed: 0, total: 4, label: 'Application launched' },
				onError: error => { errors.push(error); },
			});
			assert.equal(progress.window.isVisible(), true);
			for (const [completed, label] of [[0, 'Application launched'], [1, 'Performance diagnostics'], [4, 'Tests passed']]) {
				if (completed === 1) progress.update({ completed, total: 4, label });
				if (completed === 4) progress.finish({ completed, total: 4, label }, 'passed');
				const state = await progress.window.webContents.executeJavaScript(
					'({url:location.href,label:document.getElementById("status").textContent,' +
					'value:document.getElementById("progress").value,max:document.getElementById("progress").max,' +
					'background:getComputedStyle(document.documentElement).backgroundColor})');
				assert.deepEqual(state, { url: NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL, label,
					value: completed, max: 4, background: 'rgb(17, 19, 26)' });
			}
			assert.deepEqual(errors, []);
			console.log('NIGHTLY_PROGRESS_ARCHIVE_PASSED');
			app.exit(0);
		} catch (error) { console.error(error); app.exit(1); }
		}
	`);
	await mkdir(join(root, 'resources'));
	await createPackage(source, join(root, 'resources/app.asar'));
	await hardenDesktopNightlyTests({
		electronPlatformName: 'linux', appOutDir: root,
		packager: { executableName: 'electron', appInfo: { productFilename: 'Nightly Progress Regression' } },
	});
	const environment = { ...process.env };
	delete environment.ELECTRON_RUN_AS_NODE;
	const result = spawnSync(executable, [
		'--no-sandbox', '--disable-gpu', `--user-data-dir=${join(root, 'profile')}`,
	], { env: environment, encoding: 'utf8', timeout: 30_000 });
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /NIGHTLY_PROGRESS_ARCHIVE_PASSED/u);
});
