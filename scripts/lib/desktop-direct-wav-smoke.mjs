/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './desktop-smoke.mjs';
import {
	DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
	DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX,
	absoluteDesktopDirectWavPath,
	assertDesktopDirectWavOutputCleanup,
	canonicalDesktopDirectWavJson,
	createDesktopDirectWavSmokeAggregate,
	createDesktopDirectWavStagingObserver,
	formatDesktopDirectWavSmokeAggregate,
	freezeDesktopDirectWavValue,
	validDesktopDirectWavPlatform,
	validDesktopDirectWavToken,
	validateDesktopDirectWavOutputPaths,
	validateDesktopDirectWavPayload,
	validateDesktopDirectWavPlan,
	verifyDesktopDirectWavFile,
} from './desktop-direct-wav-smoke-evidence.mjs';

export {
	DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
	DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX,
	createDesktopDirectWavSmokeAggregate,
	createDesktopDirectWavStagingObserver,
	formatDesktopDirectWavSmokeAggregate,
	verifyDesktopDirectWavFile,
};

export const MAX_DESKTOP_DIRECT_WAV_PLAN_BYTES = 4 * 1024;

const MIB = 1024 * 1024;
const MAXIMUM_CHILD_OUTPUT_BYTES = MIB;
const MAXIMUM_CHILD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CHILD_TIMEOUT_MS = 4 * 60 * 1000;
const CHILD_TERMINATION_GRACE_MS = 250;
const CHILD_SETTLEMENT_TIMEOUT_MS = 1_000;

export function createDesktopDirectWavSmokePlan({ token, productId = 'soundscaper' } = {}) {
	return freezeDesktopDirectWavValue(validateDesktopDirectWavPlan({
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId,
		token,
	}));
}

export function encodeDesktopDirectWavSmokePlan(value) {
	const encoded = Buffer.from(
		canonicalDesktopDirectWavJson(validateDesktopDirectWavPlan(value)),
		'utf8',
	).toString('base64url');
	if (Buffer.byteLength(encoded, 'utf8') > MAX_DESKTOP_DIRECT_WAV_PLAN_BYTES) {
		throw new RangeError('Desktop direct-WAV smoke plan exceeds its 4 KiB command-line limit');
	}
	return encoded;
}

export function decodeDesktopDirectWavSmokePlan(value) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
		throw new TypeError('Desktop direct-WAV smoke plan must use canonical base64url');
	}
	if (Buffer.byteLength(value, 'utf8') > MAX_DESKTOP_DIRECT_WAV_PLAN_BYTES) {
		throw new RangeError('Desktop direct-WAV smoke plan exceeds its 4 KiB command-line limit');
	}
	const bytes = Buffer.from(value, 'base64url');
	if (bytes.toString('base64url') !== value) {
		throw new TypeError('Desktop direct-WAV smoke plan must use canonical base64url');
	}
	let parsed;
	try {
		parsed = JSON.parse(bytes.toString('utf8'));
	} catch (error) {
		throw new TypeError('Desktop direct-WAV smoke plan is not valid JSON', { cause: error });
	}
	const plan = validateDesktopDirectWavPlan(parsed);
	if (canonicalDesktopDirectWavJson(plan) !== bytes.toString('utf8')) {
		throw new TypeError('Desktop direct-WAV smoke plan must use canonical JSON');
	}
	return freezeDesktopDirectWavValue(plan);
}

export function deriveDesktopDirectWavSmokePaths(appDataPath, token) {
	const appData = absoluteDesktopDirectWavPath(appDataPath, 'isolated app-data root');
	const root = resolve(appData, `direct-wav-smoke-${validDesktopDirectWavToken(token)}`);
	return freezeDesktopDirectWavValue({
		root,
		completed: resolve(root, 'completed.wav'),
		cancelled: resolve(root, 'cancelled.wav'),
	});
}

