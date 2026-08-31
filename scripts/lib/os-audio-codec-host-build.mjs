/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated, codec-only native addon build for target OS audio APIs. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync,
	readdirSync, realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
	authenticateMilestone5NativeSourceInput,
	readMilestone5NativeSourceAcquisitions,
	removeMilestone5NativeSourceSnapshot,
	requireMilestone5NativeSource,
	snapshotMilestone5NativeSourceInput,
	verifyMilestone5NativeSourceInput,
} from './milestone-5-native-source-acquisitions.mjs';

export const OS_AUDIO_CODEC_HOST_TARGETS = Object.freeze([
	'mac-arm64', 'win-x64', 'win-arm64',
]);
/**
 * CMake picks the newest Visual Studio installed on the runner. The Windows x64
 * and ARM64 images do not carry the same release — windows-2025 ships only
 * Visual Studio 2026 while windows-11-arm still ships 2022 — and GitHub rolls
 * them independently, so pinning one generator fails configuration outright on
 * the other image. The plan therefore leaves the choice to CMake and admits a
 * closed reviewed set, which the recorded toolchain identity is checked against.
 */
export const OS_AUDIO_CODEC_HOST_ADMITTED_GENERATORS = Object.freeze({
	'mac-arm64': Object.freeze(['Ninja']),
	'win-x64': Object.freeze(['Visual Studio 17 2022', 'Visual Studio 18 2026']),
	'win-arm64': Object.freeze(['Visual Studio 17 2022', 'Visual Studio 18 2026']),
});
export const OS_AUDIO_CODEC_HOST_SOURCE_FILES = Object.freeze([
	'native/os-audio-codec-host/CMakeLists.txt',
	'native/os-audio-codec-host/src/node_api_bridge.cpp',
	'native/soundscaper-professional-host/src/os_aac_m4a_profile.cpp',
	'native/soundscaper-professional-host/src/os_aac_m4a_profile.h',
	'native/soundscaper-professional-host/src/os_audio_codec.h',
	'native/soundscaper-professional-host/src/os_audio_codec_mac.mm',
	'native/soundscaper-professional-host/src/os_audio_codec_windows.cpp',
	'native/soundscaper-professional-host/src/os_audio_codec_windows_file_bytes.h',
	'native/soundscaper-professional-host/src/os_audio_codec_windows_session.h',
	'native/soundscaper-professional-host/src/os_mp3_encode_windows.cpp',
	'native/soundscaper-professional-host/src/os_mp3_profile.cpp',
	'native/soundscaper-professional-host/src/os_mp3_profile.h',
	'native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp',
	'native/soundscaper-professional-host/tests/os_mp3_profile_self_test.cpp',
	'scripts/build-os-audio-codec-host.mjs',
	'scripts/lib/os-audio-codec-host-build.mjs',
]);

const NATIVE_ROOT = 'native/os-audio-codec-host';
const ARTIFACT_NAME = 'soundscaper_os_audio_codec.node';
const HEADER_SOURCE_ID = 'electron-node-api-headers';
const HEADER_VERSION = '43.1.1';
const HEADER_URL = 'https://electronjs.org/headers/v43.1.1/node-v43.1.1-headers.tar.gz';
const SOURCE_ALGORITHM = 'soundscaper-os-audio-codec-source-closure-sha256-v1';
const BUILD_PLAN_ALGORITHM = 'soundscaper-os-audio-codec-build-plan-sha256-v1';
const MAXIMUM_SOURCE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_TOOLCHAIN_BYTES = 4 * 1024;
const MAXIMUM_STEP_OUTPUT_BYTES = 8 * 1024 * 1024;
const AUTHENTICATED_PLANS = new WeakSet();
const TRUSTED_POLICIES = new WeakSet();

export function deriveOsAudioCodecHostPolicyIdentity(options) {
	const target = targetValue(options?.target);
	const signing = signingValue(target, options?.signingIdentity);
	const repositoryRoot = canonicalDirectory(options?.repositoryRoot, 'Repository root');
	const register = readMilestone5NativeSourceAcquisitions(
		repositoryRoot, options?.sourceManifestPath,
	);
	const headerSource = requireMilestone5NativeSource(register, HEADER_SOURCE_ID);
	validateHeaderSource(headerSource);
	const electronHeaders = electronHeaderIdentity(headerSource, {
		archive: headerSource.archive,
		extractedTree: headerSource.extractedTree,
	});
	const sourceIdentity = sourceClosureIdentity(repositoryRoot);
	const buildPlan = buildPlanIdentity({
		target,
		electronHeaders,
		sourceIdentity,
		signing: signing.identity,
		portable: portableCommands(target),
	});
	const policy = deepFreeze({
		target,
		electronHeaders,
		sourceIdentity,
		sourceRevision: sourceIdentity.sha256,
		buildPlan,
		buildPlanSha256: buildPlan.sha256,
		signing: signing.identity,
	});
	TRUSTED_POLICIES.add(policy);
	return policy;
}

