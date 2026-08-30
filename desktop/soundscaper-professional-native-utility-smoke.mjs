/* SPDX-License-Identifier: AGPL-3.0-only */

/** Packaged-only utility-process canary for an installed professional addon. */

import { isAbsolute, resolve } from 'node:path';

import { runSoundscaperDeliveryRestartPublicationSmoke } from './soundscaper-delivery-restart-smoke.mjs';
import {
	validateSoundscaperProfessionalNativeAudioCanaryEvidence,
} from './soundscaper-professional-native-utility-audio-canary.js';

export const PROFESSIONAL_NATIVE_UTILITY_SMOKE_PREFIX =
	'SOUNDSCAPER_PROFESSIONAL_NATIVE_UTILITY_SMOKE ';

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
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error); else resolvePromise(value);
		};
		const timer = setTimeout(() => {
			child.kill();
			finish(new Error('Professional native utility smoke timed out.'));
		}, timeoutMs);
		child.once('error', (error) => finish(error));
		child.once('exit', (code) => {
			if (!settled) finish(new Error(`Professional native utility smoke exited ${String(code)}.`));
		});
		child.once('message', (message) => {
			try { finish(null, validateEvidence(message, target)); }
			catch (error) { child.kill(); finish(error); }
		});
	});
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
