/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact host-system ELF closure for a Landlock-confined professional peer. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path';

import {
	isSoundscaperProfessionalLinuxRuntimeLibrary,
	soundscaperProfessionalLinuxInterpreter,
	soundscaperProfessionalLinuxLoaderName,
	type SoundscaperProfessionalLinuxTarget,
} from './soundscaper-professional-linux-system-libraries.ts';

const MAXIMUM_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAXIMUM_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_RUNTIME_FILES = 48;
const SHA256 = /^[a-f\d]{64}$/u;
const VIRTUAL_LIBRARY = 'linux-vdso.so.1';

interface ArtifactDescriptor {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly identity: Readonly<{ readonly dev: number; readonly ino: number }>;
}

interface CommandResult {
	readonly error?: unknown;
	readonly signal: NodeJS.Signals | null;
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

interface ResolverDependencies {
	readonly readArtifact?: (path: string, label: string) => Promise<ArtifactDescriptor>;
	readonly run?: (command: string, args: string[], options: Readonly<{
		encoding: BufferEncoding;
		shell: false;
		maxBuffer: number;
		timeout: number;
		env: Readonly<Record<string, string>>;
	}>) => CommandResult;
}

export interface SoundscaperProfessionalLinuxSystemRuntime {
	readonly schemaVersion: 1;
	readonly policy: 'host-system-elf-runtime-v1';
	readonly target: SoundscaperProfessionalLinuxTarget;
	readonly entryExecutable: ArtifactDescriptor;
	readonly runtimeClosure: readonly ArtifactDescriptor[];
	readonly loaderArguments: readonly string[];
}

export async function resolveSoundscaperProfessionalLinuxSystemRuntime(
	options: Readonly<{
		readonly target?: unknown;
		readonly peer?: unknown;
		readonly runtimeClosure?: unknown;
	}> | null | undefined,
	dependencies: ResolverDependencies = {},
): Promise<Readonly<SoundscaperProfessionalLinuxSystemRuntime>> {
	const target = linuxTarget(options?.target);
	const peer = artifact(options?.peer, 'professional peer');
	const packagedRuntimeClosure = artifactArray(options?.runtimeClosure);
	if (packagedRuntimeClosure.length !== 0) {
		throw new Error('The packaged ELF runtime closure must be empty.');
	}
	const readArtifact = dependencies.readArtifact ?? authenticatedSystemArtifact;
	const run = dependencies.run ?? ((command, args, commandOptions) =>
		spawnSync(command, args, commandOptions) as CommandResult);
	if (typeof readArtifact !== 'function' || typeof run !== 'function') {
		throw new TypeError('Linux system-runtime resolution requires file and command ports.');
	}
	const peerBytes = await authenticatedPeerBytes(peer);
	const requestedLoader = elfInterpreter(peerBytes, target);
	if (requestedLoader !== soundscaperProfessionalLinuxInterpreter(target)) {
		throw new Error('The professional peer requests an unreviewed ELF interpreter.');
	}
	const loaderPath = await realpath(requestedLoader);
	if (!isAbsolute(loaderPath)
		|| soundscaperProfessionalLinuxLoaderName(target) !== loaderPath.split('/').at(-1)) {
		throw new Error('The professional peer requests an unreviewed ELF interpreter.');
	}
	const loader = systemArtifact(await readArtifact(loaderPath, 'ELF interpreter'), loaderPath,
		'ELF interpreter');
	const defaultRows = loaderRows(commandText(run, loader.path,
		['--inhibit-cache', '--list', peer.path], 'default ELF closure inspection'), target);
	const libraryPath = [...new Set(defaultRows.map(({ path }) => dirname(path)))]
		.sort().join(':');
	if (libraryPath.length < 1 || libraryPath.length > 32_768) {
		throw new Error('The professional ELF library path is empty or unbounded.');
	}
	const exactArgs = ['--inhibit-cache', '--library-path', libraryPath, '--list', peer.path];
	const exactRows = loaderRows(commandText(run, loader.path, exactArgs,
		'exact ELF closure inspection'), target);
	const paths = [...new Set([loader.path, ...defaultRows.map(({ path }) => path),
		...exactRows.map(({ path }) => path)])].sort();
	if (paths.length > MAXIMUM_RUNTIME_FILES) {
		throw new RangeError(`The Linux system runtime exceeds ${MAXIMUM_RUNTIME_FILES} files.`);
	}
	const first = await Promise.all(paths.map(async (path) => systemArtifact(
		await readArtifact(path, `ELF runtime ${path}`), path, `ELF runtime ${path}`,
	)));
	const second = await Promise.all(paths.map(async (path) => systemArtifact(
		await readArtifact(path, `ELF runtime ${path}`), path, `ELF runtime ${path}`,
	)));
	for (let index = 0; index < first.length; index += 1) {
		const before = first[index];
		const after = second[index];
		if (before === undefined || after === undefined || !sameArtifact(before, after)) {
			throw new Error(`The ELF runtime ${paths[index]} changed while authenticated.`);
		}
	}
	const firstByRequestedPath = new Map(paths.map((path, index) => [path, first[index]!]));
	const defaultBindings = rowBindings(defaultRows, firstByRequestedPath);
	const exactBindings = rowBindings(exactRows, firstByRequestedPath);
	if (JSON.stringify(defaultBindings) !== JSON.stringify(exactBindings)) {
		throw new Error('The exact ELF library path resolves a different runtime closure.');
	}
	const unique = uniqueArtifacts(first);
	if (unique.length > MAXIMUM_RUNTIME_FILES) {
		throw new RangeError(`The combined Linux runtime exceeds ${MAXIMUM_RUNTIME_FILES} files.`);
	}
	const entryExecutable = unique.find(({ path }) => path === loader.path);
	if (!entryExecutable) throw new Error('The authenticated ELF closure omitted its interpreter.');
	return deepFreeze({
		schemaVersion: 1,
		policy: 'host-system-elf-runtime-v1',
		target,
		entryExecutable,
		runtimeClosure: unique.sort((left, right) => left.path.localeCompare(right.path, 'en')),
		loaderArguments: ['--inhibit-cache', '--library-path', libraryPath],
	});
}

export function parseSoundscaperProfessionalLinuxLoaderList(
	value: unknown,
	target: SoundscaperProfessionalLinuxTarget,
): readonly Readonly<{ name: string; path: string }>[] {
	if (typeof value !== 'string' || Buffer.byteLength(value) > MAXIMUM_COMMAND_OUTPUT_BYTES) {
		throw new TypeError('The ELF loader list must be bounded text.');
	}
	const rows = [];
	for (const raw of value.split(/\r?\n/u)) {
		const line = raw.trim();
		if (line === '') continue;
		const missing = /^([^\s]+)\s+=>\s+not found$/u.exec(line);
		if (missing) throw new Error(`The ELF system dependency ${missing[1]} is unavailable.`);
		const linked = /^([^\s]+)\s+=>\s+(\/[^\s]+)\s+\(0x[a-f\d]+\)$/iu.exec(line);
		const direct = /^(\/[^\s]+)\s+\(0x[a-f\d]+\)$/iu.exec(line);
		if (!linked && !direct) {
			if (new RegExp(`^${VIRTUAL_LIBRARY.replaceAll('.', '\\.')} \\(0x[a-f\\d]+\\)$`, 'iu')
				.test(line)) continue;
			throw new Error(`The ELF loader returned an unsupported row: ${line}`);
		}
		const directPath = direct?.[1];
		const linkedName = linked?.[1];
		const absoluteLoaderName = linkedName !== undefined && isAbsolute(linkedName);
		if (absoluteLoaderName && linkedName !== soundscaperProfessionalLinuxInterpreter(target)) {
			throw new Error(`The ELF loader returned an unreviewed interpreter row ${linkedName}.`);
		}
		const name = absoluteLoaderName ? basename(linkedName) : linkedName ?? basename(directPath ?? '');
		const path = linked?.[2] ?? directPath;
		if (!isSoundscaperProfessionalLinuxRuntimeLibrary(name, target) || path === undefined
			|| !isAbsolute(path)
			|| resolve(path) !== path || path.includes('\0')) {
			throw new Error(`The ELF loader admitted an unreviewed system dependency ${String(name)}.`);
		}
		rows.push(Object.freeze({ name, path }));
	}
	if (rows.length < 1 || rows.length > MAXIMUM_RUNTIME_FILES
		|| new Set(rows.map(({ name }) => name)).size !== rows.length) {
		throw new Error('The ELF loader returned an empty, duplicate, or unbounded closure.');
	}
	return Object.freeze(rows.sort((left, right) => left.name.localeCompare(right.name, 'en')));
}

async function authenticatedPeerBytes(value: ArtifactDescriptor): Promise<Buffer> {
	if (value.byteLength > MAXIMUM_ARTIFACT_BYTES) {
		throw new Error('The professional peer exceeds the ELF authentication bound.');
	}
	const handle = await open(value.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size !== value.byteLength
			|| metadata.size > MAXIMUM_ARTIFACT_BYTES) {
			throw new Error('The professional peer changed before ELF runtime resolution.');
		}
		const bytes = await handle.readFile();
		if (!metadata.isFile() || Number(metadata.dev) !== value.identity.dev
			|| Number(metadata.ino) !== value.identity.ino || bytes.byteLength !== value.byteLength
			|| sha256(bytes) !== value.sha256) {
			throw new Error('The professional peer changed before ELF runtime resolution.');
		}
		return bytes;
	} finally { await handle.close(); }
}

