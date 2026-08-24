/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, user-confirmed package-manager plans for optional external FFmpeg. */

import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

export type ExternalFfmpegInstallTarget =
	| 'win-x64'
	| 'win-arm64'
	| 'mac-arm64'
	| 'linux-x64'
	| 'linux-arm64';

export type ExternalFfmpegInstallSource = 'winget' | 'homebrew';

export interface ExternalFfmpegInstallPlan {
	readonly schemaVersion: 1;
	readonly planId: string;
	readonly target: ExternalFfmpegInstallTarget;
	readonly source: ExternalFfmpegInstallSource;
	readonly executable: string;
	readonly argv: readonly string[];
	readonly packageIdentifier: string;
	readonly packageName: string;
	readonly licenseSpdx: string;
	readonly licenseUrl: string;
	readonly disclosure: string;
	readonly confirmationRequired: true;
}

export type ExternalFfmpegInstallUnsupportedReason =
	| 'mac-x64-unsupported'
	| 'unsupported-architecture'
	| 'unsupported-platform';

export type ExternalFfmpegInstallPlanResult =
	| Readonly<{ readonly status: 'planned'; readonly plan: ExternalFfmpegInstallPlan }>
	| Readonly<{
		readonly status: 'unsupported';
		readonly reason: ExternalFfmpegInstallUnsupportedReason;
		readonly detail: string;
	}>;

export interface ExternalFfmpegInstallPlanRequest {
	readonly platform: string;
	readonly architecture: string;
	/** A main-process discovery result. Overrides only the closed package-manager executable. */
	readonly packageManagerExecutable?: string;
}

export interface ExternalFfmpegInstallRunnerOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdin: 'ignore';
	readonly stdout: 'capture';
	readonly stderr: 'capture';
	readonly timeoutMs: number;
	readonly maximumOutputBytes: number;
	readonly signal: AbortSignal;
}

export interface ExternalFfmpegInstallRunnerRequest {
	readonly executable: string;
	readonly argv: readonly string[];
	readonly options: ExternalFfmpegInstallRunnerOptions;
}

interface ExternalFfmpegInstallRunnerOutput {
	readonly stdout: string;
	readonly stderr: string;
}

export type ExternalFfmpegInstallRunnerResult =
	| Readonly<ExternalFfmpegInstallRunnerOutput & {
		readonly status: 'exited';
		readonly exitCode: number | null;
		readonly signal: string | null;
	}>
	| Readonly<ExternalFfmpegInstallRunnerOutput & {
		readonly status: 'cancelled';
		readonly detail: string;
	}>
	| Readonly<ExternalFfmpegInstallRunnerOutput & {
		readonly status: 'package-changed';
		readonly detail: string;
	}>
	| Readonly<ExternalFfmpegInstallRunnerOutput & {
		readonly status: 'failed';
		readonly detail: string;
	}>;

export type ExternalFfmpegInstallRunner = (
	request: ExternalFfmpegInstallRunnerRequest,
) => Promise<ExternalFfmpegInstallRunnerResult>;

export type ExternalFfmpegInstallFailureReason =
	| 'nonzero-exit'
	| 'output-limit'
	| 'package-metadata-changed'
	| 'runner-failed'
	| 'signalled'
	| 'spawn-failed'
	| 'timed-out';

export type ExternalFfmpegInstallOutcome =
	| Readonly<{
		readonly status: 'installed';
		readonly exitCode: 0;
		readonly stdout: string;
		readonly stderr: string;
	}>
	| Readonly<{
		readonly status: 'cancelled';
		readonly detail: string;
		readonly stdout: string;
		readonly stderr: string;
	}>
	| Readonly<{
		readonly status: 'failed';
		readonly reason: ExternalFfmpegInstallFailureReason;
		readonly detail: string;
		readonly stdout: string;
		readonly stderr: string;
	}>
	| Readonly<{
		readonly status: 'refused';
		readonly reason: 'confirmation-required' | 'install-in-progress' | 'plan-changed';
		readonly detail: string;
	}>;

