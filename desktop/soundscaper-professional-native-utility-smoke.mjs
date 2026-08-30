/* SPDX-License-Identifier: AGPL-3.0-only */

/** Packaged-only utility-process canary for an installed professional addon. */

import { isAbsolute, resolve } from 'node:path';

import { runSoundscaperDeliveryRestartPublicationSmoke } from './soundscaper-delivery-restart-smoke.mjs';
import {
	validateSoundscaperProfessionalNativeAudioCanaryEvidence,
} from './soundscaper-professional-native-utility-audio-canary.js';

export const PROFESSIONAL_NATIVE_UTILITY_SMOKE_PREFIX =
	'SOUNDSCAPER_PROFESSIONAL_NATIVE_UTILITY_SMOKE ';
const MAXIMUM_UTILITY_DIAGNOSTIC_BYTES = 4 * 1024;
const MAXIMUM_UTILITY_FAILURE_BYTES = 16 * 1024;
const UTILITY_DIAGNOSTIC_DRAIN_TIMEOUT_MS = 250;
const ANSI_ESCAPE_SEQUENCE = new RegExp(String.raw`\u001b\[[\d;?]*[ -/]*[@-~]`, 'gu');
const UNSAFE_CONTROL_CHARACTER = new RegExp(
	String.raw`[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]`, 'gu',
);

export async function runSoundscaperProfessionalNativeUtilitySmoke(options) {
	if (await runSoundscaperDeliveryRestartPublicationSmoke(options)) return true;
	const prefix = '--soundscaper-professional-native-utility-smoke=';
	const matches = options.argv.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return false;
	if (matches.length !== 1 || !options.packaged) {
		throw new Error('Professional native utility smoke requires one packaged-only request.');
	}
	const addonPath = matches[0].slice(prefix.length);
	const target = utilityArgument(options.argv, '--soundscaper-professional-native-utility-target=');
	const professionalRoot = utilityArgument(
		options.argv, '--soundscaper-professional-native-utility-professional-root=', true,
	);
	const isolationRoot = utilityArgument(
		options.argv, '--soundscaper-professional-native-utility-isolation-root=', true,
	);
	const runtimeRoot = utilityArgument(
		options.argv, '--soundscaper-professional-native-utility-runtime-root=', true,
	);
	absolutePath(addonPath, 'addon');
	if (!['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(target)) {
		throw new TypeError('Professional native utility smoke target is invalid.');
	}
	const child = options.utilityProcess.fork(options.helperPath, [
		`--addon=${addonPath}`,
		`--target=${target}`,
		`--professional-root=${professionalRoot}`,
		`--isolation-root=${isolationRoot}`,
		`--runtime-root=${runtimeRoot}`,
	], {
		serviceName: 'Soundscaper professional native self-test',
		stdio: 'pipe',
	});
	const evidence = await utilityResult(child, options.timeoutMs ?? 30_000, target);
	options.log(`${PROFESSIONAL_NATIVE_UTILITY_SMOKE_PREFIX}${JSON.stringify(evidence)}`);
	return true;
}

function utilityResult(child, timeoutMs, target) {
	return new Promise((resolvePromise, reject) => {
		let settled = false;
		const diagnostics = captureUtilityDiagnostics(child);
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			diagnostics.close();
			if (error) reject(error); else resolvePromise(value);
		};
		const failure = (summary) => new Error(boundedUtf8Head(
			`${summary}${diagnostics.render()}`, MAXIMUM_UTILITY_FAILURE_BYTES,
		));
		const failAfterDrain = async (summary) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			await diagnostics.drain();
			diagnostics.close();
			reject(failure(summary));
		};
		const timer = setTimeout(() => {
			child.kill();
			void failAfterDrain('Professional native utility smoke timed out.');
		}, timeoutMs);
		child.once('error', (type, location, report) => {
			void failAfterDrain(
				`Professional native utility smoke process error: ${
					utilityProcessErrorDetail(type, location, report)
				}.`,
			);
		});
		child.once('exit', (code, signal) => {
			const status = Number.isInteger(code) ? String(code) : 'none';
			void failAfterDrain(
				`Professional native utility smoke exited ${status}`
					+ ` (status=${status}, signal=${typeof signal === 'string' ? signal : 'none'}).`,
			);
		});
		child.once('message', (message) => {
			try { finish(null, validateEvidence(message, target)); }
			catch (error) { child.kill(); finish(error); }
		});
	});
}

function captureUtilityDiagnostics(child) {
	const stdout = captureDiagnosticStream(child?.stdout);
	const stderr = captureDiagnosticStream(child?.stderr);
	return Object.freeze({
		close() { stdout.close(); stderr.close(); },
		async drain() {
			let deadline;
			await Promise.race([
				Promise.all([stdout.drained, stderr.drained]),
				new Promise((resolvePromise) => {
					deadline = setTimeout(resolvePromise, UTILITY_DIAGNOSTIC_DRAIN_TIMEOUT_MS);
				}),
			]);
			clearTimeout(deadline);
		},
		render() {
			const output = [
				['stderr', stderr.read()], ['stdout', stdout.read()],
			].filter(([, value]) => value !== '')
				.map(([name, value]) => `${name}: ${value}`);
			return output.length === 0 ? '' : `\n${output.join('\n')}`;
		},
	});
}

