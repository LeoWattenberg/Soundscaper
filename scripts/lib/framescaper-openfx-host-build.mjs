/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	closeSync, constants, fstatSync, lstatSync, openSync, readFileSync,
	realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	openFxProductionReadinessReference,
	verifyOpenFxProductionReadiness,
} from '../../desktop/openfx-production-readiness.ts';
import {
	MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
	resolveNativeIsolationReviewPublicKey,
	validateNativeIsolationReviewPolicy,
} from '../../desktop/native-isolation-review-policy.mjs';
import { lineEndingPolicyFindings } from './line-ending-policy.mjs';
import { listNativeSourceTree } from './native-source-tree.mjs';

export const FRAMESCAPER_OPENFX_HOST_ROOT = 'native/framescaper-openfx-host';
export const FRAMESCAPER_OPENFX_SOURCE_MANIFEST =
	`${FRAMESCAPER_OPENFX_HOST_ROOT}/source-manifest.json`;
export const FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST =
	'config/framescaper-openfx-host-payload-manifest.json';
export const FRAMESCAPER_OPENFX_READINESS_EVIDENCE_NAME =
	'framescaper-openfx-production-readiness.json';
export const FRAMESCAPER_OPENFX_REVIEW_POLICY_NAME =
	'milestone-5-native-isolation-review-policy.json';

const TARGET_IDS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const LINUX_RUNTIME_LOADERS = Object.freeze({
	'linux-x64': 'ld-linux-x86-64.so.2',
	'linux-arm64': 'ld-linux-aarch64.so.1',
});
const SHA256 = /^[a-f0-9]{64}$/u;
const TARGET_FIELDS = Object.freeze([
	'runtime', 'status', 'blockedBy', 'toolchainIdentity', 'scannerPayload',
	'runtimeHostPayload', 'isolationPayload', 'productionReadiness',
]);
const VERIFIED_PAYLOAD_RELEASES = new WeakSet();
const REQUIRED_CONTRACT_FILES = Object.freeze([
	'CMakeLists.txt',
	'fixtures/conformance_interact.inc',
	'fixtures/conformance_plugin.cpp',
	'src/dynamic_library.cpp',
	'src/dynamic_library.hpp',
	'src/gpu_runtime.cpp',
	'src/gpu_runtime.hpp',
	'src/host_runtime.cpp',
	'src/host_runtime.hpp',
	'src/host_interact.inc',
	'src/host_runtime_invoke.inc',
	'src/host_scan_inspection.inc',
	'src/host_standard_parameters.inc',
	'src/isolation_contract.hpp',
	'src/interact_v1_invocation.cpp',
	'src/interact_v1_invocation.hpp',
	'src/loaded_plugin_binary.cpp',
	'src/parameter_values.cpp',
	'src/parameter_values.hpp',
	'src/rgba_frame.hpp',
	'src/ofx_runtime_host.cpp',
	'src/ofx_scanner.cpp',
	'src/openfx_abi.hpp',
	'src/sha256.cpp',
	'src/sha256.hpp',
	'src/v12_output_file.cpp',
	'src/v12_output_file.hpp',
	'src/v12_transition_authority.cpp',
	'src/v12_transition_authority.hpp',
	'src/v12_gpu_qualification.cpp',
	'src/v12_gpu_qualification.hpp',
]);
const REQUIRED_OPENFX_HEADERS = Object.freeze([
	'ofxCore.h', 'ofxImageEffect.h', 'ofxProperty.h', 'ofxParam.h',
	'ofxMemory.h', 'ofxMultiThread.h', 'ofxMessage.h', 'ofxProgress.h',
	'ofxTimeLine.h', 'ofxInteract.h', 'ofxDrawSuite.h', 'ofxKeySyms.h',
	'ofxKeySyms.h',
	'ofxGPURender.h',
]);

export function readFramescaperOpenFxSourceManifest(repositoryRoot) {
	return JSON.parse(readFileSync(
		join(repositoryRoot, FRAMESCAPER_OPENFX_SOURCE_MANIFEST), 'utf8',
	));
}

