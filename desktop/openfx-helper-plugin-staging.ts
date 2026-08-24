/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reopen exact immutable OpenFX custody or stage one legacy fixture file. */

import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { HelperExecutableGrant } from './helper-contract.ts';
import type { HelperOpenFxPluginCustody } from './helper-native-ofx-plugin-custody.ts';
import type { NativeChildIsolationPathGrant } from './native-child-isolation-launcher.ts';
import type { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';
import { authenticateFramescaperOpenFxPluginBinary } from './openfx-main-plugin-binary.ts';
import { isExecutableMappableOpenFxFile } from './openfx-plugin-native-image.ts';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';

export interface StagedOpenFxPlugin {
	readonly path: string;
	readonly resources: readonly NativeChildIsolationPathGrant[];
	readonly runtimeClosure: readonly NativeChildIsolationPathGrant[];
	revalidate(): Promise<void>;
}

export async function stageOpenFxPluginBinary(
	filesystem: NativeMediaHelperFilesystem,
	reservation: string,
	grant: HelperExecutableGrant,
	signal: AbortSignal,
): Promise<StagedOpenFxPlugin> {
	signal.throwIfAborted();
	if (grant.custody) return openCustody(filesystem, grant, signal);
	const path = join(reservation, 'plugin-binary.ofx');
	await copyFile(grant.path, path, constants.COPYFILE_EXCL);
	await filesystem.authenticateFile({ path, byteLength: grant.bytes, sha256: grant.sha256 });
	await filesystem.revalidate();
	signal.throwIfAborted();
	return Object.freeze({
		path, resources: Object.freeze([]), runtimeClosure: Object.freeze([]),
		revalidate: () => filesystem.revalidate(),
	});
}

async function openCustody(
	filesystem: NativeMediaHelperFilesystem,
	grant: HelperExecutableGrant,
	signal: AbortSignal,
): Promise<StagedOpenFxPlugin> {
	const custody = grant.custody!;
	await reauthenticateCustody(grant, custody);
	await filesystem.authenticateFile({
		path: grant.path, byteLength: grant.bytes, sha256: grant.sha256, identity: grant.identity,
	});
	for (const file of custody.runtimeClosure) await filesystem.authenticateFile({
		path: file.path, byteLength: file.bytes, sha256: file.sha256, identity: file.identity,
	});
	for (const file of custody.resources) await filesystem.authenticateFile({
		path: file.path, byteLength: file.bytes, sha256: file.sha256, identity: file.identity,
	});
	if (custody.kind === 'bundle') await filesystem.authenticateDirectory({
		path: custody.rootPath, identity: custody.rootIdentity,
	});
	await filesystem.revalidate();
	signal.throwIfAborted();
	return Object.freeze({
		path: grant.path,
		resources: Object.freeze(custody.resources.map((file) => (
			pathGrant(file.path, 'file', file.identity)
		))),
		runtimeClosure: Object.freeze(custody.runtimeClosure.map((file) => (
			pathGrant(file.path, 'file', file.identity)
		))),
		revalidate: async () => {
			await reauthenticateCustody(grant, custody);
			await filesystem.revalidate();
		},
	});
}

async function reauthenticateCustody(
	grant: HelperExecutableGrant,
	custody: HelperOpenFxPluginCustody,
): Promise<void> {
	const candidate = await authenticatePluginCandidate(custody.rootPath);
	if (candidate.kind !== custody.kind || candidate.byteLength !== custody.byteLength
		|| candidate.sha256 !== custody.sha256 || candidate.fileCount !== custody.fileCount
		|| candidate.identity.dev !== custody.rootIdentity.dev
		|| candidate.identity.ino !== custody.rootIdentity.ino) {
		throw new Error('The helper-reopened OpenFX bundle differs from its immutable custody grant.');
	}
	const executable = await authenticateFramescaperOpenFxPluginBinary(grant.path);
	if (!sameFile(executable, grant)) {
		throw new Error('The helper-reopened OpenFX executable differs from immutable custody.');
	}
	for (const expected of custody.runtimeClosure) {
		if (!await isExecutableMappableOpenFxFile(expected.path)) {
			throw new Error('An OpenFX native closure member is not executable-mappable code.');
		}
		const actual = await authenticateFramescaperOpenFxPluginBinary(expected.path);
		if (!sameFile(actual, expected)) {
			throw new Error('An OpenFX bundle native dependency differs from immutable custody.');
		}
	}
	for (const expected of custody.resources) {
		if (await isExecutableMappableOpenFxFile(expected.path)) {
			throw new Error('Executable-mappable OpenFX bytes cannot masquerade as a resource.');
		}
		const actual = await authenticateFramescaperOpenFxPluginBinary(expected.path);
		if (!sameFile(actual, expected)) {
			throw new Error('An OpenFX bundle resource differs from immutable custody.');
		}
	}
}

function pathGrant(
	path: string,
	kind: NativeChildIsolationPathGrant['kind'],
	identity: Readonly<{ dev: number; ino: number }>,
): NativeChildIsolationPathGrant {
	return Object.freeze({ path, kind, identity: Object.freeze({ ...identity }) });
}

function sameFile(
	left: Readonly<{ path: string; bytes: number; sha256: string; identity: Readonly<{ dev: number; ino: number }> }>,
	right: Readonly<{ path: string; bytes: number; sha256: string; identity: Readonly<{ dev: number; ino: number }> }>,
): boolean {
	return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256
		&& left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino;
}