function captureDiagnosticStream(stream) {
	let bytes = Buffer.alloc(0);
	let resolveDrained;
	const drained = !stream || stream.readableEnded === true || stream.destroyed === true
		? Promise.resolve()
		: new Promise((resolvePromise) => { resolveDrained = resolvePromise; });
	const onData = (value) => {
		const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
		const tail = chunk.subarray(Math.max(0, chunk.byteLength - MAXIMUM_UTILITY_DIAGNOSTIC_BYTES));
		bytes = Buffer.concat([bytes, tail]);
		if (bytes.byteLength > MAXIMUM_UTILITY_DIAGNOSTIC_BYTES) {
			bytes = bytes.subarray(bytes.byteLength - MAXIMUM_UTILITY_DIAGNOSTIC_BYTES);
		}
	};
	const onDrained = () => { resolveDrained?.(); };
	if (stream && typeof stream.on === 'function') {
		stream.on('data', onData);
		stream.once('end', onDrained);
		stream.once('close', onDrained);
		stream.once('error', onDrained);
	}
	return Object.freeze({
		close() {
			if (!stream || typeof stream.off !== 'function') return;
			stream.off('data', onData);
			stream.off('end', onDrained);
			stream.off('close', onDrained);
			stream.off('error', onDrained);
		},
		drained,
		read() { return safeDiagnosticText(bytes.toString('utf8')); },
	});
}

function safeDiagnosticText(value) {
	if (typeof value !== 'string' || value === '') return '';
	let output = value
		.replaceAll(ANSI_ESCAPE_SEQUENCE, '')
		.replaceAll(UNSAFE_CONTROL_CHARACTER, '')
		.replaceAll(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu, '$1[REDACTED]')
		.replaceAll(/\b(?:github_pat_|gh[pousr]_)[A-Za-z\d_]+\b/gu, '[REDACTED]');
	for (const [name, secret] of Object.entries(process.env)) {
		if (!/(?:token|secret|password|passwd|credential|authorization|cookie|private[_-]?key)/iu
			.test(name) || typeof secret !== 'string' || secret.length < 4) continue;
		output = output.replaceAll(secret, '[REDACTED]');
	}
	return boundedUtf8Tail(output.trim(), MAXIMUM_UTILITY_DIAGNOSTIC_BYTES);
}

function utilityProcessErrorDetail(type, location, report) {
	if (type instanceof Error && location === undefined && report === undefined) {
		return safeDiagnosticText(type.message) || 'unknown';
	}
	const values = type !== null && typeof type === 'object'
		? [['type', type.type], ['location', type.location], ['report', type.report]]
		: [['type', type], ['location', location], ['report', report]];
	const details = [];
	for (const [field, value] of values) {
		if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
		const rendered = safeDiagnosticText(String(value));
		if (rendered !== '') details.push(`${field}=${rendered}`);
	}
	return details.length === 0 ? 'unknown' : details.join(', ');
}

function boundedUtf8Tail(value, maximumBytes) {
	const bytes = Buffer.from(value, 'utf8');
	if (bytes.byteLength <= maximumBytes) return value;
	const marker = `[truncated to ${String(maximumBytes)} bytes] `;
	const available = Math.max(0, maximumBytes - Buffer.byteLength(marker));
	let start = bytes.byteLength - available;
	while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
	return `${marker}${bytes.subarray(start).toString('utf8')}`;
}

function boundedUtf8Head(value, maximumBytes) {
	const bytes = Buffer.from(value, 'utf8');
	if (bytes.byteLength <= maximumBytes) return value;
	const marker = `\n[truncated to ${String(maximumBytes)} bytes]`;
	let end = Math.max(0, maximumBytes - Buffer.byteLength(marker));
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
	return `${bytes.subarray(0, end).toString('utf8')}${marker}`;
}

function validateEvidence(value, target) {
	const operations = [
		'scan', 'instantiate', 'deterministic-process', 'latency', 'state-round-trip', 'close',
	];
	if (value?.schemaVersion !== 1 || value.status !== 'passed'
		|| value.processBoundary !== 'electron-utility-process'
		|| value.description?.addonVersion !== '1.0.0'
		|| value.description?.buildId !== 'soundscaper-professional-host'
		|| value.description?.napiVersion !== 8
		|| !Array.isArray(value.description?.pluginFormats)
		|| value.pluginIsolation?.protocol !== 'M5F1'
		|| !/^[a-f\d]{64}$/u.test(String(value.pluginIsolation?.fixtureSha256))
		|| typeof value.pluginIsolation?.launcherId !== 'string'
		|| value.pluginIsolation.launcherId.length < 3
		|| value.pluginIsolation.filesystem !== 'broker-grant-only'
		|| value.pluginIsolation.network !== 'denied'
		|| value.pluginIsolation.childProcesses !== 'denied'
		|| JSON.stringify(value.pluginIsolation.operations) !== JSON.stringify(operations)) {
		throw new Error('Professional native utility smoke returned invalid evidence.');
	}
	try {
		validateSoundscaperProfessionalNativeAudioCanaryEvidence({
			backends: value.backends, audioOperation: value.audioOperation,
		}, target);
	} catch {
		throw new Error('Professional native utility smoke returned invalid evidence.');
	}
	return Object.freeze(structuredClone(value));
}

function utilityArgument(argv, prefix, path = false) {
	const matches = argv.filter((value) => value.startsWith(prefix));
	if (matches.length !== 1) throw new TypeError('Professional native utility smoke arguments are incomplete.');
	const value = matches[0].slice(prefix.length);
	if (path) absolutePath(value, 'runtime root');
	return value;
}

function absolutePath(value, label) {
	if (!isAbsolute(value) || resolve(value) !== value || value.includes('\0')) {
		throw new TypeError(`Professional native utility smoke ${label} path is invalid.`);
	}
}