export function assertOsAudioCodecHostBuildMatchesPolicy(build, policy) {
	assert(policy && typeof policy === 'object' && TRUSTED_POLICIES.has(policy),
		'OS audio codec build verification requires trusted checkout policy.');
	if (!sameJson(build?.electronHeaders, policy.electronHeaders)) {
		throw new TypeError('The OS audio codec Electron headers do not match trusted checkout policy.');
	}
	if (!sameJson(build?.sourceIdentity, policy.sourceIdentity)
		|| build?.sourceRevision !== policy.sourceRevision) {
		throw new TypeError('The OS audio codec source identity does not match trusted checkout policy.');
	}
	if (!sameJson(build?.buildPlan, policy.buildPlan)
		|| build?.buildPlanSha256 !== policy.buildPlanSha256) {
		throw new TypeError('The OS audio codec build plan does not match trusted checkout policy.');
	}
	if (build?.signing?.mode !== policy.signing.mode
		|| build?.signing?.identitySha256 !== policy.signing.identitySha256) {
		throw new TypeError('The OS audio codec signing identity does not match trusted checkout policy.');
	}
	return policy;
}

export function createOsAudioCodecHostBuildPlan(options) {
	const target = targetValue(options?.target);
	const signing = signingValue(target, options?.signingIdentity);
	const repositoryRoot = canonicalDirectory(options?.repositoryRoot, 'Repository root');
	const buildRoot = absentOutputPath(options?.buildRoot, 'Codec build root');
	const installRoot = absentOutputPath(options?.installRoot, 'Codec install root');
	const sourceSnapshotRoot = canonicalEmptyDirectory(
		options?.sourceSnapshotRoot, 'Electron header snapshot parent',
	);
	const manifestPath = options?.sourceManifestPath;
	const register = readMilestone5NativeSourceAcquisitions(repositoryRoot, manifestPath);
	const headerSource = requireMilestone5NativeSource(register, HEADER_SOURCE_ID);
	validateHeaderSource(headerSource);
	const headerAuthentication = authenticateMilestone5NativeSourceInput({
		repositoryRoot,
		...(manifestPath === undefined ? {} : { manifestPath }),
		sourceId: HEADER_SOURCE_ID,
		archivePath: options?.electronHeadersArchivePath,
		sourceRoot: options?.electronHeadersRoot,
	});
	assertRegularFile(resolve(headerAuthentication.extractedTree.root, 'include/node/node_api.h'),
		'Electron Node-API header');
	const headerSnapshot = resolve(sourceSnapshotRoot, HEADER_SOURCE_ID);
	const sourceRoot = resolve(repositoryRoot, NATIVE_ROOT);
	const sourceIdentity = sourceClosureIdentity(repositoryRoot);
	const headerIdentity = electronHeaderIdentity(headerSource, headerAuthentication);
	const portable = portableCommands(target);
	const macosSdkPath = target === 'mac-arm64'
		? canonicalDirectory(options?.macosSdkPath, 'macOS SDK root') : null;
	const artifactPath = resolve(installRoot, ARTIFACT_NAME);
	const replacements = new Map([
		['$SOURCE_ROOT', sourceRoot], ['$BUILD_ROOT', buildRoot],
		['$INSTALL_ROOT', installRoot], ['$ELECTRON_HEADERS', headerSnapshot],
		['$ARTIFACT', artifactPath],
		...(signing.raw === null ? [] : [['$SIGNING_IDENTITY', signing.raw]]),
		...(macosSdkPath === null ? [] : [['$MACOS_SDK', macosSdkPath]]),
	]);
	const configure = command('cmake', materialize(portable.configure, replacements));
	const build = command('cmake', materialize(portable.build, replacements));
	const nativeCanary = command('ctest', materialize(portable.nativeCanary, replacements));
	const install = command('cmake', materialize(portable.install, replacements));
	const sign = portable.sign === null ? null
		: command('codesign', materialize(portable.sign, replacements));
	const signatureVerification = portable.signatureVerification === null ? null
		: command('codesign', materialize(portable.signatureVerification, replacements));
	const buildPlan = buildPlanIdentity({
		target,
		electronHeaders: headerIdentity,
		sourceIdentity,
		signing: signing.identity,
		portable,
	});
	const plan = deepFreeze({
		schemaVersion: 1, target, repositoryRoot, sourceRoot, buildRoot, installRoot,
		artifactPath, sourceSnapshotRoot,
		headerSnapshot, headerAuthentication, electronHeaders: headerIdentity,
		sourceIdentity, buildPlan, signing: signing.identity, configure, build, nativeCanary,
		install, sign, signatureVerification,
	});
	AUTHENTICATED_PLANS.add(plan);
	return plan;
}

