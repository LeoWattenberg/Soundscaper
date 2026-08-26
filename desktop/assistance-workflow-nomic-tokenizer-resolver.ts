/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only reconstruction of the authenticated tokenizer used before nomic embedding. */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
	createAssistanceNomicTokenizerV1,
	type AssistanceNomicTokenizerArtifactsV1,
	type AssistanceNomicTokenizerV1,
} from '../src/common/editor/assistance/nomic-tokenizer-v1.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowModelBindingV1,
} from '../src/common/editor/assistance/workflow.ts';
import type { InstalledLocalModel, LocalModelArtifact } from './local-model-store.ts';
import type { AssistanceService } from './assistance-service.ts';
import type {
	AssistanceWorkflowOwnedAudioCutTokenizerRequestV1,
} from './assistance-workflow-owned-audio-cut-stage-runtime.ts';

const MODEL_ID = 'nomic-embed-text-v1.5';
const MODEL_VERSION = '1.5.0';
const MODEL_STAGE_ID = 'embed-transcript';
const MODEL_SLOT_ID = 'text-embedder';
const MAXIMUM_TOKENIZER_BYTES = 16 * 1024 * 1024;
const MAXIMUM_CONFIG_BYTES = 1024 * 1024;
const MAXIMUM_GRAPH_BYTES = 8 * 1024 ** 3;
const READ_CHUNK_BYTES = 64 * 1024;
const SHA256 = /^[a-f\d]{64}$/u;

const ARTIFACT_SPECS = Object.freeze([
	Object.freeze({ fileName: 'model_quantized.onnx', role: 'model_quantized',
		maximumBytes: MAXIMUM_GRAPH_BYTES, tokenizerKey: null }),
	Object.freeze({ fileName: 'tokenizer.json', role: 'tokenizer',
		maximumBytes: MAXIMUM_TOKENIZER_BYTES, tokenizerKey: 'tokenizer' }),
	Object.freeze({ fileName: 'tokenizer_config.json', role: 'tokenizer_config',
		maximumBytes: MAXIMUM_CONFIG_BYTES, tokenizerKey: 'tokenizerConfig' }),
	Object.freeze({ fileName: 'special_tokens_map.json', role: 'special_tokens_map',
		maximumBytes: MAXIMUM_CONFIG_BYTES, tokenizerKey: 'specialTokensMap' }),
	Object.freeze({ fileName: 'config.json', role: 'config',
		maximumBytes: MAXIMUM_CONFIG_BYTES, tokenizerKey: 'config' }),
] as const);

type ModelService = Pick<AssistanceService, 'listInstalled' | 'resolveModelPaths'>;
type TokenizerKey = keyof AssistanceNomicTokenizerArtifactsV1;

export interface AssistanceWorkflowNomicTokenizerResolverOptionsV1 {
	readonly models: ModelService;
}

export type AssistanceWorkflowNomicTokenizerResolverV1 = (
	request: AssistanceWorkflowOwnedAudioCutTokenizerRequestV1,
) => Promise<AssistanceNomicTokenizerV1 | null>;

/**
 * Creates the `resolveTokenizer` hook for the owned `chunk-transcript` stage.
 * Invalid workflow authority is rejected. Authenticated model evidence that is
 * missing, stale, externally deleted, oversized, digest-drifted, or no longer
 * accepted by the pinned tokenizer parser resolves to `null`, which the stage
 * runtime exposes as its existing typed `stage-unavailable` outcome.
 */
