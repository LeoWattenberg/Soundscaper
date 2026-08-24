/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalFfmpegInstallerBroker,
	planExternalFfmpegInstall,
	type ExternalFfmpegInstallPlan,
	type ExternalFfmpegInstallRunner,
	type ExternalFfmpegInstallRunnerResult,
} from '../desktop/external-ffmpeg-installer.ts';

const WINDOWS_PACKAGE_ID = 'BtbN.FFmpeg.GPL.8.1';

test('Windows plans the exact stable WinGet package for each supported architecture', () => {
	for (const architecture of ['x64', 'arm64'] as const) {
		const result = planExternalFfmpegInstall({ platform: 'win32', architecture });
		assert.equal(result.status, 'planned');
		if (result.status !== 'planned') continue;
		assert.deepEqual(result.plan, {
			schemaVersion: 1,
			planId: result.plan.planId,
			target: `win-${architecture}`,
			source: 'winget',
			executable: 'winget.exe',
			argv: [
				'install', '--exact', '--id', WINDOWS_PACKAGE_ID,
				'--source', 'winget', '--architecture', architecture,
				'--scope', 'user', '--disable-interactivity',
			],
			packageIdentifier: WINDOWS_PACKAGE_ID,
			packageName: 'FFmpeg (BtbN GPL 8.1 release branch)',
			licenseSpdx: 'GPL-3.0',
			licenseUrl: 'https://www.ffmpeg.org/legal.html',
			disclosure: result.plan.disclosure,
			confirmationRequired: true,
		});
		assert.match(result.plan.disclosure, /WinGet.*BtbN\.FFmpeg\.GPL\.8\.1.*GPL-3\.0/isu);
		assert.doesNotMatch(result.plan.argv.join(' '), /accept-(?:package|source)-agreements/iu);
		assertNoShellBootstrap(result.plan);
	}
});

test('Homebrew plans only its existing executable and the exact ffmpeg formula command', () => {
	for (const [platform, architecture, target, executable] of [
		['darwin', 'arm64', 'mac-arm64', '/opt/homebrew/bin/brew'],
		['linux', 'x64', 'linux-x64', '/home/linuxbrew/.linuxbrew/bin/brew'],
		['linux', 'arm64', 'linux-arm64', '/home/linuxbrew/.linuxbrew/bin/brew'],
	] as const) {
		const result = planExternalFfmpegInstall({ platform, architecture });
		assert.equal(result.status, 'planned');
		if (result.status !== 'planned') continue;
		assert.equal(result.plan.target, target);
		assert.equal(result.plan.source, 'homebrew');
		assert.equal(result.plan.executable, executable);
		assert.deepEqual(result.plan.argv, ['install', 'ffmpeg']);
		assert.equal(result.plan.packageIdentifier, 'homebrew/core/ffmpeg');
		assert.equal(result.plan.licenseSpdx, 'GPL-3.0-or-later');
		assert.match(result.plan.disclosure, /existing Homebrew.*brew install ffmpeg.*GPL-3\.0-or-later/isu);
		assertNoShellBootstrap(result.plan);
	}
});

test('a discovered package-manager path can replace only the executable', () => {
	const brew = planExternalFfmpegInstall({
		platform: 'linux', architecture: 'arm64',
		packageManagerExecutable: '/srv/homebrew/bin/brew',
	});
	assert.equal(brew.status, 'planned');
	if (brew.status === 'planned') assert.equal(brew.plan.executable, '/srv/homebrew/bin/brew');

	const winget = planExternalFfmpegInstall({
		platform: 'win32', architecture: 'x64',
		packageManagerExecutable: 'C:\\Program Files\\WindowsApps\\winget.exe',
	});
	assert.equal(winget.status, 'planned');
	if (winget.status === 'planned') {
		assert.equal(winget.plan.executable, 'C:\\Program Files\\WindowsApps\\winget.exe');
		assert.deepEqual(winget.plan.argv.slice(0, 4), ['install', '--exact', '--id', WINDOWS_PACKAGE_ID]);
	}

	assert.throws(() => planExternalFfmpegInstall({
		platform: 'linux', architecture: 'x64', packageManagerExecutable: 'sh -c brew',
	}), /package-manager executable.*absolute/iu);
});

test('macOS x64 and every target outside the closed desktop matrix are refused', () => {
	assert.deepEqual(planExternalFfmpegInstall({ platform: 'darwin', architecture: 'x64' }), {
		status: 'unsupported',
		reason: 'mac-x64-unsupported',
		detail: 'Soundscaper does not support macOS x64.',
	});
	for (const [platform, architecture, reason] of [
		['win32', 'ia32', 'unsupported-architecture'],
		['darwin', 'arm', 'unsupported-architecture'],
		['linux', 'riscv64', 'unsupported-architecture'],
		['freebsd', 'x64', 'unsupported-platform'],
	] as const) {
		const result = planExternalFfmpegInstall({ platform, architecture });
		assert.equal(result.status, 'unsupported');
		if (result.status === 'unsupported') assert.equal(result.reason, reason);
	}
});

