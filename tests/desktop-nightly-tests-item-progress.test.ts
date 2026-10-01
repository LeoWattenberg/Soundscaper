/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import NightlyTestsProgressReporter, {
	DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER,
	createDesktopNightlyTestsItemProgressReader,
} from '../scripts/lib/desktop-nightly-tests-progress-reporter.mjs';
import { runDesktopNightlyTestsPlaywrightChild } from '../scripts/lib/desktop-nightly-tests-playwright-child.mjs';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import type {
	DesktopNightlyTestsItemProgress,
	DesktopNightlyTestsProgress,
} from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { runDualOriginPhaseFixture } from './helpers/nightly-tests-dual-origin-phase.ts';
import { nightlyProductSitesFixture } from './helpers/nightly-tests-product-sites.ts';

function encoded(progress: DesktopNightlyTestsItemProgress): string {
	return `${DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER}${JSON.stringify(progress)}\n`;
}

function reporterFixture(total = 3) {
	const writes: string[] = [];
	const reporter = new NightlyTestsProgressReporter({ output: { write: (value: string) => { writes.push(value); } } });
	const tests = Array.from({ length: total }, (_, index) => ({
		id: `test-${String(index)}`, expectedStatus: 'passed' as const, retries: 1,
		titlePath: () => ['', 'chromium', 'fixture.spec.js', `Test ${String(index)}`],
	}));
	reporter.onBegin({}, { allTests: () => tests });
	return { reporter, tests, writes };
}

test('the nightly reporter counts completed logical tests without counting retries twice', () => {
	const { reporter, tests, writes } = reporterFixture();
	reporter.onTestBegin(tests[0]!, { retry: 0 });
	reporter.onTestEnd(tests[0]!, { retry: 0, status: 'failed' });
	const explicitlySkipped = { ...tests[1]!, expectedStatus: 'skipped' as const };
	reporter.onTestBegin(explicitlySkipped, { retry: 0 });
	reporter.onTestEnd(explicitlySkipped, { retry: 0, status: 'skipped' });
	reporter.onTestBegin(tests[0]!, { retry: 1 });
	reporter.onTestEnd(tests[0]!, { retry: 1, status: 'passed' });
	reporter.onTestEnd(tests[0]!, { retry: 1, status: 'passed' });
	reporter.onTestEnd(tests[2]!, { retry: 1, status: 'timedOut' });
	reporter.onEnd({ status: 'failed' });
	const updates: DesktopNightlyTestsItemProgress[] = [];
	const reader = createDesktopNightlyTestsItemProgressReader((value) => { updates.push(value); });
	reader.write(writes.join(''));
	reader.finish();
	assert.deepEqual(updates.map(({ completed }) => completed), [0, 0, 0, 0, 1, 1, 2, 2, 3, 3]);
	assert.ok(updates.every(({ total }) => total === 3));
	assert.match(updates[5]!.label, /Test 0.*retry 1/u);
	assert.equal(updates.at(-1)!.label, 'Tests finished');
});

test('the reporter leaves interrupted tests incomplete and supports empty suites', () => {
	const interrupted = reporterFixture(1);
	interrupted.reporter.onTestEnd(interrupted.tests[0]!, { retry: 0, status: 'interrupted' });
	interrupted.reporter.onEnd({ status: 'interrupted' });
	assert.match(interrupted.writes.at(-1)!, /"completed":0,"total":1/u);
	const empty = reporterFixture(0);
	empty.reporter.onEnd({ status: 'passed' });
	assert.match(empty.writes.at(-1)!, /"completed":0,"total":0,"label":"No tests"/u);
});

test('implicit skips stay pending until the run ends and aborted runs leave them incomplete', () => {
	for (const status of ['failed', 'interrupted', 'timedout'] as const) {
		const { reporter, tests, writes } = reporterFixture(1);
		reporter.onTestEnd(tests[0]!, { retry: 0, status: 'skipped' });
		assert.match(writes.at(-1)!, /"completed":0,"total":1/u);
		reporter.onEnd({ status });
		assert.match(writes.at(-1)!, status === 'failed' ? /"completed":1/u : /"completed":0/u);
	}
});

