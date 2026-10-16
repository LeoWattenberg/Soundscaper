/* SPDX-License-Identifier: AGPL-3.0-only */

import nativeManifest from '../../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { stageAssistanceNativeRuntimePayload } from '../../desktop/assistance-native-runtime-payload.mjs';
import {
	validateDesktopAssistanceSherpaArm64BuildReceipt,
} from './desktop-assistance-sherpa-arm64.mjs';
import {
	prepareDesktopAssistanceSherpaGpu,
	validateDesktopAssistanceSherpaGpuBuildReceipt,
} from './desktop-assistance-sherpa-gpu-runtime.mjs';

/** Select only a checked target receipt; retain older published CPU archive receipts. */
export function desktopAssistanceNativeManifest(stage, targetId) {
	if (stage.assistanceNativeBuild == null) return nativeManifest;
	if (stage.assistanceNativeBuild.provenance?.recipeId === 'sherpa-onnx-node-gpu-locked-build-v1') {
		if (stage.assistanceNativeBuild.targetId !== targetId) throw new Error('A Sherpa GPU receipt cannot authorize another target.');
		validateDesktopAssistanceSherpaGpuBuildReceipt(stage.assistanceNativeBuild);
		return stage.assistanceNativeBuild.manifest;
	}
	if (targetId !== 'win-arm64') throw new Error('A Sherpa ARM64 build receipt cannot authorize another target.');
	validateDesktopAssistanceSherpaArm64BuildReceipt(stage.assistanceNativeBuild);
	return stage.assistanceNativeBuild.manifest;
}

export async function stageDesktopAssistanceSpeechRuntime({
	repositoryRoot, targetId, nodeModulesRoot, runtimeRoot, cacheRoot,
	buildRuntime = prepareDesktopAssistanceSherpaGpu,
}) {
	const built = await buildRuntime({ repositoryRoot, targetId, cacheRoot, nodeModulesRoot });
	const manifest = built.manifest;
	if (!manifest.targets[targetId]?.executionProviders?.some((provider) => provider !== 'cpu')) {
		throw new Error(`The ${targetId} speech runtime build did not provide a GPU option.`);
	}
	const summary = await stageAssistanceNativeRuntimePayload({
		manifest, targetId, nodeModulesRoot: built.nodeModulesRoot,
		outputRoot: runtimeRoot,
	});
	if (summary.status !== 'built') throw new Error(`The ${targetId} speech runtime could not be packaged.`);
	return { manifest, summary, buildReceipt: built.summary };
}
