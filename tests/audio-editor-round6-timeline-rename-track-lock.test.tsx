/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioTrackRow } from '../src/common/editor/ui/timeline/AudioTrackRow.jsx';
import { VideoTrackRow } from '../src/common/editor/ui/timeline/VideoTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const kind of ['audio', 'video'] as const) {
	for (const lockTiming of ['before rename', 'during rename', 'global block'] as const) {
		test(`${kind} timeline rename retains ${lockTiming} admission`, async () => {
			const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
				sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
			const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
				sourceDurationFrames: 48_000, durationFrames: 48_000 });
			let project = createSoundscaperProject({ sources: [source], clips: [clip],
				tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
			let blocked = false;
			const edits: string[] = [];
			const noop = () => undefined;
			const telemetry = { mixer: { tracks: [] } };
			const controller = { getSnapshot: () => ({ project }), getClipVisualData: () => null,
				getTelemetrySnapshot: () => telemetry, subscribeTelemetry: () => noop,
				actions: { clip: { update: (_id: string, changes: { title: string }) => { edits.push(changes.title); } },
					track: { update: noop }, mixer: { beginParameterGesture: () => 0, previewParameterGesture: noop,
						commitParameterGesture: noop, cancelParameterGesture: noop },
					timeline: { selectTrack: noop, selectClip: noop }, video: { getClipVisualData: () => null } } };
			bindProductVideoVisualPreviewRuntime(controller, createProductVideoVisualPreviewRuntime(
				async () => null, async () => null, async () => [],
			));
			const dom = installReactTestDom();
			Object.defineProperties(window, {
				requestAnimationFrame: { value: globalThis.requestAnimationFrame },
				cancelAnimationFrame: { value: globalThis.cancelAnimationFrame },
				getComputedStyle: { value: () => ({ display: 'block', visibility: 'visible' }) },
			});
			const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
			const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
			const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
			globals.IS_REACT_ACT_ENVIRONMENT = true;
			Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
			Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
			Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
			const root = createRoot(dom.container as unknown as Element);
			const render = async () => {
				const track = { ...project.tracks[0], type: kind };
				const props = { controller, project, presentationProject: project, track, visualHeight: 120,
					trackClips: [kind === 'audio' ? clip : { ...clip, kind: 'video' }], clipLookup: new Map([[clip.id, clip]]),
					sourceLookup: new Map([[source.id, source]]), trackIndex: 0, trackCount: 1, isFlatNavigation: false,
					trackBaseTabIndex: 0, panelWidth: 240, renderViewportStartFrame: 0, viewportDurationFrames: 48_000,
					pixelsPerSecond: 100, sampleRate: 48_000, timelineWidth: 600, verticalRulerWidth: 30,
					rangeSelected: false, selectedTrackId: 'track', selectedClipId: clip.id,
					selectedClipIdSet: new Set([clip.id]), waveformCache: new Map(), blocked, copy: ENGLISH_COPY,
					viewModelRevision: project, selection: null, spectralSelection: null, timeSelection: null,
					timelineView: 'waveform', asymmetricStereoHeightsAvailable: false, channelHeightRatio: 0.5,
					showRms: false, waveformDisplay: {}, showFadeShapeHandles: false,
					waveformRulerFormat: 'linear-db', waveformZoom: 1, onWaveformZoom: noop, clipStyle: 'colourful',
					recordingPreview: null, draggingClipIds: null, clipDragPreview: null, projectBinDragPreview: null,
					automationToolEnabled: false, automationRuntime: undefined, automationTargets: [], automationTarget: undefined,
					spectralBrushEnabled: false, canonicalVideoTrim: false, showArmControls: false,
					displayAudioSupported: true, recordingInputs: [], onOpenEffects: noop, onAutomationTarget: noop,
					onOpenClipProperties: undefined, onOpenRulerFlyout: noop, onFocusTimelineRuler: noop,
					onFocusTrackContainer: noop, onFocusTrackPanelControl: noop, onFocusTrackClip: noop,
					onFocusTrackRuler: noop, onFocusSelectionToolbar: noop,
					run: (operation: () => unknown) => operation(), onMenu: noop, onOpenClipMenu: noop };
				await act(async () => root.render(kind === 'audio' ? <AudioTrackRow {...props} /> : <VideoTrackRow {...props} />));
			};
			const start = async () => {
				await act(async () => { reactProps(dom.one('.clip-header__name')).onDoubleClick?.({ stopPropagation() {} }); });
			};
			const submit = async (name: string) => {
				const input = dom.one('.clip-header__name-input');
				input.value = name;
				await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', currentTarget: input,
					preventDefault() {}, stopPropagation() {} }); });
			};
			try {
				await render();
				await start();
				await submit('Healthy rename');
				assert.deepEqual(edits, ['Healthy rename']);
				if (lockTiming !== 'before rename') await start();
				if (lockTiming === 'global block') blocked = true;
				else {
					project = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'track', changes: { locked: true } });
					assert.throws(() => applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: clip.id,
						changes: { title: 'Protected rename' } }), /locked/u);
				}
				await render();
				if (lockTiming === 'before rename') {
					await start();
					assert.equal(dom.find('.clip-header__name-input'), null);
				} else await submit('Protected rename');
				assert.deepEqual(edits, ['Healthy rename']);
				blocked = false;
				project = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'track', changes: { locked: false } });
				await render();
				await start();
				await submit('Restored rename');
				assert.deepEqual(edits, ['Healthy rename', 'Restored rename']);
			} finally {
				await act(async () => root.unmount());
				globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
				if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
				if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
				Reflect.deleteProperty(ReactTestElement.prototype, 'select');
				dom.restore();
			}
		});
	}
}
