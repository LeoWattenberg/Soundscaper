/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, clean-HEAD authority for target-native build-result self-tests. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
	requiredSoundscaperProfessionalNativeSelfTestIds,
	targetId,
} from './soundscaper-professional-native-build-result-contract.mjs';
import {
	assertSoundscaperProfessionalPackagedAppAuthority,
	authenticateSoundscaperProfessionalPackagedApp,
	soundscaperProfessionalPackagedAppAuthoritySha256,
} from './soundscaper-professional-packaged-app-authority.mjs';

const REVISION = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const DRIVER_PATH = 'scripts/self-test-soundscaper-professional-native-runtime.mjs';
const DELIVERY_FILESYSTEM_DRIVER_PATH = 'scripts/self-test-soundscaper-delivery-fs.mjs';
const PACKAGED_AUTHORITY_PATH =
	'scripts/lib/soundscaper-professional-packaged-app-authority.mjs';
const TEST_RUNTIME_AUTHORITY_PATH = 'scripts/lib/soundscaper-native-test-runtime.mjs';
const CONTAINMENT_PROBES_PATH =
	'scripts/lib/soundscaper-professional-native-containment-probes.mjs';
const LINUX_SYSTEM_LIBRARIES_PATH =
	'desktop/soundscaper-professional-linux-system-libraries.ts';
const LINUX_SYSTEM_RUNTIME_PATH =
	'desktop/soundscaper-professional-linux-system-runtime.ts';
const COMMON_AUTHORITY_SOURCE_PATHS = Object.freeze([
	DRIVER_PATH,
	DELIVERY_FILESYSTEM_DRIVER_PATH,
	PACKAGED_AUTHORITY_PATH,
	TEST_RUNTIME_AUTHORITY_PATH,
	CONTAINMENT_PROBES_PATH,
]);
const LOCALLY_EXECUTED_IDS = new Set([
	'addon-exact-backend-format-inventory', 'm5f1-malformed-frame', 'launcher-refusal',
	'delivery-filesystem-protocol',
	'os-audio-codec-ctest',
]);
const AUTHENTICATED_SELF_TEST_PLANS = new WeakSet();

export function requiredPipelineSoundscaperProfessionalNativeSelfTestIds(targetValue) {
	return Object.freeze(requiredSoundscaperProfessionalNativeSelfTestIds(targetValue)
		.filter((id) => !LOCALLY_EXECUTED_IDS.has(id)));
}

/**
 * Derive commands from repository code. No path, executable, command, or test
 * identifier is caller-selectable. The entire repository must be a clean HEAD,
 * and the executed driver is additionally compared byte-for-byte with its Git
 * blob so its receipt is tied to `sourceRevision`.
 */
