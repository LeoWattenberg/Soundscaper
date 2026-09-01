#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	createSoundscaperSoakSchedule,
	soundscaperSoakWatchdogSeconds,
	validateSoundscaperSoakConfig,
} from './lib/soundscaper-soak-debug-config.mjs';
import { createSoundscaperSoakReport } from './lib/soundscaper-soak-debug-report.mjs';

const CONFIG_URL = new URL('../config/soundscaper-soak-debug.json', import.meta.url);
const TARGETS = Object.freeze(['browser', 'desktop', 'both']);
const PROFILES = Object.freeze(['quick', 'extended']);

export function parseSoundscaperSoakArguments(args) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('Soak-debug arguments must be strings.');
	}
	const options = {
		target: 'browser', profile: 'quick', outputDirectory: 'test-results/soak',
		desktopExecutable: null, keepProfileOnFailure: false,
	};
	const seen = new Set();
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--keep-profile-on-failure') {
			if (seen.has(argument)) throw new Error(`${argument} may be supplied once.`);
			seen.add(argument);
			options.keepProfileOnFailure = true;
			continue;
		}
		const keys = {
			'--target': 'target', '--profile': 'profile',
			'--output-directory': 'outputDirectory', '--desktop-executable': 'desktopExecutable',
		};
		const key = keys[argument];
		if (!key) throw new Error(`Unknown soak-debug option ${String(argument)}.`);
		if (seen.has(argument)) throw new Error(`${argument} may be supplied once.`);
		seen.add(argument);
		const value = args[index += 1];
		if (!value) throw new Error(`${argument} requires a value.`);
		options[key] = value;
	}
	if (!TARGETS.includes(options.target)) throw new Error('The soak-debug target must be browser, desktop, or both.');
	if (!PROFILES.includes(options.profile)) throw new Error('The soak-debug profile must be quick or extended.');
	if (typeof options.outputDirectory !== 'string' || !options.outputDirectory.trim()) {
		throw new Error('The soak-debug output directory is invalid.');
	}
	return Object.freeze(options);
}

export async function runSoundscaperSoak(optionsValue = process.argv.slice(2), dependencies = {}) {
	const options = Array.isArray(optionsValue)
		? parseSoundscaperSoakArguments(optionsValue)
		: validateOptions(optionsValue);
	const config = dependencies.config ?? validateSoundscaperSoakConfig(
		JSON.parse(await readFile(CONFIG_URL, 'utf8')),
	);
	const clock = dependencies.clock ?? systemClock();
	const openSession = dependencies.openSession ?? (await import(
		'./lib/soundscaper-soak-playwright.mjs'
	)).openSoundscaperSoakSession;
	const targets = options.target === 'both' ? ['browser', 'desktop'] : [options.target];
	const baseDirectory = resolve(options.outputDirectory);
	await mkdir(baseDirectory, { recursive: true });
	const runs = [];
	for (const target of targets) {
		runs.push(await runTarget({
			config, options, target, baseDirectory, clock, openSession,
			signal: dependencies.signal ?? null,
		}));
	}
	const exitCode = runs.some(({ report }) => report.exitCode === 2) ? 2
		: runs.some(({ report }) => report.exitCode === 1) ? 1 : 0;
	return Object.freeze({ exitCode, runs: Object.freeze(runs) });
}