test('structured item updates survive chunk boundaries, UTF-8, malformed records and noisy logs', () => {
	const updates: DesktopNightlyTestsItemProgress[] = [];
	const reader = createDesktopNightlyTestsItemProgressReader((value) => { updates.push(value); });
	const values = [
		{ completed: 0, total: 2, label: 'Preparing tests' },
		{ completed: 1, total: 2, label: 'Übung 🎧' },
		{ completed: 2, total: 2, label: 'Tests finished' },
	];
	const noise = `normal log\r\n${DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER}bad json\n`
		+ encoded({ completed: 9, total: 2, label: 'Invalid' })
		+ encoded({ completed: 1, total: 2, label: 'Multiple\nlines' })
		+ `${'x'.repeat(100_000)}\n`;
	const bytes = Buffer.from(encoded(values[0]!) + noise + encoded(values[1]!) + encoded(values[2]!).trimEnd());
	for (let index = 0; index < bytes.length; index += 7) reader.write(bytes.subarray(index, index + 7));
	reader.finish();
	assert.deepEqual(updates, values);
});

test('the spawned nightly child streams item progress while preserving its complete console log', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-item-progress-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const updates: DesktopNightlyTestsItemProgress[] = [];
	const fixture = join(root, 'child.mjs');
	const values = [
		{ completed: 0, total: 1, label: 'Übung 🎧' },
		{ completed: 1, total: 1, label: 'Tests finished' },
	];
	const stdout = `child output\n${values.map(encoded).join('')}`;
	await writeFile(fixture, `const bytes = Buffer.from(${JSON.stringify(stdout)});
for (let at = 0; at < bytes.length; at += 3) process.stdout.write(bytes.subarray(at, at + 3));
process.stderr.write('child diagnostic\\n');\n`);
	const result = await runDesktopNightlyTestsPlaywrightChild({
		command: process.execPath, args: [fixture], cwd: root, env: {}, logFile: join(root, 'console.log'),
	}, (value) => { updates.push(value); });
	assert.deepEqual(result, { code: 0, signal: null });
	assert.deepEqual(updates, values);
	const log = await readFile(join(root, 'console.log'), 'utf8');
	assert.ok(log.includes(stdout));
	assert.ok(log.includes('child diagnostic\n'));
});

test('a progress observer error rejects the child operation without an uncaught stream exception', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-item-progress-error-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fixture = join(root, 'child.mjs');
	await writeFile(fixture, `process.stdout.write(${JSON.stringify(encoded({ completed: 0, total: 1, label: 'Test' }))});
setInterval(() => undefined, 1000);\n`);
	await assert.rejects(runDesktopNightlyTestsPlaywrightChild({
		command: process.execPath, args: [fixture], cwd: root, env: {}, logFile: join(root, 'console.log'),
	}, () => { throw new Error('progress observer unavailable'); }), /progress observer unavailable/u);
});

test('the actual Playwright runner streams logical progress for passes, skips, retries and final failures', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-real-playwright-progress-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const playwrightURL = new URL('../node_modules/@playwright/test/index.mjs', import.meta.url).href;
	const reporterPath = fileURLToPath(new URL('../scripts/lib/desktop-nightly-tests-progress-reporter.mjs', import.meta.url));
	const cliPath = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
	const config = join(root, 'playwright.config.mjs');
	await writeFile(config, `export default {
	testDir: ${JSON.stringify(root)}, testMatch: '**/fixture.spec.mjs',
	workers: 2, fullyParallel: true, retries: 1, timeout: 10000,
	projects: [{ name: 'progress-fixture' }],
	reporter: [['list'], [${JSON.stringify(reporterPath)}],
		['json', { outputFile: ${JSON.stringify(join(root, 'results.json'))} }]],
	outputDir: ${JSON.stringify(join(root, 'test-results'))},
};\n`);
	await writeFile(join(root, 'fixture.spec.mjs'), `import { test, expect } from ${JSON.stringify(playwrightURL)};
test('passes Übung 🎧', () => { expect(1).toBe(1); });
test.skip('skipped', () => {});
test('retry then pass', ({}, testInfo) => { expect(testInfo.retry).toBe(1); });
test('final failure', () => { expect(1).toBe(2); });\n`);
	const updates: DesktopNightlyTestsItemProgress[] = [];
	const child = await runDesktopNightlyTestsPlaywrightChild({
		command: process.execPath, args: [cliPath, 'test', '--config', config], cwd: root,
		env: {}, logFile: join(root, 'console.log'),
	}, (value) => { updates.push(value); });
	assert.deepEqual(child, { code: 1, signal: null });
	assert.deepEqual(updates[0], { completed: 0, total: 4, label: 'Preparing tests' });
	assert.deepEqual(updates.at(-1), { completed: 4, total: 4, label: 'Tests finished' });
	assert.ok(updates.some(({ label }) => /progress-fixture.*passes Übung 🎧/u.test(label)));
	assert.ok(updates.some(({ label }) => /retry then pass.*retry 1/u.test(label)));
	assert.ok(updates.every(({ total }) => total === 4));
	for (let index = 1; index < updates.length; index += 1) {
		const delta = updates[index]!.completed - updates[index - 1]!.completed;
		assert.ok(delta === 0 || delta === 1, 'logical completion is monotonic and retries cannot advance it twice');
	}
	const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as {
		stats: { expected: number; skipped: number; unexpected: number; flaky: number };
	};
	assert.deepEqual(report.stats.expected, 1);
	assert.deepEqual(report.stats.skipped, 1);
	assert.deepEqual(report.stats.unexpected, 1);
	assert.deepEqual(report.stats.flaky, 1);
	assert.match(await readFile(join(root, 'console.log'), 'utf8'), /1 failed/u);
});

