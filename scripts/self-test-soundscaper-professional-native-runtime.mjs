#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Target-native installed peer/isolation and packaged-Electron canary. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';
import {
	createNativeChildIsolationLauncher,
} from '../desktop/native-child-isolation-launcher.ts';
import {
	createSoundscaperProfessionalPluginPeer,
} from '../desktop/soundscaper-professional-plugin-peer.ts';
import {
	resolveSoundscaperProfessionalLinuxSystemRuntime,
} from '../desktop/soundscaper-professional-linux-system-runtime.ts';
import {
	packagedExecutableCandidates,
} from './lib/desktop-smoke.mjs';
import {
	expectedSoundscaperProfessionalNativeInventory,
} from './lib/soundscaper-professional-native-candidate-contract.mjs';
import {
	requiredPipelineSoundscaperProfessionalNativeSelfTestIds,
} from './lib/soundscaper-professional-native-self-test-plan.mjs';
import {
	validateSoundscaperProfessionalNativeAudioCanaryEvidence,
} from '../desktop/soundscaper-professional-native-utility-audio-canary.js';
import {
	assertSoundscaperProfessionalPackagedAppAuthority,
	authenticateSoundscaperProfessionalPackagedApp,
	soundscaperProfessionalPackagedAppAuthoritySha256,
} from './lib/soundscaper-professional-packaged-app-authority.mjs';
import {
	runSoundscaperProfessionalNativeContainmentProbe,
} from './lib/soundscaper-professional-native-containment-probes.mjs';
import {
	resolveSoundscaperNativeTestRuntime,
} from './lib/soundscaper-native-test-runtime.mjs';

const args = namedArguments(process.argv.slice(2));
const target = resolveSoundscaperNativeTestRuntime({
	requestedTarget: args.target, platform: process.platform, architecture: process.arch,
}).target;
const scenario = String(args.scenario ?? '');
if (!requiredPipelineSoundscaperProfessionalNativeSelfTestIds(target).includes(scenario)) {
	throw new TypeError('The professional native self-test scenario is not canonical.');
}
const roots = Object.freeze({
	professional: await canonicalDirectory(args['professional-install-root'], 'professional install root'),
	isolation: await canonicalDirectory(args['isolation-install-root'], 'isolation install root'),
	runtime: await canonicalDirectory(args['runtime-root'], 'runtime root'),
	packagedApp: await canonicalDirectory(args['packaged-app-root'], 'packaged app root'),
});
const evidence = scenario === 'packaged-electron-utility-process-smoke'
	? await packagedElectronSmoke(roots, target, args)
	: scenario.startsWith('isolation-')
		? await hostileContainmentSmoke(roots, target, scenario)
		: await isolatedProfessionalPeerSmoke(roots, target);
process.stdout.write(`${JSON.stringify({
	schemaVersion: 1, status: 'passed', target, scenario, evidence,
})}\n`);