export function createDesktopDirectWavSmokeInvocation({
	arch,
	outputRoot,
	platform,
	profileRoot,
	productId = 'soundscaper',
	token,
} = {}) {
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const targetPlatform = validDesktopDirectWavPlatform(platform);
	const output = absoluteDesktopDirectWavPath(outputRoot, 'package output root');
	const profile = absoluteDesktopDirectWavPath(profileRoot, 'profile root');
	const plan = createDesktopDirectWavSmokePlan({ token, productId });
	const encodedPlan = encodeDesktopDirectWavSmokePlan(plan);
	const sharedAppDataPath = resolve(profile, 'application-data');
	const userDataPath = resolve(profile, 'profile');
	const productName = plan.productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
	return freezeDesktopDirectWavValue({
		arch: targetArch,
		platform: targetPlatform,
		productId: plan.productId,
		plan,
		encodedPlan,
		userDataPath,
		sharedAppDataPath,
		outputPaths: deriveDesktopDirectWavSmokePaths(sharedAppDataPath, plan.token),
		executableCandidates: packagedExecutableCandidates({
			arch: targetArch,
			outputRoot: output,
			platform: targetPlatform,
			productId: plan.productId,
			productName,
		}),
		appArguments: [
			`--user-data-dir=${userDataPath}`,
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DESKTOP_DIRECT_WAV_SMOKE_MODE}`,
			`--soundscaper-smoke-plan=${encodedPlan}`,
			`--soundscaper-smoke-app-data=${sharedAppDataPath}`,
			'--lang=en',
			'--mute-audio',
			'--autoplay-policy=no-user-gesture-required',
		],
	});
}

export function parseDesktopDirectWavSmokeOutput(output, invocation) {
	if (typeof output !== 'string') throw new TypeError('Packaged direct-WAV child output must be text');
	if (Buffer.byteLength(output, 'utf8') > MAXIMUM_CHILD_OUTPUT_BYTES) {
		throw new RangeError('Packaged direct-WAV child output exceeds its 1 MiB limit');
	}
	validateInvocation(invocation);
	const matches = output.split(/\r?\n/u)
		.filter((line) => line.startsWith(DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX));
	if (matches.length !== 1) throw new Error('Packaged direct-WAV child must emit exactly one smoke result');
	let payload;
	try {
		payload = JSON.parse(matches[0].slice(DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX.length));
	} catch (error) {
		throw new TypeError('Packaged direct-WAV child emitted invalid result JSON', { cause: error });
	}
	validateDesktopDirectWavPayload(payload, invocation);
	return freezeDesktopDirectWavValue(payload);
}

export function runBoundedDesktopDirectWavChild(command, args, {
	cwd,
	environment,
	maximumOutputBytes = MAXIMUM_CHILD_OUTPUT_BYTES,
	timeoutMs = DEFAULT_CHILD_TIMEOUT_MS,
} = {}) {
	if (typeof command !== 'string' || !command || command.includes('\0')) {
		throw new TypeError('Packaged direct-WAV child command is required');
	}
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
		throw new TypeError('Packaged direct-WAV child arguments must be strings without NUL bytes');
	}
	const directory = absoluteDesktopDirectWavPath(cwd, 'child working directory');
	if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
		throw new TypeError('Packaged direct-WAV child environment is required');
	}
	const outputLimit = integerInRange(maximumOutputBytes, 1, MAXIMUM_CHILD_OUTPUT_BYTES, 'child output limit');
	const timeout = integerInRange(timeoutMs, 1, MAXIMUM_CHILD_TIMEOUT_MS, 'child timeout');
	const childEnvironment = { ...environment };
	delete childEnvironment.ELECTRON_RUN_AS_NODE;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: directory,
			detached: process.platform !== 'win32',
			env: childEnvironment,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		const stdoutChunks = [];
		const stderrChunks = [];
		let outputBytes = 0;
		let failure = null;
		let settled = false;
		let childClosed = false;
		let forceSent = false;
		let timeoutHandle;
		let forceHandle;
		let settlementHandle;
		const clearTimers = () => {
			clearTimeout(timeoutHandle);
			clearTimeout(forceHandle);
			clearTimeout(settlementHandle);
		};
		const rejectOnce = (error, abandonChild = false) => {
			if (settled) return;
			settled = true;
			clearTimers();
			if (abandonChild) {
				child.stdout.destroy();
				child.stderr.destroy();
				child.unref();
			}
			reject(error);
		};
		const terminate = (error) => {
			if (failure) return;
			failure = error;
			clearTimeout(timeoutHandle);
			if (process.platform === 'win32') {
				terminateWindowsChildTree(child);
			} else {
				signalPosixChildGroup(child, 'SIGTERM');
				forceHandle = setTimeout(() => {
					forceSent = true;
					signalPosixChildGroup(child, 'SIGKILL');
					if (childClosed) rejectOnce(failure);
				}, CHILD_TERMINATION_GRACE_MS);
			}
			settlementHandle = setTimeout(() => {
				if (process.platform === 'win32') terminateWindowsChildTree(child);
				else {
					forceSent = true;
					signalPosixChildGroup(child, 'SIGKILL');
				}
				rejectOnce(failure, true);
			}, CHILD_SETTLEMENT_TIMEOUT_MS);
		};
		const append = (chunks) => (chunk) => {
			if (failure) return;
			const bytes = Buffer.from(chunk);
			outputBytes += bytes.byteLength;
			if (outputBytes > outputLimit) {
				terminate(new RangeError(`Packaged direct-WAV child output exceeds ${String(outputLimit)} bytes`));
				return;
			}
			chunks.push(bytes);
		};
		child.stdout.on('data', append(stdoutChunks));
		child.stderr.on('data', append(stderrChunks));
		child.on('error', (error) => {
			if (!failure) rejectOnce(error);
		});
		timeoutHandle = setTimeout(() => {
			terminate(new Error(`Packaged direct-WAV child timed out after ${String(timeout)} milliseconds`));
		}, timeout);
		child.once('close', (code, signal) => {
			if (settled) return;
			childClosed = true;
			if (failure && process.platform !== 'win32' && !forceSent) return;
			settled = true;
			clearTimers();
			if (failure) return reject(failure);
			if (signal) return reject(new Error(`Packaged direct-WAV child exited with signal ${signal}`));
			resolvePromise({
				code,
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
			});
		});
	});
}

export async function runDesktopDirectWavSmoke({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot,
	productId = environment.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper',
	removeProfile = rm,
	token = randomBytes(16).toString('hex'),
} = {}) {
	const root = absoluteDesktopDirectWavPath(repositoryRoot, 'repository root');
	if (typeof removeProfile !== 'function') throw new TypeError('Desktop direct-WAV profile remover must be a function');
	const packageRoot = outputRoot === undefined ? resolve(root, 'release/desktop') : outputRoot;
	const profileRoot = await mkdtemp(join(tmpdir(), 'scape-direct-wav-'));
	let operationError;
	let aggregate;
	try {
		const invocation = createDesktopDirectWavSmokeInvocation({
			arch, outputRoot: packageRoot, platform, profileRoot, productId, token,
		});
		const executable = await findPackagedExecutable(invocation);
		const observer = createDesktopDirectWavStagingObserver(invocation.outputPaths);
		const useXvfb = platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
		const command = useXvfb ? 'xvfb-run' : executable;
		const args = useXvfb ? ['-a', executable, ...invocation.appArguments] : invocation.appArguments;
		const childEnvironment = { ...environment };
		delete childEnvironment.ELECTRON_RUN_AS_NODE;
		delete childEnvironment.SCAPE_PRODUCT;
		let child;
		let childError;
		try {
			child = await runBoundedDesktopDirectWavChild(command, args, {
				cwd: root,
				environment: childEnvironment,
			});
		} catch (error) {
			childError = error;
		}
		let cancellation;
		let observerError;
		try {
			cancellation = await observer.stop();
		} catch (error) {
			observerError = error;
		}
		if (childError && observerError) {
			throw new AggregateError([childError, observerError], 'Direct-WAV child and staging observation failed');
		}
		if (observerError) throw observerError;
		if (childError) throw childError;
		if (child.code !== 0) {
			throw new Error(`Packaged direct-WAV smoke exited with code ${String(child.code)}.\n${childDiagnostics(child)}`);
		}
		if (
			!cancellation.observed
			|| cancellation.maximumStagedBytes <= 44
			|| cancellation.riffHeaderValidated !== true
			|| cancellation.nonzeroPayloadByteObserved !== true
		) {
			throw new Error('Packaged direct-WAV cancellation staging evidence is incomplete');
		}
		if (cancellation.remainingStagingFiles !== 0) {
			throw new Error('Packaged direct-WAV cancellation left staging files behind');
		}
		const payload = parseDesktopDirectWavSmokeOutput(child.stdout, invocation);
		await assertDesktopDirectWavOutputCleanup(invocation.outputPaths);
		const file = await verifyDesktopDirectWavFile(invocation.outputPaths.completed);
		aggregate = createDesktopDirectWavSmokeAggregate({
			invocation,
			payload,
			platform,
			arch,
			file,
			cancellation: { ...cancellation, cancelledFileAbsent: true },
		});
	} catch (error) {
		operationError = error;
	}
	let cleanupError;
	try {
		await removeProfile(profileRoot, { recursive: true, force: true });
	} catch (error) {
		cleanupError = error;
	}
	if (operationError && cleanupError) {
		throw new AggregateError(
			[operationError, cleanupError],
			'Desktop direct-WAV smoke failed and profile cleanup also failed',
			{ cause: operationError },
		);
	}
	if (operationError) throw operationError;
	if (cleanupError) throw cleanupError;
	return aggregate;
}

function signalPosixChildGroup(child, signal) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		if (error?.code === 'ESRCH') return;
		try {
			child.kill(signal);
		} catch {
			// The independent settlement deadline remains authoritative.
		}
	}
}

function terminateWindowsChildTree(child) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
		stdio: 'ignore',
		windowsHide: true,
	});
	killer.once('error', () => {
		try {
			child.kill('SIGKILL');
		} catch {
			// The independent settlement deadline remains authoritative.
		}
	});
	killer.unref();
}

function childDiagnostics(child) {
	return [child.stdout, child.stderr].filter(Boolean).join('\n');
}

function validateInvocation(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop direct-WAV invocation must be an object');
	}
	const plan = validateDesktopDirectWavPlan(value.plan);
	if (value.productId !== plan.productId) throw new Error('Packaged direct-WAV invocation product does not match its plan');
	const decoded = decodeDesktopDirectWavSmokePlan(value.encodedPlan);
	if (canonicalDesktopDirectWavJson(decoded) !== canonicalDesktopDirectWavJson(plan)) {
		throw new Error('Packaged direct-WAV invocation encoded plan does not match');
	}
	validateDesktopDirectWavOutputPaths(value.outputPaths);
}

async function findPackagedExecutable(invocation) {
	for (const candidate of invocation.executableCandidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next electron-builder output convention.
		}
	}
	throw new Error(`No packaged ${invocation.productId} executable was found for the direct-WAV smoke`);
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`Desktop direct-WAV ${label} must be an integer from ${String(minimum)} to ${String(maximum)}`);
	}
	return value;
}