test('execution requires fresh explicit confirmation and an unchanged plan', async () => {
	const plan = windowsPlan();
	let calls = 0;
	const brokerValue = broker(async () => {
		calls += 1;
		return exited();
	});
	assert.deepEqual(await brokerValue.install({ plan, confirmed: false }), {
		status: 'refused', reason: 'confirmation-required',
		detail: 'Installing external FFmpeg requires explicit confirmation of this exact plan.',
	});
	const changed = {
		...plan,
		argv: [...plan.argv, '--accept-package-agreements'],
	} as ExternalFfmpegInstallPlan;
	assert.deepEqual(await brokerValue.install({ plan: changed, confirmed: true }), {
		status: 'refused', reason: 'plan-changed',
		detail: 'The external FFmpeg install plan changed after it was disclosed.',
	});
	assert.equal(calls, 0);
});

test('a confirmed plan runs with one fixed, sanitized, shell-free process policy', async () => {
	let invocation: Parameters<ExternalFfmpegInstallRunner>[0] | undefined;
	const brokerValue = broker(async (request) => {
		invocation = request;
		return exited({ stdout: 'installed', stderr: 'notice' });
	}, {
		environment: {
			PATH: '/safe/bin', HOME: '/safe/home', TMPDIR: '/safe/tmp',
			AWS_SECRET_ACCESS_KEY: 'must-not-leak', HOMEBREW_NO_AUTO_UPDATE: '0',
		},
	});
	const result = await brokerValue.install({ plan: windowsPlan(), confirmed: true });
	assert.deepEqual(result, {
		status: 'installed', exitCode: 0, stdout: 'installed', stderr: 'notice',
	});
	assert.ok(invocation);
	assert.equal(invocation.executable, 'winget.exe');
	assert.deepEqual(invocation.argv, windowsPlan().argv);
	assert.deepEqual(invocation.options, {
		cwd: '/installer-cwd',
		env: {
			HOME: '/safe/home',
			HOMEBREW_NO_ANALYTICS: '1',
			HOMEBREW_NO_AUTO_UPDATE: '1',
			HOMEBREW_NO_ENV_HINTS: '1',
			NO_COLOR: '1',
			PATH: '/safe/bin',
			TMPDIR: '/safe/tmp',
		},
		shell: false,
		stdin: 'ignore',
		stdout: 'capture',
		stderr: 'capture',
		timeoutMs: 5_000,
		maximumOutputBytes: 8_192,
		signal: invocation.options.signal,
	});
	assert.equal(invocation.options.signal.aborted, false);
	assert.equal('AWS_SECRET_ACCESS_KEY' in invocation.options.env, false);
	assert.deepEqual(brokerValue.status(), { state: 'idle' });
});

test('the broker admits only one package-manager process at a time', async () => {
	const pending = deferred<ExternalFfmpegInstallRunnerResult>();
	let calls = 0;
	const brokerValue = broker(async () => {
		calls += 1;
		return pending.promise;
	});
	const first = brokerValue.install({ plan: windowsPlan(), confirmed: true });
	await Promise.resolve();
	assert.deepEqual(brokerValue.status(), {
		state: 'installing', planId: windowsPlan().planId, target: 'win-x64',
	});
	assert.deepEqual(await brokerValue.install({ plan: windowsPlan(), confirmed: true }), {
		status: 'refused', reason: 'install-in-progress',
		detail: 'An external FFmpeg installation is already in progress.',
	});
	assert.equal(calls, 1);
	pending.resolve(exited());
	assert.equal((await first).status, 'installed');
	assert.deepEqual(brokerValue.status(), { state: 'idle' });
});

test('changed metadata, cancellation, runner failure, signals, and nonzero exits never install', async () => {
	for (const [runnerResult, expectedStatus, expectedReason] of [
		[{ status: 'package-changed', detail: 'license changed', stdout: '', stderr: '' },
			'failed', 'package-metadata-changed'],
		[{ status: 'cancelled', detail: 'cancelled by manager', stdout: '', stderr: '' },
			'cancelled', undefined],
		[{ status: 'failed', detail: 'manager failed', stdout: '', stderr: '' },
			'failed', 'runner-failed'],
		[exited({ exitCode: 7 }), 'failed', 'nonzero-exit'],
		[exited({ exitCode: null, signal: 'SIGTERM' }), 'failed', 'signalled'],
	] as const) {
		const result = await broker(async () => runnerResult).install({
			plan: windowsPlan(), confirmed: true,
		});
		assert.equal(result.status, expectedStatus);
		if (result.status === 'failed') assert.equal(result.reason, expectedReason);
	}
	const thrown = await broker(async () => { throw new Error('ENOENT'); }).install({
		plan: windowsPlan(), confirmed: true,
	});
	assert.equal(thrown.status, 'failed');
	if (thrown.status === 'failed') {
		assert.equal(thrown.reason, 'spawn-failed');
		assert.match(thrown.detail, /ENOENT/u);
	}
});

