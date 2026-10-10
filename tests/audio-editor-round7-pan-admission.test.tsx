/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import AudioEditorMixerPanel from '../src/common/editor/ui/workspace/AudioEditorMixerPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createMixerParameterActions } from '../src/common/editor/controller/composition/internal/mixer-parameter-actions.ts';
import { applyAudacityTrackMixerAction } from '../src/common/editor/audacity-shortcut-actions/track-mixer.ts';
import { createTrackAutomationTargetInventoryV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { projectStripPanAvailable } from '../src/common/editor/terminal-channel-widths.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function recording(channelCount: number) {
	const source = createAudioSource({ id: 'source', storageKey: 'recording', name: 'Recording.wav',
		frameCount: 48_000, channelCount, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
		durationFrames: 48_000, sourceDurationFrames: 48_000 });
	return createSoundscaperProject({ id: 'pan-admission', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Recording', clipIds: [clip.id] })] });
}

for (const surface of ['header', 'mixer'] as const) for (const width of [2, 4]) {
	test(`${surface} native Pan ${width === 2 ? 'admits stereo' : 'suspends four-channel'} recording gestures`, async () => {
		const project = recording(width);
		const track = project.tracks[0];
		assert.ok(track?.type === 'audio');
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const accepted: number[] = [];
		const controller = {
			getSnapshot: () => ({ project }),
			getTelemetrySnapshot: () => ({ meters: {} }), subscribeTelemetry: () => () => undefined,
			actions: { track: { update() {} }, mixer: {
				beginParameterGesture: () => 0,
				previewParameterGesture: (_address: unknown, value: number) => accepted.push(value),
				commitParameterGesture: (_address: unknown, value: number) => accepted.push(value),
				cancelParameterGesture() {},
			} },
		};
		try {
			await act(async () => root.render(surface === 'header' ? <TrackControls controller={controller} track={track}
				trackHeight={180} panelWidth={240} selected={false} blocked={false} showArmControls={false} displayAudioSupported={false}
				recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
				isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				onMenu={() => undefined} onOpenEffects={() => undefined} onAutomationTarget={() => undefined}
				onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />
				: <AudioEditorMixerPanel controller={controller} snapshot={{ project, productId: 'soundscaper', capabilities: {}, effects: { rackTypes: [] } }}
					copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} showArmControls={false} displayAudioSupported={false}
					onOpenEffects={() => undefined} automationRuntime={undefined} />));
			const knob = surface === 'header' ? dom.one('.knob')
				: dom.one('.kw-audio-editor__mixer-channel--track').querySelector('.knob');
			assert.ok(knob);
			assert.equal(knob.getAttribute('disabled') !== null, width > 2);
			await act(async () => { reactProps(knob).onKeyDown({ key: 'End', preventDefault() {}, stopPropagation() {} }); });
			await act(async () => { reactProps(knob).onKeyUp({ key: 'End' }); });
			assert.deepEqual(accepted, width === 2 ? [1, 1] : []);
		} finally {
			await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
		}
	});
}

for (const width of [2, 4]) test(`continuous Pan admission follows the ${width}-channel native strip`, () => {
	const project = recording(width);
	const writes: unknown[] = [];
	const actions = createMixerParameterActions({ getProject: () => project,
		copy: { projectNotFound: 'No project', projectReadOnly: 'Read only' }, state: { readOnly: false },
		engine: { previewScheduledParameter: () => true }, commit: command => writes.push(command) });
	const address = { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' } as const;
	if (width === 2) {
		assert.equal(actions.beginParameterGesture(address), 0);
		actions.previewParameterGesture(address, 1); actions.commitParameterGesture(address, 1);
		assert.equal(writes.length, 1);
	} else {
		assert.throws(() => actions.beginParameterGesture(address), /strip not found/iu);
		assert.equal(writes.length, 0);
	}
});

for (const width of [2, 4]) test(`Pan shortcut preserves ${width}-channel strip admission`, () => {
	const project = recording(width);
	const writes: unknown[] = [];
	applyAudacityTrackMixerAction('track-pan-right', { project: project as unknown as ControllerProject, selectedTrackId: 'voice' }, command => writes.push(command));
	assert.equal(writes.length, width === 2 ? 1 : 0);
});

for (const width of [2, 4]) test(`Pan automation preserves ${width}-channel strip admission`, () => {
	const project = recording(width);
	const targets = createTrackAutomationTargetInventoryV21(project, 'voice');
	const pan = targets.find(target => target.address.kind === 'strip' && target.address.parameterId === 'pan');
	assert.ok(pan);
	assert.equal(pan.disabledReason !== null, width > 2);
	assert.equal(targets.find(target => target.label === 'Volume')?.disabledReason, null);
	assert.equal(targets.find(target => target.label === 'Mute')?.disabledReason, null);
});

test('channel-preserving ADM strips and native wide buses retain the graph admission contract', () => {
	const base = recording(2);
	const project = { ...base, masterChannels: 6, mixer: { ...base.mixer,
		groups: [{ id: 'stereo-group', channelCount: 2 }, { id: 'wide-group', channelCount: 4 }],
		sends: [{ id: 'wide-send', channelCount: 8 }], cues: [{ id: 'stereo-cue', channelCount: 2 }],
	} };
	assert.equal(projectStripPanAvailable(project, { kind: 'master' }), false);
	assert.equal(projectStripPanAvailable(project, { kind: 'track', id: 'voice' }), true);
	for (const [id, expected] of [['stereo-group', true], ['wide-group', false], ['wide-send', false], ['stereo-cue', true]] as const) {
		assert.equal(projectStripPanAvailable(project, { kind: 'mixer-node', id }), expected);
	}
	for (const mode of ['authored', 'passthrough']) {
		const preserving = { ...base, metadata: { ...base.metadata, adm: { mode } } };
		assert.equal(projectStripPanAvailable(preserving, { kind: 'track', id: 'voice' }), false);
		assert.equal(projectStripPanAvailable(preserving, { kind: 'master' }), false);
		assert.equal(createTrackAutomationTargetInventoryV21(preserving, 'voice').find(target => target.label === 'Pan')?.descriptor.automatable, false);
	}
	assert.equal(projectStripPanAvailable({ ...project, mixer: { groups: [], sends: [], routes: {} } }, { kind: 'track', id: 'voice' }), true,
		'the foundation graph retains its existing stereo-panner behavior');
});
