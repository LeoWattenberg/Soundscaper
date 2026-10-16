/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional acceleration capabilities authenticated with each runtime target. */
export type AssistanceRuntimeExecutionProvider = 'cpu' | 'metal' | 'vulkan' | 'coreml' | 'webgpu';

export function validateAssistanceExecutionProviders(
	value: unknown,
	familyId: string,
	targetId: string,
): readonly AssistanceRuntimeExecutionProvider[] {
	const allowed = allowedProviders(familyId, targetId);
	if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length
		|| !value.includes('cpu') || new Set(value).size !== value.length
		|| value.some((provider: unknown) => typeof provider !== 'string' || !allowed.includes(provider))) {
		throw new TypeError('Runtime execution providers must be reviewed for this family and target and retain CPU fallback.');
	}
	return Object.freeze([...value]) as readonly AssistanceRuntimeExecutionProvider[];
}

function allowedProviders(familyId: string, targetId: string): readonly string[] {
	if (familyId === 'onnxruntime-node' || familyId === 'sherpa-onnx-node') {
		if (targetId === 'mac-arm64') return ['cpu', 'coreml', 'webgpu'];
		return ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64'].includes(targetId)
			? ['cpu', 'webgpu'] : ['cpu'];
	}
	if (familyId === 'whisper-cpp' || familyId === 'llama-cpp') {
		return targetId === 'mac-arm64' ? ['cpu', 'metal'] : ['cpu', 'vulkan'];
	}
	return ['cpu'];
}