async function authenticatedSystemArtifact(value: string, label: string): Promise<ArtifactDescriptor> {
	const path = await realpath(value);
	if (!isAbsolute(path) || resolve(path) !== path || path.includes('\0')) {
		throw new Error(`The ${label} path is not canonical.`);
	}
	await rootOwnedPath(path, label);
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.uid !== 0 || (before.mode & 0o022) !== 0
			|| before.size < 1 || before.size > MAXIMUM_ARTIFACT_BYTES) {
			throw new Error(`The ${label} is not one bounded root-owned system file.`);
		}
		const bytes = await handle.readFile();
		const after = await handle.stat();
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
			throw new Error(`The ${label} is not one stable root-owned system file.`);
		}
		return Object.freeze({
			path,
			byteLength: bytes.byteLength,
			sha256: sha256(bytes),
			identity: Object.freeze({ dev: Number(before.dev), ino: Number(before.ino) }),
		});
	} finally { await handle.close(); }
}

async function rootOwnedPath(path: string, label: string): Promise<void> {
	const root = parse(path).root;
	for (let current = dirname(path); ; current = dirname(current)) {
		const metadata = await lstat(current);
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0
			|| (metadata.mode & 0o022) !== 0) {
			throw new Error(`The ${label} has a writable or non-root-owned parent directory.`);
		}
		if (current === root) return;
	}
}

