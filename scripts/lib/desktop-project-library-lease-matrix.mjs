/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX,
} from '../../desktop/project-library-lease-smoke.js';
import { createDesktopProjectLibraryHandoffStages } from './desktop-project-library-handoff-smoke.mjs';
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
	const projectId = `lease-matrix-${workflowId}`;
	const initial = document(projectId, 1, `${workflowId} initial`);
	const primary = order[0];
	const secondary = order[1];
	let results;
	if (workflowId === 'same-project-simultaneous-open') {
		const seed = await run(scope, primary, 'commit', projectId, request(initial, null));
		const observers = await runConcurrentHolds(scope, [primary, primary], 'observe-hold', projectId, null);
		results = [seed, ...observers];
	} else if (workflowId === 'cross-product-simultaneous-open') {
		const seed = await run(scope, primary, 'commit', projectId, request(initial, null));
		results = [seed, ...await runConcurrentHolds(scope, [primary, secondary], 'observe-hold', projectId, null)];
	} else if (workflowId === 'writer-lease-transfer') {
		const holder = await startHold(scope, primary, 'commit-hold', projectId, request(initial, null));
		await holder.start();
		await holder.waitResult();
		const advanced = document(projectId, 4, `${workflowId} advanced`);
		const transferred = await run(scope, secondary, 'commit', projectId, request(advanced, 1));
		results = [holder.result, transferred];
		await holder.release();
	} else if (workflowId === 'stale-lease-takeover') {
		const crashed = await crashAtCheckpoint(scope, primary, 'crash-prepared', projectId, request(initial, null));
		const takeover = await run(scope, secondary, 'commit', projectId, request(initial, null));
		results = [crashed, takeover];
		if (takeover.host?.lastWriter?.tookOverStaleLease !== true) throw new Error('Stale takeover was not evidenced');
	} else if (workflowId === 'conflicting-canonical-commit') {
		const seed = await run(scope, primary, 'commit', projectId, request(initial, null));
		const left = document(projectId, 8, `${workflowId} left`);
		const right = document(projectId, 8, `${workflowId} right`);
		const contenders = await runConcurrentHolds(scope, [primary, secondary], 'commit-hold', projectId, [
			request(left, 1), request(right, 1),
		]);
		const committed = contenders.filter((result) => result.renderer?.status === 'committed');
		const conflicts = contenders.filter((result) => result.renderer?.status === 'conflict');
		if (committed.length !== 1 || conflicts.length !== 1) throw new Error('Canonical conflict did not select one winner');
		results = [seed, ...contenders];
	} else if (workflowId === 'renderer-loss-during-operation') {
		results = await runRendererLoss(scope, primary, projectId, request(initial, null));
	} else if (workflowId === 'orderly-process-restart') {
		results = [
			await run(scope, primary, 'commit', projectId, request(initial, null)),
			await run(scope, primary, 'verify', projectId, null),
		];
	} else {
		results = [
			await crashAtCheckpoint(scope, primary, 'crash-committed', projectId, request(initial, null)),
			await run(scope, secondary, 'commit', projectId, request(initial, null)),
		];
		if (results[1].host?.lastWriter?.recovery?.outcome !== 'committed') {
			throw new Error('Committed crash journal was not recovered');
		}
	}
	const tokens = results.flatMap((result) => {
		const token = result.host?.lastWriter?.fencingToken ?? result.host?.activeWriter?.fencingToken;
		return Number.isSafeInteger(token) ? [token] : [];
	}).sort((left, right) => left - right);
	if (new Set(tokens).size !== tokens.length) throw new Error('Lease matrix fencing tokens are not strictly increasing');
	const winningDocument = finalDocument(results) ?? initial;
	const winningDocumentSha256 = sha256(winningDocument);
	const finalCatalog = results.toReversed().find((result) => result.catalog)?.catalog;
	if (finalCatalog?.projectSha256 !== winningDocumentSha256) {
		throw new Error('Lease matrix catalog does not advertise the exact winning document');
	}
	const managedDescriptors = [...new Set(results.flatMap(
		(result) => result.catalog?.managedMediaDescriptors ?? [],
	))].sort();
	if (managedDescriptors.length !== 0) {
		throw new Error('Source-free lease matrix advertised a losing managed-media descriptor');
	}
	return deepFreeze({
		workflowId,
		order: order.join('-then-'),
		fencingTokens: tokens,
		winningDocumentSha256,
		losingManagedMediaDescriptors: managedDescriptors,
	});
}

async function runConcurrentHolds(scope, products, action, projectId, requests) {
	const holds = await Promise.all(products.map((productId, index) => startHold(
		scope, productId, action, projectId, Array.isArray(requests) ? requests[index] : requests,
	)));
	await Promise.all(holds.map((hold) => hold.start()));
	const results = await Promise.all(holds.map((hold) => hold.waitResult()));
	await Promise.all(holds.map((hold) => hold.release()));
	return results;
}

async function startHold(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	await waitForFile(child.control.ready);
	let result;
	return {
		get result() { return result; },
		start: () => touch(child.control.start),
		async waitResult() { result ??= JSON.parse(await waitForFile(child.control.result)); return result; },
		async release() {
			if (!result) await this.waitResult();
			await touch(child.control.release);
			await expectCleanExit(child);
		},
	};
}

async function run(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	await waitForFile(child.control.ready);
	await touch(child.control.start);
	const exit = await expectCleanExit(child);
	return parseChildOutput(exit.output);
}

async function runRendererLoss(scope, productId, projectId, commitRequest) {
	const child = await launch(scope, productId, 'renderer-loss', projectId, commitRequest);
	await waitForFile(child.control.ready);
	await touch(child.control.start);
	const checkpoint = JSON.parse(await waitForFile(child.control.result));
	const exit = await expectCleanExit(child);
	return [checkpoint, parseChildOutput(exit.output)];
}

async function crashAtCheckpoint(scope, productId, action, projectId, commitRequest) {
	const child = await launch(scope, productId, action, projectId, commitRequest);
	await waitForFile(child.control.ready);
	await touch(child.control.start);
	const checkpoint = JSON.parse(await waitForFile(child.control.result));
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
	return { child, control, exit };
}

async function expectCleanExit(process) {
	let timeoutId;
	const timeout = new Promise((_resolve, reject) => {
		timeoutId = setTimeout(() => reject(new Error('Lease matrix child timed out')), CHILD_TIMEOUT_MS);
	});
	const exit = await Promise.race([process.exit, timeout]).finally(() => clearTimeout(timeoutId));
	if (exit.code !== 0 || exit.signal) throw new Error(`Lease matrix child failed (${String(exit.code)}/${String(exit.signal)}): ${exit.output}`);
	return exit;
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

async function waitForFile(path) {
	for (let attempt = 0; attempt < 9_000; attempt += 1) {
		try { return await readFile(path, 'utf8'); } catch (error) {
			if (error.code !== 'ENOENT') throw error;
			await delay(10);
		}
	}
	throw new Error(`Lease matrix control timed out: ${path}`);
}

function touch(path) { return writeFile(path, '', { flag: 'wx' }); }
function request(document, expectedRevision) { return { document, expectedRevision }; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function finalDocument(results) {
	for (const result of results.toReversed()) {
		if (result.renderer?.status === 'committed') return result.renderer.document;
		if (typeof result.renderer?.document === 'string') return result.renderer.document;
	}
	return null;
}
function document(id, revision, title) {
	const base = JSON.parse(createDesktopProjectLibraryHandoffStages()[0].target.document);
	return JSON.stringify({ ...base, id, title, revision, metadata: { ...base.metadata, title } });
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}