export type ExternalFfmpegInstallerStatus =
	| Readonly<{ readonly state: 'idle' }>
	| Readonly<{
		readonly state: 'installing';
		readonly planId: string;
		readonly target: ExternalFfmpegInstallTarget;
	}>;

export interface ExternalFfmpegInstallRequest {
	readonly plan: ExternalFfmpegInstallPlan;
	readonly confirmed: boolean;
	readonly signal?: AbortSignal;
}

export interface ExternalFfmpegInstallerBrokerOptions {
	readonly runner: ExternalFfmpegInstallRunner;
	/** Fixed main-owned working directory; renderer install requests cannot replace it. */
	readonly cwd: string;
	/** Only the package-manager allowlist below is copied into the child environment. */
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly timeoutMs?: number;
	readonly maximumOutputBytes?: number;
}

export interface ExternalFfmpegInstallerBroker {
	status(): ExternalFfmpegInstallerStatus;
	install(request: ExternalFfmpegInstallRequest): Promise<ExternalFfmpegInstallOutcome>;
}

interface ActiveInstall {
	readonly planId: string;
	readonly target: ExternalFfmpegInstallTarget;
}

type PlanBody = Omit<ExternalFfmpegInstallPlan, 'planId'>;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 256 * 1_024;
const CANCELLED = Symbol('external-ffmpeg-install-cancelled');
const TIMED_OUT = Symbol('external-ffmpeg-install-timed-out');
const plannedObjects = new WeakSet<object>();

// Official WinGet manifests publish x64 and ARM64 under this stable release-branch ID:
// https://github.com/microsoft/winget-pkgs/tree/master/manifests/b/BtbN/FFmpeg/GPL/8/1
export const WINDOWS_FFMPEG_PACKAGE_ID = 'BtbN.FFmpeg.GPL.8.1';

const PASSTHROUGH_ENVIRONMENT_KEYS = Object.freeze([
	'ALL_PROXY', 'HOME', 'HOMEBREW_CELLAR', 'HOMEBREW_PREFIX', 'HOMEBREW_REPOSITORY',
	'HTTPS_PROXY', 'HTTP_PROXY', 'LOCALAPPDATA', 'NO_PROXY', 'PATH', 'Path',
	'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'WINDIR',
] as const);

/** Produces a deterministic, frozen plan without filesystem, network, or process access. */
export function planExternalFfmpegInstall(
	request: ExternalFfmpegInstallPlanRequest,
): ExternalFfmpegInstallPlanResult {
	const target = installTarget(request.platform, request.architecture);
	if (typeof target !== 'string') return target;
	const executable = packageManagerExecutable(target, request.packageManagerExecutable);
	const body = target === 'win-x64' || target === 'win-arm64'
		? windowsPlanBody(target, executable)
		: homebrewPlanBody(target, executable);
	const plan = freezePlan(body);
	plannedObjects.add(plan);
	return Object.freeze({ status: 'planned', plan });
}