function loaderRows(value: string, target: SoundscaperProfessionalLinuxTarget) {
	return parseSoundscaperProfessionalLinuxLoaderList(value, target);
}

function elfInterpreter(bytes: Buffer, target: SoundscaperProfessionalLinuxTarget): string {
	if (!Buffer.isBuffer(bytes) || bytes.byteLength < 64 || bytes.subarray(0, 4).toString('hex') !== '7f454c46'
		|| bytes[4] !== 2 || bytes[5] !== 1
		|| bytes.readUInt16LE(18) !== (target === 'linux-x64' ? 62 : 183)) {
		throw new Error('The professional peer is not one target-native ELF64 image.');
	}
	const tableOffset = safeInteger(bytes.readBigUInt64LE(32), 'ELF program-header offset');
	const entryBytes = bytes.readUInt16LE(54);
	const entryCount = bytes.readUInt16LE(56);
	if (entryBytes < 56 || entryCount < 1 || entryCount > 1024
		|| tableOffset > bytes.byteLength - entryBytes * entryCount) {
		throw new Error('The professional ELF program-header table is malformed.');
	}
	const interpreters = [];
	for (let index = 0; index < entryCount; index += 1) {
		const offset = tableOffset + index * entryBytes;
		if (bytes.readUInt32LE(offset) !== 3) continue;
		const pathOffset = safeInteger(bytes.readBigUInt64LE(offset + 8), 'ELF interpreter offset');
		const pathBytes = safeInteger(bytes.readBigUInt64LE(offset + 32), 'ELF interpreter length');
		if (pathBytes < 2 || pathBytes > 4096 || pathOffset > bytes.byteLength - pathBytes) {
			throw new Error('The professional ELF interpreter record is malformed.');
		}
		const value = bytes.subarray(pathOffset, pathOffset + pathBytes);
		if (value.at(-1) !== 0 || value.subarray(0, -1).includes(0)) {
			throw new Error('The professional ELF interpreter path is malformed.');
		}
		interpreters.push(value.subarray(0, -1).toString('utf8'));
	}
	const interpreter = interpreters[0];
	if (interpreters.length !== 1 || interpreter === undefined || !isAbsolute(interpreter)) {
		throw new Error('The professional peer has no exact absolute ELF interpreter.');
	}
	return interpreter;
}

