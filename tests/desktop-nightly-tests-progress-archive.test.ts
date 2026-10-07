/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createPackage } from '@electron/asar';
import { getCurrentFuseWire } from '@electron/fuses';

import hardenDesktopNightlyTests from '../scripts/desktop-nightly-tests-after-pack.mjs';
import { generateDesktopIcon } from '../scripts/desktop-icons.mjs';

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
		import { join } from 'node:path';
		import { app, BrowserWindow, nativeImage, protocol, session } from 'electron/main';
		import { createDesktopNightlyTestsProgressWindow, NIGHTLY_TESTS_PROGRESS_SCHEME,
			NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL } from './desktop/nightly-tests-progress-window.mjs';
		protocol.registerSchemesAsPrivileged([{
			scheme: NIGHTLY_TESTS_PROGRESS_SCHEME, privileges: { standard: true, secure: true },
		}]);
		void run();
		async function run() {
		try {
			await app.whenReady();
			const icon = join(process.resourcesPath, 'icon.png');
			assert.equal(nativeImage.createFromPath(icon).isEmpty(), false);
			const errors = [];
			const progress = await createDesktopNightlyTestsProgressWindow({
				BrowserWindow, protocol: session.defaultSession.protocol,
				icon,
				initialProgress: { completed: 0, total: 6, label: 'Application launched' },
				onError: error => { errors.push(error); },
			});
			assert.equal(progress.window.isVisible(), true);
			for (const [completed, label, items, expectedValue, expectedPhases] of [
				[0, 'Application launched', null, 0, [0, 0, 0, 0, 0, 0]],
				[0, 'Browser tests', { completed: 2, total: 8, label: '[chromium] project opens <audio> ü' },
					0.25, [0.25, 0, 0, 0, 0, 0]],
				[0, 'Browser tests', { completed: 8, total: 8, label: 'Tests finished' },
					1, [1, 0, 0, 0, 0, 0]],
				[2, 'Performance diagnostics', null, 2, [1, 1, 0, 0, 0, 0]],
				[2, 'Performance diagnostics', { completed: 3, total: 4, label: '[chromium] audio benchmark' },
					2.75, [1, 1, 0.75, 0, 0, 0]],
				[3, 'Packaged app diagnostics', null, 3, [1, 1, 1, 0, 0, 0]],
				[6, 'Tests passed', null, 6, [1, 1, 1, 1, 1, 1]],
			]) {
				const update = { completed, total: 6, label, ...(items ? { items } : {}) };
				if (completed === 6) progress.finish(update, 'passed');
				else progress.update(update);
				const state = await progress.window.webContents.executeJavaScript(
					'({url:location.href,label:document.getElementById("status").textContent,' +
					'value:document.getElementById("progress").value,max:document.getElementById("progress").max,' +
					'phases:[...document.querySelectorAll(".phase:not([hidden]) progress")].map(value => value.position),' +
					'current:document.getElementById("current-item").textContent,' +
					'background:getComputedStyle(document.documentElement).backgroundColor})');
				assert.deepEqual(state, { url: NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL, label,
					value: expectedValue, max: 6, phases: expectedPhases,
					current: items?.label ?? (completed > 0 && completed < 6 ? 'Preparing tests…' : ''),
					background: 'rgb(17, 19, 26)' });
				if (items) {
					const counts = await progress.window.webContents.executeJavaScript(
						'({browser:document.getElementById("phase-count-0").textContent,' +
						'active:document.getElementById("phase-count-' + completed + '").textContent})');
					assert.equal(counts.active, items.completed + ' of ' + items.total + ' tests complete');
					if (completed === 2) assert.equal(counts.browser, '8 of 8 tests complete');
				}
			}
			progress.update({ completed: 1, total: 7, label: 'Tauri native smoke test',
				items: { completed: 0, total: 1, label: 'Importing and exporting a tone' } });
			const tauri = await progress.window.webContents.executeJavaScript(
				'({hidden:document.getElementById("tauri-phase").hidden,' +
				'visible:getComputedStyle(document.getElementById("tauri-phase")).display !== "none",' +
				'phases:document.querySelectorAll(".phase:not([hidden]) progress").length,' +
				'count:document.getElementById("phase-count-tauri").textContent,' +
				'max:document.getElementById("progress").max})');
			assert.deepEqual(tauri, { hidden: false, visible: true, phases: 7,
				count: '0 of 1 tests complete', max: 7 });
			assert.deepEqual(errors, []);
			console.log('NIGHTLY_PROGRESS_ARCHIVE_PASSED');
			app.exit(0);
		} catch (error) { console.error(error); app.exit(1); }
		}
	`);
	await mkdir(join(root, 'resources'));
	await generateDesktopIcon({ outputPath: join(root, 'resources/icon.png') });
	await createPackage(source, join(root, 'resources/app.asar'));
	await hardenDesktopNightlyTests({
		electronPlatformName: 'linux', appOutDir: root,
		packager: { executableName: 'electron', appInfo: { productFilename: 'Nightly Progress Regression' } },
	});
	const environment = { ...process.env };
	delete environment.ELECTRON_RUN_AS_NODE;
	// Electron subprocesses may keep inherited pipes open after the launcher exits.
	const stdoutPath = join(root, 'electron.stdout.log');
	const stderrPath = join(root, 'electron.stderr.log');
	const result = (() => {
		const stdout = openSync(stdoutPath, 'w');
		try {
			const stderr = openSync(stderrPath, 'w');
			try {
				// The common shard can make a shared CI runner slow to start Electron.
				return spawnSync(executable, [
					'--no-sandbox', '--disable-gpu', `--user-data-dir=${join(root, 'profile')}`,
				], { env: environment, stdio: ['ignore', stdout, stderr], timeout: 90_000 });
			} finally { closeSync(stderr); }
		} finally { closeSync(stdout); }
	})();
	const stdout = readFileSync(stdoutPath, 'utf8');
	const stderr = readFileSync(stderrPath, 'utf8');
	if (result.error) throw new Error(`Electron progress-page process failed: ${result.error.message}\n${stderr}`, { cause: result.error });
	assert.equal(result.status, 0, stderr);
	assert.match(stdout, /NIGHTLY_PROGRESS_ARCHIVE_PASSED/u);
});
