/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact staged/packaged closure verification for the codec-only OS addon. */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME,
	OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	OS_AUDIO_CODEC_NATIVE_TARGETS,
	parseCanonicalOsAudioCodecNativeManifest,
} from '../../desktop/os-audio-codec-native-payload.mjs';
import {
	osAudioCodecNativePayloadOutputRoot,
	osAudioCodecNativePayloadStageSummary,
	verifyOsAudioCodecNativeBuildResult,
	verifyStagedOsAudioCodecNativePayload,
} from './os-audio-codec-native-payload.mjs';

export async function verifyDesktopOsAudioCodecNativePackageTree({
	runtimeRoot, productId, target, summary, placement,
}) {
	const prefix = resolve(runtimeRoot, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX);
	const supported = productId === 'soundscaper' && OS_AUDIO_CODEC_NATIVE_TARGETS.includes(target);
	if (summary === null) {
		const entries = await readdir(prefix).catch((error) => {
			if (error?.code === 'ENOENT') return null;
			throw error;
		});
		if (entries !== null) throw new Error(`${placement} OS audio codec native subtree must be absent.`);
		return null;
	}
	if (!supported) {
		throw new Error(`${placement} ${productId} ${target} has invalid OS audio codec native evidence.`);
	}
	const targets = await readdir(prefix, { withFileTypes: true }).catch(() => []);
	if (targets.length !== 1 || targets[0].name !== target
		|| !targets[0].isDirectory() || targets[0].isSymbolicLink()) {
		throw new Error(`${placement} OS audio codec native runtime has an unexpected target subtree.`);
	}
	const outputRoot = resolve(prefix, target);
	const manifestBytes = await readFile(resolve(outputRoot, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME));
	const manifest = parseCanonicalOsAudioCodecNativeManifest(manifestBytes, target);
	const release = await verifyOsAudioCodecNativeBuildResult({
		build: buildResultFromManifest(manifest, resolve(outputRoot, OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME)),
		target,
		sourceRevision: manifest.sourceRevision,
		buildPlanSha256: manifest.buildPlan.sha256,
	});
	const verified = await verifyStagedOsAudioCodecNativePayload({
		release,
		outputRoot: osAudioCodecNativePayloadOutputRoot(runtimeRoot, release),
	});
	if (JSON.stringify(summary) !== JSON.stringify(osAudioCodecNativePayloadStageSummary(release))) {
		throw new Error(`${placement} stage manifest has invalid OS audio codec native evidence.`);
	}
	return verified;
}

function buildResultFromManifest(manifest, artifactPath) {
	return {
		schemaVersion: 1, status: 'built', target: manifest.target,
		artifact: { ...manifest.payload, path: artifactPath },
		electronHeaders: manifest.electronHeaders,
		sourceIdentity: manifest.sourceIdentity,
		sourceRevision: manifest.sourceRevision,
		buildPlan: manifest.buildPlan,
		buildPlanSha256: manifest.buildPlan.sha256,
		toolchainIdentity: manifest.toolchainIdentity,
		nativeCanary: manifest.nativeCanary,
		signing: manifest.signing,
	};
}