export function createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(options) {
	const repositoryRoot = canonicalRoot(options?.repositoryRoot);
	const sourceRevision = revision(options?.sourceRevision);
	const target = targetId(options?.target);
	const roots = Object.freeze({
		professionalInstallRoot: externalPath(options?.professionalInstallRoot,
			repositoryRoot, 'professional install root'),
		isolationInstallRoot: externalPath(options?.isolationInstallRoot,
			repositoryRoot, 'isolation install root'),
		runtimeRoot: externalPath(options?.runtimeRoot, repositoryRoot, 'runtime root'),
		packagedAppRoot: externalPath(options?.packagedAppRoot, repositoryRoot, 'packaged app root'),
	});
	const head = gitText(repositoryRoot, ['rev-parse', 'HEAD']).trim();
	if (head !== sourceRevision) {
		throw new Error('The professional self-test source revision is not the checked-out HEAD.');
	}
	if (gitText(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
		throw new Error('The professional self-test working tree is not a clean HEAD.');
	}
	const authoritySourcePaths = selfTestAuthoritySourcePaths(target);
	const authorityFiles = authoritySourcePaths.map((path) =>
		authenticatedGitFile(repositoryRoot, sourceRevision, path));
	const driver = authorityFiles[0];
	const packagedApp = authenticateSoundscaperProfessionalPackagedApp({
		packagedAppRoot: roots.packagedAppRoot, sourceRevision, target,
	});
	const packagedAppAuthoritySha256 =
		soundscaperProfessionalPackagedAppAuthoritySha256(packagedApp);
	const commands = requiredPipelineSoundscaperProfessionalNativeSelfTestIds(target).map((id) =>
		Object.freeze({
			id,
			command: process.execPath,
			args: Object.freeze([
				'--experimental-strip-types',
				driver.absolutePath,
				`--scenario=${id}`,
				`--target=${target}`,
				`--professional-install-root=${roots.professionalInstallRoot}`,
				`--isolation-install-root=${roots.isolationInstallRoot}`,
				`--runtime-root=${roots.runtimeRoot}`,
				`--packaged-app-root=${roots.packagedAppRoot}`,
				`--packaged-app-authority-sha256=${packagedAppAuthoritySha256}`,
				`--source-revision=${sourceRevision}`,
			]),
			expectedStatus: 0,
		}));
	const plan = deepFreeze({
		schemaVersion: 1,
		kind: 'soundscaper-professional-native-self-test-plan',
		target,
		sourceRevision,
		repositoryRoot,
		packagedAppRoot: roots.packagedAppRoot,
		authority: {
			status: 'authenticated-clean-head',
			files: authorityFiles.map(
				({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
			packagedApp,
		},
		commands,
	});
	AUTHENTICATED_SELF_TEST_PLANS.add(plan);
	return plan;
}

export function assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(value) {
	if (!value || typeof value !== 'object' || !AUTHENTICATED_SELF_TEST_PLANS.has(value)) {
		throw new TypeError('An authenticated self-test plan is required.');
	}
	return value;
}

export function verifyAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(value, options = {}) {
	const plan = assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(value);
	if (gitText(plan.repositoryRoot, ['rev-parse', 'HEAD']).trim() !== plan.sourceRevision
		|| gitText(plan.repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
		throw new Error('The professional self-test authority changed from its clean HEAD.');
	}
	for (const path of selfTestAuthoritySourcePaths(plan.target)) {
		const observed = authenticatedGitFile(plan.repositoryRoot, plan.sourceRevision, path);
		const expected = plan.authority.files.find((entry) => entry.path === path);
		if (!expected || observed.byteLength !== expected.byteLength || observed.sha256 !== expected.sha256) {
			throw new Error('The professional self-test implementation changed after planning.');
		}
	}
	if (options.verifyPackagedApp !== false) {
		assertSoundscaperProfessionalPackagedAppAuthority(plan.authority.packagedApp, {
			packagedAppRoot: plan.packagedAppRoot,
			sourceRevision: plan.sourceRevision,
			target: plan.target,
		});
	}
	return plan;
}

function selfTestAuthoritySourcePaths(target) {
	return target.startsWith('linux-') ? Object.freeze([
		...COMMON_AUTHORITY_SOURCE_PATHS,
		LINUX_SYSTEM_LIBRARIES_PATH,
		LINUX_SYSTEM_RUNTIME_PATH,
	]) : COMMON_AUTHORITY_SOURCE_PATHS;
}

function authenticatedGitFile(repositoryRoot, sourceRevision, path) {
	const absolutePath = resolve(repositoryRoot, path);
	const working = readFileSync(absolutePath);
	const committed = execFileSync('git', ['show', `${sourceRevision}:${path}`], {
		cwd: repositoryRoot,
		encoding: 'buffer',
		maxBuffer: 4 * 1024 * 1024,
	});
	if (!working.equals(committed)) {
		throw new Error(`The professional self-test working tree changed ${path}.`);
	}
	return Object.freeze({
		path,
		absolutePath,
		byteLength: working.byteLength,
		sha256: createHash('sha256').update(working).digest('hex'),
	});
}

function gitText(repositoryRoot, args) {
	return execFileSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
	});
}

function canonicalRoot(value) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0') || realpathSync(value) !== value) {
		throw new TypeError('The repository root must be one canonical absolute directory.');
	}
	return value;
}

function externalPath(value, repositoryRoot, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be an absolute normalized path.`);
	const relation = relative(repositoryRoot, value);
	if (relation === '' || !isExternalPathRelation(relation, sep, isAbsolute(relation))) {
		throw new TypeError(`The ${label} must remain outside the authenticated repository.`);
	}
	return value;
}

export function isExternalPathRelation(relation, separator, relationIsAbsolute) {
	return relation === '..' || relation.startsWith(`..${separator}`) || relationIsAbsolute;
}

function revision(value) {
	if (typeof value !== 'string' || !REVISION.test(value)) {
		throw new TypeError('The professional self-test source revision is invalid.');
	}
	return value;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
