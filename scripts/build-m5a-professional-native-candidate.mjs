#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated one-shot build/install/self-test/candidate command for one target. */

import { spawnSync } from 'node:child_process';
import {
	lstatSync, mkdirSync, realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
	createSoundscaperProfessionalNativeCandidatePipelinePlan,
	executeSoundscaperProfessionalNativeCandidatePipeline,
} from './lib/soundscaper-professional-native-candidate-pipeline.mjs';
import {
	createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan,
} from './lib/soundscaper-professional-native-self-test-plan.mjs';
import {
	canonicalSoundscaperProfessionalNativeMacosSdkPath,
	createSoundscaperProfessionalNativeBuildPlan,
	resolveSoundscaperProfessionalNativeRunnerTarget,
} from './lib/soundscaper-professional-native-build.mjs';
import {
	createOsAudioCodecHostBuildPlan,
} from './lib/os-audio-codec-host-build.mjs';
import {
	readMilestone5NativeSourceAcquisitions,
} from './lib/milestone-5-native-source-acquisitions.mjs';
import {
	soundscaperProfessionalNativeSourceIdsForTarget,
} from './lib/soundscaper-professional-native-candidate-contract.mjs';

const allowed = new Set([
	'candidate', 'macos-sdk', 'packaged-app', 'root', 'runtime-root',
	'runner-arch', 'runner-os', 'signing-identity', 'sources', 'target', 'work-root',
]);
const args = parseArguments(process.argv.slice(2));
for (const name of [
	'candidate', 'packaged-app', 'runner-arch', 'runner-os', 'sources', 'target', 'work-root',
]) {
	if (!args[name]) throw new TypeError(`--${name}=... is required.`);
}
const repositoryRoot = canonicalDirectory(resolve(args.root ?? process.cwd()), 'repository root');
const target = args.target;
const sourceIds = soundscaperProfessionalNativeSourceIdsForTarget(target);
resolveSoundscaperProfessionalNativeRunnerTarget({
	target, runnerOs: args['runner-os'], runnerArch: args['runner-arch'],
});
if (target === 'mac-arm64' && (!args['macos-sdk'] || !args['signing-identity'])) {
	throw new TypeError('mac-arm64 requires --macos-sdk and --signing-identity.');
}
if (!target.startsWith('mac-') && args['signing-identity'] !== undefined) {
	throw new TypeError('Only mac-arm64 accepts --signing-identity.');
}
const macosSdkPath = args['macos-sdk']
	? canonicalSoundscaperProfessionalNativeMacosSdkPath(resolve(args['macos-sdk'])) : null;
const sourcesRoot = canonicalDirectory(resolve(args.sources), 'native source cache');
const workRoot = exclusiveDirectory(absolutePath(args['work-root'], 'work root'));
const candidateRoot = absentPath(args.candidate, 'candidate root');
canonicalDirectory(dirname(candidateRoot), 'candidate parent');
const register = readMilestone5NativeSourceAcquisitions(repositoryRoot);
const sourceRoots = Object.fromEntries(sourceIds.map((id) =>
	[id, canonicalDirectory(resolve(sourcesRoot, id, 'source'), `${id} source root`)]));
const sourceArchives = Object.fromEntries(sourceIds.map((id) => {
	const row = register.sources.find((source) => source.id === id);
	if (!row) throw new Error(`The M5 source register omits ${id}.`);
	return [id, canonicalFile(resolve(sourcesRoot, id, row.archive.fileName), `${id} archive`)];
}));
const professionalSnapshotRoot = exclusiveDirectory(resolve(workRoot, 'professional-source-snapshots'));
const professionalBuildPlan = createSoundscaperProfessionalNativeBuildPlan({
	repositoryRoot, target, sourceRoots, sourceArchives,
	sourceSnapshotRoot: professionalSnapshotRoot,
	buildRoot: resolve(workRoot, 'professional-build'),
	installRoot: resolve(workRoot, 'professional-install'),
	...(macosSdkPath === null ? {} : { macosSdkPath }),
});
let osAudioCodecBuildPlan = null;
if (!target.startsWith('linux-')) {
	const osSnapshotRoot = exclusiveDirectory(resolve(workRoot, 'os-codec-source-snapshots'));
	osAudioCodecBuildPlan = createOsAudioCodecHostBuildPlan({
		repositoryRoot, target,
		electronHeadersArchivePath: sourceArchives['electron-node-api-headers'],
		electronHeadersRoot: sourceRoots['electron-node-api-headers'],
		sourceSnapshotRoot: osSnapshotRoot,
		buildRoot: resolve(workRoot, 'os-codec-build'),
		installRoot: resolve(workRoot, 'os-codec-install'),
		...(macosSdkPath === null ? {} : {
			macosSdkPath,
			signingIdentity: args['signing-identity'],
		}),
	});
}
const runtimeRoot = args['runtime-root']
	? canonicalDirectory(resolve(args['runtime-root']), 'runtime closure root')
	: exclusiveDirectory(resolve(workRoot, 'runtime'));
const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
	cwd: repositoryRoot, encoding: 'utf8', shell: false,
});
if (revision.status !== 0 || !/^(?:[a-f\d]{40}|[a-f\d]{64})\s*$/u.test(revision.stdout)) {
	throw new Error('The candidate source revision could not be resolved.');
}
const selfTestPlan = createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan({
	repositoryRoot,
	sourceRevision: revision.stdout.trim(),
	target,
	professionalInstallRoot: professionalBuildPlan.installRoot,
	isolationInstallRoot: resolve(workRoot, 'isolation-install'),
	runtimeRoot,
	packagedAppRoot: canonicalDirectory(resolve(args['packaged-app']), 'packaged Electron app root'),
});
const plan = createSoundscaperProfessionalNativeCandidatePipelinePlan({
	target, repositoryRoot, candidateRoot, runtimeRoot,
	professionalBuildPlan, osAudioCodecBuildPlan,
	isolationBuildRoot: resolve(workRoot, 'isolation-build'),
	isolationInstallRoot: resolve(workRoot, 'isolation-install'),
	selfTestPlan,
	sourceRevision: revision.stdout.trim(),
	...(target === 'mac-arm64' ? { signingIdentity: args['signing-identity'] } : {}),
});
const candidate = await executeSoundscaperProfessionalNativeCandidatePipeline(plan);
process.stdout.write(`${JSON.stringify({
	status: 'candidate-created', target, candidateRoot: candidate.candidateRoot,
	buildPlanSha256: candidate.receipt.buildPlanSha256,
}, null, '\t')}\n`);

function parseArguments(values) {
	const output = {};
	for (const value of values) {
		const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(value);
		if (!match || !allowed.has(match[1]) || output[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate argument ${value}.`);
		}
		output[match[1]] = match[2];
	}
	return output;
}

function exclusiveDirectory(path) {
	canonicalDirectory(dirname(path), 'output parent');
	mkdirSync(path, { recursive: false, mode: 0o700 });
	return canonicalDirectory(path, 'exclusive output directory');
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
	const metadata = lstatSync(value, { bigint: true });
	if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(value) !== value
		|| metadata.size < 1n || metadata.size > 512n * 1024n * 1024n) {
		throw new Error(`The ${label} is not one bounded canonical file.`);
	}
	return value;
}

function absentPath(value, label) {
	const path = absolutePath(value, label);
	try {
		const descriptor = lstatSync(path);
		if (descriptor) throw new Error(`The ${label} already exists.`);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	return path;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be an absolute normalized path.`);
	return value;
}
