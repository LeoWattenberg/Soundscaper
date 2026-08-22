/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
	boundedString,
	deepFreeze,
	exactRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const COMMAND_FIELDS = Object.freeze([
	'executable',
	'arguments',
	'timeoutMilliseconds',
	'maxOutputBytes',
]);
const MAX_ARGUMENT_COUNT = 256;
const MAX_ARGUMENT_LENGTH = 4_096;
const MAX_EXECUTABLE_BYTES = 512 * 1_024 * 1_024;
const HASH_CHUNK_BYTES = 1 * 1_024 * 1_024;

export const M5B_WORKLOAD_DEFAULT_TIMEOUT_MILLISECONDS = 45 * 60 * 1_000;
export const M5B_WORKLOAD_MAX_TIMEOUT_MILLISECONDS = 2 * 60 * 60 * 1_000;
export const M5B_WORKLOAD_DEFAULT_OUTPUT_BYTES = 256 * 1_024;
export const M5B_WORKLOAD_MAX_OUTPUT_BYTES = 1 * 1_024 * 1_024;

export function validateM5bWorkloadCommand(value) {
	const record = exactRecord(
		snapshotStrictJsonData(value, '5B workload command'),
		COMMAND_FIELDS,
		'5B workload command',
	);
	const executable = commandString(record.executable, '5B workload command.executable');
	if (!isAbsolute(executable)) {
		throw new Error('5B workload command.executable must be an absolute path.');
	}
	if (!Array.isArray(record.arguments) || record.arguments.length > MAX_ARGUMENT_COUNT) {
		throw new Error(`5B workload command.arguments must contain at most ${MAX_ARGUMENT_COUNT} strings.`);
	}
	const argumentsList = record.arguments.map((argument, index) => commandString(
		argument,
		`5B workload command.arguments[${index}]`,
	));
	const timeoutMilliseconds = boundedInteger(
		record.timeoutMilliseconds,
		1,
		M5B_WORKLOAD_MAX_TIMEOUT_MILLISECONDS,
		'5B workload command.timeoutMilliseconds',
	);
	const maxOutputBytes = boundedInteger(
		record.maxOutputBytes,
		1,
		M5B_WORKLOAD_MAX_OUTPUT_BYTES,
		'5B workload command.maxOutputBytes',
	);
	return deepFreeze({
		executable,
		arguments: argumentsList,
		timeoutMilliseconds,
		maxOutputBytes,
	});
}

/** Hash one bounded regular executable without loading a native host into memory. */
export async function fingerprintM5bWorkloadExecutable(executableValue) {
	const executable = commandString(executableValue, '5B workload executable');
	if (!isAbsolute(executable)) throw new Error('5B workload executable must be an absolute path.');
	let handle;
	try {
		handle = await open(executable, 'r');
		const before = await handle.stat();
		if (!before.isFile()
			|| !Number.isSafeInteger(before.size)
			|| before.size < 1
			|| before.size > MAX_EXECUTABLE_BYTES) {
			throw new Error(`must be a regular file of at most ${MAX_EXECUTABLE_BYTES} bytes`);
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, before.size));
		let position = 0;
		while (position < before.size) {
			const length = Math.min(buffer.byteLength, before.size - position);
			const { bytesRead } = await handle.read(buffer, 0, length, position);
			if (bytesRead < 1) throw new Error('ended before its recorded byte length');
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		const after = await handle.stat();
		if (after.size !== before.size
			|| after.dev !== before.dev
			|| after.ino !== before.ino
			|| after.mtimeMs !== before.mtimeMs) {
			throw new Error('changed while it was fingerprinted');
		}
		return hash.digest('hex');
	} catch (error) {
		throw workloadError('executable could not be fingerprinted', error);
	} finally {
		await handle?.close();
	}
}

/**
 * Spawn one command directly, with no shell, retry, stdin, or unbounded output.
 * Its stdout must consist of exactly one complete JSON value. Stderr may carry
 * diagnostics, but it shares the same byte budget and never enters evidence.
 */
export async function runM5bQualityWorkload(commandValue, dependencies = {}) {
	const command = validateM5bWorkloadCommand(commandValue);
	const spawnProcess = dependencies.spawnProcess ?? spawn;
	return new Promise((resolvePromise, rejectPromise) => {
		let child;
		let finished = false;
		let outputBytes = 0;
		const stdoutChunks = [];

		const finish = (error, value) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			if (error) rejectPromise(error);
			else resolvePromise(value);
		};
		const terminate = (error) => {
			if (finished) return;
			try {
				killWorkloadProcessTree(child);
			} catch {
				// The bounded refusal is authoritative even if the process exited first.
			}
			finish(error);
		};
		const admitChunk = (chunk, retain) => {
			if (finished) return;
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			outputBytes += bytes.byteLength;
			if (outputBytes > command.maxOutputBytes) {
				terminate(new Error(
					`5B workload command exceeded its ${command.maxOutputBytes}-byte output limit.`,
				));
				return;
			}
			if (retain) stdoutChunks.push(bytes);
		};

		const timer = setTimeout(() => {
			terminate(new Error(
				`5B workload command exceeded its ${command.timeoutMilliseconds}-millisecond time limit.`,
			));
		}, command.timeoutMilliseconds);
		timer.unref();

		try {
			child = spawnProcess(command.executable, command.arguments, {
				detached: process.platform !== 'win32',
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true,
			});
		} catch (error) {
			finish(workloadError('could not be spawned', error));
			return;
		}
		if (!child.stdout || !child.stderr) {
			terminate(new Error('5B workload command did not expose bounded output streams.'));
			return;
		}
		child.stdout.on('data', (chunk) => admitChunk(chunk, true));
		child.stderr.on('data', (chunk) => admitChunk(chunk, false));
		child.stdout.once('error', (error) => terminate(workloadError('stdout failed', error)));
		child.stderr.once('error', (error) => terminate(workloadError('stderr failed', error)));
		child.once('error', (error) => finish(workloadError('failed to start', error)));
		child.once('close', (code, signal) => {
			if (finished) return;
			if (code !== 0 || signal !== null) {
				finish(new Error(
					`5B workload command failed with exit code ${String(code)} and signal ${String(signal)}.`,
				));
				return;
			}
			const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
			if (stdout.length === 0) {
				finish(new Error('5B workload command must emit exactly one JSON diagnostic.'));
				return;
			}
			try {
				finish(null, JSON.parse(stdout));
			} catch (error) {
				finish(workloadError('must emit exactly one JSON diagnostic', error));
			}
		});
	});
}

function commandString(value, path) {
	const string = boundedString(value, 1, MAX_ARGUMENT_LENGTH, path);
	if (string.includes('\0')) throw new Error(`${path} must not contain a NUL byte.`);
	return string;
}

function boundedInteger(value, minimum, maximum, path) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${path} must be a safe integer from ${minimum} through ${maximum}.`);
	}
	return value;
}

function workloadError(message, cause) {
	return new Error(
		`5B workload command ${message}: ${cause instanceof Error ? cause.message : String(cause)}.`,
		{ cause },
	);
}

function killWorkloadProcessTree(child) {
	if (process.platform !== 'win32' && Number.isSafeInteger(child?.pid) && child.pid > 0) {
		try {
			process.kill(-child.pid, 'SIGKILL');
			return;
		} catch {
			// Fall through when the group settled between the bound and the kill.
		}
	}
	child?.kill('SIGKILL');
}
