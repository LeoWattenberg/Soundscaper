#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build, target-native self-test, and publish one immutable helper result. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	lstatSync, mkdirSync, readFileSync, realpathSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
	authenticateMilestone5NativeSourceInput,
	removeMilestone5NativeSourceSnapshot,
	snapshotMilestone5NativeSourceInput,
} from './lib/milestone-5-native-source-acquisitions.mjs';
import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
import {
	createNativeHelperAddonBuildResult,
	deriveNativeHelperAddonBuildPolicy,
} from './lib/native-helper-addon-build-result.mjs';

const RUNNERS = Object.freeze({
	'Linux/X64': 'linux-x64',
	'Linux/ARM64': 'linux-arm64',
	'macOS/ARM64': 'mac-arm64',
	'Windows/X64': 'win-x64',
	'Windows/ARM64': 'win-arm64',
});
const values = parseArguments(process.argv.slice(2));
for (const name of ['output', 'runner-arch', 'runner-os', 'sources', 'target', 'work-root']) {
	if (!values[name]) throw new TypeError(`--${name}=... is required.`);
}
const repositoryRoot = canonicalDirectory(resolve(values.root ?? process.cwd()), 'repository root');
const target = values.target;
if (RUNNERS[`${values['runner-os']}/${values['runner-arch']}`] !== target) {
	throw new TypeError(`Native helper target ${target} requires its exact target-native runner.`);
}
if (target === 'mac-arm64' && !values['macos-sdk']) throw new TypeError('mac-arm64 requires --macos-sdk.');
if (target !== 'mac-arm64' && values['macos-sdk']) throw new TypeError('Only mac-arm64 accepts --macos-sdk.');
const policy = deriveNativeHelperAddonBuildPolicy({ repositoryRoot, target });
const sourcesRoot = canonicalDirectory(resolve(values.sources), 'native source cache');
const workRoot = exclusiveDirectory(absolutePath(values['work-root'], 'work root'));
const outputRoot = absentPath(values.output, 'build-result root');
canonicalDirectory(dirname(outputRoot), 'build-result parent');
const headerRoot = canonicalDirectory(resolve(sourcesRoot, 'electron-node-api-headers/source'),
	'Electron header source root');
const headerArchive = canonicalFile(resolve(sourcesRoot, 'electron-node-api-headers',
	policy.electronHeaders.archive.fileName), 'Electron header archive');