async function isolatedProfessionalPeerSmoke(roots_, target_) {
	const windows = target_.startsWith('win-');
	const [profileName, brokerName] = target_.startsWith('linux-')
		? ['linux-v1.json', 'linux-broker-v1.json']
		: target_ === 'mac-arm64'
			? ['macos-v1.sb', 'macos-broker-v1.json']
			: ['windows-v1.json', 'windows-broker-v1.json'];
	const [peer, launcher, sandboxProfile, brokerPolicy, fixture, runtimeClosure] = await Promise.all([
		descriptor(resolve(roots_.professional,
			`soundscaper_professional_peer${windows ? '.exe' : ''}`)),
		descriptor(resolve(roots_.isolation, 'bin',
			`milestone5-native-isolation-launcher${windows ? '.exe' : ''}`)),
		descriptor(resolve(roots_.isolation, 'profiles', profileName)),
		descriptor(resolve(roots_.isolation, 'profiles', brokerName)),
		descriptor(resolve(roots_.professional, 'self-test', 'soundscaper_professional_fixture.clap')),
		runtimeDescriptors(roots_.runtime),
	]);
	const isolationRuntime = await effectiveIsolationRuntime(target_, peer, runtimeClosure);
	const launcherAuthority = createNativeChildIsolationLauncher({
		target: target_,
		machineWorkload: Object.freeze({
			kind: 'soundscaper', payloads: Object.freeze([peer]),
			runtimeClosure: isolationRuntime.runtimeClosure,
		}),
		artifacts: Object.freeze({ launcher, sandboxProfile, brokerPolicy }),
	});
	const machine = await launcherAuthority.machineReady();
	assert(machine.status === 'ready', `Machine containment is unavailable: ${machine.detail ?? 'unknown'}`);
	const plugin = createSoundscaperProfessionalPluginPeer({
		launcher: launcherAuthority,
		peerExecutable: peer,
		entryExecutable: isolationRuntime.entryExecutable,
		entryArguments: isolationRuntime.entryArguments,
		runtimeReadExecute: isolationRuntime.runtimeClosure,
		pluginFormats: ['clap'],
	});
	const fixtureMetadata = await lstat(fixture.path);
	const context = Object.freeze({
		identity: Object.freeze({ dev: Number(fixtureMetadata.dev), ino: Number(fixtureMetadata.ino) }),
		byteLength: fixture.byteLength,
		sha256: fixture.sha256,
		resourcePolicy: Object.freeze({
			maximumInputBytes: fixture.byteLength,
			maximumJobDurationMs: 30_000,
			maximumRssBytes: 512 * 1024 ** 2,
			allowNetwork: false,
			allowChildProcesses: false,
			allowOutputFiles: false,
		}),
	});
	assert(Number(fixtureMetadata.dev) === context.identity.dev
		&& Number(fixtureMetadata.ino) === context.identity.ino,
	'The fixture changed before isolated admission.');
	const descriptions = await plugin.inspectPluginCandidate(fixture.path, 'clap', context);
	assert(descriptions.length === 1
		&& descriptions[0].stableId === 'org.soundscaper.fixture.deterministic-gain'
		&& descriptions[0].inputChannels === 2 && descriptions[0].outputChannels === 2,
	'The isolated fixture scan returned a different inventory.');
	const instance = await plugin.openPluginInstance(
		fixture.path, 48_000, 256, 'clap', descriptions[0].stableId, context,
	);
	try {
		const input = [Float32Array.of(1, 2, -3, 0.5), Float32Array.of(-1, 4, 0.25, 8)];
		const first = [new Float32Array(4), new Float32Array(4)];
		const second = [new Float32Array(4), new Float32Array(4)];
		await plugin.processPluginBlock(instance, 4, input, first);
		await plugin.processPluginBlock(instance, 4, input, second);
		assert(equalPlanes(first, second)
			&& equalPlanes(first, input.map((plane) => Float32Array.from(plane, (value) => value * 2))),
		'The isolated fixture process is not deterministic.');
		assert(await plugin.pluginLatencyFrames(instance) === 32,
			'The isolated fixture latency changed.');
		const saved = await plugin.savePluginState(instance);
		assert(saved.byteLength === 4, 'The fixture state shape changed.');
		const changed = new Uint8Array(4);
		new DataView(changed.buffer).setFloat32(0, 3, true);
		assert(await plugin.loadPluginState(instance, changed), 'The fixture state load failed.');
		const tripled = [new Float32Array(4), new Float32Array(4)];
		await plugin.processPluginBlock(instance, 4, input, tripled);
		assert(equalPlanes(tripled,
			input.map((plane) => Float32Array.from(plane, (value) => value * 3))),
		'The fixture state did not affect deterministic processing.');
		assert(await plugin.loadPluginState(instance, saved), 'The fixture state round trip failed.');
	} finally {
		assert(await plugin.closePluginInstance(instance), 'The isolated fixture did not close.');
	}
	return Object.freeze({
		protocol: 'M5F1', fixtureSha256: fixture.sha256,
		launcherId: machine.launcherId,
		filesystem: 'broker-grant-only', network: 'denied', childProcesses: 'denied',
		operations: Object.freeze([
			'scan', 'instantiate', 'deterministic-process', 'latency', 'state-round-trip', 'close',
		]),
	});
}