test('cancellation aborts the runner and keeps the concurrency gate until it settles', async () => {
	const pending = deferred<ExternalFfmpegInstallRunnerResult>();
	let runnerSignal: AbortSignal | undefined;
	const brokerValue = broker(async (request) => {
		runnerSignal = request.options.signal;
		return pending.promise;
	});
	const cancellation = new AbortController();
	const running = brokerValue.install({
		plan: windowsPlan(), confirmed: true, signal: cancellation.signal,
	});
	await Promise.resolve();
	cancellation.abort(new Error('user cancelled'));
	const result = await running;
	assert.equal(result.status, 'cancelled');
	assert.equal(runnerSignal?.aborted, true);
	assert.equal((await brokerValue.install({ plan: windowsPlan(), confirmed: true })).status, 'refused');
	pending.resolve(exited());
	await nextTurn();
	assert.deepEqual(brokerValue.status(), { state: 'idle' });

	const preCancelled = new AbortController();
	preCancelled.abort();
	let spawns = 0;
	const beforeSpawn = await broker(async () => { spawns += 1; return exited(); }).install({
		plan: windowsPlan(), confirmed: true, signal: preCancelled.signal,
	});
	assert.equal(beforeSpawn.status, 'cancelled');
	assert.equal(spawns, 0);
});

test('timeouts and oversized output fail closed under broker-owned bounds', async () => {
	const pending = deferred<ExternalFfmpegInstallRunnerResult>();
	let signal: AbortSignal | undefined;
	const timedBroker = broker(async (request) => {
		signal = request.options.signal;
		return pending.promise;
	}, { timeoutMs: 10 });
	const timeout = await timedBroker.install({ plan: windowsPlan(), confirmed: true });
	assert.equal(timeout.status, 'failed');
	if (timeout.status === 'failed') assert.equal(timeout.reason, 'timed-out');
	assert.equal(signal?.aborted, true);
	pending.resolve(exited());
	await nextTurn();

	const oversized = await broker(async () => exited({ stdout: 'x'.repeat(8_193) })).install({
		plan: windowsPlan(), confirmed: true,
	});
	assert.equal(oversized.status, 'failed');
	if (oversized.status === 'failed') assert.equal(oversized.reason, 'output-limit');
});

function windowsPlan(): ExternalFfmpegInstallPlan {
	const result = planExternalFfmpegInstall({ platform: 'win32', architecture: 'x64' });
	assert.equal(result.status, 'planned');
	if (result.status !== 'planned') throw new Error('The supported Windows plan was refused.');
	return result.plan;
}

function broker(
	runner: ExternalFfmpegInstallRunner,
	overrides: Readonly<{
		readonly environment?: Readonly<Record<string, string | undefined>>;
		readonly timeoutMs?: number;
	}> = {},
) {
	return createExternalFfmpegInstallerBroker({
		runner,
		cwd: '/installer-cwd',
		environment: overrides.environment ?? { PATH: '/safe/bin' },
		timeoutMs: overrides.timeoutMs ?? 5_000,
		maximumOutputBytes: 8_192,
	});
}

function exited(overrides: Readonly<{
	readonly exitCode?: number | null;
	readonly signal?: string | null;
	readonly stdout?: string;
	readonly stderr?: string;
}> = {}): ExternalFfmpegInstallRunnerResult {
	return {
		status: 'exited',
		exitCode: overrides.exitCode === undefined ? 0 : overrides.exitCode,
		signal: overrides.signal ?? null,
		stdout: overrides.stdout ?? '',
		stderr: overrides.stderr ?? '',
	};
}

function assertNoShellBootstrap(plan: ExternalFfmpegInstallPlan): void {
	const command = [plan.executable, ...plan.argv].join(' ');
	assert.doesNotMatch(command, /(?:^|\s)(?:sudo|sh|bash|zsh|powershell|curl|wget)(?:\s|$)/iu);
	assert.doesNotMatch(command, /brew\.sh|bootstrap/iu);
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
} {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

async function nextTurn(): Promise<void> {
	await new Promise<void>((resolve) => { setImmediate(resolve); });
}
