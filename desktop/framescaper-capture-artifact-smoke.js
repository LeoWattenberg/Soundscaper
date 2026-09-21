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