function buildPlanIdentity({ target, electronHeaders, sourceIdentity, signing, portable }) {
	return deepFreeze({
		algorithm: BUILD_PLAN_ALGORITHM,
		sha256: sha256(Buffer.from(JSON.stringify({
			schemaVersion: 1, target, napiVersion: 8, artifactName: ARTIFACT_NAME,
			electronHeaders, sourceIdentity, signing,
			configure: { command: 'cmake', argv: portable.configure },
			build: { command: 'cmake', argv: portable.build },
			nativeCanary: { command: 'ctest', argv: portable.nativeCanary },
			install: { command: 'cmake', argv: portable.install },
			sign: portable.sign === null ? null : { command: 'codesign', argv: portable.sign },
			signatureVerification: portable.signatureVerification === null ? null
				: { command: 'codesign', argv: portable.signatureVerification },
		}))),
	});
}

export function osAudioCodecHostBuildPlanIdentity(plan) {
	assert(AUTHENTICATED_PLANS.has(plan),
		'OS audio codec identity requires an authenticated build plan.');
	return plan.buildPlan;
}

export function executeOsAudioCodecHostBuild(plan, options = {}) {
	assert(plan && typeof plan === 'object' && AUTHENTICATED_PLANS.has(plan),
		'OS audio codec execution requires an authenticated build plan.');
	const currentSource = sourceClosureIdentity(plan.repositoryRoot);
	assert(equalIdentity(currentSource, plan.sourceIdentity),
		'OS audio codec source closure changed after build planning.');
	verifyMilestone5NativeSourceInput(plan.headerAuthentication);
	canonicalEmptyDirectory(plan.sourceSnapshotRoot, 'Electron header snapshot parent');
	absentOutputPath(plan.buildRoot, 'Codec build root');
	absentOutputPath(plan.installRoot, 'Codec install root');
	let snapshot;
	try {
		snapshot = snapshotMilestone5NativeSourceInput(plan.headerAuthentication, {
			snapshotRoot: plan.headerSnapshot,
		});
		assertRegularFile(resolve(snapshot.extractedTree.root, 'include/node/node_api.h'),
			'Authenticated Electron Node-API header snapshot');
		const run = options.run ?? spawnSync;
		const steps = [plan.configure, plan.build, plan.nativeCanary, plan.install,
			...(plan.sign === null ? [] : [plan.sign, plan.signatureVerification])];
		for (const step of steps) {
			const outcome = run(step.command, step.argv, {
				encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_STEP_OUTPUT_BYTES,
				env: { ...process.env, SOURCE_DATE_EPOCH: '0', TZ: 'UTC', LC_ALL: 'C' },
			});
			if (typeof options.onStepOutput === 'function') {
				options.onStepOutput(step, String(outcome.stdout ?? ''), String(outcome.stderr ?? ''));
			}
			assert(outcome.error === undefined && outcome.signal === null && outcome.status === 0,
				`OS audio codec ${step.command} step failed: ${stepFailure(outcome)}`);
		}
		assert(equalIdentity(sourceClosureIdentity(plan.repositoryRoot), plan.sourceIdentity),
			'OS audio codec source closure changed during the native build.');
		const artifact = boundedFileDescriptor(
			plan.artifactPath, MAXIMUM_ARTIFACT_BYTES, 'OS audio codec addon artifact',
		);
		const toolchainIdentity = readToolchainIdentity(plan);
		return deepFreeze({
			schemaVersion: 1, status: 'built', target: plan.target,
			artifact, electronHeaders: plan.electronHeaders,
			sourceIdentity: plan.sourceIdentity,
			sourceRevision: plan.sourceIdentity.sha256,
			buildPlan: plan.buildPlan,
			buildPlanSha256: plan.buildPlan.sha256,
			toolchainIdentity,
			nativeCanary: { status: 'passed', testCommand: 'ctest' },
			signing: signingResult(plan.signing),
		});
	} finally {
		if (snapshot !== undefined) removeMilestone5NativeSourceSnapshot(snapshot);
	}
}