export function auditFramescaperOpenFxHost({ repositoryRoot }) {
	const manifest = readFramescaperOpenFxSourceManifest(repositoryRoot);
	const findings = lineEndingPolicyFindings(repositoryRoot, [
		`/${FRAMESCAPER_OPENFX_HOST_ROOT}/**`,
		`/${FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST}`,
	]);
	if (manifest.schemaVersion !== 1 || manifest.hostVersion !== '1.0.0'
		|| manifest.helperContractVersion !== 1 || manifest.license !== 'AGPL-3.0-only') {
		findings.push('The OpenFX host source identity is unsupported.');
	}
	const expectedOpenFx = {
		version: '1.5.1', tag: 'OFX_Release_1.5.1', commit: 'ab77951',
		commitSha: 'ab779510b2655b4d11a7e01e5c521f9aa8c88976',
		tagObjectSha: '43d93ea99255cc61177b0632e421e899e802995e',
		signedTagApiUrl: 'https://api.github.com/repos/AcademySoftwareFoundation/openfx/git/tags/43d93ea99255cc61177b0632e421e899e802995e',
		signedTagVerifiedAt: '2025-11-20T18:14:02Z',
		url: 'https://codeload.github.com/AcademySoftwareFoundation/openfx/tar.gz/ab77951',
		byteLength: 9_837_777,
		sha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
		extractedTree: {
			algorithm: 'framescaper-portable-source-tree-sha256-v1',
			fileCount: 388,
			sha256: 'bd7c4e5850725a2ed985e7c5f1f531a33e1c2509057052b21a0062454c3a8efe',
		},
		license: 'BSD-3-Clause',
	};
	if (JSON.stringify(manifest.openfx) !== JSON.stringify(expectedOpenFx)) {
		findings.push('The OpenFX 1.5.1 signed-tag source pin drifted.');
	}
	const hostRoot = join(repositoryRoot, FRAMESCAPER_OPENFX_HOST_ROOT);
	const tree = sourceTree(hostRoot);
	const audited = (path) => !path.startsWith('prebuilt/') && !path.startsWith('out/');
	const actualPaths = tree.files.filter(audited);
	for (const path of tree.irregular.filter(audited)) {
		findings.push(`Irregular OpenFX host source entry: ${path}`);
	}
	const listedPaths = Array.isArray(manifest.sourceFiles)
		? manifest.sourceFiles.map(({ path }) => path) : [];
	if (JSON.stringify(listedPaths) !== JSON.stringify(actualPaths)) {
		findings.push('The OpenFX host local source closure is incomplete or unordered.');
	}
	for (const source of manifest.sourceFiles ?? []) {
		const path = join(hostRoot, source.path);
		let bytes;
		try {
			bytes = readFileSync(path);
		} catch {
			findings.push(`The OpenFX host source ${source.path} is missing.`);
			continue;
		}
		if (bytes.byteLength !== source.byteLength
			|| createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
			findings.push(`The OpenFX host source ${source.path} does not match its digest pin.`);
		}
	}
	const sourceText = new Map(actualPaths.map((path) => [
		path, readFileSync(join(hostRoot, path), 'utf8'),
	]));
	for (const path of REQUIRED_CONTRACT_FILES) {
		if (!sourceText.has(path)) findings.push(`The OpenFX native contract source ${path} is missing.`);
	}
	const abi = sourceText.get('src/openfx_abi.hpp') ?? '';
	for (const header of REQUIRED_OPENFX_HEADERS) {
		if (!abi.includes(`#include <${header}>`)) {
			findings.push(`The OpenFX native contract does not bind pinned header ${header}.`);
		}
	}
	const runtime = [
		sourceText.get('src/host_runtime.cpp') ?? '',
		sourceText.get('src/host_runtime_invoke.inc') ?? '',
		sourceText.get('src/gpu_runtime.cpp') ?? '',
		sourceText.get('src/loaded_plugin_binary.cpp') ?? '',
	].join('\n');
	for (const identity of [
		'OfxGetNumberOfPlugins', 'OfxGetPlugin', 'OfxSetHost',
		'kOfxImageEffectActionGetFramesNeeded', 'kOfxImageEffectActionRender',
		'kOfxPropertySuite', 'kOfxImageEffectSuite', 'kOfxParameterSuite',
		'kOfxMemorySuite', 'kOfxMultiThreadSuite', 'kOfxMessageSuite',
		'kOfxProgressSuite', 'kOfxTimeLineSuite', 'kOfxInteractSuite',
		'kOfxDrawSuite', 'kOfxDialogSuite', 'kOfxParametricParameterSuite',
		'kOfxOpenGLRenderSuite', 'kOfxOpenCLProgramSuite',
		'eglCreateContext', 'clCreateContext', 'cuCtxCreate_v2',
		'MTLCreateSystemDefaultDevice',
	]) {
		if (!runtime.includes(identity)) findings.push(`The OpenFX native runtime contract omits ${identity}.`);
	}
	const dynamicLoader = sourceText.get('src/dynamic_library.cpp') ?? '';
	if (!dynamicLoader.includes('sha256_file(path_)')
		|| !dynamicLoader.includes('open_library(path_)')
		|| dynamicLoader.indexOf('sha256_file(path_)') > dynamicLoader.indexOf('open_library(path_)')) {
		findings.push('The OpenFX native loader does not authenticate the exact binary before loading it.');
	}
	if (!dynamicLoader.includes('require_os_isolation_for_plugin_execution()')
		|| dynamicLoader.indexOf('require_os_isolation_for_plugin_execution()')
			> dynamicLoader.indexOf('open_library(path_)')) {
		findings.push('The OpenFX native loader can run without an isolation-attestation gate.');
	}
	const isolation = sourceText.get('src/isolation_contract.hpp') ?? '';
	if (!isolation.includes('isolation-unavailable: no reviewed OS isolation launcher attestation is implemented')
		|| !isolation.includes('unavailable-upstream-openfx-1.5.1-defines-only-v1')) {
		findings.push('The OpenFX isolation or pinned Interact-suite limitation is not explicit.');
	}
	const parameters = sourceText.get('src/parameter_values.cpp') ?? '';
	for (const identity of [
		'parameter_set_at', 'parameter_derivative', 'parameter_integral',
		'parameter_key_index', 'parameter_copy', 'parametric_add_point',
		'parametric_set_point', 'parametric_delete_all_points',
	]) {
		if (!parameters.includes(identity)) {
			findings.push(`The OpenFX typed parameter contract omits ${identity}.`);
		}
	}
	const cmake = sourceText.get('CMakeLists.txt') ?? '';
	if (!cmake.includes('src/parameter_values.cpp')
		|| cmake.includes('FRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE')) {
		findings.push('The production OpenFX build does not bind typed parameters or enables its test-only loader.');
	}
	const authoritySurface = [...sourceText.entries()]
		.filter(([path]) => path.startsWith('src/'))
		.map(([, text]) => text).join('\n');
	if (/\b(?:socket|connect|listen|accept|popen|system|ShellExecute)\s*\(/u.test(authoritySurface)
		|| /CreateWindow|NSWindow|XCreateWindow/u.test(authoritySurface)) {
		findings.push('The OpenFX native contract contains forbidden ambient network or window authority.');
	}
	for (const [path, text] of sourceText) {
		if (path.startsWith('src/') && text.split(/\r?\n/u).length - 1 > 600) {
			findings.push(`The OpenFX native source ${path} exceeds the maintained file ceiling.`);
		}
	}
	const targets = JSON.parse(readFileSync(join(hostRoot, 'build/targets.json'), 'utf8'));
	if (targets.schemaVersion !== 1
		|| JSON.stringify(targets.targets.map(({ id }) => id)) !== JSON.stringify(TARGET_IDS)
		|| JSON.stringify(Object.keys(manifest.targets)) !== JSON.stringify(TARGET_IDS)) {
		findings.push('The OpenFX five-target build identity is incomplete or reordered.');
	}
	for (const id of TARGET_IDS) {
		const target = manifest.targets[id];
		const expected = targets.targets.find((candidate) => candidate.id === id);
		if (!target || !sameFields(target, TARGET_FIELDS)) {
			findings.push(`OpenFX target ${id} has a malformed closed record.`);
			continue;
		}
		if (!expected || target.runtime !== expected.runtime) {
			findings.push(`OpenFX target ${id} runtime identity drifted.`);
		}
		if (target.status === 'pending-external') {
			if (target.toolchainIdentity !== null || target.scannerPayload !== null
				|| target.runtimeHostPayload !== null || target.isolationPayload !== null
				|| typeof target.blockedBy !== 'string'
				|| target.blockedBy.length < 16 || target.productionReadiness !== null) {
				findings.push(`OpenFX target ${id} has an invalid pending-external record.`);
			}
		} else if (target.status === 'built') {
			findings.push(...auditBuiltTarget(repositoryRoot, id, target));
		} else {
			findings.push(`OpenFX target ${id} has unsupported status ${String(target.status)}.`);
		}
	}
	return Object.freeze({ manifest, findings: Object.freeze(findings) });
}

export function deriveFramescaperOpenFxPayloadManifest(sourceManifest) {
	const targets = TARGET_IDS.map((id) => {
		const target = sourceManifest.targets[id];
		return target.status === 'built'
			? {
				id, runtime: target.runtime, status: 'built', blockedBy: null,
				payload: {
					scannerPayload: { ...target.scannerPayload },
					runtimeHostPayload: { ...target.runtimeHostPayload },
					isolationPayload: cloneIsolationPayload(target.isolationPayload),
				},
				productionReadiness: target.productionReadiness === null
					? null : { ...target.productionReadiness },
			}
			: {
				id, runtime: target.runtime, status: 'pending-external',
				blockedBy: target.blockedBy, payload: null, productionReadiness: null,
			};
	});
	return {
		schemaVersion: 1,
		id: `framescaper-openfx-host-${sourceManifest.hostVersion}`,
		sourceManifestPath: FRAMESCAPER_OPENFX_SOURCE_MANIFEST,
		openfx: {
			version: sourceManifest.openfx.version,
			commit: sourceManifest.openfx.commit,
			sha256: sourceManifest.openfx.sha256,
		},
		runtimePrefix: FRAMESCAPER_OPENFX_HOST_ROOT,
		payloads: targets.filter(({ status }) => status === 'built').map((target) => ({
			id: target.id, runtime: target.runtime,
			scannerPayload: { ...target.payload.scannerPayload },
			runtimeHostPayload: { ...target.payload.runtimeHostPayload },
			isolationPayload: cloneIsolationPayload(target.payload.isolationPayload),
		})),
		targets,
	};
}

export function verifyFramescaperOpenFxPayloadManifest({ repositoryRoot }) {
	const audit = auditFramescaperOpenFxHost({ repositoryRoot });
	if (audit.findings.length > 0) throw new Error(audit.findings.join('\n'));
	const payload = JSON.parse(readFileSync(
		join(repositoryRoot, FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST), 'utf8',
	));
	const expected = deriveFramescaperOpenFxPayloadManifest(audit.manifest);
	if (JSON.stringify(payload) !== JSON.stringify(expected)) {
		throw new Error('The packaged OpenFX payload manifest disagrees with the pinned source manifest.');
	}
	for (const entry of payload.payloads) {
		for (const [field, identity] of payloadDescriptors(entry)) {
			const bytes = readFileSync(resolve(repositoryRoot, identity.path));
			if (bytes.byteLength !== identity.byteLength
				|| createHash('sha256').update(bytes).digest('hex') !== identity.sha256) {
				throw new Error(`The packaged OpenFX ${entry.id} ${field} bytes disagree with the pin.`);
			}
		}
	}
	return Object.freeze({ source: audit.manifest, payload });
}

/** Reopen and authenticate every declared per-target isolation review. */
export async function verifyFramescaperOpenFxPayloadRelease({ repositoryRoot }) {
	const root = resolve(repositoryRoot);
	const release = verifyFramescaperOpenFxPayloadManifest({ repositoryRoot: root });
	const reviewPolicyBytes = regularCanonicalFile(
		root,
		MILESTONE_5_NATIVE_ISOLATION_REVIEW_POLICY_PATH,
		'OpenFX native-isolation review policy',
	);
	const reviewPolicy = parseJson(reviewPolicyBytes, 'OpenFX native-isolation review policy');
	validateNativeIsolationReviewPolicy(reviewPolicy);
	const productionReadiness = {};
	for (const target of release.payload.targets) {
		if (target.status !== 'built' || target.productionReadiness === null) {
			productionReadiness[target.id] = null;
			continue;
		}
		const reference = openFxProductionReadinessReference(
			target.productionReadiness,
			target.id,
		);
		const evidence = await verifyOpenFxProductionReadiness(reference, {
			scannerSha256: target.payload.scannerPayload.sha256,
			runtimeHostSha256: target.payload.runtimeHostPayload.sha256,
			isolation: {
				launcherSha256: target.payload.isolationPayload.launcherPayload.sha256,
				sandboxProfileSha256: target.payload.isolationPayload.sandboxProfilePayload.sha256,
				brokerPolicySha256: target.payload.isolationPayload.brokerPolicyPayload.sha256,
				runtimeLibraries: target.payload.isolationPayload.runtimeLibraryPayloads.map((library) => ({
					name: library.path.split('/').at(-1),
					byteLength: library.byteLength,
					sha256: library.sha256,
				})),
			},
		}, {
			readEvidence: async (path) => regularCanonicalFile(
				root, path, `OpenFX ${target.id} production-readiness evidence`,
			),
			resolveReviewPublicKey: (_target, keyId) => resolveNativeIsolationReviewPublicKey(
				reviewPolicy,
				{ usage: 'framescaper-openfx-production-readiness', target: target.id, keyId },
			),
		});
		const evidenceBytes = regularCanonicalFile(
			root,
			reference.evidence.path,
			`reopened OpenFX ${target.id} production-readiness evidence`,
		);
		verifyDescriptor(evidenceBytes, reference.evidence,
			`reopened OpenFX ${target.id} production-readiness evidence`);
		productionReadiness[target.id] = Object.freeze({
			reference,
			evidence: Object.freeze({ status: 'authenticated', evidence }),
			evidenceBytes,
		});
	}
	const verified = Object.freeze({
		...release,
		reviewPolicy: Object.freeze({
			name: FRAMESCAPER_OPENFX_REVIEW_POLICY_NAME,
			byteLength: reviewPolicyBytes.byteLength,
			sha256: digest(reviewPolicyBytes),
			bytes: reviewPolicyBytes,
		}),
		productionReadiness: Object.freeze(productionReadiness),
	});
	VERIFIED_PAYLOAD_RELEASES.add(verified);
	return verified;
}

export function framescaperOpenFxProductionReadinessStageSummary(release, targetId) {
	assertVerifiedPayloadRelease(release);
	const readiness = release.productionReadiness[targetId];
	if (readiness === null) return null;
	return deepFreeze({
		reference: structuredClone(readiness.reference),
		evidence: {
			name: FRAMESCAPER_OPENFX_READINESS_EVIDENCE_NAME,
			byteLength: readiness.evidenceBytes.byteLength,
			sha256: digest(readiness.evidenceBytes),
		},
		verified: structuredClone(readiness.evidence),
	});
}

function sourceTree(root) {
	const tree = listNativeSourceTree(root);
	const hostPath = (path) => relative(root, path).replaceAll('\\', '/');
	return {
		files: tree.files.map(hostPath).filter((path) => path !== 'source-manifest.json').sort(),
		irregular: tree.irregular.map(hostPath).sort(),
	};
}

function auditBuiltTarget(repositoryRoot, id, target) {
	const findings = [];
	if (target.blockedBy !== null || !SHA256.test(String(target.toolchainIdentity))) {
		findings.push(`OpenFX target ${id} requires an authenticated toolchain and no blocker.`);
	}
	const suffix = id.startsWith('win-') ? '.exe' : '';
	const prefix = `${FRAMESCAPER_OPENFX_HOST_ROOT}/prebuilt/${id}/bin/`;
	const isolationPrefix = `${FRAMESCAPER_OPENFX_HOST_ROOT}/prebuilt/${id}/isolation/`;
	const isolation = target.isolationPayload;
	if (!isolation || !sameFields(isolation, [
		'launcherPayload', 'sandboxProfilePayload', 'brokerPolicyPayload', 'runtimeLibraryPayloads',
	]) || !Array.isArray(isolation.runtimeLibraryPayloads) || isolation.runtimeLibraryPayloads.length > 32) {
		findings.push(`OpenFX target ${id} has an invalid isolationPayload identity.`);
	}
	const declarations = [
		['scannerPayload', target.scannerPayload, `${prefix}framescaper-ofx-scanner${suffix}`],
		['runtimeHostPayload', target.runtimeHostPayload, `${prefix}framescaper-ofx-runtime-host${suffix}`],
		['isolation launcherPayload', isolation?.launcherPayload,
			`${isolationPrefix}milestone5-native-isolation-launcher${suffix}`],
		['isolation sandboxProfilePayload', isolation?.sandboxProfilePayload,
			`${isolationPrefix}milestone5-native-isolation-profile.json`],
		['isolation brokerPolicyPayload', isolation?.brokerPolicyPayload,
			`${isolationPrefix}milestone5-native-isolation-broker.json`],
		...(Array.isArray(isolation?.runtimeLibraryPayloads)
			? isolation.runtimeLibraryPayloads.map((payload) => [
				'isolation runtimeLibraryPayloads', payload,
				`${FRAMESCAPER_OPENFX_HOST_ROOT}/prebuilt/${id}/lib/${payload?.path?.split('/').at(-1) ?? ''}`,
			]) : []),
	];
	const runtimePaths = Array.isArray(isolation?.runtimeLibraryPayloads)
		? isolation.runtimeLibraryPayloads.map(({ path }) => path) : [];
	if (runtimePaths.some((path, index) => index > 0
		&& runtimePaths[index - 1].localeCompare(path, 'en') >= 0)) {
		findings.push(`OpenFX target ${id} runtime libraries are not uniquely ordered.`);
	}
	if (id.startsWith('linux-') && runtimePaths.filter((path) => (
		path.split('/').at(-1) === LINUX_RUNTIME_LOADERS[id]
	)).length !== 1) {
		findings.push(`OpenFX target ${id} requires its exact staged runtime loader.`);
	}
	for (const [field, payload, expectedPath] of declarations) {
		if (!payload || !sameFields(payload, ['path', 'byteLength', 'sha256'])
			|| payload.path !== expectedPath
			|| !Number.isSafeInteger(payload.byteLength) || payload.byteLength <= 0
			|| !SHA256.test(String(payload.sha256))) {
			findings.push(`OpenFX target ${id} has an invalid ${field} identity.`);
			continue;
		}
		const path = resolve(repositoryRoot, payload.path);
		try {
			const metadata = lstatSync(path);
			if (metadata.isSymbolicLink() || !metadata.isFile() || realpathSync(path) !== path) {
				throw new Error('not a canonical regular file');
			}
			const bytes = readFileSync(path);
			if (bytes.byteLength !== payload.byteLength
				|| createHash('sha256').update(bytes).digest('hex') !== payload.sha256) {
				findings.push(`OpenFX target ${id} ${field} bytes disagree with the pin.`);
			}
		} catch {
			findings.push(`OpenFX target ${id} ${field} is missing or not a canonical file.`);
		}
	}
	if (target.productionReadiness !== null) {
		try {
			openFxProductionReadinessReference(target.productionReadiness, id);
		} catch {
			findings.push(`OpenFX target ${id} has an invalid production-readiness attestation.`);
		}
	}
	return findings;
}

function regularCanonicalFile(root, relativePath, label) {
	const path = resolve(root, relativePath);
	const localPath = relative(root, path);
	if (!localPath || isAbsolute(localPath) || localPath === '..' || localPath.startsWith(`..${sep}`)) {
		throw new Error(`${label} leaves its repository root.`);
	}
	const metadata = lstatSync(path);
	if (metadata.isSymbolicLink() || !metadata.isFile() || realpathSync(path) !== path) {
		throw new Error(`${label} is not a canonical regular file.`);
	}
	if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > 1024 * 1024) {
		throw new Error(`${label} has an invalid byte length.`);
	}
	const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(descriptor);
		if (!opened.isFile() || opened.size !== metadata.size
			|| (metadata.ino !== 0 && opened.ino !== 0
				&& (opened.dev !== metadata.dev || opened.ino !== metadata.ino))) {
			throw new Error(`${label} changed while it was opened.`);
		}
		const bytes = readFileSync(descriptor);
		const after = fstatSync(descriptor);
		if (after.size !== opened.size || bytes.byteLength !== opened.size) {
			throw new Error(`${label} changed while it was read.`);
		}
		return bytes;
	} finally {
		closeSync(descriptor);
	}
}

