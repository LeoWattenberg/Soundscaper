/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX,
} from '../../desktop/project-library-lease-smoke.js';
import { createSoundscaperProjectV21 } from '../../src/soundscaper/editor-project-v21.ts';
import { packagedExecutableCandidates, resolveSmokeArchitecture } from './desktop-smoke.mjs';

export const DESKTOP_PROJECT_LIBRARY_LEASE_MATRIX_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_LEASE_MATRIX ';
export const DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS = Object.freeze([
	'same-project-simultaneous-open',
	'cross-product-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
]);

export const DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS = Object.freeze(
	DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS.filter(
		(workflowId) => workflowId !== 'cross-product-simultaneous-open',
	),
);

const TTL_MS = 1_000;
const CHILD_TIMEOUT_MS = 90_000;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
/** Both catalogs raise a lease another live instance holds under this exact wording. */
const WRITER_LEASE_BUSY = /desktop V10 writer lease is busy/u;

export function createDesktopProjectLibraryLeaseMatrixPlan({ action, control, productId, projectId, request }) {
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
		action,
		control,
		leaseTtlMs: TTL_MS,
		productId,
		projectId,
		request,
	});
}

export async function runDesktopProjectLibraryLeaseMatrix({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot = resolve(repositoryRoot, 'release/desktop-lease-matrix'),
} = {}) {
	const root = resolve(repositoryRoot);
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const smokeRoot = await mkdtemp(join(tmpdir(), 'scape-lease-matrix-'));
	try {
		const runtime = { root, targetArch, platform, environment, outputRoot: resolve(outputRoot), smokeRoot };
		const cases = [];
		for (const workflowId of DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS) {
			cases.push(await runCase(runtime, workflowId, ['soundscaper', 'soundscaper']));
		}
		return deepFreeze({
			schemaVersion: 1,
			mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
			platform,
			arch: targetArch,
			workflows: DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS,
			cases,
		});
	} finally {
		await rm(smokeRoot, { recursive: true, force: true });
	}
}

export function formatDesktopProjectLibraryLeaseMatrix(value) {
	const line = `${DESKTOP_PROJECT_LIBRARY_LEASE_MATRIX_PREFIX}${JSON.stringify(value)}`;
	if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) throw new RangeError('Lease matrix result exceeds 1 MiB');
	return line;
}

async function runCase(runtime, workflowId, order) {
	const caseRoot = join(runtime.smokeRoot, `${workflowId}-${order.join('-')}`);
	await mkdir(caseRoot, { recursive: true });
	const scope = { ...runtime, caseRoot, appDataPath: join(caseRoot, 'application-data'), childIndex: 0 };
	return runDesktopProjectLibraryLeaseMatrixCase({ driver: createChildDriver(scope), workflowId, order });
}

