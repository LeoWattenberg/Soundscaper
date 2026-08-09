/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClipV10,
	createAudioEditorProjectV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createLabelTrackV10,
	createLabelV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
	loadAudioEditorProjectV10,
	validateAudioEditorProjectV10,
} from '../src/common/editor/project-v10.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { sampleFrameToBeat } from '../src/common/editor/timeline-tempo-inverse.ts';

const NOW = '2026-08-09T12:00:00.000Z';

test('foundation projects close sequence, tempo, signature, and sample-rate wire contracts', () => {
	const project = createAudioEditorProjectV10({ id: 'foundation', now: NOW });
	assert.equal(project.schemaVersion, 10);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.primarySequenceId, 'main-sequence');
	assert.deepEqual(project.sequences, [{
		id: 'main-sequence', name: 'Main sequence', rate: { num: 30, den: 1 },
		dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		trackIds: [],
	}]);
	assert.deepEqual(project.tempoMap, {
		mode: 'musical',
		events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	});
	assert.deepEqual(project.signatureMap, {
		events: [{ id: 'signature-1', bar: 0, numerator: 4, denominator: 4 }],
	});
	assert.throws(() => createAudioEditorProjectV10({
		now: NOW,
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 1, den: 2 } },
		] },
	}), /root tempo event.*1 BPM/iu);
	assert.equal(validateAudioEditorProjectV10(project), true);
	assert.throws(() => createAudioEditorProjectV10({ now: NOW, sampleRate: 7_999 }), /sampleRate/iu);
	assert.throws(() => validateAudioEditorProjectV10(createAudioEditorProjectV10({
		now: NOW,
		sequences: [{ id: 'main', rate: { num: 24, den: 1 }, dropFrame: true }],
		primarySequenceId: 'main',
	})), /drop.frame/iu);
});

test('legacy tempo is an exact derived projection of authoritative musical maps', () => {
	const project = createAudioEditorProjectV10({
		now: NOW,
		tempo: { bpm: 111, timeSignature: { numerator: 3, denominator: 4 }, detected: true },
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-main', beat: { num: 0, den: 1 }, bpm: { num: 275, den: 2 } }],
		},
		signatureMap: {
			events: [{ id: 'signature-main', bar: 0, numerator: 7, denominator: 8 }],
		},
	});
	assert.deepEqual(project.tempo, {
		bpm: 137.5,
		timeSignature: { numerator: 7, denominator: 8 },
		detected: true,
	});
	assert.equal(validateAudioEditorProjectV10(project), true);
	assert.throws(
		() => validateAudioEditorProjectV10({
			...project,
			tempo: { ...project.tempo as Record<string, unknown>, bpm: 111 },
		}),
		/legacy tempo.*authoritative tempo map/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV10({
			...project,
			tempo: {
				...project.tempo as Record<string, unknown>,
				timeSignature: { numerator: 3, denominator: 4 },
			},
		}),
		/legacy signature.*authoritative signature map/iu,
	);
});

test('foundation tempo maps reject hidden ramp semantics at factory and validation boundaries', () => {
	assert.throws(() => createAudioEditorProjectV10({
		now: NOW,
		tempoMap: {
			mode: 'musical',
			interpolation: 'ramp',
			events: [{
				id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, curve: 'linear',
			}],
		},
	} as never), /tempoMap.*unsupported field|tempo event.*unsupported field/iu);
	const project = createAudioEditorProjectV10({ now: NOW });
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		tempoMap: { ...project.tempoMap, interpolation: 'ramp' },
	}), /tempoMap.*unsupported field.*interpolation/iu);
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		tempoMap: {
			...project.tempoMap,
			events: project.tempoMap.events.map((event) => ({ ...event, curve: 'linear' })),
		},
	}), /tempoMap event.*unsupported field.*curve/iu);
});

test('tempo maps admit only exact sample-inverse rationals inside the safe wire domain', () => {
	const tempoMap = {
		mode: 'musical' as const,
		events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{
				id: 'tempo-2', beat: { num: 1, den: 999_983 },
				bpm: { num: 120_000_001, den: 1_000_000 },
			},
		],
	};
	assert.throws(() => sampleFrameToBeat(1, tempoMap, 48_000), /safe integer domain/iu);
	assert.throws(() => createAudioEditorProjectV10({ now: NOW, tempoMap }), /inverse|reconcil|safe rational/iu);
	const baseline = createAudioEditorProjectV10({ now: NOW });
	assert.throws(() => validateAudioEditorProjectV10({ ...baseline, tempoMap }), /inverse|reconcil|safe rational/iu);
});

