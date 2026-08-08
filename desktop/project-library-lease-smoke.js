/* SPDX-License-Identifier: AGPL-3.0-only */

import { access, rename, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE = 'project-library-lease-matrix-v1';
export const DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_LEASE ';

const ACTIONS = new Set([
	'observe-hold', 'commit-hold', 'commit', 'verify',
	'crash-prepared', 'crash-committed', 'renderer-loss',
]);

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
}) {
	const admitted = validatePlan(plan);
	if (admitted.productId !== productId) throw new Error('Desktop lease smoke plan targets another product');
	if (typeof projectLibraryEvidence !== 'function') throw new TypeError('Desktop lease smoke evidence is unavailable');
	let attachedWindow = null;
	let checkpointUsed = false;
	let rendererLossStarted = false;
	let rendererLossRecovered = false;
	return Object.freeze({
		attach(window) { attachedWindow = window; },
		hostOptions: Object.freeze({
			leaseTtlMs: admitted.leaseTtlMs,
			renewIntervalMs: Math.max(100, Math.floor(admitted.leaseTtlMs / 3)),
			checkpoint: async (phase) => {
				const target = admitted.action === 'crash-prepared' || admitted.action === 'renderer-loss'
					? 'prepared' : admitted.action === 'crash-committed' ? 'committed' : null;
				if (checkpointUsed || phase !== target) return;
				checkpointUsed = true;
				await atomicJson(admitted.control.result, {
					phase, processId: process.pid, host: projectLibrarySnapshot(),
				});
				if (admitted.action !== 'renderer-loss') await new Promise(() => {});
				if (!attachedWindow || attachedWindow.isDestroyed()) throw new Error('Lease smoke renderer is unavailable');
				attachedWindow.webContents.forcefullyCrashRenderer();
				await delay(100);
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
				await execute(webContents, admitted).catch(() => undefined);
				return null;
			}
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

export async function runDesktopProjectLibraryLeaseRendererSmoke(scope, plan) {
	const api = scope?.scapeDesktop?.v1;
	if (!api) throw new Error('Desktop lease smoke bridge is unavailable');
	if (plan.action === 'observe-hold' || plan.action === 'verify') {
		return {
			document: await api.readSharedProject(plan.projectId),
			projects: await api.listSharedProjects(),
		};
	}
	return api.commitSharedProject(plan.request);
}

function execute(webContents, plan) {
	const rendererPlan = {
		action: plan.action,
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
	if (evidence?.project?.id !== plan.projectId || typeof evidence.project.sha256 !== 'string') {
		throw new Error('Desktop lease smoke project evidence is inconsistent');
	}
	const managedMediaDescriptors = [...new Set((evidence.sources ?? []).map((source) => source?.bindingId))].sort();
	if (managedMediaDescriptors.some((id) => typeof id !== 'string' || !id)) {
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
			revision: evidence.catalogRevision,
			projectSha256: evidence.project.sha256,
			managedMediaDescriptors: Object.freeze(managedMediaDescriptors),
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
		throw new TypeError('Desktop lease smoke product is invalid');
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
