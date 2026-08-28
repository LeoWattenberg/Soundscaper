/* SPDX-License-Identifier: AGPL-3.0-only */

import { renameSync, writeFileSync } from 'node:fs';
import { access, rename, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE = 'project-library-lease-matrix-v1';
export const DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_LEASE ';

const ACTIONS = new Set([
	'observe-hold', 'commit-hold', 'commit', 'commit-contend', 'verify',
	'crash-prepared', 'crash-committed', 'renderer-loss',
]);
const RENDERER_LOSS_PARK_MS = 100;

export function decodeDesktopProjectLibraryLeaseSmokePlan(encoded) {
	if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
		throw new TypeError('Desktop lease smoke plan must be canonical base64url');
	}
	const text = Buffer.from(encoded, 'base64url').toString('utf8');
	let value;
	try { value = JSON.parse(text); } catch (error) {
		throw new TypeError('Desktop lease smoke plan is not JSON', { cause: error });
	}
	if (Buffer.from(text, 'utf8').toString('base64url') !== encoded) {
		throw new TypeError('Desktop lease smoke plan is not canonical base64url');
	}
	return validatePlan(value);
}

export function createDesktopProjectLibraryLeaseSmokeSession({
	plan,
	productId,
	projectLibraryEvidence,
	projectLibrarySnapshot,
	rendererProcessTerminator = terminateDesktopProjectLibraryLeaseSmokeRenderer,
}) {
	const admitted = validatePlan(plan);
	if (admitted.productId !== productId) throw new Error('Desktop lease smoke plan targets another product');
	if (typeof projectLibraryEvidence !== 'function') throw new TypeError('Desktop lease smoke evidence is unavailable');
	if (typeof rendererProcessTerminator !== 'function') {
		throw new TypeError('Desktop lease smoke renderer terminator is unavailable');
	}
	let attachedWindow = null;
	let checkpointUsed = false;
	let planStarted = false;
	let rendererLossStarted = false;
	let rendererLossRecovered = false;
	return Object.freeze({
		attach(window) {
			attachedWindow = window;
			// Production main-window recovery owns the renderer-loss cleanup barrier
			// and its one trusted reload. The smoke only retains the window so its
			// qualification checkpoint can stage the abrupt process loss.
		},
		leaseQualification: Object.freeze({
			leaseTtlMs: admitted.leaseTtlMs,
			renewIntervalMs: Math.max(100, Math.floor(admitted.leaseTtlMs / 3)),
		// The baseline journal checkpoint is synchronous, so the phase is recorded with
			// synchronous writes and the thread then parks until the matrix kills the
			// process. Parking rather than exiting leaves the journal and the
			// unexpired lease exactly as a crash would.
			//
			// Only the plan's own publication may be crashed. The packaged editor
			// publishes while it boots — it autosaves the project it opens — so the
			// first 'prepared' phase this process reaches belongs to startup, not to
			// the workflow. Crashing there wrote the checkpoint and parked main
			// before the renderer had signalled ready, so the matrix waited out its
			// full control timeout on a ready file main could no longer send.
			checkpoint: (phase) => {
				const target = admitted.action === 'crash-prepared' || admitted.action === 'renderer-loss'
					? 'prepared' : admitted.action === 'crash-committed' ? 'committed' : null;
				if (!planStarted || checkpointUsed || phase !== target) return;
				checkpointUsed = true;
				atomicJsonSync(admitted.control.result, {
					phase, processId: process.pid, host: projectLibrarySnapshot(),
				});
				if (admitted.action !== 'renderer-loss') parkUntilTerminated();
				if (!attachedWindow || attachedWindow.isDestroyed()) throw new Error('Lease smoke renderer is unavailable');
				rendererProcessTerminator(attachedWindow.webContents);
				parkFor(RENDERER_LOSS_PARK_MS);
			},
		}),
		async rendererReady(webContents) {
			if (admitted.action === 'renderer-loss' && rendererLossStarted && !rendererLossRecovered) {
				rendererLossRecovered = true;
				const renderer = await execute(webContents, { ...admitted, action: 'commit' });
				return resultPayload(admitted, renderer, projectLibrarySnapshot(), projectLibraryEvidence);
			}
			if (rendererLossRecovered) return null;
			if (!rendererLossStarted) {
				await atomicJson(admitted.control.ready, { action: admitted.action, processId: process.pid });
				await waitForFile(admitted.control.start);
			}
			if (admitted.action === 'renderer-loss') {
				rendererLossStarted = true;
				planStarted = true;
				await execute(webContents, admitted).catch(() => undefined);
				return null;
			}
			planStarted = true;
			const renderer = await execute(webContents, admitted);
			const payload = await resultPayload(
				admitted, renderer, projectLibrarySnapshot(), projectLibraryEvidence,
			);
			await atomicJson(admitted.control.result, payload);
			if (admitted.action.endsWith('-hold')) await waitForFile(admitted.control.release);
			return payload;
		},
	});
}

