/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded packaged canary that reaches the native device API without selecting real hardware. */

const BACKENDS = Object.freeze({
	'linux-x64': Object.freeze(['pipewire', 'alsa', 'jack']),
	'linux-arm64': Object.freeze(['pipewire', 'alsa', 'jack']),
	'mac-arm64': Object.freeze(['coreaudio']),
	'win-x64': Object.freeze(['wasapi', 'asio']),
	'win-arm64': Object.freeze(['wasapi', 'asio']),
});
const INVENTORY_STATUSES = Object.freeze(['ok', 'backend-unavailable', 'server-unavailable']);
const OPEN_STATUSES = Object.freeze([
	'ok', 'backend-unavailable', 'server-unavailable', 'device-unavailable',
	'format-refused', 'mode-refused', 'unsupported',
]);
const DEVICE_HANDLE = 'soundscaper-self-test-nonexistent';

export function runSoundscaperProfessionalNativeAudioCanary(addon, target) {
	const expected = BACKENDS[target];
	assert(expected, 'The packaged professional audio target is unsupported.');
	assert(typeof addon?.enumerateAudioBackends === 'function'
		&& typeof addon?.openAudioDevice === 'function'
		&& typeof addon?.closeAudioDevice === 'function',
	'The packaged professional addon omits its native audio API.');
	const backends = addon.enumerateAudioBackends();
	assert(Array.isArray(backends)
		&& JSON.stringify(backends.map(({ backend }) => backend)) === JSON.stringify(expected),
	'The packaged professional backend inventory changed.');
	for (const row of backends) validateBackendRow(row);
	const requestedBackend = expected[0];
	const request = Object.freeze({
		candidates: Object.freeze([Object.freeze({ backend: requestedBackend, deviceHandle: DEVICE_HANDLE })]),
		direction: 0,
		exclusive: 0,
		sampleRate: 48_000,
		periodFrames: 256,
		channelCount: 2,
	});
	const opened = addon.openAudioDevice(request);
	validateOpenResult(opened, requestedBackend);
	let status = 'typed-refusal';
	if (opened.status === 'ok') {
		assert(opened.session !== null && opened.session !== undefined
			&& addon.closeAudioDevice(opened.session) === true,
		'The packaged professional audio canary did not close its native session.');
		status = 'opened-and-closed';
	} else {
		assert(!Object.hasOwn(opened, 'session'),
			'A refused packaged professional audio open returned a session.');
	}
	return deepFreeze({
		backends: structuredClone(backends),
		audioOperation: {
			operation: 'native-device-open-probe', status,
			requestedBackend, resultStatus: opened.status, attempts: opened.attempts.length,
		},
	});
}

export function validateSoundscaperProfessionalNativeAudioCanaryEvidence(value, target) {
	const expected = BACKENDS[target];
	assert(expected && value && typeof value === 'object',
		'The packaged professional audio evidence target is invalid.');
	assert(Array.isArray(value.backends)
		&& JSON.stringify(value.backends.map(({ backend }) => backend)) === JSON.stringify(expected),
	'The packaged professional audio evidence inventory changed.');
	for (const row of value.backends) validateBackendRow(row);
	const operation = value.audioOperation;
	assert(operation && exactKeys(operation, [
		'operation', 'status', 'requestedBackend', 'resultStatus', 'attempts',
	]) && operation.operation === 'native-device-open-probe'
		&& ['typed-refusal', 'opened-and-closed'].includes(operation.status)
		&& operation.requestedBackend === expected[0] && OPEN_STATUSES.includes(operation.resultStatus)
		&& operation.attempts === 1
		&& (operation.resultStatus === 'ok') === (operation.status === 'opened-and-closed'),
	'The packaged professional native audio operation evidence is invalid.');
	return value;
}

function validateBackendRow(row) {
	assert(exactKeys(row, ['backend', 'status', 'detail', 'devices'])
		&& typeof row.backend === 'string' && INVENTORY_STATUSES.includes(row.status)
		&& typeof row.detail === 'string' && Array.isArray(row.devices),
	'The packaged professional backend status is invalid.');
	for (const device of row.devices) {
		assert(exactKeys(device, ['handle', 'label', 'direction'])
			&& typeof device.handle === 'string' && device.handle.length > 0
			&& typeof device.label === 'string'
			&& ['input', 'output', 'duplex'].includes(device.direction),
		'The packaged professional backend device inventory is invalid.');
	}
	assert(row.status === 'ok' || row.devices.length === 0,
		'An unavailable packaged professional backend reported devices.');
}

function validateOpenResult(value, requestedBackend) {
	assert(value && typeof value === 'object' && OPEN_STATUSES.includes(value.status)
		&& value.requestedBackend === requestedBackend && typeof value.detail === 'string'
		&& Array.isArray(value.attempts) && value.attempts.length === 1,
	'The packaged professional native audio open result is invalid.');
	const attempt = value.attempts[0];
	assert(exactKeys(attempt, ['backend', 'deviceHandle', 'status', 'detail'])
		&& attempt.backend === requestedBackend && attempt.deviceHandle === DEVICE_HANDLE
		&& OPEN_STATUSES.includes(attempt.status) && typeof attempt.detail === 'string'
		&& attempt.status === value.status,
	'The packaged professional native audio attempt evidence is invalid.');
}

function exactKeys(value, fields) {
	return !!value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Reflect.ownKeys(value).sort()) === JSON.stringify([...fields].sort());
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