export function createExternalFfmpegInstallerBroker(
	options: ExternalFfmpegInstallerBrokerOptions,
): ExternalFfmpegInstallerBroker {
	if (typeof options?.runner !== 'function') throw new TypeError('An external FFmpeg installer requires a runner.');
	if (!isAbsolutePath(options.cwd)) {
		throw new TypeError('The external FFmpeg installer working directory must be absolute.');
	}
	const runner = options.runner;
	const cwd = options.cwd;
	const environment = installerEnvironment(options.environment);
	const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 10, 30 * 60 * 1_000, 'timeout');
	const maximumOutputBytes = boundedInteger(
		options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES,
		1_024,
		1_024 * 1_024,
		'maximum output',
	);
	let active: ActiveInstall | null = null;

	const finish = (install: ActiveInstall): void => {
		if (active === install) active = null;
	};

	return Object.freeze({
		status: (): ExternalFfmpegInstallerStatus => active === null
			? Object.freeze({ state: 'idle' })
			: Object.freeze({ state: 'installing', planId: active.planId, target: active.target }),
		install: async (request: ExternalFfmpegInstallRequest): Promise<ExternalFfmpegInstallOutcome> => {
			if (request.confirmed !== true) return refused(
				'confirmation-required',
				'Installing external FFmpeg requires explicit confirmation of this exact plan.',
			);
			if (!isCurrentPlan(request.plan)) return refused(
				'plan-changed',
				'The external FFmpeg install plan changed after it was disclosed.',
			);
			if (active !== null) return refused(
				'install-in-progress',
				'An external FFmpeg installation is already in progress.',
			);
			if (request.signal?.aborted) return cancelled(abortDetail(request.signal), '', '');

			const install: ActiveInstall = Object.freeze({
				planId: request.plan.planId,
				target: request.plan.target,
			});
			active = install;
			const lifetime = new AbortController();
			const invocation = runnerInvocation(
				request.plan, cwd, environment, timeoutMs, maximumOutputBytes, lifetime.signal,
			);
			const runnerPromise = Promise.resolve().then(() => runner(invocation));
			let timeout: ReturnType<typeof setTimeout> | undefined;
			let onAbort: (() => void) | undefined;
			const cancellationPromise = new Promise<typeof CANCELLED>((resolve) => {
				if (!request.signal) return;
				onAbort = () => {
					lifetime.abort(request.signal?.reason);
					resolve(CANCELLED);
				};
				if (request.signal.aborted) onAbort();
				else request.signal.addEventListener('abort', onAbort, { once: true });
			});
			const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
				timeout = setTimeout(() => {
					lifetime.abort(new Error('The external FFmpeg installation timed out.'));
					resolve(TIMED_OUT);
				}, timeoutMs);
			});
			let settled: ExternalFfmpegInstallRunnerResult | typeof CANCELLED | typeof TIMED_OUT;
			try {
				settled = await Promise.race([runnerPromise, cancellationPromise, timeoutPromise]);
			} catch (error) {
				if (timeout !== undefined) clearTimeout(timeout);
				if (onAbort && request.signal) request.signal.removeEventListener('abort', onAbort);
				finish(install);
				return failed(
					'spawn-failed', errorMessage(error), '', '',
				);
			}
			if (timeout !== undefined) clearTimeout(timeout);
			if (onAbort && request.signal) request.signal.removeEventListener('abort', onAbort);

			if (settled === CANCELLED || settled === TIMED_OUT) {
				void runnerPromise.then(() => { finish(install); }, () => { finish(install); });
				return settled === CANCELLED
					? cancelled(abortDetail(request.signal), '', '')
					: failed('timed-out', 'The external FFmpeg installation exceeded its time limit.', '', '');
			}
			finish(install);
			return runnerOutcome(settled, maximumOutputBytes);
		},
	});
}

function installTarget(
	platform: string,
	architecture: string,
): ExternalFfmpegInstallTarget | Exclude<ExternalFfmpegInstallPlanResult, { status: 'planned' }> {
	if (platform === 'darwin' && architecture === 'x64') return Object.freeze({
		status: 'unsupported', reason: 'mac-x64-unsupported',
		detail: 'Soundscaper does not support macOS x64.',
	});
	if (!['win32', 'darwin', 'linux'].includes(platform)) return Object.freeze({
		status: 'unsupported', reason: 'unsupported-platform',
		detail: `External FFmpeg installation is unavailable on ${platform}.`,
	});
	if (!['x64', 'arm64'].includes(architecture)
		|| (platform === 'darwin' && architecture !== 'arm64')) return Object.freeze({
		status: 'unsupported', reason: 'unsupported-architecture',
		detail: `External FFmpeg installation is unavailable for ${platform}-${architecture}.`,
	});
	if (platform === 'win32') return `win-${architecture}` as 'win-x64' | 'win-arm64';
	if (platform === 'darwin') return 'mac-arm64';
	return `linux-${architecture}` as 'linux-x64' | 'linux-arm64';
}

