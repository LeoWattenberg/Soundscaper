#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Build, test, and publish one target-native Framescaper media-host result. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
	createFramescaperMediaHostBuildRecipe,
	executeFramescaperMediaHostBuildRecipe,
} from '../native/framescaper-media-host/build/recipe-driver.mjs';
import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
import {
	createFramescaperMediaHostBuildResult,
	framescaperMediaHostTestReceipt,
} from './lib/framescaper-media-host-build-result.mjs';
import {
	writeFramescaperMediaHostToolchainReceipt,
} from './lib/framescaper-media-host-toolchain.mjs';
import {
	soundscaperProfessionalNativeIsolationConfigureArguments,
} from './lib/soundscaper-professional-native-target-build.mjs';

const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const args = parseArguments(process.argv.slice(2));
for (const required of [
	'boost-source', 'external-source-root', 'ffmpeg-source', 'output', 'target', 'work-root',
]) {
	if (!args[required]) throw new TypeError(`--${required}=... is required.`);
}
const repositoryRoot = canonicalDirectory(resolve(args.root ?? process.cwd()), 'repository root');
const workRoot = exclusiveDirectory(path(args['work-root'], 'work root'));
const output = absentPath(args.output, 'build-result root');
canonicalDirectory(dirname(output), 'build-result parent');
const recipeOutput = exclusiveDirectory(resolve(workRoot, 'media-build'));
const isolationBuild = resolve(workRoot, 'isolation-build');
const isolationInstall = resolve(workRoot, 'isolation-install');
const runtimeRoot = args['runtime-root']
	? canonicalDirectory(path(args['runtime-root'], 'runtime root'), 'runtime root')
	: exclusiveDirectory(resolve(workRoot, 'runtime'));
const toolchain = writeFramescaperMediaHostToolchainReceipt({
	targetId: args.target,
	path: resolve(workRoot, 'media-toolchain.json'),
});
const cmake = toolchain.receipt.executables.cmake.path;
const recipe = createFramescaperMediaHostBuildRecipe({
	repositoryRoot,
	targetId: args.target,
	hostRuntime: `${process.platform}-${process.arch}`,
	toolchainReceipt: toolchain.path,
	toolchainIdentity: toolchain.receipt.identitySha256,
	ffmpegSourceRoot: canonicalDirectory(
		path(args['ffmpeg-source'], 'FFmpeg source root'), 'FFmpeg source root',
	),
	boostSourceRoot: canonicalDirectory(
		path(args['boost-source'], 'Boost source root'), 'Boost source root',
	),
	externalSourceRoot: canonicalDirectory(
		path(args['external-source-root'], 'external-source root'), 'external-source root',
	),
	outputRoot: recipeOutput,
});
executeFramescaperMediaHostBuildRecipe(recipe);
const ctestArguments = [
	'--build', resolve(recipeOutput, 'host-build'), '--config', 'Release',
	'--target', 'test', '--parallel', '1',
];
const ctest = run(cmake, ctestArguments, 'media-host CTest');
const isolationSource = resolve(repositoryRoot, 'native/milestone-5-native-isolation-launcher');
run(cmake, soundscaperProfessionalNativeIsolationConfigureArguments({
	target: args.target, sourceRoot: isolationSource, buildRoot: isolationBuild,
	ninja: toolchain.receipt.executables.ninja.path,
	cCompiler: toolchain.receipt.executables.c.path,
	cxxCompiler: toolchain.receipt.executables.cxx.path,
}), 'isolation configure');
run(cmake, ['--build', isolationBuild, '--config', 'Release', '--parallel'], 'isolation build');
run(cmake, [
	'--install', isolationBuild, '--config', 'Release', '--prefix', isolationInstall,
], 'isolation install');
const revision = run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], 'source revision', repositoryRoot)
	.stdout.trim();
if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(revision)) {
	throw new Error('The media-host source revision is invalid.');
}
const sourceManifestBytes = readFileSync(resolve(
	repositoryRoot, 'native/framescaper-media-host/source-manifest.json',
));
const result = await createFramescaperMediaHostBuildResult({
	target: args.target,
	buildResultRoot: output,
	hostInstallRoot: resolve(recipeOutput, 'host-install'),
	isolationInstallRoot: isolationInstall,
	runtimeRoot,
	sourceRevision: revision,
	sourceManifestSha256: sha256(sourceManifestBytes),
	buildRecipeSha256: sha256(Buffer.from(JSON.stringify(recipe))),
	toolchainIdentity: toolchain.receipt.identitySha256,
	thirdPartyNotices: readFileSync(resolve(
		repositoryRoot, 'native/framescaper-media-host/THIRD_PARTY_NOTICES.md',
	), 'utf8'),
	buildTests: [framescaperMediaHostTestReceipt(
		'framescaper-media-host-ctest', cmake, ctestArguments, ctest.output,
	)],
});
process.stdout.write(`${JSON.stringify({
	status: 'build-result-created', target: args.target, output: result.buildResultRoot,
	receiptSha256: sha256(Buffer.from(`${JSON.stringify(result.receipt, null, '\t')}\n`)),
}, null, '\t')}\n`);

function run(command, commandArgs, label, cwd = repositoryRoot) {
	const outcome = spawnSync(command, [...commandArgs], {
		cwd, encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_OUTPUT_BYTES,
		env: { ...process.env, SOURCE_DATE_EPOCH: '1786492800', TZ: 'UTC', LC_ALL: 'C' },
	});
	const output = Buffer.from(`${outcome.stdout ?? ''}\n${outcome.stderr ?? ''}`);
	if (outcome.status !== 0 || outcome.error !== undefined || outcome.signal !== null
		|| output.byteLength > MAXIMUM_OUTPUT_BYTES) {
		throw new Error(`The ${label} command failed with status ${String(outcome.status)}: ${String(outcome.stderr ?? '').trim()}`);
	}
	return { ...outcome, output };
}

function parseArguments(values) {
	const allowed = new Set([
		'boost-source', 'external-source-root', 'ffmpeg-source', 'output', 'root',
		'runtime-root', 'target', 'work-root',
	]);
	const result = {};
	for (const value of values) {
		const match = /^--([a-z][a-z0-9-]*)=(.+)$/u.exec(value);
		if (!match || !allowed.has(match[1]) || result[match[1]] !== undefined) {
			throw new TypeError(`Unsupported or duplicate argument ${value}.`);
		}
		result[match[1]] = match[2];
	}
	return result;
}

function exclusiveDirectory(value) {
	canonicalDirectory(dirname(value), 'output parent');
	mkdirSync(value, { recursive: false, mode: 0o700 });
	return canonicalDirectory(value, 'exclusive output directory');
}
function canonicalDirectory(value, label) {
	const absolute = path(value, label);
	const metadata = lstatSync(absolute);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(absolute) !== absolute) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return absolute;
}
function absentPath(value, label) {
	const absolute = path(value, label);
	try { lstatSync(absolute); }
	catch (error) { if (error?.code === 'ENOENT') return absolute; throw error; }
	throw new Error(`The ${label} already exists.`);
}
function path(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError(`The ${label} must be absolute.`);
	}
	return normalizeAbsoluteCliPath(value, label);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