async function hostileContainmentSmoke(roots_, target_, scenario_) {
	const windows = target_.startsWith('win-');
	const [profileName, brokerName] = target_.startsWith('linux-')
		? ['linux-v1.json', 'linux-broker-v1.json']
		: target_ === 'mac-arm64'
			? ['macos-v1.sb', 'macos-broker-v1.json']
			: ['windows-v1.json', 'windows-broker-v1.json'];
	const [peer, launcher, sandboxProfile, brokerPolicy, authorizedFile, unauthorizedFile,
		runtimeClosure] = await Promise.all([
		descriptor(resolve(roots_.professional,
			`soundscaper_professional_peer${windows ? '.exe' : ''}`)),
		descriptor(resolve(roots_.isolation, 'bin',
			`milestone5-native-isolation-launcher${windows ? '.exe' : ''}`)),
		descriptor(resolve(roots_.isolation, 'profiles', profileName)),
		descriptor(resolve(roots_.isolation, 'profiles', brokerName)),
		descriptor(resolve(roots_.professional, 'self-test', 'soundscaper_professional_fixture.clap')),
		descriptor(resolve(roots_.professional, 'soundscaper_professional.node')),
		runtimeDescriptors(roots_.runtime),
	]);
	const isolationRuntime = await effectiveIsolationRuntime(target_, peer, runtimeClosure);
	const launcherAuthority = createNativeChildIsolationLauncher({
		target: target_,
		machineWorkload: Object.freeze({
			kind: 'soundscaper', payloads: Object.freeze([peer]),
			runtimeClosure: isolationRuntime.runtimeClosure,
		}),
		artifacts: Object.freeze({ launcher, sandboxProfile, brokerPolicy }),
	});
	const machine = await launcherAuthority.machineReady();
	assert(machine.status === 'ready', `Machine containment is unavailable: ${machine.detail ?? 'unknown'}`);
	return runSoundscaperProfessionalNativeContainmentProbe({
		scenario: scenario_, launcher: launcherAuthority, peer,
		entryExecutable: isolationRuntime.entryExecutable,
		entryArguments: isolationRuntime.entryArguments,
		runtimeClosure: isolationRuntime.runtimeClosure,
		authorizedFile,
		unauthorizedPath: unauthorizedFile.path,
	});
}

async function packagedElectronSmoke(roots_, target_, arguments_) {
	const outputRoot = roots_.packagedApp;
	const professionalRoot = roots_.professional;
	const packagedApp = authenticateSoundscaperProfessionalPackagedApp({
		packagedAppRoot: outputRoot,
		sourceRevision: arguments_['source-revision'],
		target: target_,
	});
	const packagedAppAuthoritySha256 = soundscaperProfessionalPackagedAppAuthoritySha256(packagedApp);
	assert(packagedAppAuthoritySha256 === arguments_['packaged-app-authority-sha256'],
		'The packaged Electron app differs from its candidate authority.');
	const [platform, arch] = target_.startsWith('linux-') ? ['linux', target_.slice(6)]
		: target_ === 'mac-arm64' ? ['darwin', 'arm64'] : ['win32', target_.slice(4)];
	if (platform !== process.platform) {
		throw new Error('The packaged Electron smoke is not executing on its target operating system.');
	}
	const executable = packagedExecutableCandidates({
		arch, outputRoot, platform, productId: 'soundscaper', productName: 'Soundscaper',
	}).find(existsSync);
	if (!executable) throw new Error('The target packaged Soundscaper executable is absent.');
	const addonPath = resolve(professionalRoot, 'soundscaper_professional.node');
	const applicationArguments = [
		`--soundscaper-professional-native-utility-smoke=${addonPath}`,
		`--soundscaper-professional-native-utility-target=${target_}`,
		`--soundscaper-professional-native-utility-professional-root=${professionalRoot}`,
		`--soundscaper-professional-native-utility-isolation-root=${roots_.isolation}`,
		`--soundscaper-professional-native-utility-runtime-root=${roots_.runtime}`,
	];
	const result = spawnSync(platform === 'linux' ? 'xvfb-run' : executable,
		platform === 'linux' ? ['-a', executable, ...applicationArguments] : applicationArguments, {
			encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 1024 * 1024,
			env: cleanElectronEnvironment(),
		});
	if (result.error !== undefined || result.signal !== null || result.status !== 0) {
		throw new Error(`The packaged Electron smoke failed: ${result.stderr || result.stdout || 'no output'}`);
	}
	const prefix = 'SOUNDSCAPER_PROFESSIONAL_NATIVE_UTILITY_SMOKE ';
	const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u)
		.find((value) => value.startsWith(prefix));
	if (!line) throw new Error('The packaged Electron smoke emitted no authenticated result.');
	const payload = JSON.parse(line.slice(prefix.length));
	const expected = expectedSoundscaperProfessionalNativeInventory(target_);
	const operations = [
		'scan', 'instantiate', 'deterministic-process', 'latency', 'state-round-trip', 'close',
	];
	assert(payload?.schemaVersion === 1 && payload.status === 'passed'
		&& payload.processBoundary === 'electron-utility-process'
		&& payload.description?.addonVersion === '1.0.0'
		&& payload.description?.buildId === 'soundscaper-professional-host'
		&& payload.description?.napiVersion === 8
		&& JSON.stringify(payload.description?.pluginFormats) === JSON.stringify(expected.addonPluginFormats)
		&& JSON.stringify(payload.backends?.map(({ backend }) => backend))
			=== JSON.stringify(expected.backends)
		&& payload.pluginIsolation?.protocol === 'M5F1'
		&& /^[a-f\d]{64}$/u.test(String(payload.pluginIsolation?.fixtureSha256))
		&& payload.pluginIsolation?.filesystem === 'broker-grant-only'
		&& payload.pluginIsolation?.network === 'denied'
		&& payload.pluginIsolation?.childProcesses === 'denied'
		&& JSON.stringify(payload.pluginIsolation?.operations) === JSON.stringify(operations),
		'The packaged Electron utility process returned a different professional addon contract.');
	validateSoundscaperProfessionalNativeAudioCanaryEvidence({
		backends: payload.backends, audioOperation: payload.audioOperation,
	}, target_);
	assertSoundscaperProfessionalPackagedAppAuthority(packagedApp, {
		packagedAppRoot: outputRoot,
		sourceRevision: arguments_['source-revision'],
		target: target_,
	});
	return Object.freeze({
		executable: executable.slice(outputRoot.length + 1),
		processBoundary: payload.processBoundary,
		addonSha256: createHash('sha256').update(await readFile(addonPath)).digest('hex'),
		sourceRevision: packagedApp.sourceRevision,
		contentManifestSha256: packagedApp.contentManifest.sha256,
		rootClosureSha256: packagedApp.rootClosureSha256,
		packagedAppAuthoritySha256,
		audioOperation: payload.audioOperation.operation,
		pluginIsolation: Object.freeze({
			protocol: payload.pluginIsolation.protocol,
			fixtureSha256: payload.pluginIsolation.fixtureSha256,
			launcherId: payload.pluginIsolation.launcherId,
			operations: Object.freeze([...payload.pluginIsolation.operations]),
		}),
	});
}

