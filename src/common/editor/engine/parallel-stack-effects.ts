/* SPDX-License-Identifier: AGPL-3.0-only */
import { createBitcrusherProcessor } from '../first-party-effects/bitcrusher/dsp.js';
import { createDeesserProcessor } from '../first-party-effects/deesser/dsp.ts';
import { createMultibandCompressorProcessor } from '../first-party-effects/multiband-compressor/dsp.ts';
import { isStandardEffect } from '../first-party-effects/standard/definition.ts';
import { createStandardEffectProcessor } from '../first-party-effects/standard/dsp.ts';
import { standardDelayCapacityFrames, normalizeStandardDelayParams } from '../first-party-effects/standard/delay-definition.ts';
import { noiseGateLatencyFrames } from '../first-party-effects/standard/noise-gate-definition.ts';
import { ParametricEqWasmRuntime, designParametricEqWasmConfiguration, PARAMETRIC_EQ_WASM_MEMORY_BYTES } from '../parametric-eq/wasm-runtime.js';
import { createParallelDynamics } from './parallel-stack-effects-dynamics.ts';
import type { EngineEffect } from './types.ts';
import type { ParallelStackEffect, ParallelStackRuntimeModules } from './parallel-stack-types.ts';

export interface ParallelStackEffectProcessor {
	reset(): void;
	processBlock(input: readonly Float32Array[], output: readonly Float32Array[], frames: number,
		sidechain?: readonly Float32Array[]): void;
}

export function compileParallelStackEffect(effect: EngineEffect, sampleRate: number, channels: number): ParallelStackEffect {
	const type = String(effect.type ?? effect.kind ?? '').toLowerCase();
	if (['eq', 'parametric-eq', 'parametric_eq'].includes(type)) {
		const configuration = designParametricEqWasmConfiguration(effect.params ?? {}, sampleRate, { effectId: effect.id });
		return { id: String(effect.id ?? ''), type: 'parametric-eq', params: configuration.packet, latencyFrames: 0,
			stateBytes: PARAMETRIC_EQ_WASM_MEMORY_BYTES + 65536 + channels * 4096 };
	}
	const params = structuredClone(effect.params ?? {});
	if (Object.keys(params).length > 128 || Object.values(params).some((value) => !(typeof value === 'number' && Number.isFinite(value))
		&& !(typeof value === 'string' && value.length <= 128) && typeof value !== 'boolean')) {
		throw new Error('Parallel effect parameters exceed their bounded scalar schema.');
	}
	let latencyFrames = 0;
	// Includes JS object overhead, bounded coefficient banks and all scratch state.
	let stateBytes = 65536 + channels * 4096;
	if (type === 'multi-tap-delay') {
		const normalized = normalizeStandardDelayParams(params);
		if (Number(normalized.pitchShift) !== 0) throw new Error('Parallel stacks do not admit pitched multi-tap-delay.');
		stateBytes += 4 * channels * standardDelayCapacityFrames(params, sampleRate, channels);
	} else if (type === 'noise-gate') {
		latencyFrames = noiseGateLatencyFrames(params, sampleRate);
		stateBytes += latencyFrames * channels * 4;
	} else if (type === 'limiter' || type === 'gate') {
		for (const [key, value] of Object.entries(params)) {
			if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid parallel ${type} parameter ${key}.`);
		}
		latencyFrames = type === 'limiter' ? Math.max(0, Math.ceil(Number(params.lookahead ?? 0) * sampleRate)) : 0;
		if (latencyFrames > 60 * sampleRate) throw new Error('Parallel dynamics lookahead exceeds the memory limit.');
		stateBytes += (latencyFrames + 1) * channels * 4;
	} else if (!isStandardEffect(type) && !['bitcrusher', 'deesser', 'multiband-compressor'].includes(type)) {
		throw new Error(`Parallel stacks do not support effect ${type}.`);
	}
	if (type === 'vocoder') stateBytes += 1024 * 1024;
	return { id: String(effect.id ?? ''), type, params, latencyFrames, stateBytes };
}

export function createParallelStackEffect(effect: ParallelStackEffect, sampleRate: number,
	channels: number, modules: ParallelStackRuntimeModules = {}): ParallelStackEffectProcessor {
	const { type, params } = effect;
	const options = { sampleRate, channelCount: channels, params };
	if (type === 'parametric-eq') {
		if (!(modules.parametricEqWasmModule instanceof WebAssembly.Module)) throw new Error('Parallel parametric EQ requires its precompiled WASM module.');
		const runtime = new ParametricEqWasmRuntime(modules.parametricEqWasmModule, options);
		runtime.configure(params, { effectId: effect.id, mode: 'immediate', transitionFrames: 0 });
		return { reset() { runtime.reset(); }, processBlock(input, output, frames) {
			if (output[0]?.length !== frames) throw new Error('Parallel EQ requires a complete output block.');
			// The audited JavaScript API infers its bounded frame count from this full block.
			runtime.process(input, output);
		} };
	}
	if (type === 'bitcrusher') return createBitcrusherProcessor(options);
	if (type === 'deesser') return createDeesserProcessor(options);
	if (type === 'multiband-compressor') return createMultibandCompressorProcessor(options);
	if (type === 'limiter' || type === 'gate') return createParallelDynamics(type, params, sampleRate, channels);
	if (isStandardEffect(type)) return createStandardEffectProcessor({ ...options, type });
	throw new Error(`Unsupported parallel stack effect ${type}.`);
}
