/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseXmlDocument, walkXml, type XmlElement } from '../src/common/editor/dawproject-xml.ts';

const SAMPLE_RATE = 48_000;

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p', title: 'Mix one', sampleRate: SAMPLE_RATE, masterChannels: 2, primarySequenceId: 'main-sequence',
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-2', beat: { num: 8, den: 1 }, bpm: { num: 90, den: 1 } },
		] },
		signatureMap: { events: [
			{ id: 'sig-1', bar: 0, numerator: 4, denominator: 4 },
			{ id: 'sig-2', bar: 2, numerator: 3, denominator: 4 },
		] },
		metadata: { title: 'Mix one', artist: 'Someone', album: '', year: '2026', comments: '' },
		sources: [
			{ kind: 'audio', id: 'src-a', name: 'Take 1.wav', frameCount: 96_000, channelCount: 2, sampleRate: SAMPLE_RATE },
			{ kind: 'audio', id: 'src-b', name: 'Loop.wav', frameCount: 44_100, channelCount: 1, sampleRate: 44_100 },
		],
		clips: [
			{
				kind: 'audio', id: 'c1', sourceId: 'src-a', title: 'Verse', timelineStartFrame: SAMPLE_RATE,
				durationFrames: SAMPLE_RATE, sourceStartFrame: 24_000, sourceDurationFrames: SAMPLE_RATE,
				fadeInFrames: 480, fadeOutFrames: 960, gain: 1, speedRatio: 1,
			},
			{
				// 44,100 source frames at 44.1 kHz is one second, played over two: a stretch.
				kind: 'audio', id: 'c2', sourceId: 'src-b', title: 'Loop', timelineStartFrame: 0,
				durationFrames: 2 * SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: 44_100, gain: 0.5, speedRatio: 0.5,
			},
		],
		tracks: [
			{
				type: 'audio', id: 't1', name: 'Vocals', clipIds: ['c1'], gain: 0.8, pan: -0.5, mute: false, solo: false,
				effects: [], envelope: [{ frame: 0, value: 1 }, { frame: 2 * SAMPLE_RATE, value: 0.5 }],
			},
			{
				type: 'audio', id: 't2', name: 'Loops', clipIds: ['c2'], gain: 1, pan: 0, mute: true, solo: false,
				effects: [{ id: 'fx', type: 'eq', params: {} }],
			},
			{ type: 'label', id: 'l1', name: 'Sections', labels: [{ id: 'lab1', title: 'Chorus', startFrame: 2 * SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE }] },
		],
		trackFolders: [{ id: 'f1', name: 'Band' }],
		sequences: [{ id: 'main-sequence', trackNodes: [
			{ kind: 'folder', id: 'f1', parentFolderId: null },
			{ kind: 'track', id: 't1', parentFolderId: 'f1' },
			{ kind: 'track', id: 't2', parentFolderId: null },
			{ kind: 'track', id: 'l1', parentFolderId: null },
		] }],
		mixer: {
			groups: [{ id: 'f1', name: 'Band', gain: 0.9, pan: 0 }, { id: 'g1', name: 'Drums bus', gain: 1, pan: 0 }],
			sends: [{ id: 'fx1', name: 'Reverb', gain: 1, pan: 0 }],
			routes: { t1: { groupId: 'f1', sends: { fx1: 0.25 } }, t2: { groupId: 'g1', sends: {} } },
		},
		master: { gain: 1, pan: 0, mute: false, solo: false, effects: [] },
		timelineAnnotations: [
			{ id: 'm1', kind: 'marker', name: 'Drop', timelineStartFrame: SAMPLE_RATE, timelineEndFrame: SAMPLE_RATE },
			{ id: 'r1', kind: 'region', name: 'Bridge', timelineStartFrame: 3 * SAMPLE_RATE, timelineEndFrame: 4 * SAMPLE_RATE },
		],
		...overrides,
	};
}

function exported(overrides: Record<string, unknown> = {}) {
	return createDawprojectExport({ project: project(overrides), application: { name: 'Soundscaper', version: '1.2.3' } });
}

function all(root: XmlElement, name: string): XmlElement[] {
	return [...walkXml(root)].filter((element) => element.name === name);
}

function named(root: XmlElement, elementName: string, name: string): XmlElement {
	const element = all(root, elementName).find((candidate) => candidate.attributes.name === name);
	assert.ok(element, `expected a ${elementName} named ${name}`);
	return element;
}