test('video source and clip factories retain exact source and sequence authority', () => {
	const source = createVideoSourceV10({
		id: 'video-source', frameCount: 44_100, sampleRate: 44_100,
		width: 1_920, height: 1_080, frameRate: 24,
		sourceFrameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
		videoCodec: 'h264', timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const clip = createVideoClipV10({
		id: 'video-clip', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 1, sequenceFrameCount: 1,
		sourceInFrame: 0, sourceFrameCount: 1,
	}, {
		projectSampleRate: 44_100,
		sequence: { id: 'main', rate: { num: 24, den: 1 } },
		source,
	});
	assert.equal(source.sampleFrameCount, 44_100);
	assert.deepEqual(source.frameRate, { num: 24, den: 1 });
	assert.equal(Object.hasOwn(source, 'frameCount'), false);
	assert.equal(Object.hasOwn(clip, 'timelineStartFrame'), false);
	assert.equal(clip.sequenceStartFrame, 1);
	assert.equal(clip.sequenceFrameCount, 1);
	assert.equal(clip.sourceInFrame, 0);
	const resolved = resolveRuntimeClipProjection({
		schemaVersion: 10, sampleRate: 44_100, primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 24, den: 1 } }],
	}, clip);
	assert.deepEqual([resolved.timelineStartFrame, resolved.durationFrames], [1_838, 1_837]);
});

test('exact video timing decisions require their immutable timing sidecar', () => {
	const sourceOptions = {
		id: 'video-source', frameCount: 48_000, sampleRate: 48_000,
		width: 16, height: 16, frameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
		timingDecision: { mode: 'exact', rate: { num: 24, den: 1 } },
	};
	assert.throws(() => createVideoSourceV10(sourceOptions), /exact.*timing asset|timing asset.*exact/iu);
	const source = createVideoSourceV10({
		...sourceOptions,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const project = createAudioEditorProjectV10({ now: NOW, sources: [source] });
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		sources: project.sources.map((value) => value.id === source.id
			? { ...value, timingDecision: sourceOptions.timingDecision }
			: value),
	}), /exact.*timing asset|timing asset.*exact/iu);
});

test('musical audio authority and foundation breakpoint maps survive load and edit normalization', () => {
	const source = createAudioSourceV10({ id: 'source', frameCount: 96_000, channelCount: 1 });
	const clip = createAudioClipV10({
		id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000,
		anchor: 'musical', musicalStartBeat: { num: 3, den: 1 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 },
		warpMap: {
			feature: 'audio-warp',
			points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 2, source: 48_000, mode: 'forward' },
			],
		},
	});
	const track = createAudioTrackV10({ id: 'track', clipIds: [clip.id] });
	const project = createAudioEditorProjectV10({ now: NOW, sources: [source], clips: [clip], tracks: [track] });
	const resolved = resolveRuntimeClipProjection(project, project.clips[0]);
	assert.deepEqual([resolved.timelineStartFrame, resolved.timelineEndFrame], [72_000, 120_000]);
	const serialized = JSON.stringify(project);
	const loaded = loadAudioEditorProjectV10(JSON.parse(serialized));
	assert.equal(loaded.readOnly, false);
	assert.equal(JSON.stringify(loaded.project), serialized, 'load/save without edits is byte-identical');
	const updated = applyEditorCommand(project, { type: 'clip/update', clipId: 'clip', changes: { title: 'Renamed' } }, { now: NOW });
	const reloadResult = loadAudioEditorProjectV10(JSON.parse(JSON.stringify(updated)));
	assert.equal(reloadResult.readOnly, false);
	const reloaded = reloadResult.project as typeof project;
	assert.deepEqual(reloaded.clips[0].musicalStartBeat, { num: 3, den: 1 });
	assert.deepEqual(reloaded.clips[0].warpMap, clip.warpMap);
});