async function runtimeDescriptors(root) {
	const output = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error('The runtime closure contains a symbolic link.');
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) output.push(await descriptor(path));
			else throw new Error('The runtime closure contains a special file.');
		}
	}
	await visit(root);
	if (output.length > 128) throw new Error('The runtime closure exceeds 128 files.');
	return Object.freeze(output.sort((left, right) => left.path.localeCompare(right.path, 'en')));
}

async function effectiveIsolationRuntime(target_, peer, packagedRuntimeClosure) {
	if (!target_.startsWith('linux-')) {
		return Object.freeze({
			entryExecutable: peer,
			entryArguments: Object.freeze([]),
			runtimeClosure: packagedRuntimeClosure,
		});
	}
	const system = await resolveSoundscaperProfessionalLinuxSystemRuntime({
		target: target_, peer, runtimeClosure: packagedRuntimeClosure,
	});
	assert(system.schemaVersion === 1 && system.policy === 'host-system-elf-runtime-v1',
		'The Linux host-system runtime policy is not authenticated.');
	return Object.freeze({
		entryExecutable: system.entryExecutable,
		entryArguments: system.loaderArguments,
		runtimeClosure: system.runtimeClosure,
	});
}

async function descriptor(path) {
	const canonical = await realpath(path);
	const [metadata, bytes] = await Promise.all([lstat(canonical, { bigint: true }), readFile(canonical)]);
	if (canonical !== path || !metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error(`The self-test artifact ${path} is not canonical.`);
	}
	return Object.freeze({
		path: canonical,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: nativeChildFileIdentityFromStat(metadata),
	});
}

async function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} is not absolute and normalized.`);
	const metadata = await lstat(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(value) !== value) {
		throw new Error(`The ${label} is not canonical.`);
	}
	return value;
}

function namedArguments(values) {
	const output = {};
	for (const value of values) {
		const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(value);
		if (!match || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate self-test argument ${value}.`);
		}
		output[match[1]] = match[2];
	}
	const expected = ['isolation-install-root', 'packaged-app-authority-sha256',
		'packaged-app-root', 'professional-install-root', 'runtime-root', 'scenario',
		'source-revision', 'target'];
	if (JSON.stringify(Object.keys(output).sort()) !== JSON.stringify(expected)) {
		throw new TypeError('The professional runtime self-test argument set is incomplete.');
	}
	return output;
}

function cleanElectronEnvironment() {
	const environment = { ...process.env };
	delete environment.ELECTRON_RUN_AS_NODE;
	return environment;
}

function equalPlanes(left, right) {
	return JSON.stringify(left.map((plane) => [...plane]))
		=== JSON.stringify(right.map((plane) => [...plane]));
}

function assert(condition, message) { if (!condition) throw new Error(message); }
