/* SPDX-License-Identifier: AGPL-3.0-only */

/** Receive and hold exact SCTI streams inside one OpenFX helper reservation. */

import { join } from 'node:path';

import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import { receiveHelperDataPlaneFile } from './helper-data-plane-io.ts';
import type { HelperOfxVideoTimingAssetGrant } from './helper-native-ofx-video-timing-grant.ts';
import type { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';

export interface StagedOpenFxVideoTimingAssetV1 {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export async function stageOpenFxVideoTimingAssetsV1(input: Readonly<{
	readonly grants: readonly HelperOfxVideoTimingAssetGrant[];
	readonly ports: readonly HelperDataPlaneIoPort[];
	readonly firstPortIndex: number;
	readonly reservation: string;
	readonly filesystem: NativeMediaHelperFilesystem;
	readonly signal: AbortSignal;
}>): Promise<readonly StagedOpenFxVideoTimingAssetV1[]> {
	const result: StagedOpenFxVideoTimingAssetV1[] = [];
	for (const [index, grant] of input.grants.entries()) {
		input.signal.throwIfAborted();
		const path = join(input.reservation, `timing-${String(index).padStart(4, '0')}.scti`);
		await receiveHelperDataPlaneFile({
			binding: grant.binding,
			port: input.ports[input.firstPortIndex + index]!,
			path,
			signal: input.signal,
		});
		await input.filesystem.authenticateFile({
			path, byteLength: grant.binding.byteLength, sha256: grant.binding.sha256,
		});
		result.push(Object.freeze({
			path, byteLength: grant.binding.byteLength, sha256: grant.binding.sha256,
		}));
	}
	return Object.freeze(result);
}
