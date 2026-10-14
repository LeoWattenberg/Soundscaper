/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { waitFor } from './helpers/async-test-control.ts';

const OPENFX_ENV = 'SCAPE_NODE_TEST_OPENFX_FIXTURE';
const DESKTOP_ENV = 'SCAPE_NODE_TEST_DESKTOP_RUNTIME_FIXTURE';
const NATIVE_ENV = 'SCAPE_NODE_TEST_NATIVE_FIXTURE';
const CONTROL_ENV = 'SCAPE_FAKE_NODE_FIXTURE_CONTROL';
const MODE_ENV = 'SCAPE_FAKE_NODE_FIXTURE_MODE';

interface PreparationRecord {
	readonly pid: number;
	readonly directory: string;
}

const CONTROL_SOURCE = String.raw`
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const control = process.env.SCAPE_FAKE_NODE_FIXTURE_CONTROL;
const failed = process.env.SCAPE_FAKE_NODE_FIXTURE_MODE === 'failure';
async function until(predicate) {
	const deadline = Date.now() + 5_000;
	while (!await predicate()) {
		if (Date.now() > deadline) throw new Error('Fake fixture rendezvous timed out.');
		await pause(5);
	}
}
async function exists(path) {
	try { await access(path); return true; }
	catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function running(pid) {
	try { process.kill(pid, 0); return true; }
	catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export async function prepare(label, directory) {
	assert.equal(process.env.SCAPE_NODE_TEST_OPENFX_FIXTURE, undefined);
	assert.equal(process.env.SCAPE_NODE_TEST_DESKTOP_RUNTIME_FIXTURE, undefined);
	assert.equal(process.env.SCAPE_NODE_TEST_NATIVE_FIXTURE, undefined);
	await writeFile(join(control, label + '.started'), JSON.stringify({ pid: process.pid, directory }));
	const sibling = label === 'openfx' ? 'desktop' : 'openfx';
	await until(() => exists(join(control, sibling + '.started')));
	if (failed && label === 'openfx') {
		await writeFile(join(control, 'openfx.finished'), 'failed');
		process.exitCode = 1;
		return;
	}
	if (failed) {
		const other = JSON.parse(await readFile(join(control, 'openfx.started'), 'utf8'));
		await until(() => !running(other.pid));
		// The first compiler has exited; neither fixture may be removed yet.
		await access(directory);
		await access(other.directory);
		await writeFile(join(control, label + '.held'), 'all directories survive');
		await until(() => exists(join(control, label + '.release')));
	}
	await writeFile(join(directory, 'ready'), label);
	await writeFile(join(control, label + '.finished'), 'ready');
}
`;

async function record(control: string, label: string): Promise<PreparationRecord> {
	const value: unknown = JSON.parse(await readFile(join(control, `${label}.started`), 'utf8'));
	assert.ok(value && typeof value === 'object' && 'pid' in value && typeof value.pid === 'number'
		&& 'directory' in value && typeof value.directory === 'string');
	return { pid: value.pid, directory: value.directory };
}

async function exists(path: string): Promise<boolean> {
	try { await readFile(path); return true; }
	catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}

