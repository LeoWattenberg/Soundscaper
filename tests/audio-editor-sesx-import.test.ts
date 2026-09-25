/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseSesxDocument, sesxAudioReferences } from '../src/common/editor/sesx-import.ts';
import { buildSesxProject } from '../src/common/editor/sesx-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const SESX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE sesx>
<sesx version="1.9"><session appVersion="22.2" audioChannelType="stereo" sampleRate="48000">
<tracks>
<audioTrack id="10001" index="1"><trackParameters><name>Lead</name></trackParameters>
<trackAudioParameters audioChannelType="stereo" solo="true">
<trackOutput outputID="10000" type="trackID"/>
<component id="trackFader" componentID="Audition.Fader"><parameter name="volume" parameterValue="0.5"/><parameter name="static gain" parameterValue="0.8"/></component>
<component id="trackMute" componentID="Audition.Mute"><parameter name="mute" parameterValue="0"/></component>
<component id="trackPan" componentID="Audition.StereoPanner"><parameter name="Pan" parameterValue="0.25"/></component>
<component id="trackEQ" componentID="Audition.EQ" powered="true"/>
</trackAudioParameters>
<audioClip id="0" fileID="0" name="Intro" startPoint="24000" endPoint="48000" sourceInPoint="12000" sourceOutPoint="36000" looped="false">
<component id="clipGain" componentID="Audition.Fader"><parameter name="static gain" parameterValue="0.75"/></component>
<fadeIn startPoint="12000" endPoint="14400" type="linear"/><fadeOut startPoint="33600" endPoint="36000" type="log" shape="19"/>
</audioClip></audioTrack>
<audioTrack id="10002" index="2"><trackParameters><name>Double</name></trackParameters>
<trackAudioParameters audioChannelType="stereo" solo="false"/>
<audioClip id="0" fileID="0" name="Again" startPoint="48000" endPoint="72000" sourceInPoint="12000" sourceOutPoint="36000" looped="false"/>
</audioTrack>
<masterTrack id="10000"><trackAudioParameters audioChannelType="stereo"><component id="trackFader"><parameter name="volume" parameterValue="0.9"/></component></trackAudioParameters></masterTrack>
</tracks><markers><marker name="Cue"/></markers></session>
<files><file id="0" relativePath="Imported Files/voice.wav" absolutePath="/old/path/voice.wav"/></files></sesx>`;

function ids() {
	const counts = new Map<string, number>();
	return (prefix: string) => {
		const next = (counts.get(prefix) ?? 0) + 1;
		counts.set(prefix, next);
		return `${prefix}-${String(next)}`;
	};
}

function build(xml = SESX, media = new Map<string, { frameCount: number; channelCount: number; sampleRate: number } | null>([
	['0', { frameCount: 100_000, channelCount: 2, sampleRate: 48_000 }],
])) {
	return buildSesxProject(parseSesxDocument(xml), {
		fileName: 'Session.sesx', media, createStableId: ids(),
		stagedSourceIds: new Map([['0', 'staged-source']]),
	});
}

test('the real SESX file-table shape resolves paths and gives one reference per ID', () => {
	const document = parseSesxDocument(SESX);
	assert.equal(document.version, '1.9');
	assert.equal(document.sampleRate, 48_000);
	assert.equal(document.tracks.length, 2);
	assert.deepEqual(document.tracks.map((track) => track.name), ['Lead', 'Double']);
	assert.deepEqual(sesxAudioReferences(document), [{
		id: '0', relativePath: 'Imported Files/voice.wav', absolutePath: '/old/path/voice.wav', name: 'voice.wav',
	}]);
});

test('an attributed Audition 22.2 session parses with its original BOM and doctype', () => {
	const xml = readFileSync(new URL('./fixtures/sesx/audition-22.2-metronome.sesx', import.meta.url), 'utf8');
	const document = parseSesxDocument(xml);
	assert.equal(document.sampleRate, 48_000);
	assert.equal(document.channelCount, 1);
	assert.equal(document.tracks.length, 2);
	assert.equal(document.tracks.flatMap((track) => track.clips).length, 3);
	assert.equal(sesxAudioReferences(document).length, 3);
	assert.equal(document.tracks[0]?.clips[0]?.id, document.tracks[1]?.clips[0]?.id);
	const plan = buildSesxProject(document, {
		fileName: 'Metronome.sesx',
		media: new Map(sesxAudioReferences(document).map((ref) => [ref.id, {
			frameCount: 96_000, channelCount: 1, sampleRate: 48_000,
		}])),
		createStableId: ids(),
	});
	assert.equal((plan.project.clips as unknown[]).length, 3);
	assert.equal(plan.report.items.some((item) => item.code === 'sesx.crossfade-omitted'), false);
	createCurrentAudioEditorProject(plan.project);
});

test('sample positions, source trims, fades, static controls and repeated Audition clip IDs import', () => {
	const plan = build();
	assert.equal(plan.title, 'Session');
	assert.equal(plan.sampleRate, 48_000);
	assert.deepEqual(plan.media, [{ fileId: '0', sourceId: 'staged-source' }]);
	const tracks = plan.project.tracks as Array<Record<string, unknown>>;
	assert.deepEqual(tracks.map((track) => [track.name, track.gain, track.pan, track.mute, track.solo]), [
		['Lead', 0.4, 0.25, false, true], ['Double', 1, 0, false, false],
	]);
	const clips = plan.project.clips as Array<Record<string, unknown>>;
	assert.equal(clips.length, 2);
	assert.notEqual(clips[0]?.id, clips[1]?.id);
	assert.deepEqual(clips.map((clip) => [clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames]), [
		[24_000, 12_000, 24_000, 24_000], [48_000, 12_000, 24_000, 24_000],
	]);
	assert.equal(clips[0]?.fadeInFrames, 2_400);
	assert.equal(clips[0]?.fadeOutFrames, 2_400);
	assert.equal(clips[0]?.gain, 0.75);
	assert.equal((plan.project.master as Record<string, unknown>).gain, 0.9);
	assert.deepEqual(plan.report.items.map((item) => item.code).filter((code) => code.endsWith('omitted')).sort(), [
		'sesx.effects-omitted', 'sesx.markers-omitted',
	]);
	assert.equal(plan.report.direction, 'import');
	createCurrentAudioEditorProject(plan.project);
});

test('missing media and a different decoded sample rate omit only affected clips', () => {
	const missing = build(SESX, new Map());
	assert.equal((missing.project.clips as unknown[]).length, 0);
	assert.equal(missing.report.items.find((item) => item.code === 'sesx.media-missing')?.disposition, 'missing');
	const mismatch = build(SESX, new Map([['0', { frameCount: 100_000, channelCount: 2, sampleRate: 44_100 }]]));
	assert.equal((mismatch.project.clips as unknown[]).length, 0);
	assert.deepEqual(mismatch.media, []);
	assert.equal(mismatch.report.items.find((item) => item.code === 'sesx.sample-rate-mismatch')?.disposition, 'omitted');
});

test('source overrun, looping and offline clips are reported without invalid project clips', () => {
	const xml = SESX.replace('sourceOutPoint="36000" looped="false"', 'sourceOutPoint="36000" looped="true"')
		.replace('name="Again"', 'name="Again" offline="true"');
	const plan = build(xml, new Map([['0', { frameCount: 20_000, channelCount: 2, sampleRate: 48_000 }]]));
	const clips = plan.project.clips as Array<Record<string, unknown>>;
	assert.equal(clips.length, 1);
	assert.equal(clips[0]?.sourceDurationFrames, 8_000);
	assert.equal(clips[0]?.durationFrames, 8_000);
	assert.ok(plan.report.items.some((item) => item.code === 'sesx.clip-extent-converted'));
	assert.ok(plan.report.items.some((item) => item.code === 'sesx.loops-omitted'));
	assert.ok(plan.report.items.some((item) => item.code === 'sesx.offline-clip-omitted'));
	createCurrentAudioEditorProject(plan.project);
});

test('essential fields, unsafe doctypes and surround sessions are rejected', () => {
	assert.throws(() => parseSesxDocument('<Project/>'), /<sesx>/u);
	assert.throws(() => parseSesxDocument(SESX.replace('sampleRate="48000"', 'sampleRate="x"')), /sampleRate/u);
	assert.throws(() => parseSesxDocument(SESX.replace('audioChannelType="stereo"', 'audioChannelType="5.1"')), /mono or stereo/u);
	assert.throws(() => parseSesxDocument(SESX.replace('sourceOutPoint="36000"', 'sourceOutPoint="oops"')), /sourceOutPoint/u);
	assert.throws(() => parseSesxDocument(SESX.replace('<!DOCTYPE sesx>', '<!DOCTYPE sesx [<!ENTITY x "boom">]>')), /doctype|entity/iu);
	assert.throws(() => parseSesxDocument(SESX.replace('<!DOCTYPE sesx>', '<!DOCTYPE sesx SYSTEM "file:///tmp/x">')), /doctype/iu);
	assert.throws(() => parseSesxDocument(SESX.replace('relativePath="Imported Files/voice.wav"', 'relativePath="a.wav" id="duplicate"')), /duplicate attribute/iu);
});

test('duplicate file IDs are refused and unresolved references remain reportable', () => {
	assert.throws(() => parseSesxDocument(SESX.replace('</files>', '<file id="0" relativePath="other.wav"/></files>')), /Duplicate SESX file ID/u);
	const plan = build(SESX.replace('fileID="0" name="Again"', 'fileID="unknown" name="Again"'));
	assert.equal((plan.project.clips as unknown[]).length, 1);
	assert.ok(plan.report.items.some((item) => item.code === 'sesx.media-missing'));
});

test('track index determines the imported order when XML nodes are out of order', () => {
	const xml = '<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks>'
		+ '<audioTrack index="2"><trackParameters><name>Second</name></trackParameters></audioTrack>'
		+ '<audioTrack index="1"><trackParameters><name>First</name></trackParameters></audioTrack>'
		+ '</tracks></session></sesx>';
	assert.deepEqual(parseSesxDocument(xml).tracks.map((track) => track.name), ['First', 'Second']);
});

test('automation, routing, video, clip pan and channel remapping are reported', () => {
	const xml = SESX.replace('outputID="10000"', 'outputID="other"')
		.replace('<audioClip id="0"', '<automationLane/><audioClip id="0"')
		.replace('<fadeIn startPoint="12000"', '<component id="clipPan"><parameter name="Pan" parameterValue="0.5"/></component><channelMap><channel index="0" sourceIndex="1"/></channelMap><fadeIn startPoint="12000"')
		.replace('</masterTrack>', '</masterTrack><videoTrack/>');
	const plan = build(xml);
	const codes = plan.report.items.map((item) => item.code);
	for (const code of ['sesx.automation-omitted', 'sesx.routing-omitted', 'sesx.video-omitted', 'sesx.clip-pan-omitted', 'sesx.channel-map-omitted']) {
		assert.ok(codes.includes(code), code);
	}
});

test('linked Audition crossfades are reported, while unlinked sentinel IDs are ignored', () => {
	const linked = SESX.replace('id="0" fileID="0"', 'id="0" crossFadeHeadClipID="1" crossFadeTailClipID="-1" fileID="0"');
	const plan = build(linked);
	assert.equal(plan.report.items.filter((item) => item.code === 'sesx.crossfade-omitted').length, 1);
	assert.equal((plan.project.clips as unknown[]).length, 2);
	const tailLinked = SESX.replace('id="0" fileID="0"', 'id="0" crossFadeTailClipID="1" fileID="0"');
	assert.equal(build(tailLinked).report.items.filter((item) => item.code === 'sesx.crossfade-omitted').length, 1);
	const unlinked = SESX.replace('id="0" fileID="0"', 'id="0" crossFadeHeadClipID="-1" crossFadeTailClipID="-1" fileID="0"');
	assert.equal(build(unlinked).report.items.some((item) => item.code === 'sesx.crossfade-omitted'), false);
});
