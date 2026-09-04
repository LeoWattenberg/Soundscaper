/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
	createDesktopProjectLibraryLeaseMatrixPlan,
	isDesktopProjectLibraryWriterLeaseBusy,
} from './desktop-project-library-lease-matrix.mjs';
import {
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX,
} from '../../desktop/project-library-lease-smoke.js';
import { packagedExecutableCandidates } from './desktop-smoke.mjs';

const CHILD_TIMEOUT_MS = 90_000;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;

/**
 * Driving the packaged instances a lease-matrix case needs.
 *
 * Every case is about what happens when two real desktop instances want the same project
 * writer lease, so each one is a launched application rather than a stub: an instance that
 * commits, one that holds and waits, one that must be refused, one that is killed at a
 * checkpoint, and one whose renderer is lost. Only a real process exercises the lease the
 * way the operating system does, which is why the crash paths terminate whole process
 * trees rather than a single PID.
 */

export function createChildDriver(scope) {
	return Object.freeze({
		commit: (productId, action, projectId, commitRequest) => (
			run(scope, productId, action, projectId, commitRequest)
		),
		hold: (productId, action, projectId, commitRequest) => (
			startHold(scope, productId, action, projectId, commitRequest)
		),
		refuse: (productId, action, projectId, commitRequest) => (
			expectRefusal(scope, productId, action, projectId, commitRequest)
		),
		crash: (productId, action, projectId, commitRequest) => (
			crashAtCheckpoint(scope, productId, action, projectId, commitRequest)
		),
		rendererLoss: (productId, projectId, commitRequest) => (
			runRendererLoss(scope, productId, projectId, commitRequest)
		),
	});
}

/**
 * Launch an instance that must not come up, and prove it failed on the writer
 * lease rather than on anything else. It never reaches a renderer, so there is
 * no control file to wait for — only the exit.
 */
async function expectRefusal(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	const exit = await awaitExit(child);
	if (exit.code === 0 && !exit.signal) {
		throw new Error('Lease matrix second instance was admitted while the writer lease was held');
	}
	if (!isDesktopProjectLibraryWriterLeaseBusy(exit.output)) {
		throw new Error(`Lease matrix second instance failed for another reason: ${exit.output}`);
	}
	return { refused: 'writer-lease-busy' };
}

async function startHold(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	await awaitLeaseMatrixControlFile(child.control.ready, child);
	let result;
	return {
		get result() { return result; },
		start: () => touch(child.control.start),
		async waitResult() {
			result ??= JSON.parse(await awaitLeaseMatrixControlFile(child.control.result, child));
			return result;
		},
		async release() {
			if (!result) await this.waitResult();
			await touch(child.control.release);
			await expectCleanExit(child);
		},
	};
}

async function run(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	await awaitLeaseMatrixControlFile(child.control.ready, child);
	await touch(child.control.start);
	const exit = await expectCleanExit(child);
	return parseChildOutput(exit.output);
}

async function runRendererLoss(scope, productId, projectId, commitRequest) {
	const child = await launch(scope, productId, 'renderer-loss', projectId, commitRequest);
	await awaitLeaseMatrixControlFile(child.control.ready, child);
	await touch(child.control.start);
	const checkpoint = JSON.parse(await awaitLeaseMatrixControlFile(child.control.result, child));
	const exit = await expectCleanExit(child);
	return [checkpoint, parseChildOutput(exit.output)];
}

async function crashAtCheckpoint(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	await awaitLeaseMatrixControlFile(child.control.ready, child);
	await touch(child.control.start);
	const checkpoint = JSON.parse(await awaitLeaseMatrixControlFile(child.control.result, child));
	await terminateTree(child.child, scope.platform);
	await child.exit;
	return checkpoint;
}