async function fixture(context: test.TestContext, mode: 'success' | 'failure') {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-fixture-runner-test-'));
	let runnerChild: ChildProcess | undefined = undefined;
	let completion: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined = undefined;
	context.after(async () => {
		if (runnerChild) {
			await Promise.all(['desktop', 'native'].map(label => writeFile(join(root, label + '.release'), 'cleanup release')));
			if (running(runnerChild)) runnerChild.kill();
			await completion?.catch(() => undefined);
		}
		for (const label of ['openfx', 'desktop', 'native']) {
			if (await exists(join(root, `${label}.started`))) {
				await rm((await record(root, label)).directory, { recursive: true, force: true });
			}
		}
		await rm(root, { recursive: true, force: true });
	});
	await Promise.all(['scripts/lib', 'tests', 'node_modules/tsx'].map(directory =>
		mkdir(join(root, directory), { recursive: true })));
	const runner = await readFile(new URL('../scripts/run-node-tests.mjs', import.meta.url), 'utf8');
	await Promise.all([
		writeFile(join(root, 'package.json'), '{"type":"module"}'),
		writeFile(join(root, 'scripts/run-node-tests.mjs'), runner),
		writeFile(join(root, 'scripts/node-style-asset-loader.mjs'), 'export {};'),
		writeFile(join(root, 'node_modules/tsx/package.json'), '{"type":"module","exports":"./index.mjs"}'),
		writeFile(join(root, 'node_modules/tsx/index.mjs'), 'export {};'),
		writeFile(join(root, 'scripts/lib/fixture-control.mjs'), CONTROL_SOURCE),
		writeFile(join(root, 'scripts/lib/node-test-shards.mjs'), [
			"import { join } from 'node:path';",
			'export const describeNodeTestSelection = () => "fixture tests";',
			'export const parseNodeTestSelection = () => ({ shard: null });',
			'export const partitionNodeTestExecutionBatches = files => [files];',
			'export const selectNodeTestFiles = root => [join(root, "tests/consumer.test.mjs")];',
		].join('\n')),
		writeFile(join(root, 'scripts/lib/required-linux-native-tests.mjs'), [
			'export const assertRequiredLinuxNativeTestHost = () => undefined;',
			'export const REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV = "SCAPE_FAKE_NATIVE_SKIPS";',
			'export const requiredLinuxNativeSkipError = () => null;',
		].join('\n')),
		writeFile(join(root, 'scripts/lib/node-test-openfx-fixture.ts'), [
			`export const OPENFX_TEST_FIXTURE_ENV = '${OPENFX_ENV}';`,
			'export const openFxTestFixtureArtifacts = () => ["plugin", "runtime"];',
		].join('\n')),
		writeFile(join(root, 'scripts/lib/node-native-test-fixtures.ts'), `export const NATIVE_TEST_FIXTURE_ENV = '${NATIVE_ENV}';`),
		writeFile(join(root, 'scripts/lib/node-native-test-fixture-recipes.ts'), 'export const selectedNativeTestFixtures = () => ["media-contract"];'),
		writeFile(join(root, 'scripts/prepare-node-native-test-fixtures.mjs'), [
			"import { prepare } from './lib/fixture-control.mjs';",
			'await prepare("native", process.argv[3]);',
		].join('\n')),
		writeFile(join(root, 'scripts/lib/node-test-desktop-runtime-fixture.ts'), [
			"import { basename } from 'node:path';",
			"import { prepare } from './fixture-control.mjs';",
			`export const DESKTOP_RUNTIME_TEST_FIXTURE_ENV = '${DESKTOP_ENV}';`,
			'export const needsDesktopRuntimeTestFixture = () => true;',
			'if (basename(process.argv[1]) === "node-test-desktop-runtime-fixture.ts") {',
			'\tawait prepare("desktop", process.argv[3]);',
			'}',
		].join('\n')),
		writeFile(join(root, 'scripts/prepare-node-openfx-test-fixture.mjs'), [
			"import { prepare } from './lib/fixture-control.mjs';",
			'await prepare("openfx", process.argv[3]);',
		].join('\n')),
		writeFile(join(root, 'tests/consumer.test.mjs'), [
			"import assert from 'node:assert/strict';",
			"import { readFileSync, writeFileSync } from 'node:fs';",
			"import { join } from 'node:path';",
			"import test from 'node:test';",
			'test("both freshly prepared fixtures reach the consumer", () => {',
			`\tconst openfx = process.env.${OPENFX_ENV}, desktop = process.env.${DESKTOP_ENV}, native = process.env.${NATIVE_ENV};`,
			'\tassert.equal(readFileSync(join(openfx, "ready"), "utf8"), "openfx");',
			'\tassert.equal(readFileSync(join(desktop, "ready"), "utf8"), "desktop");',
			'\tassert.equal(readFileSync(join(native, "ready"), "utf8"), "native");',
			`\twriteFileSync(join(process.env.${CONTROL_ENV}, "consumer"), JSON.stringify({ openfx, desktop, native }));`,
			'});',
		].join('\n')),
	]);
	const environment: NodeJS.ProcessEnv = {
		...process.env, [CONTROL_ENV]: root, [MODE_ENV]: mode,
		[OPENFX_ENV]: 'stale-openfx-fixture', [DESKTOP_ENV]: 'stale-desktop-fixture', [NATIVE_ENV]: 'stale-native-fixture',
	};
	delete environment.NODE_V8_COVERAGE;
	delete environment.NODE_TEST_CONTEXT;
	const child = spawn(process.execPath, [join(root, 'scripts/run-node-tests.mjs')], {
		cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
	});
	runnerChild = child;
	const output: string[] = [];
	child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output.push(chunk); });
	child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output.push(chunk); });
	const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code, signal) => { resolve({ code, signal }); });
	});
	completion = completed;
	void completed.catch(() => undefined);
	return { root, child, completed, output };
}

function running(child: ChildProcess): boolean {
	return child.exitCode === null && child.signalCode === null;
}

test('the Node runner overlaps fresh preparations and supplies both fixtures only after success', { timeout: 15_000 }, async context => {
	const run = await fixture(context, 'success');
	const result = await run.completed;
	assert.deepEqual(result, { code: 0, signal: null }, run.output.join(''));
	const [openfx, desktop, native] = await Promise.all(['openfx', 'desktop', 'native'].map(label => record(run.root, label)));
	const consumer: unknown = JSON.parse(await readFile(join(run.root, 'consumer'), 'utf8'));
	assert.deepEqual(consumer, { openfx: openfx.directory, desktop: desktop.directory, native: native.directory });
	for (const prepared of [openfx, desktop, native]) {
		await assert.rejects(access(prepared.directory), { code: 'ENOENT' });
	}
});

test('a failed preparation waits for its sibling to close before removing both fixtures and prevents consumers', { timeout: 15_000 }, async context => {
	const run = await fixture(context, 'failure');
	try {
		await waitFor(() => exists(join(run.root, 'desktop.held')), 'the sibling retained after the failed preparer exited', {
			turns: 1_000, delayMs: 5,
		});
		assert.equal(running(run.child), true, 'the runner must still wait for the surviving compiler');
		assert.equal(await exists(join(run.root, 'consumer')), false);
	} finally {
		await Promise.all(['desktop', 'native'].map(label => writeFile(join(run.root, label + '.release'), 'finish sibling')));
	}
	const result = await run.completed;
	assert.deepEqual(result, { code: 1, signal: null }, run.output.join(''));
	assert.equal(await readFile(join(run.root, 'desktop.finished'), 'utf8'), 'ready');
	assert.equal(await exists(join(run.root, 'consumer')), false);
	for (const label of ['openfx', 'desktop', 'native']) {
		await assert.rejects(access((await record(run.root, label)).directory), { code: 'ENOENT' });
	}
});