async function runTarget({ config, options, target, baseDirectory, clock, openSession, signal }) {
	const directoryName = runDirectoryName(clock.now(), target, options.profile);
	const outputDirectory = resolve(baseDirectory, directoryName);
	if (!contained(baseDirectory, outputDirectory)) throw new Error('The soak-debug run directory escaped its output root.');
	await mkdir(outputDirectory, { recursive: false });
	const journal = createJournal(resolve(outputDirectory, 'events.jsonl'), clock);
	let startedAt = null;
	let ceiling = null;
	let targetSignal = signal;
	let session = null;
	let failed = false;
	let failureArtifactCount = 0;
	try {
		session = await openSession({
			target,
			desktopExecutable: options.desktopExecutable,
			keepProfileOnFailure: options.keepProfileOnFailure,
			outputDirectory,
			signal,
			onRuntimeEvent: (type, details = {}) => journal.append(type, sanitizeRuntimeDetails(details)),
		});
		startedAt = clock.monotonicNow();
		ceiling = targetCeiling(config, options.profile);
		targetSignal = signal ? AbortSignal.any([signal, ceiling.signal]) : ceiling.signal;
		await journal.append('run-start', { target, profile: options.profile });
		if (targetSignal.aborted) throw interruptedError(targetSignal.reason);
		const schedule = createSoundscaperSoakSchedule(config, options.profile, target);
		const samples = schedule.filter(({ kind }) => kind === 'sample');
		const operations = schedule.filter(({ kind }) => kind === 'operation');
		const profile = config.profiles[options.profile];
		const warmup = deferred();
		const fatal = new AbortController();
		const runSignal = AbortSignal.any([targetSignal, fatal.signal]);
		let operationsComplete = false;
		const samplingTask = guarded(async () => {
			try {
				for (const item of samples) {
					await sleepUntil(clock, startedAt + (item.elapsedSeconds * 1_000), runSignal);
					const sample = await executeDiagnosticSample(session, runSignal);
					await journal.append('sample', sanitizeSample(sample));
					if (item.elapsedSeconds === profile.warmupSeconds) warmup.resolve();
					if (options.profile === 'quick' && operationsComplete
						&& item.elapsedSeconds > profile.warmupSeconds) return;
				}
			} catch (error) {
				warmup.reject(error);
				throw error;
			}
		}, fatal);
		const operationsTask = guarded(async () => {
			await abortablePromise(warmup.promise, runSignal);
			for (const item of operations) {
				await sleepUntil(clock, startedAt + (item.elapsedSeconds * 1_000), runSignal);
				await executeOperation(item);
			}
			operationsComplete = true;
		}, fatal);
		const tasks = await Promise.allSettled([samplingTask, operationsTask]);
		const rejected = tasks.find((result) => result.status === 'rejected');
		if (rejected) throw fatal.signal.aborted ? fatal.signal.reason : rejected.reason;
		await journal.append('run-end', {
			outcome: 'completed', durationMs: Math.max(0, clock.monotonicNow() - startedAt),
		});
	} catch (error) {
		failed = true;
		const code = errorCode(error);
		if (session && ['SOAK_RUNTIME_CRASH', 'SOAK_INTERRUPTED', 'SOAK_TARGET_TIMEOUT'].includes(code)) {
			await journal.append('run-end', {
				outcome: code === 'SOAK_RUNTIME_CRASH' ? 'crashed'
					: code === 'SOAK_TARGET_TIMEOUT' ? 'timed-out' : 'interrupted',
				durationMs: Math.max(0, clock.monotonicNow() - startedAt),
				reason: errorReason(error),
			});
		} else {
			await journal.append('bootstrap-error', {
				reason: errorReason(error), code: errorCode(error),
			});
		}
	} finally {
		ceiling?.cancel();
		try {
			await session?.close({ failed });
		} catch (error) {
			failed = true;
			await journal.append('cleanup-error', {
				reason: errorReason(error), code: errorCode(error),
			});
		}
		await journal.flush();
	}
	const report = createSoundscaperSoakReport(config, journal.events(), {
		target, profile: options.profile,
		incompleteReason: failed ? 'The soak-debug target did not complete.' : undefined,
	});
	await writeFile(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`, {
		encoding: 'utf8', flag: 'wx',
	});
	return Object.freeze({ target, outputDirectory, report, failureArtifactCount });

	async function executeOperation(item) {
		const operation = config.operations.find(({ id }) => id === item.operationId);
		const operationStartedAt = clock.monotonicNow();
		const operationAbort = new AbortController();
		const operationSignal = AbortSignal.any([targetSignal, operationAbort.signal]);
		const execution = Promise.resolve().then(() => session.execute(
			item.operationId, { variant: item.variant, signal: operationSignal },
		));
		try {
			const measurements = await withTimeout(
				execution,
				operation.timeoutSeconds * 1_000,
				item.operationId,
				targetSignal,
				(error) => operationAbort.abort(error),
			);
			await journal.append('operation', {
				eventId: item.eventId, operationId: item.operationId, status: 'passed',
				durationMs: Math.max(0, clock.monotonicNow() - operationStartedAt),
				measurements: sanitizeMeasurements(measurements),
			});
		} catch (error) {
			if (['SOAK_INTERRUPTED', 'SOAK_TARGET_TIMEOUT'].includes(errorCode(error))) throw error;
			failed = true;
			await journal.append('operation', {
				eventId: item.eventId, operationId: item.operationId, status: 'failed',
				durationMs: Math.max(0, clock.monotonicNow() - operationStartedAt),
				reason: errorReason(error), code: errorCode(error), measurements: {},
			});
			if (failureArtifactCount < config.artifacts.maximumFailureArtifacts) {
				failureArtifactCount += await captureFailure({
					session, outputDirectory, operationId: item.operationId,
					index: failureArtifactCount + 1,
					maximumBytes: config.artifacts.maximumFailureArtifactBytes,
				});
			}
			if (errorCode(error) === 'SOAK_RUNTIME_CRASH') throw error;
			const resetReason = errorCode(error) === 'SOAK_OPERATION_TIMEOUT'
				? 'operation-timeout' : 'operation-failure';
			try {
				if (typeof session.reset !== 'function') {
					throw new Error('The soak-debug session cannot reset failed work.', { cause: error });
				}
				await session.reset({ reason: resetReason, signal: targetSignal });
				await execution.catch(() => undefined);
				await journal.append('runtime-reset', {
					operationId: item.operationId, reason: resetReason,
				});
			} catch (resetError) {
				if (targetSignal.aborted) throw interruptedError(targetSignal.reason);
				if (['SOAK_INTERRUPTED', 'SOAK_TARGET_TIMEOUT'].includes(errorCode(resetError))) {
					throw resetError;
				}
				const crash = new Error(
					`The runtime could not reset after ${item.operationId} failed: ${errorReason(resetError)}`,
					{ cause: resetError },
				);
				crash.code = 'SOAK_RUNTIME_CRASH';
				throw crash;
			}
		} finally {
			if (!operationAbort.signal.aborted) {
				operationAbort.abort(new Error(`The ${item.operationId} operation settled.`));
			}
		}
	}
}

async function executeDiagnosticSample(session, signal) {
	const sampleAbort = new AbortController();
	const sampleSignal = signal
		? AbortSignal.any([signal, sampleAbort.signal]) : sampleAbort.signal;
	const started = deferred();
	const execution = Promise.resolve().then(() => session.sample({
		signal: sampleSignal,
		onStarted: started.resolve,
	}));
	void execution.then(
		() => started.reject(new Error('The diagnostic sample settled before announcing its start.')),
		(error) => started.reject(error),
	);
	await abortablePromise(started.promise, signal);
	return withTimeout(
		execution, 60_000, 'diagnostic-sample', signal,
		(error) => sampleAbort.abort(error),
	);
}

function deferred() {
	let resolvePromise;
	let rejectPromise;
	let settled = false;
	const promise = new Promise((resolveValue, rejectValue) => {
		resolvePromise = resolveValue;
		rejectPromise = rejectValue;
	});
	return Object.freeze({
		promise,
		resolve: () => {
			if (settled) return;
			settled = true;
			resolvePromise();
		},
		reject: (error) => {
			if (settled) return;
			settled = true;
			rejectPromise(error);
		},
	});
}

async function guarded(task, controller) {
	try {
		return await task();
	} catch (error) {
		if (!controller.signal.aborted) controller.abort(error);
		throw error;
	}
}

async function sleepUntil(clock, dueAt, signal) {
	if (signal.aborted) throw interruptedError(signal.reason);
	const delay = Math.max(0, dueAt - clock.monotonicNow());
	if (delay > 0) await clock.sleep(delay, signal);
	if (signal.aborted) throw interruptedError(signal.reason);
}

function abortablePromise(promise, signal) {
	if (signal.aborted) return Promise.reject(interruptedError(signal.reason));
	let abort;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			abort = () => reject(interruptedError(signal.reason));
			signal.addEventListener('abort', abort, { once: true });
		}),
	]).finally(() => signal.removeEventListener('abort', abort));
}

function createJournal(path, clock) {
	const rows = [];
	let pending = Promise.resolve();
	return Object.freeze({ append, flush: () => pending, events: () => [...rows] });

	function append(type, details = {}) {
		const event = Object.freeze({
			schemaVersion: 1,
			sequence: rows.length + 1,
			occurredAt: clock.now().toISOString(),
			monotonicMs: clock.monotonicNow(),
			type,
			...details,
		});
		rows.push(event);
		pending = pending.then(() => appendFile(path, `${JSON.stringify(event)}\n`, 'utf8'));
		return pending;
	}
}

async function captureFailure({ session, outputDirectory, operationId, index, maximumBytes }) {
	try {
		const bytes = await session.captureFailure?.();
		if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) return 0;
		const safeId = operationId.replace(/[^a-z0-9-]/gu, '-');
		await writeFile(
			resolve(outputDirectory, `failure-${String(index).padStart(2, '0')}-${safeId}.png`),
			bytes,
			{ flag: 'wx' },
		);
		return 1;
	} catch {
		return 0;
	}
}

function sanitizeSample(value) {
	const sample = value && typeof value === 'object' ? value : {};
	return {
		usedJsHeapBytes: nonNegative(sample.usedJsHeapBytes),
		forcedCollections: nonNegativeInteger(sample.forcedCollections),
		electronWorkingSetBytes: nullableNonNegative(sample.electronWorkingSetBytes),
		electronWorkingSetUnavailableReason: sample.electronWorkingSetBytes === null
			? boundedText(sample.electronWorkingSetUnavailableReason, 500) : null,
	};
}

function sanitizeMeasurements(value) {
	const source = value && typeof value === 'object' ? value : {};
	const result = {};
	for (const [key, reasonKey] of [
		['decodedMediaAvDriftMaximumMs', 'decodedMediaAvDriftUnavailableReason'],
		['decodedVideoDroppedFrames', 'decodedVideoDroppedFramesUnavailableReason'],
		['streamUnderrunFrames', 'streamUnderrunFramesUnavailableReason'],
	]) {
		if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= 0) {
			result[key] = source[key];
		} else if (source[key] === null) {
			result[key] = null;
			result[reasonKey] = boundedText(source[reasonKey], 500) || 'The measurement is unavailable.';
		}
	}
	if (typeof source.streamedPlaybackObserved === 'boolean') {
		result.streamedPlaybackObserved = source.streamedPlaybackObserved;
	} else if (source.streamedPlaybackObserved === null) {
		result.streamedPlaybackObserved = null;
		result.streamedPlaybackObservedUnavailableReason = boundedText(
			source.streamedPlaybackObservedUnavailableReason, 500,
		) || 'The measurement is unavailable.';
	}
	return result;
}

function sanitizeRuntimeDetails(value) {
	const details = value && typeof value === 'object' ? value : {};
	return {
		name: boundedText(details.name, 64) || 'Error',
		code: /^[A-Z][A-Z0-9_]{0,63}$/u.test(String(details.code ?? ''))
			? String(details.code) : 'UNCLASSIFIED',
		message: boundedText(details.message, 2_000),
	};
}

function validateOptions(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Soak-debug options are invalid.');
	return parseSoundscaperSoakArguments([
		'--target', value.target,
		'--profile', value.profile,
		'--output-directory', value.outputDirectory,
		...(value.desktopExecutable ? ['--desktop-executable', value.desktopExecutable] : []),
		...(value.keepProfileOnFailure ? ['--keep-profile-on-failure'] : []),
	]);
}

function systemClock() {
	const origin = performance.now();
	return {
		now: () => new Date(),
		monotonicNow: () => performance.now() - origin,
		sleep: (milliseconds, signal) => abortableDelay(milliseconds, signal),
	};
}

function targetCeiling(config, profile) {
	const durationSeconds = soundscaperSoakWatchdogSeconds(config, profile);
	const controller = new AbortController();
	const timer = setTimeout(() => {
		const error = new Error(`The ${profile} target reached its ${String(durationSeconds)}-second ceiling.`);
		error.code = 'SOAK_TARGET_TIMEOUT';
		controller.abort(error);
	}, durationSeconds * 1_000);
	return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function withTimeout(promise, milliseconds, operationId, signal, onTimeout = () => undefined) {
	let timer;
	let abortHandler;
	return Promise.race([
		Promise.resolve(promise),
		new Promise((_, reject) => {
			timer = setTimeout(() => {
				const error = new Error(`${operationId} exceeded its ${String(milliseconds)} ms timeout.`);
				error.code = 'SOAK_OPERATION_TIMEOUT';
				onTimeout(error);
				reject(error);
			}, milliseconds);
		}),
		new Promise((_, reject) => {
			if (!signal) return;
			abortHandler = () => reject(interruptedError(signal.reason));
			if (signal.aborted) abortHandler();
			else signal.addEventListener('abort', abortHandler, { once: true });
		}),
	]).finally(() => {
		clearTimeout(timer);
		if (abortHandler) signal?.removeEventListener('abort', abortHandler);
	});
}

function abortableDelay(milliseconds, signal) {
	if (signal?.aborted) return Promise.reject(interruptedError(signal.reason));
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(finish, milliseconds);
		const abort = () => finish(interruptedError(signal.reason));
		if (signal) signal.addEventListener('abort', abort, { once: true });
		function finish(error) {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolvePromise();
		}
	});
}

function runDirectoryName(date, target, profile) {
	const timestamp = date.toISOString().replace(/[-:]/gu, '').replace('.', '');
	return `${timestamp}-${target}-${profile}`;
}

function contained(parent, child) {
	const relativePath = relative(parent, child);
	return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function nonNegative(value) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new TypeError('A soak-debug numeric sample is invalid.');
	}
	return value;
}

function nullableNonNegative(value) {
	return value === null ? null : nonNegative(value);
}

function nonNegativeInteger(value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('A soak-debug count is invalid.');
	return value;
}

function boundedText(value, maximum) {
	return typeof value === 'string' ? [...value].map((character) => {
		const code = character.codePointAt(0);
		return code < 32 || code === 127 ? ' ' : character;
	}).join('').slice(0, maximum) : '';
}

function errorReason(error) {
	return boundedText(error instanceof Error ? error.message : String(error), 1_000) || 'Unknown failure.';
}

function errorCode(error) {
	try {
		const code = error && typeof error === 'object' ? error.code : null;
		return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : 'UNCLASSIFIED';
	} catch {
		return 'UNCLASSIFIED';
	}
}

function interruptedError(reason) {
	const error = new Error(reason instanceof Error ? reason.message : 'The soak-debug run was interrupted.');
	error.code = reason?.code === 'SOAK_TARGET_TIMEOUT' ? 'SOAK_TARGET_TIMEOUT' : 'SOAK_INTERRUPTED';
	return error;
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	const controller = new AbortController();
	const interrupt = () => controller.abort(new Error('The soak-debug run was interrupted.'));
	process.once('SIGINT', interrupt);
	process.once('SIGTERM', interrupt);
	try {
		const result = await runSoundscaperSoak(process.argv.slice(2), { signal: controller.signal });
		for (const run of result.runs) {
			process.stdout.write(`${run.target}: ${run.report.status} (${run.outputDirectory})\n`);
		}
		process.exitCode = result.exitCode;
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 2;
	} finally {
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', interrupt);
	}
}
