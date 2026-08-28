/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	assertRequiredLinuxNativeTestHost,
	REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV,
	requireLinuxNativeTestEvents,
	requiredLinuxNativeSkipError,
	requiresLinuxNativeTestExecution,
} from '../scripts/lib/required-linux-native-tests.mjs';

test('required Linux native mode rejects every implicit prerequisite skip', () => {
	assert.equal(requiresLinuxNativeTestExecution(
		true, '/checkout/tests/native-pipewire-backend.test.js'), true);
	for (const reason of [
		'A C++20 compiler is unavailable.',
		'A C++ compiler is not installed on this source-audit host.',
		'no native addon payload for this host: target is pending-external',
		'The pinned Boost closure is not provisioned on this source-audit host.',
		'No complete five-target recipe pair executes on linux-x64.',
		'This checkout carries no Git metadata to resolve attributes against.',
	]) assert.equal(requiresLinuxNativeTestExecution(reason), true, String(reason));
});

test('required Linux native mode preserves unrelated boolean platform skips', () => {
	assert.equal(requiresLinuxNativeTestExecution(
		true, '/checkout/tests/milestone-5-package-evidence.test.js'), false);
});

test('required Linux native mode preserves reviewed opt-in and build-output skips', () => {
	for (const reason of [
		false,
		undefined,
		'Set FRAMESCAPER_MEDIA_HOST_TEST_BINARY to a locally linked, unshipped FFmpeg 9.0.1 fixture.',
		'Reference-scale test skipped; run `npm run test:reference:wav-385mib`.',
		'dist/transfer/sender/index.html is absent; run `npm run build` to measure the shipped preload set.',
		'set SOUNDSCAPER_ASSISTANCE_REFERENCE=1 to run',
		'This host provisions the pinned closure, so admission is not the refusing path.',
	]) assert.equal(requiresLinuxNativeTestExecution(reason), false, String(reason));
});

test('the reporter passes events through, then fails on a required native skip', async () => {
	const events = [
		{ type: 'test:pass', data: { name: 'ordinary test', skip: undefined } },
		{
			type: 'test:pass',
			data: {
				name: 'native fixture', file: '/checkout/tests/native-pipewire-backend.test.js', line: 17,
				skip: 'A C++20 compiler is unavailable.',
			},
		},
	];
	const received = [];
	await assert.rejects(async () => {
		for await (const event of requireLinuxNativeTestEvents(events)) received.push(event);
	}, /Required Linux native tests skipped:[\s\S]*native fixture[\s\S]*compiler is unavailable/iu);
	assert.deepEqual(received, events, 'reporting must not hide the runner events that explain the failure');
});

test('the reporter accepts reviewed non-native skips', async () => {
	const events = [{
		type: 'test:pass',
		data: { name: 'reference fixture', skip: 'Reference-scale test skipped; run it explicitly.' },
	}];
	const received = [];
	for await (const event of requireLinuxNativeTestEvents(events)) received.push(event);
	assert.deepEqual(received, events);
});

test('the custom reporter records an in-scope implicit skip for its parent process', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-required-native-reporter-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const fixture = join(directory, 'native-pipewire-backend.test.js');
	const report = join(directory, 'required-native-skips.txt');
	writeFileSync(fixture, [
		"import test from 'node:test';",
		"test('missing native prerequisite', { skip: true }, () => {});",
		'',
	].join('\n'));
	const reporter = resolve('scripts/require-linux-native-tests-reporter.mjs');
	const childEnvironment = { ...process.env, [REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV]: report };
	delete childEnvironment.NODE_TEST_CONTEXT;
	const run = spawnSync(process.execPath, [
		'--test-reporter', reporter, '--test', fixture,
	], {
		encoding: 'utf8',
		env: childEnvironment,
	});
	assert.equal(run.status, 0,
		`Node reporters cannot directly change the parent test process status:\n${run.stdout}\n${run.stderr}`);
	const recorded = readFileSync(report, 'utf8');
	assert.match(recorded, /native-pipewire-backend\.test\.js[\s\S]*missing native prerequisite/u);
	assert.match(requiredLinuxNativeSkipError(recorded)?.message ?? '',
		/Required Linux native tests skipped:[\s\S]*missing native prerequisite/u);
});

test('required Linux native mode is admitted only on the canonical CI host', () => {
	assert.doesNotThrow(() => assertRequiredLinuxNativeTestHost('linux', 'x64'));
	assert.throws(() => assertRequiredLinuxNativeTestHost('linux', 'arm64'), /require linux-x64/u);
	assert.throws(() => assertRequiredLinuxNativeTestHost('darwin', 'arm64'), /require linux-x64/u);
});
