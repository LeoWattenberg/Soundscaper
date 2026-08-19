/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflowDirectory = new URL('../.github/workflows/', import.meta.url);
const helperPath = fileURLToPath(new URL('../scripts/ci-apt-install.sh', import.meta.url));

// A stalled Ubuntu mirror once held `apt-get update` open until the 45 minute job
// limit killed the whole quality gate. Every workflow package install therefore has
// to go through the bounded helper rather than calling apt-get in the step itself.
test('no workflow step calls apt-get directly', async () => {
	const offenders = [];
	for (const workflowName of await readWorkflowNames()) {
		const workflow = await readFile(new URL(workflowName, workflowDirectory), 'utf8');
		for (const [index, line] of workflow.split('\n').entries()) {
			if (/\bapt-get\b/u.test(line)) offenders.push(`${workflowName}:${index + 1}: ${line.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], 'workflow package installs must use scripts/ci-apt-install.sh');
});

test('every workflow step that installs packages is bounded by a step timeout', async () => {
	const unbounded = [];
	for (const workflowName of await readWorkflowNames()) {
		const workflow = await readFile(new URL(workflowName, workflowDirectory), 'utf8');
		for (const step of splitSteps(workflow)) {
			if (!step.includes('ci-apt-install.sh')) continue;
			if (!/^\s+timeout-minutes:\s*\d+\s*$/mu.test(step)) {
				unbounded.push(`${workflowName}: ${step.split('\n')[0].trim()}`);
			}
		}
	}
	assert.deepEqual(unbounded, [], 'package install steps must carry timeout-minutes');
});

test('the helper installs nothing when the runner image already carries the packages', () => {
	const harness = createHarness({ installed: ['xvfb'] });
	try {
		const result = harness.run(['xvfb']);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(harness.aptInvocations(), [].length, 'apt-get must not run for preinstalled packages');
	} finally {
		harness.cleanup();
	}
});

test('the helper bounds each apt-get call with a wall clock', () => {
	const harness = createHarness({ installed: [] });
	try {
		const result = harness.run(['pulseaudio', 'pulseaudio-utils']);
		assert.equal(result.status, 0, result.stderr);
		const calls = harness.aptCalls();
		assert.ok(
			calls.some((call) => call.includes('update')),
			'apt-get update must run when a package is missing',
		);
		assert.ok(
			calls.some((call) => call.includes('install') && call.includes('pulseaudio-utils')),
			'the missing packages must be installed',
		);
		assert.equal(
			harness.timeoutInvocations(),
			calls.length,
			'every apt-get call must run under timeout(1)',
		);
	} finally {
		harness.cleanup();
	}
});

test('the helper retries an apt-get call that a mirror failure aborted', () => {
	const harness = createHarness({ installed: [], failuresBeforeSuccess: 2 });
	try {
		const result = harness.run(['xvfb']);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(
			harness.aptCalls().filter((call) => call.includes('update')).length >= 3,
			'a failing apt-get update must be retried',
		);
	} finally {
		harness.cleanup();
	}
});

test('the helper repairs a half-applied dpkg state before retrying an install', () => {
	const harness = createHarness({ installed: [], failuresBeforeSuccess: 1 });
	try {
		const result = harness.run(['pulseaudio']);
		assert.equal(result.status, 0, result.stderr);
		// The wall clock can kill apt-get between unpack and configure. Without a
		// repair the retry inherits the broken database and can never succeed.
		assert.ok(
			harness.dpkgRepairs() >= 1,
			'a retried install must reconfigure the interrupted dpkg transaction first',
		);
	} finally {
		harness.cleanup();
	}
});

test('the helper fails once its attempts are spent instead of hanging', () => {
	const harness = createHarness({ installed: [], failuresBeforeSuccess: Number.MAX_SAFE_INTEGER });
	try {
		const result = harness.run(['xvfb']);
		assert.notEqual(result.status, 0, 'an unreachable mirror must fail the step');
	} finally {
		harness.cleanup();
	}
});

async function readWorkflowNames() {
	const entries = await readdir(fileURLToPath(workflowDirectory), { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
		.map((entry) => entry.name)
		.sort();
}

function splitSteps(workflow) {
	const steps = [];
	let current = null;
	for (const line of workflow.split('\n')) {
		if (/^\s+- name:\s/u.test(line)) {
			if (current) steps.push(current.join('\n'));
			current = [line];
		} else if (current) {
			current.push(line);
		}
	}
	if (current) steps.push(current.join('\n'));
	return steps;
}

// The helper only ever reaches apt through `sudo timeout … apt-get`, so stubbing those
// four commands on PATH exercises the real script without touching the host's packages.
function createHarness({ installed, failuresBeforeSuccess = 0 }) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-apt-'));
	const binary = join(root, 'bin');
	mkdirSync(binary);
	const aptLog = join(root, 'apt.log');
	const dpkgLog = join(root, 'dpkg.log');
	const timeoutLog = join(root, 'timeout.log');
	const attemptCounter = join(root, 'attempts');

	writeStub(
		join(binary, 'dpkg-query'),
		`installed='${installed.join(' ')}'\n` +
			'for queried; do :; done\n' +
			'for known in $installed; do\n' +
			'\tif [ "$known" = "$queried" ]; then printf installed; exit 0; fi\n' +
			'done\n' +
			'exit 1\n',
	);
	writeStub(join(binary, 'sudo'), 'exec "$@"\n');
	writeStub(join(binary, 'dpkg'), `printf '%s\\n' "$*" >> '${dpkgLog}'\n`);
	writeStub(
		join(binary, 'timeout'),
		`printf '%s\\n' "$*" >> '${timeoutLog}'\n` +
			'while [ "$#" -gt 0 ]; do\n' +
			'\tcase "$1" in --*|[0-9]*) shift ;; *) break ;; esac\n' +
			'done\n' +
			'exec "$@"\n',
	);
	// Failures are counted per subcommand, so an `update` that recovers does not
	// spend the `install` budget the way a single shared counter would.
	writeStub(
		join(binary, 'apt-get'),
		`printf '%s\\n' "$*" >> '${aptLog}'\n` +
			'subcommand=other\n' +
			'for argument in "$@"; do\n' +
			'\tcase "$argument" in update|install) subcommand="$argument"; break ;; esac\n' +
			'done\n' +
			`counter='${attemptCounter}'."$subcommand"\n` +
			'attempts=$(cat "$counter" 2>/dev/null || printf 0)\n' +
			'attempts=$((attempts + 1))\n' +
			'printf %s "$attempts" > "$counter"\n' +
			`if [ "$attempts" -le ${failuresBeforeSuccess === Number.MAX_SAFE_INTEGER ? 999999 : failuresBeforeSuccess} ]; then exit 100; fi\n` +
			'exit 0\n',
	);

	return {
		run(packages) {
			return spawnSync('bash', [helperPath, ...packages], {
				encoding: 'utf8',
				env: {
					...process.env,
					PATH: `${binary}:${process.env.PATH ?? ''}`,
					CI_APT_RETRY_DELAY_SECONDS: '0',
				},
			});
		},
		aptCalls() {
			return readLog(aptLog);
		},
		aptInvocations() {
			return readLog(aptLog).length;
		},
		timeoutInvocations() {
			return readLog(timeoutLog).length;
		},
		dpkgRepairs() {
			return readLog(dpkgLog).filter((call) => call.includes('--configure')).length;
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		},
	};
}

function readLog(path) {
	try {
		return readFileSync(path, 'utf8').split('\n').filter(Boolean);
	} catch {
		return [];
	}
}

function writeStub(path, body) {
	writeFileSync(path, `#!/bin/sh\n${body}`);
	chmodSync(path, 0o755);
}