test('derived A/V equality and frame-grid caches are validator invariants', () => {
	const videoSource = createVideoSourceV10({
		id: 'video-source', frameCount: 44_100, sampleRate: 44_100, width: 16, height: 16,
		frameRate: 24, sourceFrameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
	});
	const audioSource = createAudioSourceV10({ id: 'audio-source', frameCount: 44_100, sampleRate: 44_100, channelCount: 1 });
	const video = createVideoClipV10({
		id: 'video', sourceId: videoSource.id, sequenceId: 'main', sequenceStartFrame: 1,
		sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, avLinkId: 'link',
	}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: { num: 24, den: 1 } }, source: videoSource });
	const audio = createAudioClipV10({
		id: 'audio', sourceId: audioSource.id, timelineStartFrame: 1_838,
		durationFrames: 1_837, sourceDurationFrames: 1_837, avLinkId: 'link',
	});
	const project = createAudioEditorProjectV10({
		now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: { num: 24, den: 1 } }], primarySequenceId: 'main',
		sources: [videoSource, audioSource], clips: [video, audio],
		tracks: [
			createVideoTrackV10({ id: 'video-track', laneGroupId: 'lane', clipIds: ['video'] }),
			createAudioTrackV10({ id: 'audio-track', laneGroupId: 'lane', clipIds: ['audio'] }),
		],
	});
	assert.equal(validateAudioEditorProjectV10(project), true);
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		clips: project.clips.map((candidate) => candidate.id === 'video'
			? { ...candidate, timelineStartFrame: 1_839 }
			: candidate),
	}), /derived|cache/iu);
});

test('A/V links reject musical audio authority that cannot remain frame-locked to video', () => {
	const sampleRate = 48_000;
	const sequence = { id: 'main', rate: { num: 24, den: 1 } };
	const videoSource = createVideoSourceV10({
		id: 'video-source', frameCount: sampleRate, sampleRate, width: 16, height: 16,
		frameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const audioSource = createAudioSourceV10({ id: 'audio-source', frameCount: sampleRate, sampleRate, channelCount: 1 });
	const video = createVideoClipV10({
		id: 'video', sourceId: videoSource.id, sequenceId: sequence.id,
		sequenceStartFrame: 1, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1,
		avLinkId: 'link',
	}, { projectSampleRate: sampleRate, sequence, source: videoSource });
	const audio = createAudioClipV10({
		id: 'audio', sourceId: audioSource.id, anchor: 'musical', musicalStartBeat: { num: 1, den: 12 },
		musicalExtent: 'fixedSamples', durationFrames: 2_000, sourceDurationFrames: 2_000, avLinkId: 'link',
	}, { projectSampleRate: sampleRate, tempoMap: {
		mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	} });
	const project = createAudioEditorProjectV10({
		id: 'linked-musical', now: NOW, sampleRate,
		sequences: [sequence], primarySequenceId: sequence.id,
		sources: [videoSource, audioSource], clips: [video, audio],
		tracks: [
			createVideoTrackV10({ id: 'video-track', laneGroupId: 'lane', clipIds: [video.id] }),
			createAudioTrackV10({ id: 'audio-track', laneGroupId: 'lane', clipIds: [audio.id] }),
		],
	});
	assert.throws(() => validateAudioEditorProjectV10(project), /A\/V link.*sample anchor|musical.*A\/V link/iu);
});

test('paired Project Bin media rejects beat-extent audio that cannot retain video duration', () => {
	const sampleRate = 48_000;
	const sequence = { id: 'main', rate: { num: 24, den: 1 } };
	const videoSource = createVideoSourceV10({
		id: 'bin-video-source', frameCount: sampleRate, sampleRate, width: 16, height: 16,
		frameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
	});
	const audioSource = createAudioSourceV10({ id: 'bin-audio-source', frameCount: sampleRate, sampleRate, channelCount: 1 });
	const video = createVideoClipV10({
		id: 'bin-video', sourceId: videoSource.id, sequenceId: sequence.id,
		sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1,
	}, { projectSampleRate: sampleRate, sequence, source: videoSource });
	const audio = createAudioClipV10({
		id: 'bin-audio', sourceId: audioSource.id, anchor: 'musical', musicalStartBeat: { num: 0, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 12 }, sourceDurationFrames: 2_000,
	}, { projectSampleRate: sampleRate, tempoMap: {
		mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	} });
	const project = createAudioEditorProjectV10({
		id: 'paired-bin-musical', now: NOW, sampleRate,
		sequences: [sequence], primarySequenceId: sequence.id,
		sources: [videoSource, audioSource],
		projectBin: { clips: [
			{ ...video, binItemId: 'item' },
			{ ...audio, binItemId: 'item' },
		] },
	});
	assert.throws(() => validateAudioEditorProjectV10(project), /Project Bin item.*fixed-sample|beat-extent.*Project Bin/iu);
});

test('sample-locked tempo anchors must form one continuous positive runtime map', () => {
	const project = createAudioEditorProjectV10({
		now: NOW,
		tempoMap: {
			mode: 'sampleLocked',
			events: [
				{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 },
				{ id: 'tempo-2', beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 96_000 },
			],
		},
	});
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		tempoMap: {
			mode: 'sampleLocked',
			events: [
				{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 },
				{ id: 'tempo-2', beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 100 },
			],
		},
	}), /continuous|sample.*position|exact sample authority/iu);
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		tempoMap: {
			...project.tempoMap,
			events: project.tempoMap.events.map((event, index) => (
				index === 0 ? { ...event, samplePosition: 1 } : event
			)),
		},
	}), /first.*sample|sample zero/iu);
	const nonCanonicalBeat = {
		mode: 'sampleLocked' as const,
		events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 },
			{ id: 'tempo-2', beat: { num: 1, den: 48_000 }, bpm: { num: 90, den: 1 }, samplePosition: 1 },
		],
	};
	assert.throws(
		() => createAudioEditorProjectV10({ now: NOW, sampleRate: 48_000, tempoMap: nonCanonicalBeat }),
		/exact.*beat|derived.*beat|sample.*authority/iu,
	);
	assert.throws(
		() => validateAudioEditorProjectV10({ ...project, tempoMap: nonCanonicalBeat }),
		/exact.*beat|derived.*beat|sample.*authority/iu,
	);

	const source = createAudioSourceV10({ id: 'source', frameCount: 1_000, channelCount: 1 });
	const clip = createAudioClipV10({
		id: 'clip', sourceId: source.id, anchor: 'musical', musicalStartBeat: { num: 0, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 1 }, durationFrames: 24_000,
		sourceDurationFrames: 1,
	});
	const track = createAudioTrackV10({ id: 'track', clipIds: [clip.id] });
	const musical = createAudioEditorProjectV10({ now: NOW, sources: [source], clips: [clip], tracks: [track] });
	assert.throws(() => validateAudioEditorProjectV10({
		...musical,
		tempo: { ...musical.tempo as Record<string, unknown>, bpm: 1_000 },
		clips: musical.clips.map((value) => value.id === clip.id ? {
			...value,
			musicalDurationBeats: { num: 1, den: 1_000_000 },
		} : value),
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 1_000, den: 1 } }],
		},
	}), /positive.*runtime|positive.*range/iu);

	const label = createLabelV10({
		id: 'label', title: 'Region', color: '#ffffff', anchor: 'musical',
		startBeat: { num: 0, den: 1 }, endBeat: { num: 1, den: 1_000_000 },
	});
	const labelTrack = createLabelTrackV10({ id: 'label-track', labels: [label] });
	const labelProject = createAudioEditorProjectV10({
		now: NOW,
		tracks: [labelTrack],
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 1_000, den: 1 } }],
		},
	});
	assert.throws(() => validateAudioEditorProjectV10(labelProject), /positive.*runtime|positive.*range/iu);
});

