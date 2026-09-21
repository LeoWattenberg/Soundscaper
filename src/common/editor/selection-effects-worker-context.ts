/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SelectionEffectWorkerRuntimeContext {
	afterChannels?: Float32Array[];
	beforeChannels?: Float32Array[];
	controlChannels?: Float32Array[];
	effectId?: string;
	noiseProfile?: unknown;
	onProgress?: (progress: number) => void;
	spectralSelection?: unknown;
	wasmModule?: WebAssembly.Module;
}

export function normalizeSelectionEffectWorkerContext(
	value: unknown,
): SelectionEffectWorkerRuntimeContext {
	if (!isRecord(value)) return {};
	const context: SelectionEffectWorkerRuntimeContext = {};
	for (const key of ['afterChannels', 'beforeChannels', 'controlChannels'] as const) {
		const channels = value[key];
		if (Array.isArray(channels)) context[key] = channels.map(asFloat32Array);
	}
	if (typeof value.effectId === 'string') context.effectId = value.effectId;
	if (Object.hasOwn(value, 'noiseProfile')) context.noiseProfile = value.noiseProfile;
	if (Object.hasOwn(value, 'spectralSelection')) {
		context.spectralSelection = value.spectralSelection;
	}
	return context;
}

export function asFloat32Array(value: unknown): Float32Array {
	if (value instanceof Float32Array) return value;
	if (typeof value === 'number') return new Float32Array(value);
	if (value == null) return new Float32Array(0);
	return new Float32Array(value as ArrayLike<number>);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return value !== null && typeof value === 'object';
}
