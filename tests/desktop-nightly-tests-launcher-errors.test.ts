/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

interface Observation {
	exitCode: number;
	dialogs: Array<{ detail: string }>;
	acknowledged: boolean;
	keptAlive: boolean;
}

async function launch(context: TestContext, scenario: string) {
	const root = await mkdtemp(join(tmpdir(), 'nightly-launcher-errors-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const entry = new URL('../desktop/nightly-tests-main.mjs', import.meta.url).href;
	const modules = {
			'electron/main': `
				const { root, scenario, observation } = globalThis.fixture;
				export const protocol = { registerSchemesAsPrivileged() {} };
				export const session = { defaultSession: { protocol: {} } };
				export const app = {
					whenReady: async () => { if (scenario === 'readiness') throw Error('Electron readiness failed'); },
					getVersion: () => '1.0.0-rc.9', getPath: () => root,
					on: (event) => { if (event === 'window-all-closed') observation.keptAlive = true; },
					exit: (exitCode) => {
						globalThis.fixture.save({ ...observation, exitCode }); process.exit(0);
					},
				};
				export const dialog = {
					showMessageBox: async (...args) => {
						observation.dialogs.push(args.at(-1));
						if (scenario === 'dialog') throw Error('Native dialog failed');
						const delay = scenario === 'background'
							? (args.at(-1).message === 'Nightly tests could not complete.' ? 30 : 0) : 10;
						await new Promise(resolve => setTimeout(resolve, delay));
						observation.acknowledged = true;
					},
					showErrorBox: (_title, detail) => {
						observation.dialogs.push({ detail }); observation.acknowledged = true;
					},
				};
			`,
			'nightly-tests-progress-window.mjs': `
				export async function createDesktopNightlyTestsProgressWindow() {
					if (globalThis.fixture.scenario === 'window') throw Error('Progress document failed');
					return { window: { isDestroyed: () => false }, update() {}, finish() { throw Error('Taskbar progress failed'); } };
				}
			`,
			'nightly-tests-manifest.mjs': 'export async function readDesktopNightlyTestsSourceRevision() { return null; }',
			'desktop-nightly-tests-runtime.mjs': `
				export async function runDesktopNightlyTests() {
					if (globalThis.fixture.scenario === 'background') {
						process.emit('unhandledRejection', Error('Background startup failed'));
						return { exitCode: 0, runRoot: globalThis.fixture.root, result: { status: 'passed' } };
					}
					if (globalThis.fixture.scenario.endsWith('passed')) return {
						exitCode: 0, runRoot: globalThis.fixture.root, result: { status: 'passed' },
					};
					if (globalThis.fixture.scenario === 'failure-result') return {
						exitCode: 2, runRoot: globalThis.fixture.root,
						result: { status: 'error', failure: 'Browser process could not spawn' },
					};
					throw Error('Payload startup failed');
				}
			`,
	};
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
		import { registerHooks } from 'node:module';
		import { writeFileSync } from 'node:fs';
		const root = ${JSON.stringify(root)};
		const scenario = ${JSON.stringify(scenario)};
		if (scenario.startsWith('unattended')) process.argv.push('--unattended');
		const observation = { dialogs: [], acknowledged: false, keptAlive: false };
		globalThis.fixture = { root, scenario, observation };
		process.env.APPIMAGE = root + '/runner.AppImage';
		process.env.PORTABLE_EXECUTABLE_DIR = root;
		Object.defineProperty(process, 'execPath', { value: root + '/runner' });
		Object.defineProperty(process, 'resourcesPath', { value: root });
		const modules = ${JSON.stringify(modules)};
		globalThis.fixture.save = value => writeFileSync(root + '/observation.json', JSON.stringify(value));
		registerHooks({
			resolve(specifier, context, next) {
				const key = Object.keys(modules).find(key => specifier === key || specifier.endsWith('/' + key));
				return key ? { url: 'fixture:' + key, shortCircuit: true } : next(specifier, context);
			},
			load(url, context, next) {
				if (url === 'fixture:desktop-nightly-tests-runtime.mjs' && scenario.endsWith('import'))
					throw Error('Runtime module missing from package');
				return url.startsWith('fixture:')
					? { format: 'module', source: modules[url.slice(8)], shortCircuit: true } : next(url, context);
			},
		});
		await import(${JSON.stringify(entry)});
	`], { encoding: 'utf8', timeout: 30_000 });
	assert.equal(result.status, 0, result.stderr);
	const observation = JSON.parse(await readFile(join(root, 'observation.json'), 'utf8')) as Observation;
	const directories = (await readdir(root)).filter(name => name.startsWith('soundscaper-nightly-tests-startup-'));
	assert.equal(directories.length, 1, 'even failure before the run directory must leave startup diagnostics');
	const log = await readFile(join(root, directories[0], 'startup.log'), 'utf8');
	return { observation, log, stdout: result.stdout };
}

test('an unattended early import failure leaves diagnostics and exits without a dialog', async context => {
	const { observation, log, stdout } = await launch(context, 'unattended-import');
	assert.equal(observation.exitCode, 2);
	assert.deepEqual(observation.dialogs, []);
	assert.match(log, /Runtime module missing from package/u);
	assert.match(stdout, /SOUNDSCAPER_NIGHTLY_TESTS_RESULT .*"status":"error"/u);
});

test('taskbar errors do not change a passing nightly verdict or skip its acknowledged dialog', async context => {
	const { observation, log } = await launch(context, 'passed');
	assert.equal(observation.exitCode, 0);
	assert.equal(observation.acknowledged, true);
	assert.match(log, /Tests passed; exit 0/u);
	assert.match(log, /Taskbar progress failed/u);
});

test('an unattended passing run keeps its machine-readable verdict and never opens a dialog', async context => {
	const { observation, stdout } = await launch(context, 'unattended-passed');
	assert.equal(observation.exitCode, 0);
	assert.deepEqual(observation.dialogs, []);
	assert.match(stdout, /SOUNDSCAPER_NIGHTLY_TESTS_RESULT .*"status":"passed"/u);
});

for (const [scenario, expected] of [
	['window', 'Progress document failed'],
	['import', 'Runtime module missing from package'],
	['runtime', 'Payload startup failed'],
	['readiness', 'Electron readiness failed'],
	['dialog', 'Payload startup failed'],
	['failure-result', 'Browser process could not spawn'],
	['background', 'Background startup failed'],
]) {
	test(`nightly ${scenario} failures stay visible until acknowledged and leave a startup log`, async context => {
		const { observation, log } = await launch(context, scenario);
		assert.equal(observation.exitCode, 2);
		assert.equal(observation.acknowledged, true);
		assert.equal(observation.keptAlive, true);
		assert.ok(observation.dialogs.some(dialog => dialog.detail.includes(expected)));
		assert.ok(log.includes(expected), log);
		assert.match(log, /Application launched/u);
	});
}
