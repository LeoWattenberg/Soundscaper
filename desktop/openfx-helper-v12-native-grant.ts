/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical native-host document derived only from an admitted helper grant. */

import type { HelperOfxRenderHostJobGrantV1OrV2 } from './helper-native-ofx-host-grant-v2.ts';
import type { StagedOpenFxVideoTimingAssetV1 } from './openfx-helper-video-timing-staging.ts';
import type { OfxRenderBackendV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';

export function canonicalOpenFxV12NativeGrant(input: Readonly<{
	readonly grant: HelperOfxRenderHostJobGrantV1OrV2;
	readonly pluginPath: string;
	readonly pluginIndex: number;
	readonly planPath: string;
	readonly timingAssets: readonly StagedOpenFxVideoTimingAssetV1[];
	readonly inputPaths: readonly string[];
	readonly outputPath: string;
	readonly maximumControlBytes: number;
	readonly supportedBackends: readonly OfxRenderBackendV1[];
}>): string {
	const { grant } = input;
	const document = {
		schemaVersion: 1,
		supportedBackends: input.supportedBackends,
		pluginBinary: {
			path: input.pluginPath,
			sha256: grant.pluginBinary.sha256,
			pluginIndex: input.pluginIndex,
		},
		invocation: grant.invocation,
		plan: { path: input.planPath, byteLength: grant.plan.byteLength, sha256: grant.plan.sha256 },
		...(input.timingAssets.length === 0 ? {} : {
			videoTimingAssets: input.timingAssets.map((asset) => ({ ...asset })),
		}),
		inputs: grant.inputs.map((frame, index) => ({
			name: frame.name,
			sourceRef: frame.sourceRef,
			streamId: frame.frame.streamId,
			path: input.inputPaths[index]!,
			pixelFormat: frame.pixelFormat,
			width: frame.width,
			height: frame.height,
			rowBytes: frame.rowBytes,
			byteLength: frame.frame.byteLength,
			sha256: frame.frame.sha256,
		})),
		output: {
			streamId: grant.output.frame.streamId,
			path: input.outputPath,
			pixelFormat: grant.output.pixelFormat,
			width: grant.output.width,
			height: grant.output.height,
			rowBytes: grant.output.rowBytes,
			byteLength: grant.output.frame.exactByteLength,
		},
	};
	const canonical = canonicalizeNativeMediaPlan(document);
	if (Buffer.byteLength(canonical) > input.maximumControlBytes) {
		throw new Error('The canonical OpenFX V12 native grant exceeds 64 KiB.');
	}
	return canonical;
}
