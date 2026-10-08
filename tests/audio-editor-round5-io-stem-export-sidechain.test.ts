/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { stemProject } from '../src/common/editor/controller/export/temporary-export.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { renderAndEncodeAudioExport, type AudioExportRenderOrchestrationRuntime } from '../src/common/editor/controller/export/internal/audio/audio-export-render-orchestration.ts';

function fixture(mode: 'bus' | 'direct' | 'muted' | 'none') {
	const project = createSoundscaperProject({ id: 'track-stem', sampleRate: 48_000,
		sources: ['programme', 'detector', 'unrelated'].map(id => ({ id, storageKey: id,
			sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })),
		clips: ['programme', 'detector', 'unrelated'].map(id => ({ id: `${id}-clip`, sourceId: id,
			timelineStartFrame: 0, durationFrames: 48_000 })),
		tracks: [
			{ id: 'programme', type: 'audio', name: 'Programme', clipIds: ['programme-clip'],
				gain: 0.5, pan: 0.75, effects: [createEffect('gate', { id: 'gate' })] },
			{ id: 'detector', type: 'audio', name: 'Detector', clipIds: ['detector-clip'],
				gain: 0.25, pan: -0.5, mute: mode === 'muted', effects: [createEffect('highpass', { id: 'filter' })] },
			{ id: 'unrelated', type: 'audio', name: 'Unrelated', clipIds: ['unrelated-clip'] },
		], master: { gain: 0.3, effects: [createEffect('highpass', { id: 'master-filter' })] },
	});
	const bus = mode === 'bus' || mode === 'muted';
	const mixer = normalizeMixerGraphV21({ ...project.mixer,
		groups: bus ? [{ id: 'bus', name: 'Detector bus', channelCount: 1, color: '#ffffff',
			gain: 0.75, pan: 0.25, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] }] : [],
		edges: [...project.mixer.edges.map(edge => bus && edge.source.kind === 'track' && edge.source.id === 'detector'
			? { ...edge, destination: { kind: 'mixer-node' as const, id: 'bus' }, channelMap: [0] } : edge),
			...(bus ? [{ id: 'bus-output', kind: 'assignment' as const, source: { kind: 'mixer-node' as const, id: 'bus' },
				destination: { kind: 'master' as const }, position: 'post-fader' as const,
				level: 1, enabled: true, channelMap: [0, 0] }] : []),
			...(mode === 'none' ? [] : [{ id: 'detector-input', kind: 'sidechain' as const,
				source: bus ? { kind: 'mixer-node' as const, id: 'bus' } : { kind: 'track' as const, id: 'detector' },
				destination: { kind: 'effect-sidechain' as const, strip: { kind: 'track' as const, id: 'programme' }, effectId: 'gate' },
				position: 'pre-fader' as const, level: 0.5, enabled: true, channelMap: [0] }])],
	});
	const output = bus ? 'bus-output' : mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'detector')!.id;
	const lane = (id: string, address: unknown) => normalizeAutomationLaneV21({ id, address,
		timebase: 'absolute-samples', points: [{ id: `${id}-point`, position: 0, value: 0.75 }], segments: [] });
	return createSoundscaperProject({ ...project, mixer, automationLanes: [
		lane('detector-gain', { kind: 'strip', strip: { kind: 'track', id: 'detector' }, parameterId: 'gain' }),
		lane('detector-output', { kind: 'edge', edgeId: output, parameterId: 'level' }),
		lane('programme-gain', { kind: 'strip', strip: { kind: 'track', id: 'programme' }, parameterId: 'gain' }),
	] });
}

