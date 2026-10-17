/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { SelectionEffectsDialog } from '../../../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import { createEffectControlsService, type EffectControlsState } from '../../../src/common/editor/controller/effects/effect-controls-service.ts';
import { createSelectionEffectExecutionService } from '../../../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../../../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_SELECTION_EFFECT_DEFINITIONS, normalizeAudioSelectionEffectParams } from '../../../src/common/editor/effects.js';
import { estimateAudioSelectionEffectPeakBytes } from '../../../src/common/editor/selection-effects.js';
import { createSoundscaperProject } from '../../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../../../src/common/i18n/catalogs.js';

interface ObservedEvent {
	readonly event: string;
	readonly at: number;
	readonly value: string;
	readonly gainDb: unknown;
	readonly trusted?: boolean;
	readonly key?: string;
	readonly inputType?: string;
}

/** The only held port is dry PCM completion; preparation, parameter ownership and UI are production code. */
export function mountAmplifyPreparation() {
	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate('amplify-selection');
	const pcm = new Float32Array([0.05, -0.05, 0.025, 0]);
	const project = createSoundscaperProject({ id: 'amplify-selection', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: pcm.length })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] }, 48_000)],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: pcm.length })],
	});
	const state: EffectControlsState = {
		audacityEffectType: 'audacity-amplify', audacityEffectParams: {}, audacityEffectTouchedParams: new Map(),
		audacityPreviewSource: null, audacityPreviewAuditionBandId: null, audacityPreviewGeneration: 0,
		audacityControlTrackId: null, effectPresets: { schemaVersion: 1, presets: [] }, lastAudacityEffect: null,
	};
	let completed = false;
	let renders = 0;
	let releasePcm!: () => void;
	const pendingPcm = new Promise<void>((resolve) => { releasePcm = resolve; });
	const events: ObservedEvent[] = [];
	const controls = createEffectControlsService({
		state, copy: ENGLISH_COPY, createId: () => 'unused',
		// The fixture owns no rack effects; expose the controls service's narrower rack view.
		getProject: () => ({ id: project.id, tracks: project.tracks.map(({ id, type }) => ({ id, type })), master: {} }),
		persistSetting: async () => undefined, publishDocumentSnapshot: () => render(),
		setStatus: () => undefined, applySelectedAudacityEffect: async () => undefined,
		captureRackNoiseProfile: () => undefined,
	});
	const controller = { project, actions: { effects: {
		setSelectionParams: controls.setAudacityEffectParamsFromController,
		setControlTrack: controls.setAudacityControlTrack, cancelPreview: controls.cancelAudacityEffectPreview,
		presets: {},
	} } };
	const field = () => container.querySelector<HTMLInputElement>('[data-effect-number-input="gainDb"] input');
	const record = (event: ObservedEvent) => { if (events.length < 64) events.push(event); };
	function render() {
		record({ event: 'publish', at: performance.now(), value: field()?.value ?? '', gainDb: controls.currentAudacityEffectParams().gainDb });
		root.render(<ThemeProvider><SelectionEffectsDialog isOpen controller={controller} copy={ENGLISH_COPY}
			fileService={null} onClose={() => undefined} snapshot={{ ready: true, project, selectedTrackId: 'track',
				selectedClipId: 'clip', effects: { selectionType: state.audacityEffectType,
					selectionParams: controls.currentAudacityEffectParams(), presets: [] } }} /></ThemeProvider>);
	}
	const execution = createSelectionEffectExecutionService({
		lifetime, state, copy: ENGLISH_COPY, AUDIO_SELECTION_EFFECT_DEFINITIONS,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES: 512 * 1024 ** 2,
		captureProject: () => generation.capture(), assertProject: (token: Parameters<typeof generation.assertCurrent>[0]) => generation.assertCurrent(token),
		getPreparedAudioAuthority: () => project, getProject: () => project,
		audacityEffectTargets: () => [{ track: project.tracks[0], startFrame: 0, endFrame: pcm.length,
			durationFrames: pcm.length, channelCount: 1, clipIds: ['clip'] }],
		currentAudacityEffectParams: controls.currentAudacityEffectParams,
		setAudacityEffectType: controls.setAudacityEffectType,
		resolveInteractiveAudacityParams: controls.resolveInteractiveAudacityParams,
		normalizeAudioSelectionEffectParams, estimateAudioSelectionEffectPeakBytes,
		audacityEffectMemoryError: () => new Error('The selection is too large.'),
		projectSampleRate: () => project.sampleRate,
		renderDryTrackRange: async () => {
			renders += 1;
			await pendingPcm;
			return [pcm];
		},
		publishDocumentSnapshot: () => render(),
	});
	const observe = (event: Event) => {
		if (event.target !== field()) return;
		record({ event: event.type, at: performance.now(), value: field()!.value,
			gainDb: controls.currentAudacityEffectParams().gainDb, trusted: event.isTrusted,
			key: event instanceof KeyboardEvent ? event.key : undefined,
			inputType: event instanceof InputEvent ? event.inputType : undefined });
	};
	const observedTypes = ['focus', 'select', 'keydown', 'beforeinput', 'input', 'blur'] as const;
	for (const type of observedTypes) document.addEventListener(type, observe, true);
	render();
	const preparation = execution.prepareAudacityEffectFromController('audacity-amplify').then(() => { completed = true; });
	let originalField: HTMLInputElement | null = null;
	return {
		snapshot() {
			const input = field();
			originalField ??= input;
			const gainDb = controls.currentAudacityEffectParams().gainDb;
			return { completed, renders, gainDb, fieldValue: input?.value ?? null,
				synchronized: !!input && Number(input.value) === gainDb,
				sameField: input !== null && input === originalField, focused: input !== null && document.activeElement === input,
				touched: [...(state.audacityEffectTouchedParams.get('audacity-amplify') ?? [])],
				headroom: 20 * Math.log10(1 / pcm[0]!), events: [...events] };
		},
		async finishScan() { releasePcm(); await preparation; },
		async dispose() {
			releasePcm();
			await preparation;
			root.unmount();
			lifetime.beginDisposal();
			lifetime.finishDisposal();
			for (const type of observedTypes) document.removeEventListener(type, observe, true);
			container.remove();
		},
	};
}
