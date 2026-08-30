/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	runSoundscaperProfessionalNativeAudioCanary,
} from '../desktop/soundscaper-professional-native-utility-audio-canary.js';
import {
	PROFESSIONAL_NATIVE_UTILITY_SMOKE_PREFIX,
	runSoundscaperProfessionalNativeUtilitySmoke,
} from '../desktop/soundscaper-professional-native-utility-smoke.mjs';

test('professional utility smoke is dormant without its packaged-only argument', async () => {
	assert.equal(await runSoundscaperProfessionalNativeUtilitySmoke({
		argv: [], packaged: true, utilityProcess: null, helperPath: '/helper', log() {},
	}), false);
	await assert.rejects(() => runSoundscaperProfessionalNativeUtilitySmoke({
		argv: ['--soundscaper-professional-native-utility-smoke=/addon.node'],
		packaged: false, utilityProcess: null, helperPath: '/helper', log() {},
	}), /packaged-only/iu);
});

test('professional utility audio canary reaches a valid native open and closes any session', () => {
	let request = null;
	let closed = null;
	const result = runSoundscaperProfessionalNativeAudioCanary({
		enumerateAudioBackends: () => [{
			backend: 'coreaudio', status: 'ok', detail: '', devices: [],
		}],
		openAudioDevice(value) {
			request = value;
			return {
				status: 'device-unavailable', requestedBackend: 'coreaudio',
				detail: 'fixture device is absent', attempts: [{
					backend: 'coreaudio', deviceHandle: value.candidates[0].deviceHandle,
					status: 'device-unavailable', detail: 'fixture device is absent',
				}],
			};
		},
		closeAudioDevice(session) { closed = session; return true; },
	}, 'mac-arm64');
	assert.deepEqual(request, {
		candidates: [{
			backend: 'coreaudio',
			deviceHandle: 'soundscaper-self-test-nonexistent',
		}],
		direction: 0, exclusive: 0, sampleRate: 48_000, periodFrames: 256, channelCount: 2,
	});
	assert.equal(closed, null);
	assert.deepEqual(result.backends, [{ backend: 'coreaudio', status: 'ok', detail: '', devices: [] }]);
	assert.equal(result.audioOperation.operation, 'native-device-open-probe');
	assert.equal(result.audioOperation.resultStatus, 'device-unavailable');
});

test('professional utility audio canary refuses unknown backend and open statuses', () => {
	const addon = {
		enumerateAudioBackends: () => [{
			backend: 'coreaudio', status: 'invented', detail: '', devices: [],
		}],
		openAudioDevice: () => { throw new Error('must not open'); },
		closeAudioDevice: () => true,
	};
	assert.throws(() => runSoundscaperProfessionalNativeAudioCanary(addon, 'mac-arm64'),
		/backend status/iu);
});

test('professional utility smoke accepts only exact Electron utility-process evidence', async () => {
	const logs = [];
	const { child, running } = utilitySmoke(logs);
	queueMicrotask(() => child.emit('message', evidence()));
	assert.equal(await running, true);
	assert.equal(logs.length, 1);
	assert(logs[0].startsWith(PROFESSIONAL_NATIVE_UTILITY_SMOKE_PREFIX));
});

test('professional utility smoke requires audio and every isolated plug-in lifecycle operation', async () => {
	for (const operation of [
		'scan', 'instantiate', 'deterministic-process', 'latency', 'state-round-trip', 'close',
	]) {
		const { child, running } = utilitySmoke([]);
		const changed = evidence();
		changed.pluginIsolation.operations = changed.pluginIsolation.operations
			.filter((value) => value !== operation);
		queueMicrotask(() => child.emit('message', changed));
		await assert.rejects(running, /invalid evidence/iu, operation);
	}
	for (const mutate of [
		(value) => { value.audioOperation = null; },
		(value) => { value.backends[0].status = 'invented'; },
		(value) => { value.audioOperation.resultStatus = 'invented'; },
		(value) => { value.pluginIsolation.network = 'allowed'; },
		(value) => { value.pluginIsolation.fixtureSha256 = 'invalid'; },
	]) {
		const { child, running } = utilitySmoke([]);
		const changed = evidence();
		mutate(changed);
		queueMicrotask(() => child.emit('message', changed));
		await assert.rejects(running, /invalid evidence/iu);
	}
});

function utilitySmoke(logs) {
	const child = new EventEmitter();
	child.kill = () => true;
	const argv = [
		'--soundscaper-professional-native-utility-smoke=/professional/soundscaper_professional.node',
		'--soundscaper-professional-native-utility-target=linux-x64',
		'--soundscaper-professional-native-utility-professional-root=/professional',
		'--soundscaper-professional-native-utility-isolation-root=/isolation',
		'--soundscaper-professional-native-utility-runtime-root=/runtime',
	];
	const running = runSoundscaperProfessionalNativeUtilitySmoke({
		argv,
		packaged: true,
		utilityProcess: {
			fork(path, args, options) {
				assert.equal(path, '/helper.js');
				assert.deepEqual(args, [
					'--addon=/professional/soundscaper_professional.node',
					'--target=linux-x64',
					'--professional-root=/professional',
					'--isolation-root=/isolation',
					'--runtime-root=/runtime',
				]);
				assert.equal(options.serviceName, 'Soundscaper professional native self-test');
				return child;
			},
		},
		helperPath: '/helper.js',
		log: (value) => logs.push(value),
	});
	return { child, running };
}

function evidence() {
	return {
		schemaVersion: 1,
		status: 'passed',
		processBoundary: 'electron-utility-process',
		description: {
			addonVersion: '1.0.0', buildId: 'soundscaper-professional-host', napiVersion: 8,
			pluginFormats: [],
		},
		backends: [
			{ backend: 'pipewire', status: 'server-unavailable', detail: 'absent', devices: [] },
			{ backend: 'alsa', status: 'ok', detail: '', devices: [] },
			{ backend: 'jack', status: 'backend-unavailable', detail: 'absent', devices: [] },
		],
		audioOperation: {
			operation: 'native-device-open-probe', status: 'typed-refusal',
			requestedBackend: 'pipewire', resultStatus: 'server-unavailable', attempts: 1,
		},
		pluginIsolation: {
			protocol: 'M5F1', fixtureSha256: 'a'.repeat(64),
			launcherId: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
			filesystem: 'broker-grant-only', network: 'denied', childProcesses: 'denied',
			operations: [
				'scan', 'instantiate', 'deterministic-process', 'latency', 'state-round-trip', 'close',
			],
		},
	};
}