for (const strategy of ['offline', 'realtime-stream', 'offline-fallback'] as const) {
	test(`${strategy} stem rendering consumes the complete isolated production graph`, async () => {
		const project = stemProject(fixture('bus'), 'programme');
		const plan = createExportPlan(project, { mode: 'stems', format: 'wav', includeTail: false });
		const output = plan.outputs.find(value => value.trackId === 'programme')!;
		const targets: Array<{ trackId?: string | null; includeMaster?: boolean; respectMuteSolo?: boolean }> = [];
		const runtime: AudioExportRenderOrchestrationRuntime = {
			encodingRuntime: { copy: { encoding: 'Encoding' }, setStatus() {},
				throwIfAborted(signal) { signal.throwIfAborted(); },
				applyMediaChannelMapping: channels => channels,
				audioBufferChannels: () => [Float32Array.of(0.1)],
				encodeWav: () => Uint8Array.of(1), encodeAiff: () => Uint8Array.of(1),
				resampleBuffer: value => value, ffmpeg: { encode: async () => ({ bytes: Uint8Array.of(1), mimeType: 'audio/wav' }) },
			}, normalizeProjectSampleRate: rate => rate,
			renderSnapshot(_snapshot, range) {
				targets.push(range);
				if (strategy === 'offline-fallback') throw new Error('Offline context unavailable');
				return { sampleRate: 48_000 };
			},
			renderRealtimeEncoded(_snapshot, _plan, _settings, _signal, _sources, target) {
				targets.push(target); return { mimeType: 'audio/wav' };
			},
		};
		await renderAndEncodeAudioExport(runtime, { snapshot: project, settings: {},
			plan: { mode: plan.mode, format: plan.format, sampleRate: plan.sampleRate, channelCount: plan.channelCount,
				channelMapping: plan.encoding.channelMapping, ditherMode: plan.encoding.dither, metadata: plan.metadata,
				encoding: { ...plan.encoding, bitDepth: plan.encoding.bitDepth ?? 16 }, mimeType: plan.encoding.mimeType,
				range: plan.range, tailFrames: plan.tailFrames, outputFrames: plan.outputFrames,
				render: { strategy: strategy === 'realtime-stream' ? strategy : 'offline' } },
			renderTarget: output, signal: new AbortController().signal,
			renderSources: { sourceMap: new Map(), chunkSources: null, prepareTimePitchCaches: false },
		});
		assert.equal(targets.length, strategy === 'offline-fallback' ? 2 : 1);
		for (const target of targets) assert.deepEqual({ trackId: target.trackId,
			includeMaster: target.includeMaster, respectMuteSolo: target.respectMuteSolo },
		{ trackId: null, includeMaster: false, respectMuteSolo: true });
	});
}

for (const mode of ['bus', 'direct', 'muted', 'none'] as const) {
	test(`${mode} track stem preserves authored detector feeds and isolates their output`, async () => {
		const project = fixture(mode);
		const before = structuredClone(project);
		const snapshot = stemProject(project, 'programme');
		const control = snapshot.tracks.find(track => track.id === 'detector')!;
		assert.equal(control.mute, mode === 'muted' || mode === 'none');
		assert.equal(control.gain, 0.25);
		assert.equal(control.pan, -0.5);
		assert.deepEqual(control.effects, project.tracks[1]!.effects);
		assert.equal(snapshot.tracks[0]!.gain, 0.5);
		assert.equal(snapshot.tracks[0]!.pan, 0.75);
		assert.equal(snapshot.tracks[2]!.mute, true);
		for (const edge of snapshot.mixer.edges) {
			const required = edge.source.kind === 'master' || edge.source.kind === 'track' && edge.source.id === 'programme'
				|| mode !== 'none' && (edge.id === 'detector-input' || (mode === 'bus' || mode === 'muted')
					&& edge.source.kind === 'track' && edge.source.id === 'detector');
			assert.equal(edge.level, required ? project.mixer.edges.find(original => original.id === edge.id)!.level : 0, edge.id);
		}
		assert.deepEqual(snapshot.automationLanes.map(lane => lane.id), ['detector-gain', 'programme-gain']);
		assert.deepEqual(snapshot.clips, project.clips);
		assert.deepEqual(snapshot.mixer.groups, project.mixer.groups);
		assert.equal(snapshot.master.gain, 1);
		assert.deepEqual(snapshot.master.effects, []);
		assert.deepEqual(structuredClone(project), before);
		const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
		try { assert.doesNotThrow(() => engine.loadProject(snapshot, new Map())); }
		finally { await engine.dispose(); }
	});
}
