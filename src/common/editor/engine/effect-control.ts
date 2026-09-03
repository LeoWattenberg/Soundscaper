/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeEffect,
} from '../effects.js';
import {
	designParametricEqWasmConfiguration,
} from '../parametric-eq/wasm-runtime.js';
import {
	addNode,
	connect,
} from './audio-node-utils.ts';
import { readDynamicsAnalysisTelemetry } from './dynamics-analysis-telemetry.ts';
import {
	applyEffect,
	effectGraphKey,
	postEffectMessage,
	readParametricEqSpectrumEntry,
	safeMessageSequence,
} from './effect-rack.ts';
import {
	ensureParametricEqWorklet,
} from './effect-worklets.ts';
import {
	cloneMessageValue,
	projectRackEffect,
	projectWithEffectParams,
	projectWithParametricEqParams,
} from './project-effects.ts';
import {
	disposeGraph,
} from './transport-scheduler.ts';
import {
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeMethodMap,
} from './runtime-types.ts';

/** Rack effects whose processors accept a live parameter frame over their port. */
const CONFIGURABLE_RACK_EFFECT_TYPES = new Set(['delay', 'bitcrusher']);

export const engineEffectControlMethods = {
configureRackEffect(scope, targetId, effectId, params, options = {}) {
		if (!params || typeof params !== 'object' || Array.isArray(params)) {
			throw new TypeError('Rack effect parameters must be an object.');
		}
		const effect = projectRackEffect(this.project, scope, targetId, effectId);
		const configurable = String(effect?.type || '').toLowerCase();
		if (!effect || !CONFIGURABLE_RACK_EFFECT_TYPES.has(configurable)) return false;
		const normalized = normalizeEffect({
			...effect,
			params: { ...(effect.params || {}), ...params },
		}).params;
		const sequence = postEffectMessage(
			this.graph,
			scope,
			targetId,
			effectId,
			{ type: 'configure', params: normalized },
			options.revision,
		);
		if (sequence !== false) {
			this.project = projectWithEffectParams(
				this.project,
				scope,
				targetId,
				effectId,
				normalized,
				(candidate) => String(candidate?.type || '').toLowerCase() === configurable,
			) || this.project;
		}
		return sequence;
	},

configureParametricEq(scope, targetId, effectId, params, options = {}) {
		if (!params || typeof params !== 'object' || Array.isArray(params)) {
			throw new TypeError('Parametric EQ parameters must be an object.');
		}
		designParametricEqWasmConfiguration(
			params,
			this.context?.sampleRate || this.sampleRate,
			{ effectId },
		);
		const message: Record<string, unknown> = { type: 'configure', params };
		if (options.transitionFrames !== undefined) {
			message.transitionFrames = safeMessageSequence(options.transitionFrames, 'transitionFrames');
		}
		const sequence = postEffectMessage(
			this.graph,
			scope,
			targetId,
			effectId,
			message,
			options.revision,
		);
		if (sequence !== false) {
			this.project = projectWithParametricEqParams(this.project, scope, targetId, effectId, params) || this.project;
		}
		return sequence;
	},

auditionParametricEq(scope, targetId, effectId, bandId = null) {
		if (bandId !== null && (typeof bandId !== 'string' || !bandId)) {
			throw new TypeError('A parametric EQ audition band ID must be a non-empty string or null.');
		}
		return postEffectMessage(this.graph, scope, targetId, effectId, {
			type: 'audition',
			bandId,
		});
	},

resetParametricEq(scope, targetId, effectId) {
		return postEffectMessage(this.graph, scope, targetId, effectId, { type: 'reset' });
	},

readParametricEqSpectrum(scope, targetId, effectId, which, target) {
		const key = effectGraphKey(scope, targetId, effectId);
		const entry = this.graph?.effectAnalysers?.get(key);
		return readParametricEqSpectrumEntry(entry, which, target);
	},

readDynamicsAnalysis(scope, targetId, effectId) {
		const key = effectGraphKey(scope, targetId, effectId);
		return readDynamicsAnalysisTelemetry(this.graph?.effectNodes?.get(key));
	},

async createParametricEqPreview(buffer, params, { effectId = 'selection-preview-eq' } = {}) {
		if (!buffer || !Number.isSafeInteger(buffer.numberOfChannels)
			|| buffer.numberOfChannels < 1 || buffer.numberOfChannels > 32) {
			throw new RangeError('Parametric EQ preview requires an AudioBuffer with between one and 32 channels.');
		}
		const context = await this.getAudioContext({ resume: true });
		const wasmModule = await ensureParametricEqWorklet(context);
		const nodes: AudioNode[] = [];
		const effectNodes = new Map();
		const effectAnalysers = new Map();
		let previewError: unknown = null;
		let previewErrorListener: ((error: unknown) => void) | null = null;
		const source = addNode(nodes, context.createBufferSource());
		source.buffer = buffer;
		let output;
		try {
			output = applyEffect(context, source, {
				id: effectId,
				type: 'eq',
				enabled: true,
				params,
			}, nodes, {
				scope: 'master',
				targetId: null,
				effectAnalysis: true,
				effectNodes,
				effectAnalysers,
				parametricEqWasmModule: wasmModule,
				parametricEqChannelCount: buffer.numberOfChannels,
				onParametricEqError: (error) => {
					previewError ||= error;
					this[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error);
					previewErrorListener?.(error);
				},
			});
			connect(output, context.destination);
		} catch (error) {
			for (const node of nodes.reverse()) {
				try { node.disconnect(); } catch { /* The partially built graph may already be disconnected. */ }
			}
			throw error;
		}
		const key = effectGraphKey('master', null, effectId);
		const processor = effectNodes.get(key);
		const analyserEntry = effectAnalysers.get(key);
		const graph = {
			nodes,
			sources: new Set([source]),
			effectNodes,
			effectAnalysers,
			effectMessageSequences: new Map(),
		};
		let sequence = 0;
		let disposed = false;
		const postPreviewMessage = (message: Record<string, unknown>) => {
			if (disposed || !processor?.port?.postMessage) return false;
			sequence += 1;
			processor.port.postMessage({ ...message, revision: sequence, sequence });
			return sequence;
		};
		return {
			source,
			get onended() { return source.onended; },
			set onended(listener) { source.onended = listener; },
			get onerror() { return previewErrorListener; },
			set onerror(listener) {
				previewErrorListener = typeof listener === 'function' ? listener : null;
				if (previewError && previewErrorListener) previewErrorListener(previewError);
			},
			start: (...args: Parameters<AudioBufferSourceNode['start']>) => source.start(...args),
			stop: (...args: Parameters<AudioBufferSourceNode['stop']>) => source.stop(...args),
			configure: (nextParams: unknown) => postPreviewMessage({
					type: 'configure',
					params: cloneMessageValue(nextParams),
					mode: 'smooth',
				}),
			audition: (bandId: unknown) => postPreviewMessage({ type: 'audition', bandId }),
			readSpectrum: (which: unknown, target: Float32Array) => (
				readParametricEqSpectrumEntry(analyserEntry, which, target)
			),
			disconnect: () => {
				if (disposed) return;
				disposed = true;
				previewErrorListener = null;
				disposeGraph(graph, false);
			},
		};
	}
} satisfies EngineRuntimeMethodMap<
	| 'configureRackEffect'
	| 'configureParametricEq'
	| 'auditionParametricEq'
	| 'resetParametricEq'
	| 'readParametricEqSpectrum'
	| 'readDynamicsAnalysis'
	| 'createParametricEqPreview'
>;