export async function runDesktopProjectLibraryLeaseMatrixCase({ driver, workflowId, order }) {
	const projectId = `lease-matrix-${workflowId}`;
	const initial = createDesktopProjectLibraryLeaseMatrixDocument(projectId, 1, `${workflowId} initial`);
	const primary = order[0];
	const secondary = order[1];
	let results;
	if (workflowId === 'same-project-simultaneous-open' || workflowId === 'cross-product-simultaneous-open') {
		const contender = workflowId === 'cross-product-simultaneous-open' ? secondary : primary;
		const seed = await driver.commit(primary, 'commit', projectId, request(initial, null));
		const holder = await driver.hold(primary, 'observe-hold', projectId, null);
		await holder.start();
		await holder.waitResult();
		// One writer per library for the life of the process: the instance that
		// arrives second is refused rather than admitted alongside the holder.
		const refused = await driver.refuse(contender, 'observe-hold', projectId, null);
		await holder.release();
		results = [seed, holder.result, refused];
	} else if (workflowId === 'writer-lease-transfer') {
		const holder = await driver.hold(primary, 'commit-hold', projectId, request(initial, null));
		await holder.start();
		await holder.waitResult();
		// The lease only transfers once its holder has given it up.
		await holder.release();
		const advanced = createDesktopProjectLibraryLeaseMatrixDocument(projectId, 4, `${workflowId} advanced`);
		const transferred = await driver.commit(secondary, 'commit', projectId, request(advanced, 1));
		results = [holder.result, transferred];
	} else if (workflowId === 'stale-lease-takeover') {
		const crashed = await driver.crash(primary, 'crash-prepared', projectId, request(initial, null));
		const takeover = await driver.commit(secondary, 'commit', projectId, request(initial, null));
		results = [crashed, takeover];
		if (takeover.host?.writer?.tookOverStaleLease !== true) throw new Error('Stale takeover was not evidenced');
	} else if (workflowId === 'conflicting-canonical-commit') {
		const seed = await driver.commit(primary, 'commit', projectId, request(initial, null));
		const left = createDesktopProjectLibraryLeaseMatrixDocument(projectId, 8, `${workflowId} left`);
		const right = createDesktopProjectLibraryLeaseMatrixDocument(projectId, 8, `${workflowId} right`);
		// Both contenders are handed the seeded base, so the one that reaches the
		// library second publishes against a base the winner already superseded.
		const winner = await driver.commit(primary, 'commit-contend', projectId, request(left, 1));
		const loser = await driver.commit(secondary, 'commit-contend', projectId, request(right, 1));
		if (winner.renderer?.status !== 'committed') throw new Error('Canonical conflict did not select one winner');
		if (loser.renderer?.status !== 'conflict' || loser.renderer.reason !== 'compare-and-swap') {
			throw new Error('Canonical conflict did not refuse the second contender by compare-and-swap');
		}
		results = [seed, winner, loser];
	} else if (workflowId === 'renderer-loss-during-operation') {
		const [checkpoint, recovered] = await driver.rendererLoss(primary, projectId, request(initial, null));
		if (checkpoint.phase !== 'prepared' || checkpoint.host?.activePublication !== true) {
			throw new Error('Renderer loss did not land on an in-flight publication');
		}
		if (recovered.renderer?.status !== 'committed') {
			throw new Error('Renderer loss left its abandoned publication canonical');
		}
		results = [checkpoint, recovered];
	} else if (workflowId === 'orderly-process-restart') {
		results = [
			await driver.commit(primary, 'commit', projectId, request(initial, null)),
			await driver.commit(primary, 'verify', projectId, null),
		];
	} else {
		results = [
			await driver.crash(primary, 'crash-committed', projectId, request(initial, null)),
			await driver.commit(secondary, 'commit', projectId, request(initial, null)),
		];
		if (results[1].host?.writer?.recovery?.outcome !== 'committed') {
			throw new Error('Committed crash journal was not recovered');
		}
	}
	const tokens = fencingTokens(results);
	const winningDocumentSha256 = winningDigest(results);
	const finalCatalog = results.toReversed().find((result) => result.catalog)?.catalog;
	if (!winningDocumentSha256 || finalCatalog?.projectSha256 !== winningDocumentSha256) {
		throw new Error('Lease matrix catalog does not advertise the exact winning document');
	}
	const bodyCounts = results.flatMap((result) => (
		Number.isSafeInteger(result.catalog?.managedMediaBodyCount) ? [result.catalog.managedMediaBodyCount] : []
	));
	if (bodyCounts.some((count) => count !== 0)) {
		throw new Error('Source-free lease matrix advertised a managed-media body');
	}
	return deepFreeze({
		workflowId,
		order: order.join('-then-'),
		fencingTokens: tokens,
		refusedInstances: results.filter((result) => result.refused).length,
		winningDocumentSha256,
		losingManagedMediaBodyCounts: bodyCounts,
	});
}

/**
 * V10 takes one writer lease per process lifetime and renews it without minting
 * a new token, so a holder reports the same token for every result it produces.
 * Fencing only guarantees that the next acquisition outranks every token the
 * library issued before it.
 */
function fencingTokens(results) {
	const tokens = [];
	const holders = new Map();
	let highest = null;
	for (const result of results) {
		const token = result.host?.writer?.fencingToken;
		if (!Number.isSafeInteger(token)) continue;
		const holder = result.host?.owner?.instanceId;
		if (typeof holder !== 'string' || !holder) {
			throw new Error('Lease matrix fencing evidence does not identify its lease holder');
		}
		const held = holders.get(holder);
		if (held === undefined) {
			if (highest !== null && token <= highest) {
				throw new Error('Lease matrix fencing token did not advance across acquisitions');
			}
		} else if (token < held) {
			throw new Error('Lease matrix fencing token regressed within one lease holder');
		}
		holders.set(holder, token);
		highest = highest === null || token > highest ? token : highest;
		tokens.push(token);
	}
	return tokens;
}

function createChildDriver(scope) {
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
	if (!WRITER_LEASE_BUSY.test(exit.output)) {
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
		if (Buffer.byteLength(output) > MAXIMUM_OUTPUT_BYTES) void terminateTree(child, scope.platform);
	});
	const exit = new Promise((resolveExit, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolveExit({ code, signal, get output() { return output; } }));
	});
	return { child, control, exit, get output() { return output; } };
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

async function terminateTree(child, platform) {
	if (child.exitCode !== null || child.signalCode !== null) return;
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
function request(document, expectedRevision) { return { document, expectedRevision }; }
/** The digest main published, so the assertion compares stored bytes rather than re-encoded text. */
function winningDigest(results) {
	for (const result of results.toReversed()) {
		if (result.renderer?.status === 'committed') return result.renderer.projectSha256;
	}
	for (const result of results.toReversed()) {
		if (typeof result.renderer?.projectSha256 === 'string') return result.renderer.projectSha256;
	}
	return null;
}
export function createDesktopProjectLibraryLeaseMatrixDocument(id, revision, title) {
	const base = createSoundscaperProjectV21({ id, title });
	return JSON.stringify({ ...base, revision, metadata: { ...base.metadata, title } });
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}
