/* SPDX-License-Identifier: AGPL-3.0-only */

import nativeManifest from '../../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { stageAssistanceNativeRuntimePayload } from '../../desktop/assistance-native-runtime-payload.mjs';
import {
	prepareDesktopAssistanceSherpaArm64,
	validateDesktopAssistanceSherpaArm64BuildReceipt,
} from './desktop-assistance-sherpa-arm64.mjs';

/** Select only a source-checked ARM64 build receipt; other targets keep upstream pins. */
export function desktopAssistanceNativeManifest(stage, targetId) {
	if (stage.assistanceNativeBuild == null) return nativeManifest;
	if (targetId !== 'win-arm64') throw new Error('A Sherpa ARM64 build receipt cannot authorize another target.');
	validateDesktopAssistanceSherpaArm64BuildReceipt(stage.assistanceNativeBuild);
	return stage.assistanceNativeBuild.manifest;
}

export async function stageDesktopAssistanceSpeechRuntime({
	repositoryRoot, targetId, nodeModulesRoot, runtimeRoot, cacheRoot,
}) {
	const built = targetId === 'win-arm64'
		? await prepareDesktopAssistanceSherpaArm64({ repositoryRoot, targetId, cacheRoot }) : null;
	const manifest = built?.manifest ?? nativeManifest;
	const summary = await stageAssistanceNativeRuntimePayload({
		manifest, targetId, nodeModulesRoot: built?.nodeModulesRoot ?? nodeModulesRoot,
		outputRoot: runtimeRoot,
	});
	if (summary.status !== 'built') throw new Error(`The ${targetId} speech runtime could not be packaged.`);
	return { manifest, summary, buildReceipt: built?.summary ?? null };
}