export function createAssistanceWorkflowNomicTokenizerResolverV1(
	optionsValue: AssistanceWorkflowNomicTokenizerResolverOptionsV1,
): AssistanceWorkflowNomicTokenizerResolverV1 {
	const models = modelService(optionsValue);
	return async (requestValue) => {
		const { binding, signal } = exactRequest(requestValue);
		signal.throwIfAborted();
		let installed: readonly InstalledLocalModel[];
		try { installed = await models.listInstalled(); }
		catch (error) { return unavailableOrThrow(error, signal); }
		signal.throwIfAborted();
		const installation = exactInstallation(installed, binding);
		if (installation === null) return null;
		let paths: Readonly<Record<string, string>>;
		try { paths = await models.resolveModelPaths(MODEL_ID); }
		catch (error) { return unavailableOrThrow(error, signal); }
		signal.throwIfAborted();
		if (!exactResolvedPaths(paths)) return null;
		const tokenizerArtifacts: Partial<Record<TokenizerKey, Uint8Array>> = {};
		try {
			for (const spec of ARTIFACT_SPECS) {
				if (spec.tokenizerKey === null) continue;
				const artifact = installation.artifacts.find(
					({ fileName }) => fileName === spec.fileName,
				)!;
				const bytes = await readAuthenticatedArtifact(
					paths[spec.role]!, artifact, spec.maximumBytes, signal,
				);
				if (bytes === null) return null;
				tokenizerArtifacts[spec.tokenizerKey] = bytes;
			}
			signal.throwIfAborted();
			const tokenizer = createAssistanceNomicTokenizerV1(
				tokenizerArtifacts as unknown as AssistanceNomicTokenizerArtifactsV1,
			);
			signal.throwIfAborted();
			return tokenizer;
		} catch (error) {
			return unavailableOrThrow(error, signal);
		}
	};
}

function exactRequest(value: AssistanceWorkflowOwnedAudioCutTokenizerRequestV1): Readonly<{
	binding: AssistanceWorkflowModelBindingV1;
	signal: AbortSignal;
}> {
	if (!isRecord(value) || !exactKeys(value, ['request', 'model', 'signal'])
		|| !isAbortSignal(value.signal)) {
		throw new TypeError('The nomic tokenizer resolver request is invalid.');
	}
	const request = validateAssistanceWorkflow(value.request);
	if (request.workflowId !== 'index-transcript'
		|| !request.stageIds.includes('chunk-transcript')
		|| !request.stageIds.includes(MODEL_STAGE_ID)) {
		throw new TypeError('The nomic tokenizer requires exact transcript-index workflow authority.');
	}
	const bindings = request.models.filter(({ stageId, slotId }) =>
		stageId === MODEL_STAGE_ID && slotId === MODEL_SLOT_ID);
	if (bindings.length !== 1) {
		throw new TypeError('The nomic tokenizer requires one exact embedding-model binding.');
	}
	const binding = bindings[0]!;
	if (binding.modelId !== MODEL_ID || binding.version !== MODEL_VERSION) {
		throw new TypeError('The nomic tokenizer requires the exact nomic-embed-text-v1.5 identity.');
	}
	if (!exactCallbackBinding(value.model, binding)) {
		throw new TypeError('The nomic tokenizer callback model lost its exact workflow binding authority.');
	}
	return Object.freeze({ binding, signal: value.signal });
}

function exactInstallation(
	installedValue: readonly InstalledLocalModel[],
	binding: AssistanceWorkflowModelBindingV1,
): InstalledLocalModel | null {
	if (!Array.isArray(installedValue)) return null;
	const matches = installedValue.filter((candidate) => isRecord(candidate)
		&& candidate.modelId === MODEL_ID && candidate.version === MODEL_VERSION);
	if (matches.length !== 1) return null;
	const installed = matches[0]! as unknown as InstalledLocalModel;
	if (!Array.isArray(installed.artifacts) || installed.artifacts.length !== ARTIFACT_SPECS.length) {
		return null;
	}
	for (const spec of ARTIFACT_SPECS) {
		const candidates = installed.artifacts.filter(({ fileName }) => fileName === spec.fileName);
		if (candidates.length !== 1 || !validArtifact(candidates[0], spec.maximumBytes)) return null;
	}
	if (installed.artifacts.some(({ fileName }) =>
		!ARTIFACT_SPECS.some((spec) => spec.fileName === fileName))) return null;
	const installedDigests = installed.artifacts.map(({ sha256 }) => sha256).sort();
	if (!sameStrings(installedDigests, binding.artifactSha256s)) return null;
	if (!Number.isSafeInteger(installed.totalBytes) || installed.totalBytes < 1
		|| installed.totalBytes !== installed.artifacts.reduce(
			(total, artifact) => total + artifact.byteLength, 0,
		)) return null;
	return installed;
}