function child(element: XmlElement, name: string): XmlElement {
	const found = element.children.find((candidate) => candidate.name === name);
	assert.ok(found, `expected a ${name} child of ${element.name}`);
	return found;
}

function codes(result: ReturnType<typeof createDawprojectExport>): string[] {
	return result.report.items.map((item) => item.code);
}

test('the document is a version 1.0 Project with application, transport, structure and arrangement in schema order', () => {
	const { document, projectXml } = exported();
	assert.equal(document.name, 'Project');
	assert.equal(document.attributes.version, '1.0');
	assert.deepEqual(document.children.map((element) => element.name), ['Application', 'Transport', 'Structure', 'Arrangement']);
	assert.equal(child(document, 'Application').attributes.name, 'Soundscaper');
	assert.equal(child(document, 'Application').attributes.version, '1.2.3');
	assert.match(projectXml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>\n<Project version="1\.0">/u);
	assert.deepEqual(parseXmlDocument(projectXml).children.map((element) => element.name), document.children.map((element) => element.name));
});

test('the transport states the root tempo and signature as parameters', () => {
	const transport = child(exported().document, 'Transport');
	const tempo = child(transport, 'Tempo');
	assert.equal(tempo.attributes.unit, 'bpm');
	assert.equal(tempo.attributes.value, '120');
	const signature = child(transport, 'TimeSignature');
	assert.equal(signature.attributes.numerator, '4');
	assert.equal(signature.attributes.denominator, '4');
});

test('the structure nests folder tracks and gives buses and the master their mixer roles', () => {
	const structure = child(exported().document, 'Structure');
	const band = named(structure, 'Track', 'Band');
	assert.equal(band.attributes.contentType, 'tracks audio');
	assert.equal(child(band, 'Channel').attributes.role, 'submix', 'a folder that owns a bus is a submix channel');
	assert.ok(band.children.some((element) => element.name === 'Track' && element.attributes.name === 'Vocals'), 'the folder holds its track');
	assert.equal(named(structure, 'Track', 'Drums bus').children[0]?.attributes.role, 'submix');
	assert.equal(named(structure, 'Track', 'Reverb').children[0]?.attributes.role, 'effect');
	const master = named(structure, 'Track', 'Master');
	assert.equal(child(master, 'Channel').attributes.role, 'master');
	assert.equal(child(master, 'Channel').attributes.audioChannels, '2');
	assert.equal(structure.children.at(-1)?.attributes.name, 'Master');
	assert.equal(all(structure, 'Track').some((track) => track.attributes.name === 'Sections'), false, 'a label track is markers, not a track');
});

test('channels carry volume, normalized pan, mute, solo, routing and sends', () => {
	const { document } = exported();
	const structure = child(document, 'Structure');
	const vocals = child(named(structure, 'Track', 'Vocals'), 'Channel');
	assert.equal(child(vocals, 'Volume').attributes.value, '0.8');
	assert.equal(child(vocals, 'Volume').attributes.unit, 'linear');
	assert.equal(child(vocals, 'Pan').attributes.value, '0.25', '-0.5 on a -1..1 pan is 0.25 of a 0..1 pan');
	assert.equal(child(vocals, 'Mute').attributes.value, 'false');
	assert.equal(vocals.attributes.destination, child(named(structure, 'Track', 'Band'), 'Channel').attributes.id);
	assert.deepEqual(vocals.children.map((element) => element.name), ['Mute', 'Pan', 'Sends', 'Volume'], 'the schema sequence');
	const send = child(child(vocals, 'Sends'), 'Send');
	assert.equal(send.attributes.destination, child(named(structure, 'Track', 'Reverb'), 'Channel').attributes.id);
	assert.equal(child(send, 'Volume').attributes.value, '0.25');
	const loops = child(named(structure, 'Track', 'Loops'), 'Channel');
	assert.equal(child(loops, 'Mute').attributes.value, 'true', 'a muted track is written muted, not left out');
	assert.equal(loops.attributes.destination, child(named(structure, 'Track', 'Drums bus'), 'Channel').attributes.id);
});

