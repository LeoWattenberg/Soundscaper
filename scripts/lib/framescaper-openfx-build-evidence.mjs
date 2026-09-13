/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed source, toolchain, and self-test evidence carried by an OpenFX CI result. */

import {
	fingerprintFramescaperOpenFxHostToolchainReceipt,
} from '../../native/framescaper-openfx-host/build/recipe-driver.mjs';

const SHA256 = /^[a-f\d]{64}$/u;
const TOOL_ROLES = Object.freeze(['c', 'cmake', 'cxx', 'ninja']);
const ENVIRONMENT_KEYS = new Set([
	'INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT',
	'TEMP', 'TMP',
]);
const SELF_TEST_IDS = Object.freeze([
	'isolation-launcher-refusal', 'openfx-runtime-host-self-test', 'openfx-scanner-self-test',
]);
const TARGET_RUNTIMES = Object.freeze({
	'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64', 'mac-arm64': 'darwin-arm64',
	'win-x64': 'win32-x64', 'win-arm64': 'win32-arm64',
});
const SOURCE_IDENTITIES = Object.freeze({
	openfx: Object.freeze({
		version: '1.5.1', commitSha: 'ab779510b2655b4d11a7e01e5c521f9aa8c88976',
		archiveSha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
		extractedTreeSha256: 'bd7c4e5850725a2ed985e7c5f1f531a33e1c2509057052b21a0062454c3a8efe',
	}),
	boost: Object.freeze({
		version: '1.92.0',
		archiveSha256: '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
		headerClosureSha256: 'a2f5894e12bc386b7db96936aba5f5bef3910e52da634c7630c73f1fa63e913d',
	}),
});

export function validateFramescaperOpenFxToolchainEvidence(value, target) {
	closedRecord(value, ['schemaVersion', 'targetId', 'hostRuntime', 'executables',
		'environment', 'identitySha256'], 'OpenFX toolchain receipt');
	closedRecord(value.executables, TOOL_ROLES, 'OpenFX toolchain executables');
	for (const role of TOOL_ROLES) {
		const descriptor = closedRecord(value.executables[role], ['path', 'sha256'],
			`OpenFX ${role} tool`);
		if (!portableAbsolutePath(descriptor.path) || !SHA256.test(String(descriptor.sha256))) {
			throw new TypeError(`The OpenFX ${role} tool identity is invalid.`);
		}
	}
	if (!value.environment || typeof value.environment !== 'object'
		|| Array.isArray(value.environment) || typeof value.environment.PATH !== 'string') {
		throw new TypeError('The OpenFX toolchain environment is invalid.');
	}
	for (const [key, entry] of Object.entries(value.environment)) {
		if (!ENVIRONMENT_KEYS.has(key) || typeof entry !== 'string' || entry === ''
			|| entry.includes('\0')) throw new TypeError(`OpenFX toolchain environment ${key} is invalid.`);
	}
	const body = {
		schemaVersion: value.schemaVersion, targetId: value.targetId, hostRuntime: value.hostRuntime,
		executables: value.executables, environment: value.environment,
	};
	const identity = fingerprintFramescaperOpenFxHostToolchainReceipt(body);
	if (value.schemaVersion !== 1 || value.targetId !== target
		|| value.hostRuntime !== TARGET_RUNTIMES[target] || value.identitySha256 !== identity) {
		throw new TypeError('The OpenFX build-result toolchain is target or identity misbound.');
	}
	return deepFreeze(structuredClone(value));
}

export function validateFramescaperOpenFxSourceEvidence(value) {
	closedRecord(value, ['openfx', 'boost'], 'OpenFX build source authentication');
	const openfx = closedRecord(value.openfx, ['schemaVersion', 'component', 'version', 'commitSha',
		'archiveSha256', 'extractedTreeSha256', 'root'], 'OpenFX source authentication');
	const boost = closedRecord(value.boost, ['schemaVersion', 'component', 'version', 'archiveSha256',
		'headerClosureSha256', 'root'], 'Boost source authentication');
	if (openfx.schemaVersion !== 1 || openfx.component !== 'openfx'
		|| boost.schemaVersion !== 1 || boost.component !== 'boost'
		|| !portableAbsolutePath(openfx.root) || !portableAbsolutePath(boost.root)
		|| Object.entries(SOURCE_IDENTITIES.openfx).some(([key, expected]) => openfx[key] !== expected)
		|| Object.entries(SOURCE_IDENTITIES.boost).some(([key, expected]) => boost[key] !== expected)) {
		throw new TypeError('The OpenFX build-result source authentication is not exact.');
	}
	return deepFreeze(structuredClone(value));
}

export function validateFramescaperOpenFxSelfTests(value) {
	if (!Array.isArray(value) || value.length !== SELF_TEST_IDS.length
		|| JSON.stringify(value.map(({ id }) => id)) !== JSON.stringify(SELF_TEST_IDS)) {
		throw new TypeError('The OpenFX build-result self-test inventory is incomplete.');
	}
	for (const entry of value) {
		closedRecord(entry, ['id', 'status', 'commandSha256', 'outputSha256'], 'OpenFX self-test');
		if (entry.status !== 'passed' || !SHA256.test(String(entry.commandSha256))
			|| !SHA256.test(String(entry.outputSha256))) {
			throw new TypeError('An OpenFX build-result self-test did not pass.');
		}
	}
	return deepFreeze(structuredClone(value));
}

function portableAbsolutePath(value) {
	return typeof value === 'string' && !value.includes('\0')
		&& (value.startsWith('/') || /^[A-Za-z]:[\\/][^\0]+$/u.test(value));
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`The ${label} has missing or unsupported fields.`);
	}
	return value;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
