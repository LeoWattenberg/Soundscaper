/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';

const CHILD_TERMINATION_GRACE_MS = 250;
const CHILD_SETTLEMENT_TIMEOUT_MS = 1_000;

// The CLI wrappers own admission, diagnostics, and result freezing. This kernel
// supervises an admitted invocation, including descendants that hold its pipes.
export function runBoundedSmokeChild(command, args, {
	cwd, environment, outputLimit, timeout, label, errorEvent,
}, {
	spawnChild = spawn,
	platform = process.platform,
	killGroup = (pid, signal) => process.kill(pid, signal),
} = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawnChild(command, args, {
			cwd,
			detached: platform !== 'win32',
			env: environment,
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
			if (platform === 'win32') {
				terminateWindowsChildTree(child, spawnChild);
			} else {
				signalPosixChildGroup(child, 'SIGTERM', killGroup);
				forceHandle = setTimeout(() => {
					forceSent = true;
					signalPosixChildGroup(child, 'SIGKILL', killGroup);
					if (childClosed) rejectOnce(failure);
				}, CHILD_TERMINATION_GRACE_MS);
			}
			settlementHandle = setTimeout(() => {
				if (platform === 'win32') terminateWindowsChildTree(child, spawnChild);
				else {
					forceSent = true;
					signalPosixChildGroup(child, 'SIGKILL', killGroup);
				}
				rejectOnce(failure, true);
			}, CHILD_SETTLEMENT_TIMEOUT_MS);
		};
		const append = (chunks) => (chunk) => {
			if (failure) return;
			const bytes = Buffer.from(chunk);
			outputBytes += bytes.byteLength;
			if (outputBytes > outputLimit) {
				terminate(new RangeError(`Packaged ${label} child output exceeds ${String(outputLimit)} bytes`));
				return;
			}
			chunks.push(bytes);
		};
		child.stdout.on('data', append(stdoutChunks));
		child.stderr.on('data', append(stderrChunks));
		child[errorEvent]('error', (error) => {
			if (!failure) rejectOnce(error);
		});
		timeoutHandle = setTimeout(() => {
			terminate(new Error(`Packaged ${label} child timed out after ${String(timeout)} milliseconds`));
		}, timeout);
		child.once('close', (code, signal) => {
			if (settled) return;
			childClosed = true;
			if (failure && platform !== 'win32' && !forceSent) return;
			settled = true;
			clearTimers();
			if (failure) return reject(failure);
			if (signal) return reject(new Error(`Packaged ${label} child exited with signal ${signal}`));
			resolvePromise({
				code,
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
			});
		});
	});
}

function signalPosixChildGroup(child, signal, killGroup) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	try {
		killGroup(-child.pid, signal);
	} catch (error) {
		if (error?.code === 'ESRCH') return;
		try {
			child.kill(signal);
		} catch {
			// The independent settlement deadline remains authoritative.
		}
	}
}

function terminateWindowsChildTree(child, spawnChild) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	const killer = spawnChild('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
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