async function launch(scope, productId, action, projectId, commitRequest) {
	const index = scope.childIndex++;
	const controlRoot = join(scope.caseRoot, `control-${String(index)}`);
	await mkdir(controlRoot, { recursive: true });
	const control = Object.freeze({
		ready: join(controlRoot, 'ready.json'),
		result: join(controlRoot, 'result.json'),
		start: join(controlRoot, 'start'),
		release: join(controlRoot, 'release'),
	});
	const plan = createDesktopProjectLibraryLeaseMatrixPlan({
		action, control, productId, projectId, request: commitRequest,
	});
	const executable = await findExecutable(scope, productId);
	const appArguments = [
		`--user-data-dir=${join(scope.caseRoot, `profile-${productId}-${String(index)}`)}`,
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE}`,
		`--soundscaper-smoke-plan=${Buffer.from(JSON.stringify(plan)).toString('base64url')}`,
		`--soundscaper-smoke-app-data=${scope.appDataPath}`,
	];
	const useXvfb = scope.platform === 'linux' && scope.environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
	const command = useXvfb ? 'xvfb-run' : executable;
	const args = useXvfb ? ['-a', executable, ...appArguments] : appArguments;
	const environment = { ...scope.environment };
	delete environment.ELECTRON_RUN_AS_NODE;
	delete environment.SCAPE_PRODUCT;
	const child = spawn(command, args, {
		cwd: scope.root,
		env: environment,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: scope.platform !== 'win32',
	});
	let output = '';
	for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
		output += String(chunk);
		if (Buffer.byteLength(output) > MAXIMUM_OUTPUT_BYTES) {
			void terminateTree(child, scope.platform).catch(() => undefined);
		}
	});
	const exit = new Promise((resolveExit, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolveExit({ code, signal, get output() { return output; } }));
	});
	const launched = { child, control, exit, get output() { return output; } };
	scope.children.add(launched);
	void exit.then(
		() => scope.children.delete(launched),
		() => scope.children.delete(launched),
	);
	return launched;
}

async function expectCleanExit(process) {
	const exit = await awaitExit(process);
	if (exit.code !== 0 || exit.signal) throw new Error(`Lease matrix child failed (${String(exit.code)}/${String(exit.signal)}): ${exit.output}`);
	return exit;
}

async function awaitExit(process) {
	let timeoutId;
	const timeout = new Promise((_resolve, reject) => {
		timeoutId = setTimeout(() => reject(new Error('Lease matrix child timed out')), CHILD_TIMEOUT_MS);
	});
	return Promise.race([process.exit, timeout]).finally(() => clearTimeout(timeoutId));
}

function parseChildOutput(output) {
	const lines = output.split(/\r?\n/u).filter((line) => line.startsWith(DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX));
	if (lines.length !== 1) throw new Error(`Lease matrix child emitted ${String(lines.length)} results`);
	return JSON.parse(lines[0].slice(DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX.length));
}

async function findExecutable(scope, productId) {
	const candidates = packagedExecutableCandidates({
		arch: scope.targetArch,
		outputRoot: resolve(scope.outputRoot, productId),
		platform: scope.platform,
		productId,
		productName: productId === 'framescaper' ? 'Framescaper' : 'Soundscaper',
	});
	for (const candidate of candidates) {
		try { await access(candidate); return candidate; } catch { /* Try the next package convention. */ }
	}
	throw new Error(`No packaged ${productId} executable was found for the lease matrix`);
}

export async function terminateTree(child, platform) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
	if (platform === 'win32') {
		const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
		await new Promise((resolveKill) => killer.once('exit', resolveKill));
		return;
	}
	try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
		if (error.code !== 'ESRCH') throw error;
	}
}

/**
 * Every control file is written by the packaged child, so the child is the only
 * thing that can explain a file that never arrives. Racing its exit and
 * reporting what it printed keeps a stalled workflow from reaching CI as a bare
 * path and a spent timeout, which is how the startup-publication deadlock in the
 * crash checkpoint first presented.
 */
export async function awaitLeaseMatrixControlFile(path, process) {
	for (let attempt = 0; attempt < 9_000; attempt += 1) {
		try { return await readFile(path, 'utf8'); } catch (error) {
			if (error.code !== 'ENOENT') throw error;
			if (process.child.exitCode !== null || process.child.signalCode !== null) {
				throw new Error(
					`Lease matrix child exited before writing ${path}: ${childDiagnostics(process)}`,
					{ cause: error },
				);
			}
			await delay(10);
		}
	}
	throw new Error(`Lease matrix control timed out: ${path}: ${childDiagnostics(process)}`);
}

function childDiagnostics(process) {
	const { exitCode, signalCode } = process.child;
	return `child exit ${String(exitCode)}/${String(signalCode)}; output ${process.output || '(none)'}`;
}

function touch(path) { return writeFile(path, '', { flag: 'wx' }); }
/**
 * A lease a crashed instance left behind only becomes takeable once it expires,
 * and its successor acquires during main-process startup. On a fast machine
 * that startup can finish inside the one-second TTL, where the correct answer
 * is the refusal these cases are not testing — so they would fail on how
 * quickly Electron starts rather than on recovery. Waiting the lease out makes
 * the case measure what it is named after on every machine.
 */