test('foundation graph binds clips to same-kind sources and their owning sequence', () => {
	const audioSource = createAudioSourceV10({ id: 'audio-source', frameCount: 48_000, channelCount: 1 });
	const videoSource = createVideoSourceV10({
		id: 'video-source', frameCount: 48_000, sampleRate: 48_000, width: 16, height: 16,
		frameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
	});
	const audioClip = createAudioClipV10({
		id: 'audio-clip', sourceId: audioSource.id, durationFrames: 100, sourceDurationFrames: 100,
	});
	const audioTrack = createAudioTrackV10({ id: 'audio-track', clipIds: [audioClip.id] });
	const audioProject = createAudioEditorProjectV10({
		now: NOW, sources: [audioSource, videoSource], clips: [audioClip], tracks: [audioTrack],
	});
	assert.throws(() => validateAudioEditorProjectV10({
		...audioProject,
		clips: audioProject.clips.map((value) => value.id === audioClip.id
			? { ...value, sourceId: videoSource.id }
			: value),
	}), /source kind|different source kind/iu);

	const videoClip = createVideoClipV10({
		id: 'video-clip', sourceId: videoSource.id, sequenceId: 'main', sequenceStartFrame: 0,
		sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1,
	}, { projectSampleRate: 48_000, sequence: { id: 'main', rate: { num: 24, den: 1 } }, source: videoSource });
	const videoTrack = createVideoTrackV10({ id: 'video-track', clipIds: [videoClip.id] });
	const sequenceProject = createAudioEditorProjectV10({
		now: NOW,
		sources: [videoSource], clips: [videoClip], tracks: [videoTrack],
		sequences: [
			{ id: 'main', rate: { num: 24, den: 1 }, trackIds: [] },
			{ id: 'secondary', rate: { num: 30, den: 1 }, trackIds: [videoTrack.id] },
		],
		primarySequenceId: 'main',
	});
	assert.throws(() => validateAudioEditorProjectV10(sequenceProject), /owning sequence|track sequence/iu);
});

