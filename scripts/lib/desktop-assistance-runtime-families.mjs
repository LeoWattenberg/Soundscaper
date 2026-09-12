/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import candidates from '../../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import {
	describeAssistanceRuntimeFamilyAvailability,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../../desktop/assistance-runtime-family-manifest.ts';
import { stageDesktopAssistanceOnnxRuntime } from './desktop-assistance-onnx-runtime.mjs';
import { stageDesktopWhisperCppRuntime } from './desktop-assistance-whisper-runtime.mjs';
import { stageDesktopLlamaCppRuntime } from './desktop-assistance-llama-runtime.mjs';

/**
 * Build-time inventory is sealed inside app.asar; executable bytes remain outside
 * it and are authenticated again by main and the inference helper before use.
 * The source supply register describes independently published candidates. It
 * is never rewritten to claim that a locally built package was published there.
 * @param {{
 *   targetId: string, runtimeRoot: string, cacheRoot?: string,
 *   stageOnnx?: (options: {targetId: string, outputRoot: string, cacheRoot: string | undefined}) => Promise<{manifest: unknown, summary?: unknown}>,
 *   stageWhisper?: (options: {targetId: string, runtimeRoot: string, cacheRoot: string | undefined, platform: string, architecture: string}) => Promise<{manifest: unknown, summary?: unknown, provenance?: unknown}>,
 *   stageLlama?: (options: {targetId: string, runtimeRoot: string, cacheRoot: string | undefined, platform: string, architecture: string}) => Promise<{manifest: unknown, summary?: unknown, provenance?: unknown}>
 * }} options
 */
export async function stageDesktopAssistanceRuntimeFamilies({
	targetId, runtimeRoot, cacheRoot,
	stageOnnx = stageDesktopAssistanceOnnxRuntime,
	stageWhisper = stageDesktopWhisperCppRuntime,
	stageLlama = stageDesktopLlamaCppRuntime,
}) {
	const match = /^(mac|linux|win)-(x64|arm64)$/u.exec(targetId);
	if (!match) throw new TypeError('The Local Assistance desktop target is invalid.');
	const platform = { mac: 'darwin', linux: 'linux', win: 'win32' }[match[1]];
	const architecture = match[2];
	const manifests = { ...candidates.manifests };
	const summaries = [];
	for (const [familyId, stage] of [
		['onnxruntime-node', () => stageOnnx({ targetId, outputRoot: runtimeRoot, cacheRoot })],
		['whisper-cpp', () => stageWhisper({
			targetId, runtimeRoot, cacheRoot, platform: process.platform, architecture: process.arch,
		})],
		['llama-cpp', () => stageLlama({
			targetId, runtimeRoot, cacheRoot, platform: process.platform, architecture: process.arch,
		})],
	]) {
		const result = await stage();
		const manifest = validateAssistanceRuntimeFamilyManifestV1(result.manifest);
		if (manifest.familyId !== familyId) {
			throw new Error(`Local Assistance staged the wrong engine for ${familyId}.`);
		}
		const availability = await describeAssistanceRuntimeFamilyAvailability({
			familyId, manifest, runtimeRoot, platform, architecture,
			totalMemoryBytes: Number.MAX_SAFE_INTEGER,
		});
		if (availability.status !== 'available') {
			throw new Error(`Cannot package ${familyId}: ${availability.detail}`);
		}
		manifests[familyId] = manifest;
		summaries.push({
			familyId, runtimeVersion: manifest.runtimeVersion, targetId,
			files: availability.descriptor.files.length,
			byteLength: availability.descriptor.files.reduce((sum, file) => sum + file.byteLength, 0),
			provenance: result.summary ?? result.provenance ?? null,
		});
	}
	const manifestBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, manifests }, null, 2)}\n`);
	return {
		manifestBytes,
		summary: {
			targetId,
			manifest: {
				path: 'config/assistance-runtime-family-supply-candidates.json',
				byteLength: manifestBytes.byteLength,
				sha256: createHash('sha256').update(manifestBytes).digest('hex'),
			},
			families: summaries,
		},
	};
}
