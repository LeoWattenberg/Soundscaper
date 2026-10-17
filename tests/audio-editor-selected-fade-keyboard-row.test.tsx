/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AudioTrackRow } from '../src/common/editor/ui/timeline/AudioTrackRow.jsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const edge of ['in', 'out'] as const) test(`mounted row keyboard fade-${edge} preserves each selected clip's opposite fade`, async () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', frameCount: 192_000,
		channelCount: 1, sampleRate: 48_000 });
	const first = createAudioClip({ id: 'first', sourceId: source.id, durationFrames: 96_000,
		sourceDurationFrames: 96_000, fadeInFrames: edge === 'in' ? 12_000 : 48_000,
		fadeOutFrames: edge === 'in' ? 48_000 : 12_000 });
	const second = createAudioClip({ id: 'second', sourceId: source.id, durationFrames: 96_000,
		sourceDurationFrames: 96_000, fadeInFrames: 0, fadeOutFrames: 0 });
	const initial = createSoundscaperProject({ sources: [source], clips: [first, second],
		tracks: [createAudioTrack({ id: 'one', clipIds: [first.id] }), createAudioTrack({ id: 'two', clipIds: [second.id] })],
		selection: { startFrame: 0, endFrame: 0, clipIds: [first.id, second.id], trackIds: ['one', 'two'] },
	});
	let history = createSoundscaperProjectHistory(initial);
	const project = resolveRuntimeProjectProjection(initial);
	const noop = () => undefined;
	const telemetry = { mixer: { tracks: [] } };
	const controller = { getSnapshot: () => ({ project: resolveRuntimeProjectProjection(history.present) }),
		getClipVisualData: () => null, getTelemetrySnapshot: () => telemetry, subscribeTelemetry: () => noop,
		actions: { edit: { commit(command: AudioEditorCommand) {
			history = executeSoundscaperProjectCommand(history, command);
		} }, track: { update: noop }, mixer: { beginParameterGesture: () => 0, previewParameterGesture: noop,
			commitParameterGesture: noop, cancelParameterGesture: noop }, timeline: { selectTrack: noop, selectClip: noop } },
	};
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
	const root = createRoot(dom.container as unknown as Element);
	try {
		const render = () => root.render(<AudioTrackRow
			controller={controller} project={project} track={project.tracks[0]} visualHeight={120}
			trackClips={[project.clips[0]]} clipLookup={new Map(project.clips.map(clip => [clip.id, clip]))}
			sourceLookup={new Map([[source.id, source]])} trackIndex={0} trackCount={2} isFlatNavigation={false}
			trackBaseTabIndex={0} panelWidth={240} renderViewportStartFrame={0} viewportDurationFrames={96_000}
			pixelsPerSecond={100} sampleRate={48_000} timelineWidth={600} verticalRulerWidth={30}
			rangeSelected={false} selectedTrackId="one" selectedClipId={first.id}
			selectedClipIdSet={new Set([first.id, second.id])} waveformCache={new Map()} blocked={false} copy={ENGLISH_COPY}
			viewModelRevision={project} selection={null} spectralSelection={null}
			timelineView="waveform" asymmetricStereoHeightsAvailable={false} channelHeightRatio={0.5}
			showRms={false} waveformDisplay={{}} showFadeShapeHandles={false}
			waveformRulerFormat="linear-db" waveformZoom={1} onWaveformZoom={noop} clipStyle="colourful"
			recordingPreview={null} draggingClipIds={null} clipDragPreview={null} projectBinDragPreview={null}
			automationToolEnabled={false} automationRuntime={undefined} automationTargets={[]} automationTarget={undefined}
			spectralBrushEnabled={false} canonicalVideoTrim={false} showArmControls={false}
			displayAudioSupported recordingInputs={[]} onOpenEffects={noop} onAutomationTarget={noop}
			onOpenClipProperties={undefined} onOpenRulerFlyout={noop} onFocusTimelineRuler={noop}
			onFocusTrackContainer={noop} onFocusTrackPanelControl={noop} onFocusTrackClip={noop}
			onFocusTrackRuler={noop} onFocusSelectionToolbar={noop}
			run={(operation: () => unknown) => operation()} onMenu={noop} onOpenClipMenu={noop}
		/>);
		await act(async () => render());
		await act(async () => render());
		const control = dom.one(`[data-clip-fade-handle="${edge}"]`);
		await act(async () => { reactProps(control).onKeyDown({
			key: edge === 'in' ? 'ArrowRight' : 'ArrowLeft', target: control, currentTarget: control,
			shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
			preventDefault() {}, stopPropagation() {},
		}); });
		assert.deepEqual(history.present.clips.map(clip => [clip.fadeInFrames, clip.fadeOutFrames]),
			edge === 'in' ? [[60_000, 36_000], [60_000, 0]] : [[36_000, 60_000], [0, 60_000]],
			'the edited length wins its own room without copying the anchor\'s opposite fade to other clips');
		assert.equal(history.undoStack.length, 1, 'one keyboard edit publishes one native batch');
		assert.deepEqual(history.present.selection, initial.selection);
		history = undoSoundscaperProjectCommand(history);
		assert.deepEqual(history.present.clips, initial.clips, 'one Undo restores both tracks');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
