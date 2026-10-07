/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { AudioTrackRuler } from '../src/common/editor/ui/timeline/AudioTrackRuler.jsx';
import { TrackAutomationSelectors } from '../src/common/editor/ui/timeline/TrackAutomationSelectors.tsx';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { createAudioTrackRowClipViewModels } from '../src/common/editor/ui/timeline/audio-track-row-view-model.js';

void test('ruler child elements and automation target groups stay retained when controls receive unrelated updates', async () => {
	const dom = installReactTestDom(); const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let groupReads = 0; let children: unknown;
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'gain' });
	const target: TrackAutomationTargetV21 = { key: descriptor.id, address: descriptor.address, descriptor, label: 'Volume',
		get groupLabel() { groupReads++; return 'Track'; }, effectId: null, edgeId: null, currentValue: 1, lane: null, disabledReason: null };
	const targets = [target]; const track = { id: 'track', name: 'Track' }; const noop = () => undefined;
	function Harness({ revision }: { revision: number }) {
		children = AudioTrackRuler({ track, displayMode: 'waveform', bodyTop: 20, bodyHeight: 80, width: 30, channelCount: 2,
			channelHeightRatio: 0.5, sampleRate: 48_000, spectrogramScale: 'linear', waveformRulerFormat: 'linear-amp', waveformZoom: 0,
			disabled: revision % 2 === 1, copy: { waveformView: 'Waveform' }, tabIndex: 0,
			onOpenRulerFlyout: noop, onKeyDown: noop, onWaveformZoom: noop, onFrequencyRange: noop }).props.children;
		TrackAutomationSelectors({ trackId: 'track', targets, selectedTarget: target, disabled: revision % 2 === 1,
			copy: {}, onTarget: noop });
		return null;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = children; const reads = groupReads;
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(children, first, 'exact React element reuse prevents child rulers from rendering again');
		assert.equal(groupReads, reads, 'target grouping performs zero repeated group-label reads');
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

void test('audio-row model construction resolves a shared track color once and applies envelope previews in the same pass', () => {
	let colorConversions = 0;
	const trackColor = { [Symbol.toPrimitive]() { colorConversions++; return 0; } };
	const clips = Array.from({ length: 200 }, (_, index) => ({ id: String(index), kind: 'audio', sourceId: 'source', title: 'Clip',
		timelineStartFrame: index * 100, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100, waveformStartFrame: 0, waveformEndFrame: 100 }));
	const points = [{ time: 0, value: 0.5 }];
	const models = createAudioTrackRowClipViewModels({ controller: { getClipVisualData: () => null }, sourceLookup: new Map(), clips,
		recordingPreview: null, overscanStartFrame: 0, pixelsPerSecond: 100, sampleRate: 100, copy: {}, displayMode: 'waveform',
		project: null, selectedClipIds: new Set(['0']), showRms: false, trackColor, waveformCache: new Map(), draggingClipIds: new Set(),
		waveformPendingClipIds: new Set(), envelopePreviews: new Map([['0', { designPoints: points, envelope: {} }]]),
		frequencyWaveformProjector: undefined, frequencyWaveformPreferences: undefined });
	assert.equal(colorConversions, 2, 'one alias lookup and number conversion for the row, instead of 400 conversions');
	assert.equal(models.length, clips.length); assert.equal(models[0]?.color, 'blue'); assert.equal(models[0]?.envelopePoints, points);
	assert.equal(models[1]?.color, 'blue');
});
