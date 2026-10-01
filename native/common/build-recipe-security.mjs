/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	lstatSync, readFileSync, readdirSync, realpathSync, statSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const SHA256_DIGEST = /^[a-f0-9]{64}$/u;

const SOURCE_RECEIPT = '.framescaper-source-identity.json';
const TOOLCHAIN_RECEIPT_FIELDS = Object.freeze([
	'schemaVersion', 'targetId', 'hostRuntime', 'executables', 'environment', 'identitySha256',
]);
const TOOLCHAIN_RECEIPT_BODY_FIELDS = Object.freeze([
	'schemaVersion', 'targetId', 'hostRuntime', 'executables', 'environment',
]);

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

export function closedRecord(value, fields, name, optional = false) {
	if (optional && value === undefined) value = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| (!optional && (keys.length !== fields.length || fields.some((field) => !keys.includes(field))))) {
		throw new TypeError(`${name} has missing or unsupported fields.`);
	}
	return value;
}

export function existingDirectory(value, name) {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError(`${name} must be an explicit absolute path.`);
	}
	const path = resolve(value);
	if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory()) {
		throw new Error(`${name} must be one canonical non-symlink directory.`);
	}
	return path;
}

export function existingFile(value, name) {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError(`${name} must be an absolute path.`);
	}
	const path = resolve(value);
	if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
		throw new Error(`${name} must be one canonical non-symlink file.`);
	}
	return path;
}

export function jsonFile(path, name) {
	return jsonBytes(readFileSync(path), name);
}

export function jsonBytes(bytes, name) {
	let result;
	try { result = JSON.parse(bytes.toString('utf8')); }
	catch { throw new TypeError(`${name} must be valid JSON.`); }
	return closedRecord(result, Object.keys(result ?? {}), name);
}

export function safeRelativePath(value) {
	return typeof value === 'string' && value.length > 0 && !value.includes('\\')
		&& !isAbsolute(value)
		&& value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
		&& /^[a-zA-Z0-9._+/-]+$/u.test(value);
}

export function witnessFile(path, witnesses) {
	const file = existingFile(path, 'build input');
	const bytes = readFileSync(file);
	witnesses.push(Object.freeze({ path: file, sha256: sha256(bytes), byteLength: bytes.byteLength }));
	return bytes;
}

export function verifyWitnesses(witnesses, verifyAdditionalWitness = () => false) {
	for (const witness of witnesses) {
		if (verifyAdditionalWitness(witness)) continue;
		const bytes = readFileSync(existingFile(witness.path, 'build input witness'));
		if (bytes.byteLength !== witness.byteLength || sha256(bytes) !== witness.sha256) {
			throw new Error(`Build input drifted after recipe admission: ${witness.path}`);
		}
	}
}

export function pinnedJson(root, manifest, path, witnesses) {
	pinnedFile(root, manifest, path, witnesses);
	return jsonFile(join(root, path), path);
}

export function pinnedFile(root, manifest, path, witnesses) {
	const pin = manifest.sourceFiles?.find((entry) => entry.path === path);
	if (!safeRelativePath(path) || !pin || !SHA256_DIGEST.test(String(pin.sha256))) {
		throw new Error(`Local build input ${path} is not source-manifest pinned.`);
	}
	const bytes = witnessFile(join(root, path), witnesses);
	if (bytes.byteLength !== pin.byteLength || sha256(bytes) !== pin.sha256) {
		throw new Error(`Local build input ${path} drifted from its pin.`);
	}
	return bytes;
}

export function sourceReceipt(root, witnesses) {
	const path = join(root, SOURCE_RECEIPT);
	witnessFile(path, witnesses);
	return jsonFile(path, `${root} source receipt`);
}

export function emptyOutputRoot(value, repositoryRoot) {
	const root = existingDirectory(value, 'output root');
	if (inside(repositoryRoot, root)) {
		throw new Error('The native build output root must remain outside the repository.');
	}
	if (readdirSync(root).length !== 0) throw new Error('The native build output root must be empty.');
	return root;
}

export function assertSeparateRoots(roots) {
	for (const [index, root] of roots.entries()) for (const peer of roots.slice(index + 1)) {
		if (inside(root, peer) || inside(peer, root)) {
			throw new Error('Native build source and output roots must not overlap.');
		}
	}
}

export function closedToolchainEnvironment(value, allowedKeys) {
	const environment = closedRecord(value, Object.keys(value ?? {}), 'toolchain environment');
	if (!Object.hasOwn(environment, 'PATH')) throw new Error('The toolchain environment must bind PATH.');
	const result = {};
	for (const key of Object.keys(environment).sort()) {
		if (!allowedKeys.has(key) || typeof environment[key] !== 'string'
			|| environment[key].length === 0 || environment[key].includes('\0')) {
			throw new Error(`Toolchain environment ${key} is unsupported.`);
		}
		result[key] = environment[key];
	}
	return Object.freeze(result);
}

export function fingerprintToolchainReceipt(value, name) {
	const receipt = closedRecord(value, TOOLCHAIN_RECEIPT_BODY_FIELDS, name);
	return sha256(Buffer.from(canonicalJson(receipt)));
}

export function authenticateToolchainReceipt({
	pathValue,
	identityValue,
	target,
	roles,
	allowedEnvironment,
	witnesses,
	receiptBodyName,
	identityError,
}) {
	const path = existingFile(pathValue, 'toolchain receipt');
	const row = closedRecord(jsonFile(path, 'toolchain receipt'), TOOLCHAIN_RECEIPT_FIELDS,
		'toolchain receipt');
	const body = {
		schemaVersion: row.schemaVersion,
		targetId: row.targetId,
		hostRuntime: row.hostRuntime,
		executables: row.executables,
		environment: row.environment,
	};
	const identitySha256 = fingerprintToolchainReceipt(body, receiptBodyName);
	if (row.schemaVersion !== 1 || row.targetId !== target.id || row.hostRuntime !== target.hostRuntime
		|| row.identitySha256 !== identitySha256 || identityValue !== identitySha256) {
		throw new Error(identityError);
	}
	const admitted = closedRecord(row.executables, roles, 'toolchain executables');
	const executables = {};
	for (const role of roles) {
		const entry = closedRecord(admitted[role], ['path', 'sha256'], `toolchain executable ${role}`);
		const executable = existingFile(entry.path, `toolchain executable ${role}`);
		const bytes = witnessFile(executable, witnesses);
		if (entry.sha256 !== sha256(bytes)) throw new Error(`Toolchain executable ${role} drifted.`);
		executables[role] = Object.freeze({ path: executable, sha256: entry.sha256 });
	}
	const environment = closedToolchainEnvironment(row.environment, allowedEnvironment);
	witnessFile(path, witnesses);
	return Object.freeze({
		identitySha256, executables: Object.freeze(executables), environment,
	});
}

function inside(parent, child) {
	const path = relative(parent, child);
	return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
