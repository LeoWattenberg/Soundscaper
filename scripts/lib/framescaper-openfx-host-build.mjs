/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { lineEndingPolicyFindings } from './line-ending-policy.mjs';

export const FRAMESCAPER_OPENFX_HOST_ROOT = 'native/framescaper-openfx-host';
export const FRAMESCAPER_OPENFX_SOURCE_MANIFEST =
	`${FRAMESCAPER_OPENFX_HOST_ROOT}/source-manifest.json`;
export const FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST =
	'config/framescaper-openfx-host-payload-manifest.json';

const TARGET_IDS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const TARGET_FIELDS = Object.freeze([
	'runtime', 'status', 'blockedBy', 'toolchainIdentity', 'scannerPayload',
	'runtimeHostPayload', 'productionReadiness',
]);
const PRODUCTION_READINESS_FIELDS = Object.freeze([
	'schemaVersion', 'status', 'target', 'scannerSha256', 'runtimeHostSha256',
	'osIsolationAttested', 'realThirdPartyExecutionAttested', 'reviewedAt',
	'reviewer', 'evidenceSha256',
]);
const REQUIRED_CONTRACT_FILES = Object.freeze([
	'CMakeLists.txt',
	'fixtures/conformance_plugin.cpp',
	'src/dynamic_library.cpp',
	'src/dynamic_library.hpp',
	'src/host_runtime.cpp',
	'src/host_runtime.hpp',
	'src/host_scan_inspection.inc',
	'src/host_standard_parameters.inc',
	'src/isolation_contract.hpp',
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
]);
const REQUIRED_OPENFX_HEADERS = Object.freeze([
	'ofxCore.h', 'ofxImageEffect.h', 'ofxProperty.h', 'ofxParam.h',
	'ofxMemory.h', 'ofxMultiThread.h', 'ofxMessage.h', 'ofxProgress.h',
	'ofxTimeLine.h', 'ofxInteract.h', 'ofxDrawSuite.h',
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
	const actualPaths = sourcePaths(hostRoot).filter(
		(path) => !path.startsWith('prebuilt/') && !path.startsWith('out/'),
	);
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
		sourceText.get('src/loaded_plugin_binary.cpp') ?? '',
	].join('\n');
	for (const identity of [
		'OfxGetNumberOfPlugins', 'OfxGetPlugin', 'OfxSetHost',
		'kOfxImageEffectActionGetFramesNeeded', 'kOfxImageEffectActionRender',
		'kOfxPropertySuite', 'kOfxImageEffectSuite', 'kOfxParameterSuite',
		'kOfxMemorySuite', 'kOfxMultiThreadSuite', 'kOfxMessageSuite',
		'kOfxProgressSuite', 'kOfxTimeLineSuite', 'kOfxInteractSuite',
		'kOfxDrawSuite', 'kOfxDialogSuite', 'kOfxParametricParameterSuite',
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
				|| target.runtimeHostPayload !== null || typeof target.blockedBy !== 'string'
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
		for (const field of ['scannerPayload', 'runtimeHostPayload']) {
			const identity = entry[field];
			const bytes = readFileSync(resolve(repositoryRoot, identity.path));
			if (bytes.byteLength !== identity.byteLength
				|| createHash('sha256').update(bytes).digest('hex') !== identity.sha256) {
				throw new Error(`The packaged OpenFX ${entry.id} ${field} bytes disagree with the pin.`);
			}
		}
	}
	return Object.freeze({ source: audit.manifest, payload });
}

function sourcePaths(root) {
	const result = [];
	visit(root);
	return result.sort();

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name !== 'source-manifest.json' && statSync(path).isFile()) {
				result.push(relative(root, path).replaceAll('\\', '/'));
			}
		}
	}
}

function auditBuiltTarget(repositoryRoot, id, target) {
	const findings = [];
	if (target.blockedBy !== null || !SHA256.test(String(target.toolchainIdentity))) {
		findings.push(`OpenFX target ${id} requires an authenticated toolchain and no blocker.`);
	}
	const suffix = id.startsWith('win-') ? '.exe' : '';
	const prefix = `${FRAMESCAPER_OPENFX_HOST_ROOT}/prebuilt/${id}/bin/`;
	for (const [field, name] of [
		['scannerPayload', `framescaper-ofx-scanner${suffix}`],
		['runtimeHostPayload', `framescaper-ofx-runtime-host${suffix}`],
	]) {
		const payload = target[field];
		if (!payload || !sameFields(payload, ['path', 'byteLength', 'sha256'])
			|| payload.path !== `${prefix}${name}`
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
		const readiness = target.productionReadiness;
		if (!sameFields(readiness, PRODUCTION_READINESS_FIELDS)
			|| readiness.schemaVersion !== 1 || readiness.status !== 'reviewed'
			|| readiness.target !== id || readiness.osIsolationAttested !== true
			|| readiness.realThirdPartyExecutionAttested !== true
			|| readiness.scannerSha256 !== target.scannerPayload?.sha256
			|| readiness.runtimeHostSha256 !== target.runtimeHostPayload?.sha256
			|| !/^\d{4}-\d{2}-\d{2}$/u.test(String(readiness.reviewedAt))
			|| typeof readiness.reviewer !== 'string' || readiness.reviewer.length < 3
			|| readiness.reviewer.length > 128 || hasControlCharacters(readiness.reviewer)
			|| !SHA256.test(String(readiness.evidenceSha256))) {
			findings.push(`OpenFX target ${id} has an invalid production-readiness attestation.`);
		}
	}
	return findings;
}

function hasControlCharacters(value) {
	return [...value].some((character) => {
		const code = character.codePointAt(0);
		return code < 0x20 || code === 0x7f;
	});
}

function sameFields(value, fields) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}