function windowsPlanBody(
	target: 'win-x64' | 'win-arm64',
	executable: string,
): PlanBody {
	const architecture = target === 'win-x64' ? 'x64' : 'arm64';
	const argv = Object.freeze([
		'install', '--exact', '--id', WINDOWS_FFMPEG_PACKAGE_ID,
		'--source', 'winget', '--architecture', architecture,
		'--scope', 'user', '--disable-interactivity',
	]);
	return {
		schemaVersion: 1,
		target,
		source: 'winget',
		executable,
		argv,
		packageIdentifier: WINDOWS_FFMPEG_PACKAGE_ID,
		packageName: 'FFmpeg (BtbN GPL 8.1 release branch)',
		licenseSpdx: 'GPL-3.0',
		licenseUrl: 'https://www.ffmpeg.org/legal.html',
		disclosure: `Install external FFmpeg with WinGet from the community source. Package: ${WINDOWS_FFMPEG_PACKAGE_ID}. License: GPL-3.0 (https://www.ffmpeg.org/legal.html). Command: winget ${argv.join(' ')}. Soundscaper will not auto-accept changed package or source agreements.`,
		confirmationRequired: true,
	};
}

function homebrewPlanBody(
	target: Exclude<ExternalFfmpegInstallTarget, `win-${string}`>,
	executable: string,
): PlanBody {
	const argv = Object.freeze(['install', 'ffmpeg']);
	return {
		schemaVersion: 1,
		target,
		source: 'homebrew',
		executable,
		argv,
		packageIdentifier: 'homebrew/core/ffmpeg',
		packageName: 'FFmpeg',
		// Official formula metadata: https://formulae.brew.sh/formula/ffmpeg
		licenseSpdx: 'GPL-3.0-or-later',
		licenseUrl: 'https://formulae.brew.sh/formula/ffmpeg',
		disclosure: 'Install external FFmpeg through existing Homebrew. Package: homebrew/core/ffmpeg. Command: brew install ffmpeg. Formula license: GPL-3.0-or-later (https://formulae.brew.sh/formula/ffmpeg). Soundscaper will not bootstrap Homebrew or use sudo.',
		confirmationRequired: true,
	};
}

function packageManagerExecutable(
	target: ExternalFfmpegInstallTarget,
	override: string | undefined,
): string {
	if (override === undefined) {
		if (target.startsWith('win-')) return 'winget.exe';
		if (target === 'mac-arm64') return '/opt/homebrew/bin/brew';
		return '/home/linuxbrew/.linuxbrew/bin/brew';
	}
	if (!isAbsolutePath(override)) {
		throw new TypeError('A discovered package-manager executable must be an absolute path.');
	}
	const expected = target.startsWith('win-') ? 'winget.exe' : 'brew';
	const basename = target.startsWith('win-') ? win32.basename(override).toLowerCase() : posix.basename(override);
	if (basename !== expected) {
		throw new TypeError(`The discovered package-manager executable must name ${expected}.`);
	}
	return override;
}

function freezePlan(body: PlanBody): ExternalFfmpegInstallPlan {
	const planId = planDigest(body);
	return Object.freeze({ ...body, argv: Object.freeze([...body.argv]), planId });
}

function isCurrentPlan(plan: ExternalFfmpegInstallPlan): boolean {
	if (!plan || typeof plan !== 'object' || !plannedObjects.has(plan)) return false;
	const { planId, ...body } = plan;
	return /^[a-f\d]{64}$/u.test(planId) && planDigest(body) === planId;
}

function planDigest(body: PlanBody): string {
	return createHash('sha256').update(JSON.stringify([
		body.schemaVersion, body.target, body.source, body.executable, body.argv,
		body.packageIdentifier, body.packageName, body.licenseSpdx, body.licenseUrl,
		body.disclosure, body.confirmationRequired,
	])).digest('hex');
}

function installerEnvironment(
	source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const admitted: Record<string, string> = {};
	for (const key of PASSTHROUGH_ENVIRONMENT_KEYS) {
		const value = source[key];
		if (typeof value === 'string' && !value.includes('\0')) admitted[key] = value;
	}
	admitted.HOMEBREW_NO_ANALYTICS = '1';
	admitted.HOMEBREW_NO_AUTO_UPDATE = '1';
	admitted.HOMEBREW_NO_ENV_HINTS = '1';
	admitted.NO_COLOR = '1';
	return Object.freeze(Object.fromEntries(
		Object.entries(admitted).sort(([left], [right]) => left.localeCompare(right)),
	));
}