test('a serial group retry does not complete its provisionally skipped later test', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-serial-playwright-progress-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const playwrightURL = new URL('../node_modules/@playwright/test/index.mjs', import.meta.url).href;
	const reporterPath = fileURLToPath(new URL('../scripts/lib/desktop-nightly-tests-progress-reporter.mjs', import.meta.url));
	const cliPath = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
	const config = join(root, 'playwright.config.mjs');
	await writeFile(config, `export default {
	testDir: ${JSON.stringify(root)}, testMatch: '**/fixture.spec.mjs',
	workers: 1, retries: 1, timeout: 10000,
	projects: [{ name: 'serial-progress-fixture' }],
	reporter: [['list'], [${JSON.stringify(reporterPath)}]],
	outputDir: ${JSON.stringify(join(root, 'test-results'))},
};\n`);
	await writeFile(join(root, 'fixture.spec.mjs'), `import { test, expect } from ${JSON.stringify(playwrightURL)};
test.describe.serial('serial group', () => {
	test('first retries', ({}, testInfo) => { expect(testInfo.retry).toBe(1); });
	test('second follows', async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
});\n`);
	const updates: DesktopNightlyTestsItemProgress[] = [];
	const child = await runDesktopNightlyTestsPlaywrightChild({
		command: process.execPath, args: [cliPath, 'test', '--config', config], cwd: root,
		env: {}, logFile: join(root, 'console.log'),
	}, (value) => { updates.push(value); });
	assert.deepEqual(child, { code: 0, signal: null });
	assert.deepEqual(updates.at(-1), { completed: 2, total: 2, label: 'Tests finished' });
	const firstRetryStart = updates.findIndex(({ label }) => /first retries.*retry 1/u.test(label));
	assert.ok(firstRetryStart > 0);
	assert.ok(updates.slice(0, firstRetryStart + 1).every(({ completed }) => completed === 0),
		'a later test skipped provisionally by a serial failure has not completed');
	const secondRetryStart = updates.findIndex(({ label }) => /second follows.*retry 1/u.test(label));
	assert.ok(secondRetryStart > firstRetryStart);
	assert.equal(updates[secondRetryStart]!.completed, 1, 'the retried second test is still running');
	for (let index = 1; index < updates.length; index += 1) {
		assert.ok(updates[index]!.completed >= updates[index - 1]!.completed);
	}
});

test('the runtime attributes streamed item progress to each of its six phases', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'nightly-phase-item-progress-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const updates: DesktopNightlyTestsProgress[] = [];
	let invocation = 0;
	const result = await runDesktopNightlyTests({
		executablePath: '/opt/nightly-tests', payloadRoot: '/opt/nightly-tests-payload', outputRoot,
		product: { id: 'soundscaper', name: 'Soundscaper', version: '1.0.0' },
		environment: {}, onProgress: (value) => { updates.push(value); },
	}, {
		startProductSites: nightlyProductSitesFixture(50100),
		runDualOriginPhase: runDualOriginPhaseFixture,
		runPlaywright: async (_plan, onItems) => {
			invocation += 1;
			onItems?.({ completed: 0, total: invocation, label: 'Preparing tests' });
			onItems?.({ completed: invocation, total: invocation, label: `Test ${String(invocation)}` });
			return { code: 0, signal: null };
		},
		writeMetricsDiagnostics: async () => ({ passed: true }),
		writePackagedMetricsDiagnostics: async () => ({ passed: true }),
		preserveCoverageEvidence: async () => '/tmp/coverage-evidence',
	});
	assert.equal(result.exitCode, 0);
	assert.equal(invocation, 6);
	assert.equal(updates.length, 18);
	for (let phase = 0; phase < 6; phase += 1) {
		const [started, preparing, finished] = updates.slice(phase * 3, phase * 3 + 3);
		assert.equal(started!.completed, phase);
		assert.equal(started!.items, undefined);
		assert.equal(preparing!.label, started!.label);
		assert.equal(finished!.label, started!.label);
		assert.deepEqual(finished!.items, { completed: phase + 1, total: phase + 1, label: `Test ${String(phase + 1)}` });
	}
});
