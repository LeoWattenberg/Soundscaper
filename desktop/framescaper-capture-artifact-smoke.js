/* SPDX-License-Identifier: AGPL-3.0-only */

const PRELOAD_BRIDGE = Object.freeze(['grant', 'listSources', 'status', 'teardown']);
const EVIDENCE_FIELDS = Object.freeze(['grant', 'preloadBridge', 'status', 'teardown']);
const STATUS_FIELDS = Object.freeze([
	'available', 'grantTtlMs', 'selectionMode', 'sourceLimit', 'sourceListTtlMs',
	'systemAudio', 'unavailableReason', 'version',
]);
const GRANT_FIELDS = Object.freeze(['expiresAtMs', 'generation', 'opaqueId', 'roles']);
const TEARDOWN_FIELDS = Object.freeze(['retired', 'retiredAgain']);
const GRANT_ROLES = Object.freeze(['camera', 'microphone']);

/**
 * Exercises the packaged, sandbox-preloaded capture control plane without
 * enumerating or opening a physical capture device. The authority is retired
 * before evidence is returned; failure after grant creation also attempts the
 * same teardown.
 */
export async function runFramescaperCaptureArtifactRendererSmoke(scope) {
	const fail = (message) => { throw new Error(`Framescaper packaged capture smoke ${message}`); };
	const exactKeys = (value, keys, label) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
			fail(`requires the exact ${label}`);
		}
		return value;
	};
	const preloadBridge = ['grant', 'listSources', 'status', 'teardown'];
	const bridge = exactKeys(
		scope?.framescaperCaptureDesktop?.v1,
		preloadBridge,
		'capture preload bridge',
	);
	if (preloadBridge.some((key) => typeof bridge[key] !== 'function')) {
		fail('requires callable capture preload methods');
	}
	const status = exactKeys(await bridge.status(), [
		'version', 'available', 'unavailableReason', 'selectionMode', 'systemAudio',
		'sourceLimit', 'sourceListTtlMs', 'grantTtlMs',
	], 'capture status');
	if (status.version !== 1 || status.available !== true || status.unavailableReason !== null
		|| !['source-list', 'system-picker'].includes(status.selectionMode)
		|| !['windows-loopback', 'unavailable'].includes(status.systemAudio)
		|| status.sourceLimit !== 64 || status.sourceListTtlMs !== 300_000
		|| status.grantTtlMs !== 15_000) {
		fail('received an unavailable or invalid capture status');
	}

	const generation = 1;
	let grantIssued = false;
	try {
		const grant = await bridge.grant({
			generation,
			roles: ['camera', 'microphone'],
			sourceToken: null,
		});
		grantIssued = true;
		exactKeys(grant, ['grantId', 'generation', 'expiresAtMs', 'roles'], 'capture grant');
		if (typeof grant.grantId !== 'string' || !/^[a-f0-9]{32}$/u.test(grant.grantId)
			|| grant.generation !== generation || !Number.isSafeInteger(grant.expiresAtMs)
			|| grant.expiresAtMs < 0
			|| JSON.stringify(grant.roles) !== '["camera","microphone"]') {
			fail('received an invalid capture grant');
		}
		const retired = await bridge.teardown(generation);
		if (retired !== true) fail('did not retire its capture grant');
		grantIssued = false;
		const retiredAgain = await bridge.teardown(generation);
		if (retiredAgain !== false) fail('capture grant did not retire exactly once');
		return {
			preloadBridge,
			status: {
				version: status.version,
				available: status.available,
				unavailableReason: status.unavailableReason,
				selectionMode: status.selectionMode,
				systemAudio: status.systemAudio,
				sourceLimit: status.sourceLimit,
				sourceListTtlMs: status.sourceListTtlMs,
				grantTtlMs: status.grantTtlMs,
			},
			grant: {
				generation,
				expiresAtMs: grant.expiresAtMs,
				roles: ['camera', 'microphone'],
				opaqueId: true,
			},
			teardown: { retired, retiredAgain },
		};
	} finally {
		if (grantIssued) {
			try { await bridge.teardown(generation); } catch { /* The process exit barrier also disposes the port. */ }
		}
	}
}

export function validateFramescaperCaptureArtifactEvidence(value) {
	const record = closedRecord(value, EVIDENCE_FIELDS, 'Framescaper capture artifact evidence');
	const preloadBridge = exactStringArray(
		record.preloadBridge,
		PRELOAD_BRIDGE,
		'Framescaper capture preload bridge',
	);
	const statusRecord = closedRecord(record.status, STATUS_FIELDS, 'Framescaper capture status evidence');
	if (statusRecord.version !== 1 || statusRecord.available !== true
		|| statusRecord.unavailableReason !== null
		|| !['source-list', 'system-picker'].includes(statusRecord.selectionMode)
		|| !['windows-loopback', 'unavailable'].includes(statusRecord.systemAudio)
		|| statusRecord.sourceLimit !== 64 || statusRecord.sourceListTtlMs !== 300_000
		|| statusRecord.grantTtlMs !== 15_000) {
		throw new Error('Framescaper capture status evidence is invalid');
	}
	const status = Object.freeze({
		version: 1,
		available: true,
		unavailableReason: null,
		selectionMode: statusRecord.selectionMode,
		systemAudio: statusRecord.systemAudio,
		sourceLimit: 64,
		sourceListTtlMs: 300_000,
		grantTtlMs: 15_000,
	});
	const grantRecord = closedRecord(record.grant, GRANT_FIELDS, 'Framescaper capture grant evidence');
	if (grantRecord.generation !== 1 || !Number.isSafeInteger(grantRecord.expiresAtMs)
		|| grantRecord.expiresAtMs < 0 || grantRecord.opaqueId !== true) {
		throw new Error('Framescaper capture grant evidence is invalid');
	}
	const roles = exactStringArray(grantRecord.roles, GRANT_ROLES, 'Framescaper capture grant roles');
	const grant = Object.freeze({
		generation: 1,
		expiresAtMs: grantRecord.expiresAtMs,
		roles,
		opaqueId: true,
	});
	const teardownRecord = closedRecord(
		record.teardown,
		TEARDOWN_FIELDS,
		'Framescaper capture teardown evidence',
	);
	if (teardownRecord.retired !== true || teardownRecord.retiredAgain !== false) {
		throw new Error('Framescaper capture grant was not retired exactly once during teardown');
	}
	const teardown = Object.freeze({ retired: true, retiredAgain: false });
	return Object.freeze({ preloadBridge, status, grant, teardown });
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields`);
	}
	const result = Object.create(null);
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function exactStringArray(value, expected, label) {
	if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new Error(`${label} does not match the reviewed contract`);
	}
	return Object.freeze([...expected]);
}
