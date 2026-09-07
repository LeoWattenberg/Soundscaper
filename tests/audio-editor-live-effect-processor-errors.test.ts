/* SPDX-License-Identifier: AGPL-3.0-only */

// A live Audacity effect that cannot construct — a noise profile captured at
// the project's sample rate applied under a playback context running at the
// device rate, say — posts one `{ type: 'error' }` message on its port and then
// fills its output with zeros for the rest of the session. The dynamics
// telemetry reader owned that port's only handler and keeps analysis windows
// alone, so the failure was swallowed: the strip played and exported silence
// with nothing reaching the engine, the render, or the user, while a parametric
// EQ beside it in the same rack reported the identical failure all the way to
// an aborted render.

import assert from 'node:assert/strict';
import test from 'node:test';

import { readDynamicsAnalysisTelemetry } from '../src/common/editor/engine/dynamics-analysis-telemetry.ts';
import { applyEffect, disposeEffectNodeBindings } from '../src/common/editor/engine/effect-rack.ts';
import { ensureProjectWorklets } from '../src/common/editor/engine/effect-worklets.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineProject, UnknownRecord } from '../src/common/editor/engine/types.ts';
import {
	MockAudioWorkletNode,
	MockOfflineAudioContext,
	createRackProject,
} from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

const PROFILE_FAILURE = 'The live Noise Reduction profile uses incompatible analysis settings.';

class PortRecordingWorkletNode {
	readonly port = {
		onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
		start: () => undefined,
	};
	onprocessorerror: (() => void) | null = null;
	constructor(_context: BaseAudioContext, _name: string, _options: AudioWorkletNodeOptions) {
		queueMicrotask(() => this.port.onmessage?.(messageEvent({ type: 'status', status: 'ready' })));
	}
	disconnect(): void {}
}

function installWorkletNode(value: unknown): void {
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, writable: true, value });
}

function restoreWorkletNode(previous: unknown): void {
	if (previous === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	else installWorkletNode(previous);
}

function liveEffectContext(): BaseAudioContext {
	return {
		sampleRate: 48_000,
		currentTime: 0,
		audioWorklet: { addModule: async () => undefined },
	} as unknown as BaseAudioContext;
}

function messageEvent(data: UnknownRecord): MessageEvent<unknown> {
	return { data } as MessageEvent<unknown>;
}

function noiseReduction(id: string): UnknownRecord {
	return { id, type: 'audacity-noise-reduction', enabled: true, params: { reductionDb: 12 } };
}

async function liveEffectProcessor(
	effect: UnknownRecord,
	onParametricEqError: (error: Readonly<UnknownRecord>) => void,
): Promise<PortRecordingWorkletNode> {
	const context = liveEffectContext();
	await ensureProjectWorklets(context, { tracks: [{ id: 'track-1', effects: [effect] }] });
	const input = { connect: () => undefined } as unknown as AudioNode;
	return applyEffect(context, input, effect, [], {
		scope: 'track',
		targetId: 'track-1',
		onParametricEqError,
	}) as unknown as PortRecordingWorkletNode;
}

test('a live Audacity effect failure reports the rack that fell silent', async () => {
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	installWorkletNode(PortRecordingWorkletNode);
	const errors: Readonly<UnknownRecord>[] = [];
	try {
		const processor = await liveEffectProcessor(noiseReduction('denoise'), (error) => { errors.push(error); });
		processor.port.onmessage?.(messageEvent({ type: 'status', status: 'ready' }));
		assert.deepEqual(errors, []);

		processor.port.onmessage?.(messageEvent({
			type: 'error',
			effectType: 'audacity-noise-reduction',
			message: PROFILE_FAILURE,
			scope: 'spoofed',
			effectId: 'spoofed',
		}));
		assert.deepEqual(errors, [{
			type: 'error',
			effectType: 'audacity-noise-reduction',
			message: PROFILE_FAILURE,
			scope: 'track',
			targetId: 'track-1',
			effectId: 'denoise',
		}]);
		assert.equal(Object.isFrozen(errors[0]), true);

		processor.onprocessorerror?.();
		assert.equal(errors.length, 2);
		assert.equal(errors[1].effectId, 'denoise');
		assert.match(String(errors[1].message), /processor failed/u);

		disposeEffectNodeBindings(processor as unknown as AudioNode);
		assert.equal(processor.port.onmessage, null);
		processor.onprocessorerror?.();
		assert.equal(errors.length, 2);
	} finally {
		restoreWorkletNode(previousAudioWorkletNode);
	}
});

test('reporting live effect failures leaves the dynamics reading path intact', async () => {
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	installWorkletNode(PortRecordingWorkletNode);
	const errors: Readonly<UnknownRecord>[] = [];
	try {
		const processor = await liveEffectProcessor(
			{ id: 'squash', type: 'audacity-limiter', enabled: true, params: {} },
			(error) => { errors.push(error); },
		);
		processor.port.onmessage?.(messageEvent({
			type: 'analysis',
			effectType: 'audacity-limiter',
			sequence: 3,
			frames: 128,
			seconds: 0.5,
			inputPeak: 0.8,
			outputPeak: 0.5,
			reductionDb: -4,
		}));
		const reading = readDynamicsAnalysisTelemetry(processor as unknown as AudioNode);
		assert.equal(reading?.sequence, 3);
		assert.equal(reading?.reductionDb, -4);
		assert.deepEqual(errors, []);
	} finally {
		restoreWorkletNode(previousAudioWorkletNode);
	}
});

test('a live effect failure during an offline render rejects instead of exporting silence', async () => {
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	installWorkletNode(MockAudioWorkletNode);
	class FailingLiveEffectOfflineContext extends MockOfflineAudioContext {
		async startRendering(): Promise<unknown> {
			for (const node of this.workletNodes) {
				if (node.name !== 'kw-audacity-live-effect' || node.readinessProbe) continue;
				node.port.onmessage?.(messageEvent({ type: 'error', message: PROFILE_FAILURE }));
			}
			return super.startRendering();
		}
	}
	const project = createRackProject({
		tracks: [{ id: 'track-1', effects: [noiseReduction('denoise')] }],
	}) as unknown as EngineProject;
	const engine = createAudioEditorEngine({
		audioContextFactory: (() => new MockAudioContext()) as never,
		offlineAudioContextFactory: ((options: never) => new FailingLiveEffectOfflineContext(options)) as never,
		meterInterval: 1_000,
	});
	try {
		engine.loadProject(project, new Map([
			['source-1', new MockAudioBuffer(1, 4_800, 48_000) as unknown as AudioBuffer],
		]));
		await assert.rejects(
			() => engine.renderMix({ startFrame: 0, endFrame: 2_400 }),
			new RegExp(PROFILE_FAILURE.replaceAll('.', '\\.'), 'u'),
		);
	} finally {
		await engine.dispose();
		restoreWorkletNode(previousAudioWorkletNode);
	}
});
