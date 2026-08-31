/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOAK_DEBUG_FLAG = '--soundscaper-soak-debug';
const PROCESS_TYPES = Object.freeze([
	'Browser', 'Tab', 'Utility', 'Zygote', 'Sandbox helper', 'GPU',
	'Pepper Plugin', 'Pepper Plugin Broker', 'Unknown',
]);

export function soakDebugProcessMetricsEnabled(argv) {
	return Array.isArray(argv) && argv.includes(SOAK_DEBUG_FLAG);
}

export function collectSoakDebugProcessMetrics(application) {
	if (!application || typeof application.getAppMetrics !== 'function') {
		throw new TypeError('Electron process metrics require app.getAppMetrics().');
	}
	const processes = application.getAppMetrics().map((entry) => processMetric(entry))
		.sort((left, right) => left.pid - right.pid);
	const workingSetBytes = processes.reduce((total, process) => total + process.workingSetBytes, 0);
	if (!nonNegativeInteger(workingSetBytes)) {
		throw new TypeError('Electron process working-set total is outside the safe integer range.');
	}
	return deepFreeze({
		schemaVersion: 1,
		workingSetBytes,
		processes,
	});
}

export function validateSoakDebugProcessMetrics(value) {
	const result = plainRecord(value, [
		'schemaVersion', 'workingSetBytes', 'processes',
	], 'Electron soak-debug process metrics');
	if (result.schemaVersion !== 1 || !nonNegativeInteger(result.workingSetBytes)
		|| !Array.isArray(result.processes) || result.processes.length > 128) {
		throw new TypeError('Electron soak-debug process metrics are invalid.');
	}
	const processes = result.processes.map((entry) => {
		const process = plainRecord(entry, ['pid', 'type', 'workingSetBytes'], 'Electron process metric');
		if (!positiveInteger(process.pid) || !nonNegativeInteger(process.workingSetBytes)
			|| !PROCESS_TYPES.includes(process.type)) {
			throw new TypeError('Electron process metric values are invalid.');
		}
		return { pid: process.pid, type: process.type, workingSetBytes: process.workingSetBytes };
	});
	if (processes.some((entry, index) => index > 0 && entry.pid <= processes[index - 1].pid)
		|| processes.reduce((total, process) => total + process.workingSetBytes, 0) !== result.workingSetBytes) {
		throw new TypeError('Electron process metrics are not a canonical working-set projection.');
	}
	return deepFreeze({ schemaVersion: 1, workingSetBytes: result.workingSetBytes, processes });
}

function processMetric(value) {
	const pid = Number(value?.pid);
	const type = typeof value?.type === 'string' ? value.type : '';
	const workingSetKilobytes = Number(value?.memory?.workingSetSize);
	if (!positiveInteger(pid) || !PROCESS_TYPES.includes(type)
		|| !Number.isSafeInteger(workingSetKilobytes) || workingSetKilobytes < 0
		|| workingSetKilobytes > Math.floor(Number.MAX_SAFE_INTEGER / 1024)) {
		throw new TypeError('Electron returned invalid process working-set metrics.');
	}
	return { pid, type, workingSetBytes: workingSetKilobytes * 1024 };
}

function plainRecord(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
		throw new TypeError(`${label} has invalid fields.`);
	}
	return value;
}

function positiveInteger(value) {
	return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
