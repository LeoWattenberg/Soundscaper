/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile, spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

/** Compiling generated Vulkan translation units needs more time than configuring CMake. */
export function desktopAssistanceCommandTimeout(executable, args) {
	return executable === 'cmake' && args[0] === '--build' ? 60 * 60_000 : 15 * 60_000;
}

/**
 * @typedef {import('node:events').EventEmitter & {
 *   pid?: number, stdout: import('node:stream').Readable, stderr: import('node:stream').Readable,
 *   kill: (signal?: NodeJS.Signals) => boolean, unref: () => void
 * }} AssistanceBuildChild
 */

/**
 * Own the compiler tree until it closes, including when a deadline or output bound stops it.
 * @param {string} executable
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, label: string, timeout?: number, maxBuffer?: number, onOutput?: (text: string) => void}} options
 * @param {{spawnChild?: (executable: string, args: string[], options: import('node:child_process').SpawnOptionsWithStdioTuple<'ignore', 'pipe', 'pipe'>) => AssistanceBuildChild, platform?: string, terminateTree?: (child: AssistanceBuildChild, platform: string) => Promise<void>}} dependencies
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function runDesktopAssistanceBuildCommand(executable, args, {
	cwd = process.cwd(), env = process.env, label, timeout = desktopAssistanceCommandTimeout(executable, args),
	maxBuffer = 8 * 1024 * 1024,
	onOutput = executable === 'cmake' && args[0] === '--build' ? text => { process.stderr.write(text); } : undefined,
}, { spawnChild = spawn, platform = process.platform, terminateTree = terminateCompilerTree } = {}) {
	if (executable === 'cmake' && args[0] === '--build') {
		console.error(`[${label}] ${executable} ${args.join(' ')}; deadline ${timeout / 60_000} minutes.`);
	}
	return new Promise((resolve, reject) => {
		const child = spawnChild(executable, args, {
			cwd, env, windowsHide: true, detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
		});
		const stdout = { chunks: [], bytes: 0 }, stderr = { chunks: [], bytes: 0 };
		const compiling = executable === 'cmake' && args[0] === '--build';
		let outputBytes = 0, failure, terminationFailure;
		let closed = false, stopping = false, treeStopped = false, settled = false;
		let exitCode, exitSignal, settlementTimer;
		const timer = setTimeout(() => stop(new Error(`timed out after ${timeout} ms`)), timeout);

		function finish(abandon = false) {
			if (settled || (!abandon && (!closed || (stopping && !treeStopped)))) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(settlementTimer);
			if (abandon) {
				child.stdout.destroy();
				child.stderr.destroy();
				child.unref();
			}
			const captured = { stdout: Buffer.concat(stdout.chunks).toString('utf8'), stderr: Buffer.concat(stderr.chunks).toString('utf8') };
			const cause = failure ?? (exitCode !== 0 ? new Error(exitSignal ? `signal ${exitSignal}` : `exit code ${exitCode}`) : undefined);
			if (!cause) { resolve(captured); return; }
			const shutdown = terminationFailure ? `\nCompiler tree shutdown failed: ${terminationFailure.message}` : '';
			reject(new Error(`${label} build failed (${cause.message}): ${executable} ${args.join(' ')}${shutdown}\n${captured.stdout}\n${captured.stderr}`, { cause }));
		}

		function stop(error) {
			if (stopping || settled) return;
			stopping = true;
			failure = error;
			clearTimeout(timer);
			// taskkill must finish before the caller can remove a Windows compiler's cwd.
			settlementTimer = setTimeout(() => finish(true), 15_000);
			void Promise.resolve().then(() => terminateTree(child, platform)).then(() => {
				treeStopped = true;
				finish();
			}, error => {
				terminationFailure = error;
				try { child.kill('SIGKILL'); } catch { /* The independent settlement bound still applies. */ }
				treeStopped = true;
				finish();
			});
		}

		function append(stream, chunk) {
			if (stopping || settled) return;
			const bytes = Buffer.from(chunk);
			outputBytes += bytes.byteLength;
			if (!compiling && outputBytes > maxBuffer) { stop(new RangeError(`output exceeds ${maxBuffer} bytes`)); return; }
			stream.chunks.push(bytes);
			stream.bytes += bytes.byteLength;
			// CMake progress can exceed execFile's capture limit. Stream it all to
			// CI, retaining only a bounded diagnostic tail for a possible failure.
			while (compiling && stream.bytes > maxBuffer) {
				const oldest = stream.chunks[0];
				const discard = Math.min(oldest.byteLength, stream.bytes - maxBuffer);
				if (discard === oldest.byteLength) stream.chunks.shift();
				else stream.chunks[0] = oldest.subarray(discard);
				stream.bytes -= discard;
			}
			try { onOutput?.(bytes.toString('utf8')); } catch (error) { stop(error); }
		}
		child.stdout.on('data', chunk => append(stdout, chunk));
		child.stderr.on('data', chunk => append(stderr, chunk));
		child.once('error', error => { failure ??= error; closed = true; finish(); });
		child.once('close', (code, signal) => { closed = true; exitCode = code; exitSignal = signal; finish(); });
	});
}

/**
 * A failed cleanup must never replace the compiler diagnostic printed by the CLI.
 * @template T
 * @param {string} work
 * @param {() => Promise<T>} build
 * @param {{remove?: (path: string, options: {recursive: boolean, force: boolean, maxRetries: number, retryDelay: number}) => Promise<void>}} dependencies
 * @returns {Promise<T>}
 */
export async function withDesktopAssistanceBuildWork(work, build, { remove = rm } = {}) {
	let result, failure, cleanupFailure;
	try { result = await build(); } catch (error) { failure = error; }
	try { await remove(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); }
	catch (error) { cleanupFailure = error; }
	if (failure && cleanupFailure) {
		throw new AggregateError([failure, cleanupFailure], `${failure.message}\nBuild cleanup also failed: ${cleanupFailure.message}`, { cause: failure });
	}
	if (failure) throw failure;
	if (cleanupFailure) throw cleanupFailure;
	return result;
}

async function terminateCompilerTree(child, platform) {
	if (!Number.isSafeInteger(child.pid) || child.pid < 1) return;
	if (platform === 'win32') {
		await runFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
	} else {
		try { process.kill(-child.pid, 'SIGKILL'); }
		catch (error) { if (error.code !== 'ESRCH') throw error; }
	}
}