test('foundation rates, timing decisions, signatures, and breakpoints are canonical and bounded', () => {
	const project = createAudioEditorProjectV10({
		now: NOW,
		sampleRate: 8_000,
		sequences: [{ id: 'main-sequence', rate: { num: 24, den: 1 } }],
	});
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		sequences: project.sequences.map((sequence) => ({ ...sequence, rate: { num: 20_000, den: 1 } })),
	}), /rate.*sample|rate.*bound/iu);
	assert.throws(() => validateAudioEditorProjectV10({
		...project,
		signatureMap: { events: [{ id: 'signature-1', bar: 0, numerator: 4, denominator: 2 ** 32 + 1 }] },
	}), /denominator|power.of.two/iu);

	const source = createVideoSourceV10({
		id: 'video-source', frameCount: 8_000, sampleRate: 8_000, width: 16, height: 16,
		frameRate: { num: 24, den: 1 }, sourceFrameCount: 24,
	});
	const sourceProject = createAudioEditorProjectV10({ now: NOW, sampleRate: 8_000, sources: [source] });
	assert.throws(() => validateAudioEditorProjectV10({
		...sourceProject,
		sources: sourceProject.sources.map((value) => value.id === source.id ? {
			...value,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 25, den: 1 } },
		} : value),
	}), /timing.*rate|frame.*rate/iu);
	assert.throws(() => validateAudioEditorProjectV10({
		...sourceProject,
		sources: sourceProject.sources.map((value) => value.id === source.id ? {
			...value,
			frameRate: { num: 16_000, den: 1 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 16_000, den: 1 } },
		} : value),
	}), /rate.*sample|rate.*bound/iu);
	assert.throws(() => validateAudioEditorProjectV10({
		...sourceProject,
		sources: sourceProject.sources.map((value) => value.id === source.id ? {
			...value,
			frameRate: { num: 48, den: 2 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 48, den: 2 } },
		} : value),
	}), /canonical|reduced/iu);

	const audioSource = createAudioSourceV10({ id: 'audio', frameCount: 48_000, channelCount: 1 });
	const audioClip = createAudioClipV10({
		id: 'clip', sourceId: audioSource.id, durationFrames: 100, sourceDurationFrames: 100,
		warpMap: {
			feature: 'audio-warp',
			points: [
				{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
				{ outer: { num: 1, den: 1 }, source: { num: 1, den: 1 }, mode: 'forward' },
			],
		},
	});
	const audioTrack = createAudioTrackV10({ id: 'track', clipIds: [audioClip.id] });
	const breakpointProject = createAudioEditorProjectV10({
		now: NOW, sources: [audioSource], clips: [audioClip], tracks: [audioTrack],
	});
	assert.throws(() => validateAudioEditorProjectV10({
		...breakpointProject,
		clips: breakpointProject.clips.map((value) => value.id === audioClip.id ? {
			...value,
			warpMap: {
				feature: 'audio-warp',
				points: [
					{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
					{ outer: { num: 2, den: 2 }, source: { num: 1, den: 1 }, mode: 'forward' },
				],
			},
		} : value),
	}), /canonical|reduced/iu);
	assert.equal(validateAudioEditorProjectV10({
		...breakpointProject,
		clips: breakpointProject.clips.map((value) => value.id === audioClip.id ? {
			...value,
			warpMap: {
				feature: 'audio-warp',
				points: [
					{ outer: { num: -1, den: 1 }, source: { num: -1, den: 1 }, mode: 'forward' },
					{ outer: { num: 1, den: 1 }, source: { num: 1, den: 1 }, mode: 'forward' },
				],
			},
		} : value),
	}), true, 'canonical rational breakpoints retain the signed domain accepted by numeric coordinates');
});
