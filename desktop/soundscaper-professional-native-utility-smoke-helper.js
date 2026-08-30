/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron utility-process entry for installed professional audio and plug-in canaries. */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';

import {
	runSoundscaperProfessionalNativeAudioCanary,
} from './soundscaper-professional-native-utility-audio-canary.js';
import {
	createNativeChildIsolationLauncher,
} from './project-library-runtime/desktop/native-child-isolation-launcher.js';
import {
	createSoundscaperProfessionalPluginPeer,
} from './project-library-runtime/desktop/soundscaper-professional-plugin-peer.js';
import {
	resolveSoundscaperProfessionalLinuxSystemRuntime,
} from './project-library-runtime/desktop/soundscaper-professional-linux-system-runtime.js';

const parentPort = process.parentPort;
const arguments_ = namedArguments(process.argv.slice(2));
if (!parentPort) throw new Error('Invalid professional utility smoke request.');
const target = runtimeTarget();
if (arguments_.target !== target) {
	throw new Error(`The packaged utility process cannot test ${String(arguments_.target)} on ${target}.`);
}
const roots = Object.freeze({
	professional: await canonicalDirectory(arguments_['professional-root'], 'professional root'),
	isolation: await canonicalDirectory(arguments_['isolation-root'], 'isolation root'),
	runtime: await canonicalDirectory(arguments_['runtime-root'], 'runtime root'),
});
const addonPath = absolutePath(arguments_.addon, 'addon');
if (resolve(roots.professional, 'soundscaper_professional.node') !== addonPath) {
	throw new Error('The professional utility smoke addon escaped its authenticated install root.');
}
const addon = createRequire(import.meta.url)(addonPath);
const description = addon.describe();
const audio = runSoundscaperProfessionalNativeAudioCanary(addon, target);
const pluginIsolation = await isolatedFixtureCanary(roots, target);
parentPort.postMessage({
	schemaVersion: 1,
	status: 'passed',
	processBoundary: 'electron-utility-process',
	description,
	backends: audio.backends,
	audioOperation: audio.audioOperation,
	pluginIsolation,
});

async function isolatedFixtureCanary(roots_, target_) {
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
		identity: fixture.identity,
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
	'The packaged plug-in fixture changed before isolated admission.');
	const descriptions = await plugin.inspectPluginCandidate(fixture.path, 'clap', context);
	assert(descriptions.length === 1
		&& descriptions[0].stableId === 'org.soundscaper.fixture.deterministic-gain'
		&& descriptions[0].inputChannels === 2 && descriptions[0].outputChannels === 2,
	'The packaged isolated fixture scan returned a different inventory.');
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
			&& equalPlanes(first, input.map((plane) => Float32Array.from(
				plane, (value) => value * 2,
			))), 'The packaged isolated fixture process is not deterministic.');
		assert(await plugin.pluginLatencyFrames(instance) === 32,
			'The packaged isolated fixture latency changed.');
		const saved = await plugin.savePluginState(instance);
		assert(saved.byteLength === 4, 'The packaged fixture state shape changed.');
		const changed = new Uint8Array(4);
		new DataView(changed.buffer).setFloat32(0, 3, true);
		assert(await plugin.loadPluginState(instance, changed), 'The packaged fixture state load failed.');
		const tripled = [new Float32Array(4), new Float32Array(4)];
		await plugin.processPluginBlock(instance, 4, input, tripled);
		assert(equalPlanes(tripled, input.map((plane) => Float32Array.from(
			plane, (value) => value * 3,
		))), 'The packaged fixture state did not affect processing.');
		assert(await plugin.loadPluginState(instance, saved),
			'The packaged fixture state round trip failed.');
	} finally {
		assert(await plugin.closePluginInstance(instance), 'The packaged isolated fixture did not close.');
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
	assert(output.length <= 128, 'The runtime closure exceeds 128 files.');
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
	const [metadata, bytes] = await Promise.all([lstat(canonical), readFile(canonical)]);
	assert(canonical === path && metadata.isFile() && !metadata.isSymbolicLink(),
		`The utility self-test artifact ${path} is not canonical.`);
	return Object.freeze({
		path: canonical,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

async function canonicalDirectory(value, label) {
	const path = absolutePath(value, label);
	const metadata = await lstat(path);
	assert(metadata.isDirectory() && !metadata.isSymbolicLink() && await realpath(path) === path,
		`The professional utility ${label} is not canonical.`);
	return path;
}

function namedArguments(values) {
	const output = {};
	for (const value of values) {
		const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(value);
		if (!match || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate utility argument ${value}.`);
		}
		output[match[1]] = match[2];
	}
	const expected = ['addon', 'isolation-root', 'professional-root', 'runtime-root', 'target'];
	assert(JSON.stringify(Object.keys(output).sort()) === JSON.stringify(expected),
		'The professional utility argument set is incomplete.');
	return output;
}

function runtimeTarget() {
	const platform = process.platform === 'darwin' ? 'mac'
		: process.platform === 'win32' ? 'win' : process.platform;
	const target = `${platform}-${process.arch}`;
	assert(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'].includes(target),
		'The professional utility process target is unsupported.');
	return target;
}

function absolutePath(value, label) {
	assert(typeof value === 'string' && isAbsolute(value) && resolve(value) === value
		&& !value.includes('\0'), `The professional utility ${label} path is invalid.`);
	return value;
}

function equalPlanes(left, right) {
	return left.length === right.length && left.every((plane, index) =>
		plane.length === right[index].length && plane.every((sample, frame) => sample === right[index][frame]));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