function commandText(
	run: NonNullable<ResolverDependencies['run']>,
	command: string,
	args: string[],
	label: string,
): string {
	const result = run(command, args, {
		encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES, timeout: 10_000,
		env: { LANG: 'C', LC_ALL: 'C', PATH: '', HOME: '/nonexistent' },
	});
	if (!result || result.error !== undefined || result.signal !== null || result.status !== 0
		|| typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
		|| Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)
			> MAXIMUM_COMMAND_OUTPUT_BYTES) {
		throw new Error(`The ${label} failed.`);
	}
	return result.stdout;
}

function artifact(value: unknown, label: string): ArtifactDescriptor {
	const record = value as Partial<ArtifactDescriptor> | null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| typeof record?.path !== 'string' || !isAbsolute(record.path) || resolve(record.path) !== record.path
		|| !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 1
		|| !SHA256.test(String(record.sha256)) || !record.identity
		|| !Number.isSafeInteger(record.identity.dev) || !Number.isSafeInteger(record.identity.ino)) {
		throw new TypeError(`The ${label} descriptor is invalid.`);
	}
	return record as ArtifactDescriptor;
}

function artifactArray(value: unknown): readonly ArtifactDescriptor[] {
	if (value === undefined) return Object.freeze([]);
	if (!Array.isArray(value) || value.length > MAXIMUM_RUNTIME_FILES) {
		throw new TypeError('The packaged ELF runtime closure is invalid.');
	}
	const output = value.map((entry) => artifact(entry, 'packaged ELF runtime'));
	if (new Set(output.map(({ path }) => path)).size !== output.length) {
		throw new TypeError('The packaged ELF runtime closure repeats a path.');
	}
	return Object.freeze(output);
}

function linuxTarget(value: unknown): SoundscaperProfessionalLinuxTarget {
	if (value !== 'linux-x64' && value !== 'linux-arm64') {
		throw new TypeError('System ELF runtime resolution supports only Linux professional targets.');
	}
	return value;
}

function safeInteger(value: bigint, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new Error(`The ${label} is unbounded.`);
	return number;
}

function sameArtifact(left: ArtifactDescriptor, right: ArtifactDescriptor): boolean {
	return left.path === right.path && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256 && left.identity.dev === right.identity.dev
		&& left.identity.ino === right.identity.ino;
}

function systemArtifact(value: ArtifactDescriptor, requestedPath: string, label: string): ArtifactDescriptor {
	const admitted = artifact(value, label);
	if (!isAbsolute(requestedPath) || resolve(requestedPath) !== requestedPath
		|| !isAbsolute(admitted.path) || resolve(admitted.path) !== admitted.path) {
		throw new Error(`The ${label} descriptor is not canonical.`);
	}
	return admitted;
}

function rowBindings(
	rows: readonly Readonly<{ name: string; path: string }>[],
	artifacts: ReadonlyMap<string, ArtifactDescriptor>,
) {
	return rows.map(({ name, path }) => {
		const value = artifacts.get(path);
		if (!value) throw new Error(`The ELF runtime ${path} was not authenticated.`);
		return { name, byteLength: value.byteLength, sha256: value.sha256,
			dev: value.identity.dev, ino: value.identity.ino };
	});
}

function uniqueArtifacts(values: readonly ArtifactDescriptor[]): ArtifactDescriptor[] {
	const output = new Map<string, ArtifactDescriptor>();
	for (const value of values) {
		const key = `${String(value.identity.dev)}:${String(value.identity.ino)}`;
		const previous = output.get(key);
		if (previous !== undefined && !sameArtifact(previous, value)) {
			throw new Error('Two ELF runtime paths resolve to conflicting file identities.');
		}
		if (previous === undefined) output.set(key, value);
	}
	return [...output.values()];
}

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return Object.freeze(value);
}