function runnerInvocation(
	plan: ExternalFfmpegInstallPlan,
	cwd: string,
	env: Readonly<Record<string, string>>,
	timeoutMs: number,
	maximumOutputBytes: number,
	signal: AbortSignal,
): ExternalFfmpegInstallRunnerRequest {
	return Object.freeze({
		executable: plan.executable,
		argv: Object.freeze([...plan.argv]),
		options: Object.freeze({
			cwd, env, shell: false, stdin: 'ignore', stdout: 'capture', stderr: 'capture',
			timeoutMs, maximumOutputBytes, signal,
		}),
	});
}

function runnerOutcome(
	result: ExternalFfmpegInstallRunnerResult,
	maximumOutputBytes: number,
): ExternalFfmpegInstallOutcome {
	const output = boundedOutput(result.stdout, result.stderr, maximumOutputBytes);
	if (output.exceeded) return failed(
		'output-limit', 'The package manager exceeded the installer output limit.', output.stdout, output.stderr,
	);
	if (result.status === 'package-changed') return failed(
		'package-metadata-changed', result.detail, output.stdout, output.stderr,
	);
	if (result.status === 'cancelled') return cancelled(result.detail, output.stdout, output.stderr);
	if (result.status === 'failed') return failed(
		'runner-failed', result.detail, output.stdout, output.stderr,
	);
	if (result.signal !== null) return failed(
		'signalled', `The package manager ended with signal ${result.signal}.`, output.stdout, output.stderr,
	);
	if (result.exitCode === 0) return Object.freeze({
		status: 'installed', exitCode: 0, stdout: output.stdout, stderr: output.stderr,
	});
	if (Number.isInteger(result.exitCode)) return failed(
		'nonzero-exit', `The package manager exited with code ${String(result.exitCode)}.`,
		output.stdout, output.stderr,
	);
	return failed('runner-failed', 'The package manager returned no valid exit status.', output.stdout, output.stderr);
}

function boundedOutput(
	stdout: string,
	stderr: string,
	maximumBytes: number,
): Readonly<{ readonly stdout: string; readonly stderr: string; readonly exceeded: boolean }> {
	const stdoutBytes = Buffer.byteLength(stdout);
	const stderrBytes = Buffer.byteLength(stderr);
	if (stdoutBytes + stderrBytes <= maximumBytes) return { stdout, stderr, exceeded: false };
	const admittedStdout = truncateUtf8(stdout, maximumBytes);
	const remaining = Math.max(0, maximumBytes - Buffer.byteLength(admittedStdout));
	return Object.freeze({
		stdout: admittedStdout,
		stderr: truncateUtf8(stderr, remaining),
		exceeded: true,
	});
}

function truncateUtf8(value: string, maximumBytes: number): string {
	return Buffer.from(value).subarray(0, maximumBytes).toString('utf8');
}

function refused(
	reason: Extract<ExternalFfmpegInstallOutcome, { status: 'refused' }>['reason'],
	detail: string,
): ExternalFfmpegInstallOutcome {
	return Object.freeze({ status: 'refused', reason, detail });
}

function cancelled(detail: string, stdout: string, stderr: string): ExternalFfmpegInstallOutcome {
	return Object.freeze({ status: 'cancelled', detail, stdout, stderr });
}

function failed(
	reason: ExternalFfmpegInstallFailureReason,
	detail: string,
	stdout: string,
	stderr: string,
): ExternalFfmpegInstallOutcome {
	return Object.freeze({ status: 'failed', reason, detail, stdout, stderr });
}

function abortDetail(signal: AbortSignal | undefined): string {
	if (signal?.reason instanceof Error && signal.reason.message !== '') return signal.reason.message;
	return 'The external FFmpeg installation was cancelled.';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`The external FFmpeg installer ${label} is outside its closed bound.`);
	}
	return value;
}

function isAbsolutePath(value: string): boolean {
	return typeof value === 'string' && value.length > 0 && value.length <= 4_096
		&& !value.includes('\0') && (posix.isAbsolute(value) || win32.isAbsolute(value));
}
