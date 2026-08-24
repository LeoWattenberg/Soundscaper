/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact file-or-tree output setup and authentication for a media-host job. */

import {
	isHelperOutputDirectoryGrant,
	type HelperOutputGrant,
} from './helper-native-output-grant.ts';
import type {
	NativeMediaHostEncodeControl,
	NativeMediaHostRenderControl,
	NativeMediaHostSequenceControl,
} from './native-media-host-result.ts';
import {
	NativeMediaHelperFilesystem,
	type NativeMediaHelperInspectedOutput,
} from './native-media-helper-filesystem.ts';

export async function prepareNativeMediaHelperOutput(
	filesystem: NativeMediaHelperFilesystem,
	output: HelperOutputGrant,
): Promise<Readonly<{
	readonly maximumOutputBytes: number;
	readonly destinationRoot: string;
	readonly temporaryOutputPath: string;
}>> {
	await filesystem.authenticateDirectory({ path: output.rootPath, identity: output.rootIdentity });
	if (isHelperOutputDirectoryGrant(output)) {
		await filesystem.expectOutputTree({
			path: output.temporaryPath, maximumBytes: output.maximumBytes,
			insideReservation: false, identity: output.treeIdentity,
		});
	} else {
		await filesystem.expectOutput({
			path: output.temporaryPath, maximumBytes: output.maximumBytes, insideReservation: false,
		});
	}
	return Object.freeze({
		maximumOutputBytes: output.maximumBytes,
		destinationRoot: output.rootPath,
		temporaryOutputPath: output.temporaryPath,
	});
}

export async function inspectNativeMediaHelperOutput(
	filesystem: NativeMediaHelperFilesystem,
	output: HelperOutputGrant,
	control: NativeMediaHostEncodeControl | NativeMediaHostRenderControl | NativeMediaHostSequenceControl,
): Promise<Readonly<NativeMediaHelperInspectedOutput>> {
	if (isHelperOutputDirectoryGrant(output)) {
		if (!isSequenceControl(control)
			|| control.profileId !== output.treeIdentity.profileId
			|| control.frameCount !== output.treeIdentity.frameCount) {
			throw new Error('The native media host sequence result changed its exact output-tree identity.');
		}
		await filesystem.sealOutputTree(control.manifestSha256);
		const inspected = await filesystem.inspectOutput();
		if (!('kind' in inspected) || inspected.kind !== 'directory') {
			throw new Error('The native media host sequence did not produce an authenticated directory.');
		}
		const nativeByteLength = inspected.byteLength - inspected.tree.manifestByteLength;
		if (nativeByteLength !== control.byteLength) {
			throw new Error('The native media host sequence byte count changed before tree sealing.');
		}
		return inspected;
	}
	if (isSequenceControl(control)) {
		throw new Error('A regular-file output cannot accept a temporary-directory host result.');
	}
	const inspected = await filesystem.inspectOutput();
	if ('kind' in inspected || control.byteLength !== inspected.byteLength
		|| control.sha256 !== inspected.sha256) {
		throw new Error('The native media host control result does not match the independently inspected output.');
	}
	return inspected;
}

function isSequenceControl(
	value: NativeMediaHostEncodeControl | NativeMediaHostRenderControl | NativeMediaHostSequenceControl,
): value is NativeMediaHostSequenceControl {
	return 'publication' in value && value.publication === 'temporary-directory';
}