function verifyDescriptor(bytes, descriptor, label) {
	if (bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256) {
		throw new Error(`${label} changed bytes or digest.`);
	}
}

function cloneIsolationPayload(value) {
	return {
		launcherPayload: { ...value.launcherPayload },
		sandboxProfilePayload: { ...value.sandboxProfilePayload },
		brokerPolicyPayload: { ...value.brokerPolicyPayload },
		runtimeLibraryPayloads: value.runtimeLibraryPayloads.map((library) => ({ ...library })),
	};
}

function payloadDescriptors(entry) {
	return [
		['scannerPayload', entry.scannerPayload],
		['runtimeHostPayload', entry.runtimeHostPayload],
		['isolation launcherPayload', entry.isolationPayload.launcherPayload],
		['isolation sandboxProfilePayload', entry.isolationPayload.sandboxProfilePayload],
		['isolation brokerPolicyPayload', entry.isolationPayload.brokerPolicyPayload],
		...entry.isolationPayload.runtimeLibraryPayloads.map((library) => (
			['isolation runtimeLibraryPayloads', library]
		)),
	];
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`${label} is invalid JSON.`, { cause: error }); }
}

function assertVerifiedPayloadRelease(release) {
	if (!VERIFIED_PAYLOAD_RELEASES.has(release)) {
		throw new Error('A verified Framescaper OpenFX payload release is required.');
	}
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

function sameFields(value, fields) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}