const headerWitness = authenticateMilestone5NativeSourceInput({
	repositoryRoot,
	sourceId: 'electron-node-api-headers',
	archivePath: headerArchive,
	sourceRoot: headerRoot,
});
const snapshot = snapshotMilestone5NativeSourceInput(headerWitness, {
	snapshotRoot: resolve(workRoot, 'electron-node-api-headers'),
});
try {
	const source = resolve(repositoryRoot, 'native/soundscaper-helper-addon');
	const build = resolve(workRoot, 'build');
	const install = resolve(workRoot, 'install');
	const replacements = new Map([
		['$SOURCE', source], ['$BUILD', build], ['$INSTALL', install],
		['$TARGET', target], ['$HEADERS', snapshot.extractedTree.root],
		['$ADDON_VERSION', policy.addonVersion], ['$NAPI_VERSION', String(policy.napiVersion)],
		...(target === 'mac-arm64'
			? [['$MACOS_SDK', canonicalDirectory(realpathSync(resolve(values['macos-sdk'])),
				'macOS SDK root')]] : []),
	]);
	for (const command of [policy.commands.configure, policy.commands.build, policy.commands.install]) {
		run(command[0], command.slice(1).map((argument) => replace(argument, replacements)), repositoryRoot);
	}
	const payloadPath = canonicalFile(resolve(install, policy.payloadName), 'installed native helper addon');
	const fixtureRoot = canonicalDirectory(resolve(install, 'fixtures'),
		'installed native helper fixture root');
	const selfTestRun = run(process.execPath, [
		resolve(repositoryRoot, 'scripts/self-test-native-helper-addon-result.mjs'),
		`--payload=${payloadPath}`, `--fixtures=${fixtureRoot}`,
		`--target=${target}`, `--version=${policy.addonVersion}`,
	], repositoryRoot);
	const observation = JSON.parse(selfTestRun.stdout);
	const toolchainPath = resolve(build, 'native-helper-addon-toolchain-Release.json');
	const toolchainValue = JSON.parse(readFileSync(toolchainPath, 'utf8'));
	const cmakeIdentity = run('cmake', ['--version'], repositoryRoot).stdout.split('\n')[0].trim();
	const sourceRevision = gitRevision(repositoryRoot);
	const result = await createNativeHelperAddonBuildResult({
		repositoryRoot, target, buildResultRoot: outputRoot, payloadPath, fixtureRoot, sourceRevision,
		toolchainReceipt: { ...toolchainValue, cmake: cmakeIdentity },
		selfTest: {
			status: observation.status, runtime: observation.runtime,
			addonVersion: observation.addonVersion, napiVersion: observation.napiVersion,
			buildId: observation.buildId, backendCount: observation.backendCount,
				renderedFrames: observation.renderedFrames, fixtureCount: observation.fixtureCount,
				inspectedFixtureCount: observation.inspectedFixtureCount,
				hostedFixtureCount: observation.hostedFixtureCount,
				renderSha256: observation.renderSha256,
			outputSha256: createHash('sha256').update(selfTestRun.stdout).digest('hex'),
		},
	});
	process.stdout.write(`${JSON.stringify({
		status: 'build-result-created', target, outputRoot: result.buildResultRoot,
		buildPolicySha256: result.receipt.buildPolicy.sha256,
	}, null, '\t')}\n`);
} finally {
	removeMilestone5NativeSourceSnapshot(snapshot);
}

function run(command, argv, cwd) {
	const result = spawnSync(command, argv, {
		cwd, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024,
		env: { ...process.env, SOURCE_DATE_EPOCH: '1755302400', TZ: 'UTC', LC_ALL: 'C' },
	});
	if (result.error || result.signal || result.status !== 0) {
		throw new Error(`Native helper ${command} step failed: ${result.error?.message
			?? result.stderr ?? result.stdout ?? `status ${String(result.status)}`}`);
	}
	return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

function replace(value, replacements) {
	let output = value;
	for (const [needle, replacement] of replacements) output = output.replaceAll(needle, replacement);
	if (output.includes('$')) throw new Error(`Unresolved native helper build argument ${output}.`);
	return output;
}

function gitRevision(root) {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false });
	if (result.status !== 0 || !/^(?:[a-f\d]{40}|[a-f\d]{64})\s*$/u.test(result.stdout)) {
		throw new Error('The native helper source revision could not be resolved.');
	}
	return result.stdout.trim();
}

function parseArguments(args) {
	const allowed = new Set([
		'macos-sdk', 'output', 'root', 'runner-arch', 'runner-os', 'sources', 'target', 'work-root',
	]);
	const output = {};
	for (const argument of args) {
		const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(argument);
		if (!match || !allowed.has(match[1]) || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate argument ${argument}.`);
		}
		output[match[1]] = match[2];
	}
	return output;
}

function exclusiveDirectory(path) {
	canonicalDirectory(dirname(path), 'work parent');
	mkdirSync(path, { recursive: false, mode: 0o700 });
	return canonicalDirectory(path, 'work root');
}

function absentPath(value, label) {
	const path = absolutePath(value, label);
	try {
		if (lstatSync(path)) throw new Error(`The ${label} already exists.`);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	return path;
}

function canonicalDirectory(path, label) {
	const value = absolutePath(path, label);
	const metadata = lstatSync(value);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(value) !== value) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return value;
}

function canonicalFile(path, label) {
	const value = absolutePath(path, label);
	const metadata = lstatSync(value);
	if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(value) !== value
		|| metadata.size < 1 || metadata.size > 512 * 1024 * 1024) {
		throw new Error(`The ${label} is not one bounded canonical file.`);
	}
	return value;
}

function absolutePath(value, label) {
	return normalizeAbsoluteCliPath(value, label);
}