function exactResolvedPaths(value: unknown): value is Readonly<Record<string, string>> {
	if (!isRecord(value)) return false;
	const roles = ARTIFACT_SPECS.map(({ role }) => role).sort();
	if (!sameStrings(Object.keys(value).sort(), roles)) return false;
	return roles.every((role) => {
		const path = value[role];
		return typeof path === 'string' && path.length <= 4_096 && !path.includes('\0')
			&& isAbsolute(path);
	});
}

async function readAuthenticatedArtifact(
	path: string,
	artifact: LocalModelArtifact,
	maximumBytes: number,
	signal: AbortSignal,
): Promise<Uint8Array | null> {
	if (!validArtifact(artifact, maximumBytes)) return null;
	signal.throwIfAborted();
	const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	try {
		signal.throwIfAborted();
		const initial = await handle.stat();
		if (!initial.isFile() || initial.size !== artifact.byteLength) return null;
		const bytes = new Uint8Array(artifact.byteLength);
		let offset = 0;
		while (offset < bytes.byteLength) {
			signal.throwIfAborted();
			const length = Math.min(READ_CHUNK_BYTES, bytes.byteLength - offset);
			const { bytesRead } = await handle.read(bytes, offset, length, offset);
			if (bytesRead < 1 || bytesRead > length) return null;
			offset += bytesRead;
		}
		const overflow = new Uint8Array(1);
		if ((await handle.read(overflow, 0, 1, artifact.byteLength)).bytesRead !== 0) return null;
		const final = await handle.stat();
		if (!final.isFile() || final.size !== initial.size) return null;
		signal.throwIfAborted();
		return digest(bytes) === artifact.sha256 ? bytes : null;
	} finally {
		await handle.close().catch(() => undefined);
	}
}

function validArtifact(value: unknown, maximumBytes: number): value is LocalModelArtifact {
	return isRecord(value) && exactKeys(value, ['fileName', 'byteLength', 'sha256'])
		&& typeof value.fileName === 'string'
		&& Number.isSafeInteger(value.byteLength) && Number(value.byteLength) >= 1
		&& Number(value.byteLength) <= maximumBytes
		&& typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

function exactCallbackBinding(
	value: unknown,
	expected: AssistanceWorkflowModelBindingV1,
): boolean {
	if (!isRecord(value) || !exactKeys(value, [
		'bindingVersion', 'stageId', 'slotId', 'modelId', 'version', 'artifactSha256s',
	]) || !Array.isArray(value.artifactSha256s)) return false;
	return value.bindingVersion === expected.bindingVersion && value.stageId === expected.stageId
		&& value.slotId === expected.slotId && value.modelId === expected.modelId
		&& value.version === expected.version
		&& sameStrings(value.artifactSha256s, expected.artifactSha256s);
}

function modelService(value: AssistanceWorkflowNomicTokenizerResolverOptionsV1): ModelService {
	if (!isRecord(value) || !exactKeys(value, ['models']) || !isRecord(value.models)
		|| typeof value.models.listInstalled !== 'function'
		|| typeof value.models.resolveModelPaths !== 'function') {
		throw new TypeError('The nomic tokenizer resolver model service is invalid.');
	}
	return value.models as unknown as ModelService;
}

function isAbortSignal(value: unknown): value is AbortSignal {
	return isRecord(value) && typeof value.aborted === 'boolean'
		&& typeof value.throwIfAborted === 'function';
}

function unavailableOrThrow(error: unknown, signal: AbortSignal): null {
	signal.throwIfAborted();
	if (!(error instanceof Error)) throw error;
	return null;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function sameStrings(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
	return sameStrings(Object.keys(value).sort(), [...keys].sort());
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