/**
 * Ends the renderer without invoking Chromium's crash reporter. A forced crash
 * can remain inside its fatal-signal handler and never deliver
 * `render-process-gone`; SIGKILL models sudden renderer loss and lets the
 * production cleanup/reload path observe the terminated process on every host.
 */
export function terminateDesktopProjectLibraryLeaseSmokeRenderer(
	webContents,
	terminate = (processId, signal) => process.kill(processId, signal),
) {
	if (!webContents || typeof webContents.getOSProcessId !== 'function') {
		throw new TypeError('Desktop lease smoke renderer process identity is unavailable');
	}
	if (typeof terminate !== 'function') {
		throw new TypeError('Desktop lease smoke renderer process termination is unavailable');
	}
	const processId = webContents.getOSProcessId();
	if (!Number.isSafeInteger(processId) || processId < 1) {
		throw new TypeError('Desktop lease smoke renderer process identity is invalid');
	}
	if (processId === process.pid) {
		throw new Error('Desktop lease smoke renderer loss cannot target main');
	}
	terminate(processId, 'SIGKILL');
}

export async function runDesktopProjectLibraryLeaseRendererSmoke(scope, plan) {
	const api = plan.productId === 'framescaper'
		? scope?.framescaperDesktop?.v1?.projectLibrary
		: scope?.soundscaperProjectLibraryDesktop?.v1;
	if (!api) throw new Error(`${plan.productId} lease smoke bridge is unavailable`);
	await api.connect();
	const catalog = await api.listProjects();
	const bundle = await api.readProjectBundle(plan.projectId);
	const observed = {
		metadataRevision: catalog.metadataRevision,
		projectRevision: bundle === null ? null : bundle.project.projectRevision,
		projectSha256: bundle === null ? null : bundle.project.sha256,
	};
	if (plan.action === 'observe-hold' || plan.action === 'verify') {
		return { status: 'observed', ...observed, document: bundle === null ? null : bundle.document };
	}
	// Publish against exactly the base this case read. Main arbitrates the
	// compare-and-swap, so contenders that read the same base race there rather
	// than being pre-screened here. A contender publishes against the base the
	// matrix handed it instead, so the one that arrives after the winner is the
	// loser main refuses.
	const expectedProject = bundle === null ? null : {
		projectRevision: plan.action === 'commit-contend'
			? plan.request.expectedRevision
			: bundle.project.projectRevision,
		projectSha256: bundle.project.sha256,
	};
	if ((plan.request.expectedRevision === null) !== (expectedProject === null)) {
		return { status: 'conflict', ...observed, reason: 'destination-presence' };
	}
	const publicationId = publicationIdFor(scope);
	try {
		await api.beginPublication({
			publicationId,
			expectedMetadataRevision: catalog.metadataRevision,
			expectedProject,
			project: JSON.parse(plan.request.document),
			bodies: [],
		});
	} catch (error) {
		return refusal(error);
	}
	try {
		const result = await api.finishPublication({ publicationId });
		return {
			status: 'committed',
			metadataRevision: result.metadataRevision,
			projectRevision: result.project.projectRevision,
			projectSha256: result.project.sha256,
			document: result.document,
		};
	} catch (error) {
		await api.abortPublication({ publicationId }).catch(() => false);
		return refusal(error);
	}

	function publicationIdFor(globalScope) {
		const bytes = new Uint8Array(24);
		globalScope.crypto.getRandomValues(bytes);
		return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Only the refusals main arbitrates are outcomes of the workflow. Anything
	 * else — a fenced host, a closed session, a failed write — is a defect the
	 * matrix must see rather than a contender that lost fairly.
	 */
	function refusal(error) {
		const message = String(error && error.message ? error.message : error);
		const reason = /failed compare-and-swap/u.test(message) ? 'compare-and-swap'
			: /expected an absent project/u.test(message) ? 'destination-presence'
				: /requires a strictly higher project revision/u.test(message) ? 'revision-order' : null;
		if (reason === null) throw error;
		return { status: 'conflict', ...observed, reason };
	}
}

function execute(webContents, plan) {
	const rendererPlan = {
		action: plan.action,
		productId: plan.productId,
		projectId: plan.projectId,
		request: plan.request,
	};
	return webContents.executeJavaScript(
		`(${runDesktopProjectLibraryLeaseRendererSmoke.toString()})(globalThis, ${JSON.stringify(rendererPlan)})`,
		true,
	);
}

async function resultPayload(plan, renderer, host, projectLibraryEvidence) {
	const evidence = await projectLibraryEvidence(plan.projectId);
	if (evidence?.project?.projectId !== plan.projectId || typeof evidence.project.sha256 !== 'string') {
		throw new Error('Desktop lease smoke project evidence is inconsistent');
	}
	// A source-free matrix must not advertise managed media. The baseline reports
	// the bundle's body count rather than historical source descriptors.
	if (!Number.isSafeInteger(evidence.project.bodyCount) || evidence.project.bodyCount < 0) {
		throw new Error('Desktop lease smoke managed-media evidence is invalid');
	}
	return Object.freeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
		action: plan.action,
		productId: plan.productId,
		renderer,
		host,
		catalog: Object.freeze({
			revision: evidence.project.projectRevision,
			projectSha256: evidence.project.sha256,
			managedMediaBodyCount: evidence.project.bodyCount,
		}),
	});
}

