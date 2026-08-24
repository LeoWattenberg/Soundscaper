/* SPDX-License-Identifier: AGPL-3.0-only */

/** Immutable, full-tree custody for one target-specific OpenFX bundle. */

import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { FramescaperOpenFxHostTargetId } from './framescaper-openfx-host-payload.ts';
import type {
	HelperExecutableGrant,
	HelperNativeFileIdentity,
} from './helper-contract.ts';
import type {
	HelperOpenFxPluginCustody,
	HelperOpenFxPluginRuntimeFile,
} from './helper-native-ofx-plugin-custody.ts';
import { authenticateFramescaperOpenFxPluginBinary } from './openfx-main-plugin-binary.ts';
import { isExecutableMappableOpenFxFile } from './openfx-plugin-native-image.ts';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';
import { snapshotAuthenticatedPluginCandidate } from './plugin-candidate-snapshot.mjs';

const ARCHITECTURE_DIRECTORY = Object.freeze({
	'linux-x64': 'Linux-x86-64',
	'linux-arm64': 'Linux-aarch64',
	'mac-arm64': 'MacOS',
	'win-x64': 'Win64',
	'win-arm64': 'Win-arm64ec',
} as const satisfies Readonly<Record<FramescaperOpenFxHostTargetId, string>>);
const BUNDLE_SUFFIX = '.ofx.bundle';
const MAXIMUM_RUNTIME_FILES = 60;
const authenticatedSnapshots = new WeakSet<object>();

interface CandidateAuthentication {
	readonly kind: 'file' | 'bundle';
	readonly byteLength: number;
	readonly sha256: string;
	readonly fileCount: number;
	readonly identity: HelperNativeFileIdentity;
}

interface CandidateSnapshot {
	readonly path: string;
	readonly authentication: CandidateAuthentication;
	dispose(): Promise<void>;
}

export interface FramescaperOpenFxPluginSnapshot {
	readonly executable: HelperExecutableGrant;
	readonly custody: HelperOpenFxPluginCustody;
	dispose(): Promise<void>;
}

export interface FramescaperOpenFxPluginSnapshotPorts {
	readonly copy?: typeof import('node:fs/promises').cp;
	readonly snapshotParent?: string;
}

export async function snapshotFramescaperOpenFxPluginCandidate(
	selectedPath: string,
	target: FramescaperOpenFxHostTargetId,
	ports: FramescaperOpenFxPluginSnapshotPorts = {},
): Promise<FramescaperOpenFxPluginSnapshot> {
	const selection = selectedCandidate(selectedPath, target);
	const authentication = await authenticatePluginCandidate(selection.root) as CandidateAuthentication;
	const snapshot = await snapshotAuthenticatedPluginCandidate(
		selection.root, authentication, ports,
	) as CandidateSnapshot;
	try {
		const executablePath = selection.relativeExecutable === '' ? snapshot.path
			: resolve(snapshot.path, ...selection.relativeExecutable.split('/'));
		const executable = await authenticateFramescaperOpenFxPluginBinary(executablePath);
		const files = authentication.kind === 'bundle'
			? await bundleFiles(snapshot.path, executable.path)
			: Object.freeze({ resources: Object.freeze([]), runtimeClosure: Object.freeze([]) });
		const custody: HelperOpenFxPluginCustody = Object.freeze({
			schemaVersion: 1,
			kind: authentication.kind,
			rootPath: snapshot.path,
			rootIdentity: snapshot.authentication.identity,
			byteLength: snapshot.authentication.byteLength,
			sha256: snapshot.authentication.sha256,
			fileCount: snapshot.authentication.fileCount,
			executableRelativePath: selection.relativeExecutable,
			resources: files.resources,
			runtimeClosure: files.runtimeClosure,
		});
		const value = Object.freeze({
			executable: Object.freeze({ ...executable, custody }),
			custody,
			dispose: snapshot.dispose,
		});
		authenticatedSnapshots.add(value);
		return value;
	} catch (error) {
		await snapshot.dispose();
		throw error;
	}
}

export function isAuthenticatedFramescaperOpenFxPluginSnapshot(
	value: unknown,
): value is FramescaperOpenFxPluginSnapshot {
	return !!value && typeof value === 'object' && authenticatedSnapshots.has(value);
}

export function sameFramescaperOpenFxPluginSnapshot(
	left: FramescaperOpenFxPluginSnapshot,
	right: FramescaperOpenFxPluginSnapshot,
): boolean {
	return left.executable.sha256 === right.executable.sha256
		&& left.custody.sha256 === right.custody.sha256;
}