test('a clip is placed in seconds with its source offset, fades and embedded audio', () => {
	const { document, media } = exported();
	const clip = named(document, 'Clip', 'Verse');
	assert.equal(clip.attributes.time, '1');
	assert.equal(clip.attributes.duration, '1');
	assert.equal(clip.attributes.playStart, '0.5');
	assert.equal(clip.attributes.contentTimeUnit, 'seconds');
	assert.equal(clip.attributes.fadeTimeUnit, 'seconds');
	assert.equal(clip.attributes.fadeInTime, '0.01');
	assert.equal(clip.attributes.fadeOutTime, '0.02');
	const audio = child(clip, 'Audio');
	assert.equal(audio.attributes.channels, '2');
	assert.equal(audio.attributes.sampleRate, '48000');
	assert.equal(audio.attributes.duration, '2');
	assert.equal(child(audio, 'File').attributes.external, 'false');
	assert.equal(child(audio, 'File').attributes.path, 'audio/001-Take-1.wav');
	assert.deepEqual(media.map((entry) => entry.path), ['audio/001-Take-1.wav', 'audio/002-Loop.wav']);
	assert.deepEqual(media.map((entry) => entry.kind), ['audio', 'audio']);
});

test('one source embeds once however many clips play it', () => {
	const result = exported({
		clips: [
			...project().clips,
			{ kind: 'audio', id: 'c3', sourceId: 'src-a', title: 'Again', timelineStartFrame: 4 * SAMPLE_RATE, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE },
		],
		tracks: project().tracks.map((track) => (track.id === 't1' ? { ...track, clipIds: ['c1', 'c3'] } : track)),
	});
	assert.equal(result.media.length, 2);
	assert.equal(all(result.document, 'Audio').filter((audio) => child(audio, 'File').attributes.path === 'audio/001-Take-1.wav').length, 2);
});

test('a stretched clip becomes a two-point warp and says so, and its gain is reported rather than dropped silently', () => {
	const result = exported();
	const clip = named(result.document, 'Clip', 'Loop');
	assert.equal(clip.attributes.playStart, '0', 'the warp timeline starts at the clip');
	const warps = child(clip, 'Warps');
	assert.equal(warps.attributes.contentTimeUnit, 'seconds');
	assert.deepEqual(warps.children.map((element) => element.name), ['Audio', 'Warp', 'Warp']);
	assert.deepEqual(warps.children.slice(1).map((warp) => [warp.attributes.time, warp.attributes.contentTime]), [['0', '0'], ['2', '1']]);
	assert.ok(codes(result).includes('dawproject.speed-change-converted'));
	const features = result.report.items.find((item) => item.code === 'dawproject.clip-features-omitted');
	assert.deepEqual(features?.data.features, ['gain']);
	assert.deepEqual(features?.scope, { kind: 'clip', id: 'c2' });
});

test('a forward warp map is written point for point', () => {
	const result = exported({
		clips: [{
			kind: 'audio', id: 'c1', sourceId: 'src-a', title: 'Warped', timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
			sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
			warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' },
				{ outer: 24_000, source: { num: 12_000, den: 1 }, mode: 'forward' },
				{ outer: SAMPLE_RATE, source: SAMPLE_RATE, mode: 'forward' },
			] },
		}],
	});
	const warps = child(named(result.document, 'Clip', 'Warped'), 'Warps');
	assert.deepEqual(warps.children.slice(1).map((warp) => [warp.attributes.time, warp.attributes.contentTime]), [['0', '0'], ['0.5', '0.25'], ['1', '1']]);
	assert.ok(codes(result).includes('dawproject.audio-warp-converted'));
});

test('the volume envelope becomes Points on the channel volume parameter', () => {
	const { document } = exported();
	const vocalsTrackId = named(child(document, 'Structure'), 'Track', 'Vocals').attributes.id;
	const lanes = all(document, 'Lanes').find((element) => element.attributes.track === vocalsTrackId);
	assert.ok(lanes, 'the track has lanes');
	const points = child(lanes, 'Points');
	assert.equal(points.attributes.unit, 'linear');
	const volumeId = child(child(named(child(document, 'Structure'), 'Track', 'Vocals'), 'Channel'), 'Volume').attributes.id;
	assert.equal(child(points, 'Target').attributes.parameter, volumeId);
	assert.deepEqual(points.children.slice(1).map((point) => [point.attributes.time, point.attributes.value, point.attributes.interpolation]), [['0', '1', 'linear'], ['2', '0.5', 'hold']]);
});