function validatePlan(value) {
	const record = exactRecord(value, [
		'action', 'control', 'leaseTtlMs', 'mode', 'productId', 'projectId', 'request', 'schemaVersion',
	], 'lease smoke plan');
	if (record.schemaVersion !== 1 || record.mode !== DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE) {
		throw new TypeError('Desktop lease smoke plan has an invalid schema or mode');
	}
	if (!ACTIONS.has(record.action)) throw new TypeError('Desktop lease smoke action is unsupported');
	if (record.productId !== 'soundscaper' && record.productId !== 'framescaper') {
		throw new TypeError('Desktop lease smoke product is unsupported');
	}
	if (typeof record.projectId !== 'string' || !record.projectId) {
		throw new TypeError('Desktop lease smoke project id is invalid');
	}
	if (!Number.isSafeInteger(record.leaseTtlMs) || record.leaseTtlMs < 1_000 || record.leaseTtlMs > 5_000) {
		throw new RangeError('Desktop lease smoke TTL is outside its closed range');
	}
	const control = exactRecord(record.control, ['ready', 'release', 'result', 'start'], 'lease smoke control');
	for (const path of Object.values(control)) {
		if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError('Desktop lease smoke control path is invalid');
	}
	if (record.request !== null) {
		const request = exactRecord(record.request, ['document', 'expectedRevision'], 'lease smoke request');
		if (typeof request.document !== 'string' || (request.expectedRevision !== null
			&& (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0))) {
			throw new TypeError('Desktop lease smoke commit request is invalid');
		}
	}
	return deepFreeze(record);
}

function atomicJsonSync(path, value) {
	const temporary = `${path}.${String(process.pid)}.tmp`;
	writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' });
	renameSync(temporary, path);
}

/**
 * Park the thread so the journal and the unexpired lease stay exactly as the
 * checkpoint left them until the matrix terminates this process. Returning
 * instead would let the publication settle and erase the crash being staged.
 */
function parkUntilTerminated() {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

/**
 * Hold the publication open across the renderer loss it just staged. The
 * checkpoint is synchronous, so returning immediately would let the publication
 * settle before the renderer being killed has gone.
 */
function parkFor(durationMs) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

async function atomicJson(path, value) {
	const temporary = `${path}.${String(process.pid)}.tmp`;
	await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
	await rename(temporary, path);
}

async function waitForFile(path) {
	for (let attempt = 0; attempt < 6_000; attempt += 1) {
		try { await access(path); return; } catch { await delay(10); }
	}
	throw new Error('Desktop lease smoke control wait timed out');
}

function exactRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`Desktop ${label} is not a closed object`);
	}
	return value;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}