export async function reauthenticateFramescaperOpenFxPluginSnapshot(
	value: FramescaperOpenFxPluginSnapshot,
): Promise<void> {
	if (!isAuthenticatedFramescaperOpenFxPluginSnapshot(value)) {
		throw new TypeError('OpenFX custody must be the main-owned immutable snapshot result.');
	}
	const actual = await authenticatePluginCandidate(value.custody.rootPath) as CandidateAuthentication;
	if (!sameCandidate(actual, value.custody)) {
		throw new Error('The immutable OpenFX bundle snapshot changed after admission.');
	}
	const executable = await authenticateFramescaperOpenFxPluginBinary(value.executable.path);
	if (!sameExecutable(executable, value.executable)) {
		throw new Error('The immutable OpenFX executable changed after admission.');
	}
	const files = value.custody.kind === 'bundle'
		? await bundleFiles(value.custody.rootPath, value.executable.path)
		: Object.freeze({ resources: Object.freeze([]), runtimeClosure: Object.freeze([]) });
	if (!sameRuntimeClosure(files.resources, value.custody.resources)
		|| !sameRuntimeClosure(files.runtimeClosure, value.custody.runtimeClosure)) {
		throw new Error('The immutable OpenFX native runtime closure changed after admission.');
	}
}

function selectedCandidate(pathValue: string, target: FramescaperOpenFxHostTargetId) {
	const selected = absolutePath(pathValue);
	const bundle = bundleAncestor(selected);
	if (bundle === null) return Object.freeze({ root: selected, relativeExecutable: '' });
	const name = basename(bundle).slice(0, -BUNDLE_SUFFIX.length);
	if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u.test(name)) {
		throw new TypeError('The OpenFX bundle has no bounded portable module name.');
	}
	const relativeExecutable = `Contents/${ARCHITECTURE_DIRECTORY[target]}/${name}.ofx`;
	const executable = resolve(bundle, ...relativeExecutable.split('/'));
	if (selected !== bundle && selected !== executable) {
		throw new Error('The selected OpenFX path is not this target bundle\'s canonical executable.');
	}
	return Object.freeze({ root: bundle, relativeExecutable });
}

async function bundleFiles(
	root: string,
	executablePath: string,
): Promise<Readonly<{
	readonly resources: readonly HelperOpenFxPluginRuntimeFile[];
	readonly runtimeClosure: readonly HelperOpenFxPluginRuntimeFile[];
}>> {
	const files = await regularFiles(root);
	const runtime: HelperOpenFxPluginRuntimeFile[] = [];
	const resources: HelperOpenFxPluginRuntimeFile[] = [];
	for (const path of files) {
		if (path === executablePath) continue;
		const grant = await authenticateFramescaperOpenFxPluginBinary(path);
		const entry = Object.freeze({
			path: grant.path, bytes: grant.bytes, sha256: grant.sha256, identity: grant.identity,
		});
		(await isExecutableMappableOpenFxFile(path) ? runtime : resources).push(entry);
		if (runtime.length + resources.length > MAXIMUM_RUNTIME_FILES) {
			throw new Error('The OpenFX bundle exceeds its exact per-file isolation grant limit.');
		}
	}
	runtime.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	resources.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	return Object.freeze({ resources: Object.freeze(resources), runtimeClosure: Object.freeze(runtime) });
}

async function regularFiles(root: string): Promise<readonly string[]> {
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			const path = join(directory, entry.name);
			const details = await lstat(path);
			if (details.isDirectory() && !details.isSymbolicLink()) await visit(path);
			else if (details.isFile() && !details.isSymbolicLink()) files.push(path);
			else throw new Error('The OpenFX custody snapshot contains a symbolic or special entry.');
		}
	}
	await visit(root);
	return Object.freeze(files);
}

function bundleAncestor(path: string): string | null {
	let current = path;
	for (;;) {
		if (basename(current).endsWith(BUNDLE_SUFFIX)) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function sameCandidate(actual: CandidateAuthentication, expected: HelperOpenFxPluginCustody): boolean {
	return actual.kind === expected.kind && actual.byteLength === expected.byteLength
		&& actual.sha256 === expected.sha256 && actual.fileCount === expected.fileCount
		&& actual.identity.dev === expected.rootIdentity.dev && actual.identity.ino === expected.rootIdentity.ino;
}

function sameExecutable(left: HelperExecutableGrant, right: HelperExecutableGrant): boolean {
	return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256
		&& left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino;
}

function sameRuntimeClosure(
	left: readonly HelperOpenFxPluginRuntimeFile[],
	right: readonly HelperOpenFxPluginRuntimeFile[],
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || resolve(value) !== value) {
		throw new TypeError('The OpenFX candidate must be one absolute normalized path.');
	}
	return value;
}

export function pathInsideOpenFxCustody(root: string, path: string): boolean {
	const value = relative(root, path);
	return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
