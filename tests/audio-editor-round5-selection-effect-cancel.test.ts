/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { deferred } from './helpers/async-test-control.ts';

for (const phase of ['render', 'worker', 'persist'] as const) {
	test(`cancelled selection effect cannot publish audio after ${phase}`, async () => {
		const gate = deferred<void>(); const entered = deferred<void>();
		const lifetime = new EditorControllerLifetime(); lifetime.markReady();
		const project = new EditorProjectGeneration(); project.activate('recording');
		let writes = 0; let workersCancelled = 0;
		const state = { audacityEffectType: 'reverb', audacityEffectProcessing: false,
			lastAudacityEffect: null, audacityControlTrackId: null,
			audacityEffectTouchedParams: new Map<string, Set<string>>() };
		const pause = async (current: typeof phase) => {
			if (current === phase) { entered.resolve(); await gate.promise; }
		};
		const service = createSelectionEffectExecutionService({ lifetime, state,
			captureProject: () => project.capture(),
			assertProject: (token: Parameters<typeof project.assertCurrent>[0]) => project.assertCurrent(token),
			AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 1_000_000,
			AUDIO_SELECTION_EFFECT_DEFINITIONS: { reverb: {} },
			activeSelection: () => null, editingBlocked: () => state.audacityEffectProcessing,
			audacityEffectTargets: () => [{ track: { id: 'audio' }, startFrame: 0, endFrame: 4,
				durationFrames: 4, channelCount: 1, hasAudio: true }],
			audacitySpectralEffectContext: () => null, audacityEffectSelectionDetails: () => ({}),
			currentAudacityEffectParams: () => ({}), normalizeAudioSelectionEffectParams: (_type: string, params: unknown) => params,
			estimateAudioSelectionEffectOutputFrames: (_type: string, frames: number) => frames,
			estimateAudioSelectionEffectPeakBytes: () => 16,
			projectSampleRate: () => 48_000, projectDurationFrames: () => 4, getProject: () => ({ id: 'recording' }),
			copy: { audacityProcessing: 'Processing', audacityApplied: 'Applied' },
			preflightStorage: async () => undefined, publishDocumentSnapshot: () => undefined, setStatus: () => undefined,
			resolveInteractiveAudacityParams: (_type: string, params: unknown) => params,
			renderDryTrackRange: async () => { await pause('render'); return [new Float32Array([.1, -.1, .2, -.2])]; },
			runSelectionEffectWorker: async () => { await pause('worker'); return { channels: [new Float32Array(4).fill(.5)] }; },
			cancelSelectionWorkers: () => { workersCancelled++; },
			persistAudacityEffectResults: async (_result: unknown, _type: string, options: { assertCurrent(): void }) => {
				await pause('persist'); options.assertCurrent(); writes++;
			},
		});
		const pending = service.applySelectedAudacityEffect();
		await entered.promise;
		const outcome = pending.then(() => null, (error: unknown) => error);
		// The browser reproducer reaches this cancellation through the existing Cancel button.
		const cancel = Reflect.get(service, 'cancelSelectedAudacityEffect') as (() => boolean) | undefined;
		cancel?.(); gate.resolve();
		const error = await outcome;
		assert.equal(writes, 0, 'a cancelled operation must not replace the recording');
		assert.ok(error instanceof Error && error.name === 'AbortError');
		assert.equal(workersCancelled, 1);
		assert.equal(state.audacityEffectProcessing, false);
		assert.equal(state.lastAudacityEffect, null);
		assert.equal(cancel?.(), false, 'idle cancellation must not touch another task');
		lifetime.beginDisposal(); lifetime.finishDisposal();
	});
}