test('V21 lanes take precedence and target pan in normalized units; lanes with no channel parameter are reported', () => {
	const result = exported({
		automationLanes: [
			{ id: 'lane-pan', address: { kind: 'strip', strip: { kind: 'track', id: 't1' }, parameterId: 'pan' }, timebase: 'absolute-samples', points: [{ id: 'p1', position: 0, value: -1 }, { id: 'p2', position: SAMPLE_RATE, value: 1 }], segments: [{ kind: 'hold' }] },
			{ id: 'lane-fx', address: { kind: 'effect', strip: { kind: 'track', id: 't1' }, effectId: 'fx', parameterId: 'gain' }, timebase: 'absolute-samples', points: [{ id: 'p1', position: 0, value: 1 }], segments: [] },
		],
	});
	const pan = all(result.document, 'Points').find((points) => points.attributes.unit === 'normalized');
	assert.ok(pan, 'the pan lane is written');
	assert.deepEqual(pan.children.slice(1).map((point) => [point.attributes.value, point.attributes.interpolation]), [['0', 'hold'], ['1', 'hold']]);
	const omitted = result.report.items.find((item) => item.code === 'dawproject.automation-omitted');
	assert.deepEqual(omitted?.scope, { kind: 'automation-lane', id: 'lane-fx' });
});

test('markers, labels and regions become arrangement markers in time order, with extents reported', () => {
	const result = exported();
	const markers = child(child(result.document, 'Arrangement'), 'Markers');
	assert.equal(markers.attributes.timeUnit, 'seconds');
	assert.deepEqual(markers.children.map((marker) => [marker.attributes.time, marker.attributes.name]), [['1', 'Drop'], ['2', 'Chorus'], ['3', 'Bridge']]);
	assert.equal(markers.children[1]?.attributes.comment, 'Sections', 'the label track name rides the marker comment');
	assert.ok(codes(result).includes('dawproject.region-extents-converted'));
	const labels = result.report.items.find((item) => item.code === 'dawproject.label-track-converted');
	assert.deepEqual(labels?.data, { labels: 1, regions: 1 });
});

test('tempo and signature maps are written as beat-positioned automation of the transport parameters', () => {
	const { document } = exported();
	const arrangement = child(document, 'Arrangement');
	assert.deepEqual(arrangement.children.map((element) => element.name), ['Lanes', 'Markers', 'TempoAutomation', 'TimeSignatureAutomation']);
	const tempo = child(arrangement, 'TempoAutomation');
	assert.equal(tempo.attributes.timeUnit, 'beats');
	assert.equal(tempo.attributes.unit, 'bpm');
	assert.equal(child(tempo, 'Target').attributes.parameter, child(child(document, 'Transport'), 'Tempo').attributes.id);
	assert.deepEqual(tempo.children.slice(1).map((point) => [point.attributes.time, point.attributes.value, point.attributes.interpolation]), [['0', '120', 'hold'], ['8', '90', 'hold']]);
	const signature = child(arrangement, 'TimeSignatureAutomation');
	assert.deepEqual(signature.children.slice(1).map((point) => [point.attributes.time, point.attributes.numerator, point.attributes.denominator]), [['0', '4', '4'], ['8', '3', '4']]);
});

test('a project with one tempo and one signature writes no automation for them', () => {
	const { document } = exported({
		tempoMap: { mode: 'musical', events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 100, den: 1 } }] },
		signatureMap: { events: [{ id: 'sig-1', bar: 0, numerator: 6, denominator: 8 }] },
	});
	assert.deepEqual(child(document, 'Arrangement').children.map((element) => element.name), ['Lanes', 'Markers']);
	assert.equal(child(child(document, 'Transport'), 'Tempo').attributes.value, '100');
	assert.equal(child(child(document, 'Transport'), 'TimeSignature').attributes.numerator, '6');
});

test('every id is unique and every reference resolves', () => {
	const { document } = exported({ automationLanes: [
		{ id: 'lane-mute', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'mute' }, timebase: 'absolute-samples', points: [{ id: 'p1', position: 0, value: 1 }], segments: [] },
	] });
	const ids = new Set<string>();
	for (const element of walkXml(document)) {
		const id = element.attributes.id;
		if (id === undefined) continue;
		assert.equal(ids.has(id), false, `duplicate id ${id}`);
		ids.add(id);
	}
	for (const element of walkXml(document)) {
		for (const reference of ['destination', 'track', 'parameter', 'reference'] as const) {
			const value = element.attributes[reference];
			if (value !== undefined) assert.ok(ids.has(value), `<${element.name} ${reference}="${value}"> resolves`);
		}
	}
});

