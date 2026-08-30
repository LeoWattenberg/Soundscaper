/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
	runSoundscaperProfessionalNativeAudioCanary,
} from '../desktop/soundscaper-professional-native-utility-audio-canary.js';
import {
	PROFESSIONAL_NATIVE_UTILITY_SMOKE_PREFIX,
	runSoundscaperProfessionalNativeUtilitySmoke,
} from '../desktop/soundscaper-professional-native-utility-smoke.mjs';

const ROOT = resolve(import.meta.dirname, '..');

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

test('professional utility helper uses the utility-process parent port', async () => {
	const source = await readFile(resolve(ROOT,
		'desktop/soundscaper-professional-native-utility-smoke-helper.js'), 'utf8');
	assert.match(source, /const parentPort = process\.parentPort;/u);
	assert.doesNotMatch(source, /import\s*\{\s*parentPort\s*\}\s*from\s*['"]electron['"]/u);
});

test('professional utility smoke exposes bounded sanitized child diagnostics', async () => {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const { child, running } = utilitySmoke([], { stdout, stderr });
	queueMicrotask(() => {
		stdout.end(`${'x'.repeat(64 * 1024)}\nstdout-tail\n`);
		stderr.end('\u001b[31mloader\u0000 failed\u001b[0m\nAuthorization: Bearer github_pat_fixture\nstderr-tail\n');
		child.emit('exit', 1);
	});
	await assert.rejects(running, (error) => {
		assert.match(error.message, /exited 1/u);
		assert.match(error.message, /loader failed/u);
		assert.match(error.message, /stdout-tail/u);
		assert.match(error.message, /stderr-tail/u);
		assert.doesNotMatch(error.message, /github_pat_fixture/iu);
		assert(!error.message.includes('\u001b'));
		assert(!error.message.includes('\u0000'));
		assert(Buffer.byteLength(error.message) <= 20 * 1024);
		return true;
	});
});

test('professional utility smoke redacts a secret spanning the diagnostic tail cut', async () => {
	const name = 'SOUNDSCAPER_UTILITY_BOUNDARY_SECRET';
	const previous = process.env[name];
	const secret = 'boundary-secret-value-8a9c6e71';
	const suffix = secret.slice(12);
	process.env[name] = secret;
	try {
		const stdout = new PassThrough();
		const { child, running } = utilitySmoke([], { stdout });
		queueMicrotask(() => {
			stdout.end(`${'x'.repeat(8 * 1024)}${secret}${'t'.repeat(4 * 1024 - suffix.length)}`);
			child.emit('exit', 1, null);
		});
		await assert.rejects(running, (error) => {
			assert.doesNotMatch(error.message, new RegExp(suffix, 'u'));
			assert(Buffer.byteLength(error.message) <= 20 * 1024);
			return true;
		});
	} finally {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
});

test('professional utility smoke drops a generic token suffix spanning the raw capture cut',
	async () => {
		const stdout = new PassThrough();
		const { child, running } = utilitySmoke([], { stdout });
		queueMicrotask(() => {
			stdout.end(`prefix\ngithub_pat_${'g'.repeat(128 * 1024)}\nvisible-tail\n`);
			child.emit('exit', 1, null);
		});
		await assert.rejects(running, (error) => {
			assert.match(error.message, /visible-tail/u);
			assert.doesNotMatch(error.message, /g{32}/u);
			assert(Buffer.byteLength(error.message) <= 20 * 1024);
			return true;
		});
	});

test('professional utility smoke keeps repeated short-secret redaction bounded', async () => {
	const name = 'SOUNDSCAPER_UTILITY_REPEATED_SECRET';
	const previous = process.env[name];
	process.env[name] = 'aaaa';
	try {
		const stderr = new PassThrough();
		const { child, running } = utilitySmoke([], { stderr });
		queueMicrotask(() => {
			stderr.end('aaaa'.repeat(1024));
			child.emit('exit', 1, null);
		});
		await assert.rejects(running, (error) => {
			assert.doesNotMatch(error.message, /aaaa/u);
			assert(Buffer.byteLength(error.message) <= 20 * 1024);
			return true;
		});
	} finally {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
});

test('professional utility smoke suppresses diagnostics when a secret exceeds its capture cap',
	async () => {
		const name = 'SOUNDSCAPER_UTILITY_OVERSIZED_SECRET';
		const previous = process.env[name];
		const secret = `oversized-secret-${'s'.repeat(128 * 1024)}`;
		const suffix = secret.slice(-2 * 1024);
		process.env[name] = secret;
		try {
			const stderr = new PassThrough();
			const { child, running } = utilitySmoke([], { stderr });
			queueMicrotask(() => {
				stderr.end(`${secret}\ntail that must also be suppressed\n`);
				child.emit('exit', 1, null);
			});
			await assert.rejects(running, (error) => {
				assert.match(error.message, /exited 1/u);
				assert.doesNotMatch(error.message, new RegExp(suffix, 'u'));
				assert.doesNotMatch(error.message, /tail that must also be suppressed/u);
				assert(Buffer.byteLength(error.message) <= 20 * 1024);
				return true;
			});
		} finally {
			if (previous === undefined) delete process.env[name];
			else process.env[name] = previous;
		}
	});

test('professional utility smoke keeps UTF-8 diagnostics inside the byte ceiling', async () => {
	const stdout = new PassThrough();
	const { child, running } = utilitySmoke([], { stdout });
	queueMicrotask(() => {
		stdout.end('🚀'.repeat(64 * 1024));
		child.emit('exit', 1, null);
	});
	await assert.rejects(running, (error) => {
		const summary = 'Professional native utility smoke exited 1 (status=1, signal=none).\nstdout: ';
		assert(Buffer.byteLength(error.message) <= Buffer.byteLength(summary) + 4 * 1024);
		assert.doesNotMatch(error.message, /�/u);
		return true;
	});
});

test('professional utility smoke drains final pipe data emitted after exit', async () => {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const { child, running } = utilitySmoke([], { stdout, stderr });
	queueMicrotask(() => {
		child.emit('exit', 1, null);
		queueMicrotask(() => {
			stdout.end();
			stderr.end('late loader exception\n');
		});
	});
	await assert.rejects(running, /status|exited 1[\s\S]*late loader exception/iu);
});

test('professional utility smoke renders bounded structured fatal errors', async () => {
	const { child, running } = utilitySmoke([]);
	queueMicrotask(() => child.emit(
		'error', 'FatalError', 'utility-bootstrap',
		`Authorization: Bearer github_pat_fixture\n${'r'.repeat(64 * 1024)}\nreport-tail`,
	));
	await assert.rejects(running, (error) => {
		assert.match(error.message, /FatalError.*utility-bootstrap/u);
		assert.match(error.message, /report-tail/u);
		assert.doesNotMatch(error.message, /github_pat_fixture/u);
		assert(Buffer.byteLength(error.message) <= 20 * 1024);
		return true;
	});
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

function utilitySmoke(logs, streams = {}) {
	const child = new EventEmitter();
	child.kill = () => true;
	child.stdout = streams.stdout ?? null;
	child.stderr = streams.stderr ?? null;
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
