/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import type { ParallelDesktopSmokeResult } from './fixtures/parallel-stack-desktop-renderer.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('desktop protocol isolates real stack workers and the AudioWorklet while the renderer is blocked', {
	skip: process.platform !== 'linux' || !process.env.DISPLAY
		? 'The real Electron protocol regression requires Linux with a display (use xvfb-run).' : false,
	timeout: 45000,
}, async (context) => {
	const executable = join(root, 'node_modules/electron/dist/electron');
	await access(executable);
	const temporary = await mkdtemp(join(tmpdir(), 'parallel-stack-desktop-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	await build({
		absWorkingDir: root, entryPoints: {
			renderer: 'tests/fixtures/parallel-stack-desktop-renderer.ts',
			worker: 'src/common/editor/engine/parallel-stack-worker.ts',
			worklet: 'src/common/editor/engine/parallel-stack-worklet.ts',
		},
		outdir: temporary, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
		define: { 'import.meta.env': '{"DEV":false,"PROD":false}' },
		plugins: [{ name: 'unused-vite-urls', setup(builder) {
			builder.onResolve({ filter: /\?(worker&)?url$/ }, (args) => ({ path: args.path, namespace: 'unused-url' }));
			builder.onLoad({ filter: /.*/, namespace: 'unused-url' }, () => ({ contents: 'export default "/unused.js";' }));
		} }],
	});
	await writeFile(join(temporary, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/renderer.js"></script></body></html>');
	await writeFile(join(temporary, 'main.mjs'), `
		import { app, BrowserWindow, protocol, session } from 'electron/main';
		import { registerAppScheme, createProtocolHandler } from ${JSON.stringify(new URL('../desktop/protocol.js', import.meta.url).href)};
		import { APP_SCHEME, APP_ORIGIN } from ${JSON.stringify(new URL('../desktop/constants.js', import.meta.url).href)};
		registerAppScheme(protocol);
		void (async () => {
			try {
				await app.whenReady();
				await session.defaultSession.protocol.handle(APP_SCHEME, createProtocolHandler({
					rendererRoot: ${JSON.stringify(temporary)}, runtimeRoot: ${JSON.stringify(temporary)},
					readCapabilities: { get() { return null; } },
				}));
				const window = new BrowserWindow({ show: true, webPreferences: {
					nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
					allowRunningInsecureContent: false, webviewTag: false,
				} });
				await window.loadURL(APP_ORIGIN + '/');
				const result = await window.webContents.executeJavaScript(
					'new Promise((resolve, reject) => { const timer = setInterval(() => { ' +
					'const status = document.documentElement.dataset.status; if (!status) return; clearInterval(timer); ' +
					'if (status === "complete") resolve(document.body.textContent); else reject(new Error(document.body.textContent)); ' +
					'}, 25); setTimeout(() => { clearInterval(timer); reject(new Error("Renderer smoke timeout")); }, 20000); })');
				console.log('PARALLEL_DESKTOP_RESULT ' + result);
				app.exit(0);
			} catch (error) { console.error(error); app.exit(1); }
		})();
	`);
	const environment: NodeJS.ProcessEnv = { ...process.env, SCAPE_PRODUCT: 'soundscaper' };
	delete environment.ELECTRON_RUN_AS_NODE;
	const outcome = spawnSync(executable, ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
		`--user-data-dir=${join(temporary, 'profile')}`, join(temporary, 'main.mjs')], {
		env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
	});
	assert.ifError(outcome.error);
	assert.equal(outcome.status, 0, `${outcome.stdout}\n${outcome.stderr}`);
	const line = outcome.stdout.split('\n').find((value) => value.startsWith('PARALLEL_DESKTOP_RESULT '));
	assert.ok(line, outcome.stdout);
	const result = JSON.parse(line.slice('PARALLEL_DESKTOP_RESULT '.length)) as ParallelDesktopSmokeResult;
	assert.equal(result.protocol, 'soundscaper-app:');
	assert.equal(result.isolated, true);
	assert.equal(result.secure, true);
	assert.equal(result.workers, 2);
	assert.equal(result.terminated, 2);
	assert.equal(result.status, 1, JSON.stringify(result));
	assert.equal(result.fault, 0);
	assert.equal(result.progress.length, 2);
	assert.ok(result.progress.every((blocks) => blocks > 10));
	assert.ok(Math.abs(result.peak - .3046875) < 1e-5, `Unexpected processed PCM peak ${result.peak}`);
	assert.deepEqual(result.errors, []);
});