function portableCommands(target) {
	const configure = ['-S', '$SOURCE_ROOT', '-B', '$BUILD_ROOT'];
	if (target === 'mac-arm64') configure.push(
		'-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=ON',
		'-DSOUNDSCAPER_NODE_API_INCLUDE=$ELECTRON_HEADERS/include/node',
		'-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_SYSROOT=$MACOS_SDK',
	);
	else configure.push(
		'-A', target === 'win-arm64' ? 'ARM64' : 'x64',
		'-DBUILD_TESTING=ON', '-DSOUNDSCAPER_NODE_API_INCLUDE=$ELECTRON_HEADERS/include/node',
		'-DCMAKE_SYSTEM_VERSION=10.0.26100',
	);
	return deepFreeze({
		configure,
		build: [
			'--build', '$BUILD_ROOT', '--config', 'Release', '--parallel', '--target',
			'soundscaper_os_audio_codec', 'soundscaper_os_audio_codec_self_test',
			'soundscaper_os_mp3_profile_self_test',
		],
		nativeCanary: [
			'--test-dir', '$BUILD_ROOT', '-C', 'Release', '--output-on-failure', '--no-tests=error',
		],
		install: ['--install', '$BUILD_ROOT', '--config', 'Release', '--prefix', '$INSTALL_ROOT'],
		sign: target === 'mac-arm64'
			? ['--force', '--sign', '$SIGNING_IDENTITY', '$ARTIFACT']
			: null,
		signatureVerification: target === 'mac-arm64'
			? ['--verify', '--strict', '$ARTIFACT'] : null,
	});
}

function signingValue(target, value) {
	if (target !== 'mac-arm64') {
		assert(value === undefined, 'Windows OS audio codec builds must not accept a signing identity.');
		return deepFreeze({ identity: {
			mode: 'not-applicable', identitySha256: null,
		}, raw: null });
	}
	if (value === '-') return deepFreeze({
		identity: { mode: 'ad-hoc', identitySha256: sha256(Buffer.from(value)) }, raw: value,
	});
	throw new TypeError('mac-arm64 supports only ad-hoc code sealing with identity -.');
}

function signingResult(signing) {
	return signing.mode === 'not-applicable'
		? { ...signing, verificationStatus: 'not-applicable' }
		: { ...signing, verificationStatus: 'passed' };
}

function materialize(arguments_, replacements) {
	return arguments_.map((argument) => argument.replaceAll(/\$[A-Z_]+/gu, (placeholder) => {
		assert(replacements.has(placeholder), `Unknown OS audio codec build placeholder ${placeholder}.`);
		return replacements.get(placeholder);
	}));
}

function sourceClosureIdentity(repositoryRoot) {
	const hash = createHash('sha256');
	for (const relativePath of OS_AUDIO_CODEC_HOST_SOURCE_FILES) {
		const descriptor = boundedFileDescriptor(resolve(repositoryRoot, relativePath),
			MAXIMUM_SOURCE_BYTES, `OS audio codec source ${relativePath}`);
		hash.update(relativePath, 'utf8');
		hash.update('\0');
		hash.update(String(descriptor.byteLength), 'utf8');
		hash.update('\0');
		hash.update(descriptor.sha256, 'ascii');
		hash.update('\n');
	}
	return deepFreeze({
		algorithm: SOURCE_ALGORITHM,
		fileCount: OS_AUDIO_CODEC_HOST_SOURCE_FILES.length,
		sha256: hash.digest('hex'),
	});
}

function electronHeaderIdentity(source, witness) {
	return deepFreeze({
		version: source.version,
		archive: {
			byteLength: witness.archive.byteLength, sha256: witness.archive.sha256,
		},
		extractedTree: {
			algorithm: witness.extractedTree.algorithm,
			fileCount: witness.extractedTree.fileCount,
			sha256: witness.extractedTree.sha256,
		},
	});
}

function validateHeaderSource(source) {
	assert(source.version === HEADER_VERSION && source.git.tag === `v${HEADER_VERSION}`
		&& source.git.commit === null && source.archive.url === HEADER_URL
		&& source.licenseSelection === 'MIT' && source.authenticationStatus === 'pinned-metadata',
	'OS audio codec builds require the exact registered Electron 43.1.1 Node-API headers.');
}