test('the report is sealed, names the format, and itemizes effects and other omissions', () => {
	const result = exported();
	assert.equal(Object.hasOwn(result.report, 'draft'), false);
	assert.equal(result.report.subject.format, 'dawproject');
	assert.equal(result.report.subject.lossless, true);
	const effects = result.report.items.find((item) => item.code === 'dawproject.effects-omitted');
	assert.deepEqual(effects?.scope, { kind: 'track', id: 't2' });
	assert.equal(codes(result).includes('dawproject.track-silent-omitted'), false, 'a project exchange keeps muted tracks');
	assert.ok(codes(result).includes('dawproject.tempo-map-preserved'));
	assert.ok(codes(result).includes('dawproject.project-preserved'));
	assert.equal(result.fileName, 'Mix-one.dawproject');
	assert.equal(result.mimeType, 'application/zip');
});

test('metadata.xml carries the project metadata that is present and nothing empty', () => {
	const { metadataDocument, metadataXml } = exported();
	assert.equal(metadataDocument.name, 'MetaData');
	assert.deepEqual(metadataDocument.children.map((element) => [element.name, element.text]), [['Title', 'Mix one'], ['Artist', 'Someone'], ['Year', '2026']]);
	assert.match(metadataXml, /<Title>Mix one<\/Title>/u);
});

test('a clip whose source is missing is reported and left out rather than written dangling', () => {
	const result = exported({ clips: [{ kind: 'audio', id: 'c1', sourceId: 'gone', title: 'Lost', timelineStartFrame: 0, durationFrames: 10 }] });
	assert.equal(all(result.document, 'Clip').length, 0);
	const missing = result.report.items.find((item) => item.code === 'dawproject.media-reference-missing');
	assert.equal(missing?.disposition, 'missing');
	assert.equal(missing?.severity, 'error');
});

test('video clips embed when the caller can supply the container and are reported otherwise', () => {
	const videoProject = {
		sources: [{ kind: 'video', id: 'cam', name: 'cam.mp4', mimeType: 'video/mp4', sampleFrameCount: 2 * SAMPLE_RATE, sampleRate: SAMPLE_RATE, hasAudio: true }],
		clips: [{ kind: 'video', id: 'v1', sourceId: 'cam', title: 'Wide', timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: SAMPLE_RATE, speedRatio: 1 }],
		tracks: [{ type: 'video', id: 'vt', name: 'V1', clipIds: ['v1'], hidden: false }],
		trackFolders: [], sequences: [], mixer: { groups: [], sends: [], routes: {} }, timelineAnnotations: [],
	};
	const omitted = createDawprojectExport({ project: project(videoProject) });
	assert.equal(all(omitted.document, 'Clip').length, 0);
	assert.ok(codes(omitted).includes('dawproject.video-media-omitted'));
	const embedded = createDawprojectExport({ project: project(videoProject), embeddableVideoSourceIds: ['cam'] });
	const clip = named(embedded.document, 'Clip', 'Wide');
	assert.equal(clip.attributes.playStart, '1');
	const video = child(clip, 'Video');
	assert.equal(video.attributes.duration, '2');
	assert.equal(video.attributes.channels, '2');
	assert.deepEqual(embedded.media, [{ path: 'video/001-cam.mp4', sourceId: 'cam', kind: 'video' }]);
	assert.equal(named(child(embedded.document, 'Structure'), 'Track', 'V1').attributes.contentType, 'video');
});

test('a project without hierarchy or mixer still exports flat tracks routed to the master', () => {
	const { document } = createDawprojectExport({ project: {
		id: 'p', title: 'Flat', sampleRate: SAMPLE_RATE,
		sources: [{ kind: 'audio', id: 's', name: 'a.wav', frameCount: 10, channelCount: 1, sampleRate: SAMPLE_RATE }],
		clips: [{ kind: 'audio', id: 'c', sourceId: 's', title: 'A', timelineStartFrame: 0, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10 }],
		tracks: [{ type: 'audio', id: 't', name: 'T', clipIds: ['c'] }],
	} });
	const structure = child(document, 'Structure');
	assert.deepEqual(structure.children.map((track) => track.attributes.name), ['T', 'Master']);
	assert.equal(child(named(structure, 'Track', 'T'), 'Channel').attributes.destination, child(named(structure, 'Track', 'Master'), 'Channel').attributes.id);
	assert.equal(child(child(document, 'Transport'), 'Tempo').attributes.value, '120');
});

test('a project is required and the sample rate must be positive', () => {
	assert.throws(() => createDawprojectExport({ project: null as never }), TypeError);
	assert.throws(() => createDawprojectExport({ project: { title: 'x' } }), RangeError);
});