function readToolchainIdentity(plan) {
	const path = resolve(plan.buildRoot, 'soundscaper-os-audio-codec-toolchain.json');
	const descriptor = boundedFileDescriptor(path, MAXIMUM_TOOLCHAIN_BYTES, 'CMake toolchain identity');
	let value;
	try {
		value = JSON.parse(readFileSync(descriptor.path, 'utf8'));
	} catch (error) {
		throw new Error(`CMake toolchain identity is invalid: ${error.message}`, { cause: error });
	}
	const keys = [
		'cmake', 'cxxCompilerId', 'cxxCompilerVersion', 'generator', 'systemName', 'systemProcessor',
	];
	assert(value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort())
		&& /^\d+\.\d+\.\d+(?:[-.][A-Za-z\d]+)*$/u.test(value.cmake)
		&& /^[A-Za-z\d+_.-]{1,64}$/u.test(value.cxxCompilerId)
		&& /^[A-Za-z\d+_.-]{1,64}$/u.test(value.cxxCompilerVersion)
		&& typeof value.generator === 'string' && value.generator.length <= 64
		&& typeof value.systemName === 'string' && value.systemName.length <= 32
		&& typeof value.systemProcessor === 'string' && value.systemProcessor.length <= 32,
	'CMake emitted an invalid OS audio codec toolchain identity.');
	const admittedGenerators = OS_AUDIO_CODEC_HOST_ADMITTED_GENERATORS[plan.target];
	const expectedSystem = plan.target === 'mac-arm64' ? 'Darwin' : 'Windows';
	const processors = plan.target.endsWith('arm64')
		? new Set(['ARM64', 'aarch64', 'arm64']) : new Set(['AMD64', 'x86_64', 'x64']);
	assert(admittedGenerators.includes(value.generator) && value.systemName === expectedSystem
		&& processors.has(value.systemProcessor),
	'CMake toolchain identity does not match the selected OS audio codec target.');
	return deepFreeze(value);
}

function boundedFileDescriptor(value, maximumBytes, label) {
	const path = canonicalFile(value, label);
	const before = lstatSync(path);
	assert(before.size > 0 && before.size <= maximumBytes, `${label} exceeds its byte budget.`);
	const handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(handle);
		assert(opened.isFile() && opened.size === before.size
			&& (before.ino === 0 || opened.ino === 0
				|| before.dev === opened.dev && before.ino === opened.ino),
		`${label} changed while opening.`);
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(opened.size, 1024 * 1024));
		let byteLength = 0;
		for (;;) {
			const bytesRead = readSync(handle, buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			byteLength += bytesRead;
			assert(byteLength <= maximumBytes, `${label} exceeds its byte budget.`);
			hash.update(buffer.subarray(0, bytesRead));
		}
		const after = fstatSync(handle);
		assert(byteLength === opened.size && after.size === opened.size
			&& after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs,
		`${label} changed while hashing.`);
		return deepFreeze({ path, byteLength, sha256: hash.digest('hex') });
	} finally {
		closeSync(handle);
	}
}

function canonicalFile(value, label) {
	const path = absoluteNormalizedPath(value, label);
	const metadata = lstatSync(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink() && realpathSync(path) === path,
		`${label} must be one canonical regular non-symbolic file.`);
	return path;
}

function assertRegularFile(path, label) {
	canonicalFile(path, label);
}

function canonicalDirectory(value, label) {
	const path = absoluteNormalizedPath(value, label);
	const metadata = lstatSync(path);
	assert(metadata.isDirectory() && !metadata.isSymbolicLink() && realpathSync(path) === path,
		`${label} must be one canonical non-symbolic directory.`);
	return path;
}

function canonicalEmptyDirectory(value, label) {
	const path = canonicalDirectory(value, label);
	assert(readdirSync(path).length === 0, `${label} must be empty and exclusive to one build.`);
	return path;
}

function absentOutputPath(value, label) {
	const path = absoluteNormalizedPath(value, label);
	canonicalDirectory(dirname(path), `${label} parent`);
	try {
		lstatSync(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return path;
		throw error;
	}
	throw new Error(`${label} must not exist before the authenticated build.`);
}

function absoluteNormalizedPath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`${label} must be an absolute normalized path.`);
	}
	return value;
}

function targetValue(value) {
	if (typeof value !== 'string' || !OS_AUDIO_CODEC_HOST_TARGETS.includes(value)) {
		throw new TypeError('OS audio codec build system supports only mac-arm64, win-x64, and win-arm64.');
	}
	return value;
}

function command(commandValue, argv) {
	return deepFreeze({ command: commandValue, argv: [...argv] });
}

function stepFailure(value) {
	return String(value?.stderr || value?.stdout || value?.error?.message || 'unknown error').slice(0, 4_096);
}

function equalIdentity(left, right) {
	return left.algorithm === right.algorithm && left.fileCount === right.fileCount
		&& left.sha256 === right.sha256;
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
