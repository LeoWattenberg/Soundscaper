/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dawprojectMediaReferences, parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

/**
 * A Bitwig-shaped file: a beats arrangement, a clip whose content is a Clips
 * timeline whose clip wraps a Warps timeline around the audio, a notes track,
 * volume automation, a marker, and a tempo change halfway through the clip.
 */
const BITWIG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project version="1.0">
  <Application name="Bitwig Studio" version="5.0"/>
  <Transport>
    <Tempo max="666.000000" min="20.000000" unit="bpm" value="120.000000" id="id0" name="Tempo"/>
    <TimeSignature denominator="4" numerator="4" id="id1"/>
  </Transport>
  <Structure>
    <Track contentType="audio" loaded="true" id="id9" name="Drumloop" color="#b53bba">
      <Channel audioChannels="2" destination="id15" role="regular" solo="false" id="id10">
        <Mute value="false" id="id13" name="Mute"/>
        <Pan max="1.000000" min="0.000000" unit="normalized" value="0.75" id="id12" name="Pan"/>
        <Volume max="2.000000" min="0.000000" unit="linear" value="0.5" id="id11" name="Volume"/>
      </Channel>
    </Track>
    <Track contentType="notes" loaded="true" id="id2" name="Bass">
      <Channel audioChannels="2" destination="id15" role="regular" solo="false" id="id3">
        <Devices><ClapPlugin deviceID="x" deviceName="Surge" deviceRole="instrument" id="id7"/></Devices>
        <Volume unit="linear" value="0.6" id="id4"/>
      </Channel>
    </Track>
    <Track contentType="audio notes" loaded="true" id="id14" name="Master">
      <Channel audioChannels="2" role="master" solo="false" id="id15">
        <Mute value="false" id="id18" name="Mute"/>
        <Pan unit="normalized" value="0.5" id="id17"/>
        <Volume unit="linear" value="0.8" id="id16"/>
      </Channel>
    </Track>
  </Structure>
  <Arrangement id="id19">
    <Lanes timeUnit="beats" id="id20">
      <Lanes track="id9" id="id24">
        <Clips id="id25">
          <Clip time="4.0" duration="8.0" playStart="0.0" loopStart="0.0" loopEnd="8.0" fadeTimeUnit="beats" fadeInTime="1.0" fadeOutTime="0.0" name="Drumfunk">
            <Clips id="id26">
              <Clip time="0.0" duration="8.0" contentTimeUnit="beats" playStart="0.0">
                <Warps contentTimeUnit="seconds" timeUnit="beats" id="id28">
                  <Audio algorithm="stretch" channels="2" duration="2.0" sampleRate="48000" id="id27">
                    <File path="audio/loop.wav"/>
                  </Audio>
                  <Warp time="0.0" contentTime="0.0"/>
                  <Warp time="8.0" contentTime="2.0"/>
                </Warps>
              </Clip>
            </Clips>
          </Clip>
        </Clips>
        <Points unit="linear" id="id40"><Target parameter="id11"/><RealPoint time="0" value="0.5" interpolation="linear"/><RealPoint time="8" value="1.0" interpolation="hold"/></Points>
      </Lanes>
      <Lanes track="id2" id="id21">
        <Clips id="id22"><Clip time="0.0" duration="8.0"><Notes id="id23"><Note time="0" duration="1" channel="0" key="60"/></Notes></Clip></Clips>
      </Lanes>
    </Lanes>
    <Markers id="id50"><Marker time="4.0" name="Drop"/></Markers>
    <TempoAutomation unit="bpm" id="id60"><Target parameter="id0"/><RealPoint time="0" value="120" interpolation="hold"/><RealPoint time="8" value="60" interpolation="hold"/></TempoAutomation>
  </Arrangement>
  <Scenes/>
</Project>
`;

/**
 * A seconds arrangement with a folder-owned submix, a send, a decibel fader,
 * a crossfade, a clip that overruns its file, a disabled clip, an external
 * file, an alias clip, and a signature change that lands between bars.
 */
const SECONDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Project version="1.0"><Application name="Cubase" version="14"/>
<Transport><Tempo unit="bpm" value="100" id="tempo"/><TimeSignature numerator="3" denominator="4" id="sig"/></Transport>
<Structure>
  <Track contentType="audio" id="t2" name="Ext"><Channel role="regular" destination="busch" id="ch2"/></Track>
  <Track contentType="tracks audio" id="grp" name="Group"><Channel role="submix" id="busch"><Volume unit="linear" value="0.7" id="gv"/></Channel>
    <Track contentType="audio" id="t1" name="Guitar"><Channel role="regular" destination="busch" id="ch1" solo="true"><Mute value="true" id="m1"/><Volume unit="decibel" value="-6" id="v1"/><Sends><Send destination="fxch" type="post" id="s1"><Volume unit="linear" value="0.3" id="sv1"/></Send></Sends></Channel></Track>
    <Track contentType="audio" id="t3" name="Inner"><Channel role="regular" destination="busch" id="ch3"/></Track>
  </Track>
  <Track contentType="audio" id="fx" name="Reverb"><Channel role="effect" id="fxch"/></Track>
  <Track contentType="audio" id="mst" name="Master"><Channel role="master" id="mstch"/></Track>
</Structure>
<Arrangement id="arr">
  <Lanes timeUnit="seconds" id="l0">
    <Lanes track="t1" id="l1"><Clips id="c0">
      <Clip time="1.5" duration="3" playStart="0.25" contentTimeUnit="seconds" fadeTimeUnit="seconds" fadeInTime="-0.1" fadeOutTime="0.5" name="Riff"><Audio channels="1" duration="10" sampleRate="44100" id="a1"><File path="./audio\\riff.wav" external="false"/></Audio></Clip>
      <Clip time="10" duration="5" playStart="8" name="Tail"><Audio channels="1" duration="10" sampleRate="44100" id="a2"><File path="audio/riff.wav"/></Audio></Clip>
      <Clip time="20" duration="1" enable="false"><Audio channels="1" duration="10" sampleRate="44100" id="a3"><File path="audio/riff.wav"/></Audio></Clip>
    </Clips></Lanes>
    <Lanes track="t2" id="l2"><Clips id="c1"><Clip time="0" duration="2"><Audio channels="2" duration="2" sampleRate="48000" id="a4"><File path="/abs/ext.wav" external="true"/></Audio></Clip></Clips></Lanes>
    <Lanes track="t3" id="l3"><Clips id="c2"><Clip time="0" reference="a1"/></Clips></Lanes>
  </Lanes>
  <TimeSignatureAutomation id="tsa"><Target parameter="sig"/><TimeSignaturePoint time="6" numerator="4" denominator="4"/><TimeSignaturePoint time="7" numerator="5" denominator="8"/></TimeSignatureAutomation>
</Arrangement></Project>
`;

const METADATA_XML = '<?xml version="1.0" encoding="UTF-8"?><MetaData><Title>Night drive</Title><Artist>Band</Artist><Year>2026</Year></MetaData>';

function ids() {
	const counters = new Map<string, number>();
	return (prefix: string) => {
		const next = (counters.get(prefix) ?? 0) + 1;
		counters.set(prefix, next);
		return `${prefix}-${String(next)}`;
	};
}

function importBitwig() {
	const document = parseDawprojectDocument(BITWIG_XML, METADATA_XML);
	return buildDawprojectProject(document, {
		fileName: 'Session.dawproject',
		media: new Map([['audio/loop.wav', { frameCount: 96_000, channelCount: 2, sampleRate: 48_000 }]]),
		createStableId: ids(),
	});
}

function importSeconds() {
	const document = parseDawprojectDocument(SECONDS_XML);
	return buildDawprojectProject(document, {
		fileName: 'Cubase session.dawproject',
		media: new Map([['audio/riff.wav', { frameCount: 441_000, channelCount: 1, sampleRate: 44_100 }]]),
		createStableId: ids(),
	});
}

function codes(plan: ReturnType<typeof buildDawprojectProject>): string[] {
	return plan.report.items.map((item) => item.code);
}

test('the parser types the structure and keeps the arrangement as elements', () => {
	const document = parseDawprojectDocument(BITWIG_XML, METADATA_XML);
	assert.equal(document.version, '1.0');
	assert.deepEqual(document.application, { name: 'Bitwig Studio', version: '5.0' });
	assert.equal(document.transport.tempo?.value, 120);
	assert.deepEqual(document.transport.timeSignature, { id: 'id1', numerator: 4, denominator: 4 });
	assert.deepEqual(document.tracks.map((track) => track.name), ['Drumloop', 'Bass', 'Master']);
	assert.deepEqual(document.tracks[0]?.contentTypes, ['audio']);
	assert.equal(document.tracks[0]?.channel?.pan?.value, 0.75);
	assert.equal(document.tracks[1]?.channel?.devices, 1);
	assert.equal(document.tracks[2]?.channel?.role, 'master');
	assert.equal(document.arrangement?.lanes?.name, 'Lanes');
	assert.equal(document.arrangement?.tempoAutomation?.children.length, 3);
	assert.equal(document.elementsById.get('id27')?.name, 'Audio');
	assert.deepEqual(document.metadata, { title: 'Night drive', artist: 'Band', album: null, year: '2026', comment: null });
	assert.deepEqual(dawprojectMediaReferences(document), [{ path: 'audio/loop.wav', external: false, kind: 'audio' }]);
});

test('a document that is not a DAWproject is refused', () => {
	assert.throws(() => parseDawprojectDocument('<Song version="1"/>'), /<Project>/u);
	assert.throws(() => parseDawprojectDocument('<Project version="1.0"><Structure>'), /unclosed tag/u);
});

test('a beats arrangement resolves through the imported tempo map, tempo change included', () => {
	const plan = importBitwig();
	assert.equal(plan.sampleRate, 48_000, 'the embedded audio rate is the project rate');
	assert.equal(plan.title, 'Night drive');
	const tempo = plan.project.tempoMap as { events: { beat: { num: number; den: number }; bpm: { num: number; den: number } }[] };
	assert.deepEqual(tempo.events.map((event) => [event.beat.num / event.beat.den, event.bpm.num / event.bpm.den]), [[0, 120], [8, 60]]);
	const clips = plan.project.clips as Record<string, number | string>[];
	assert.equal(clips.length, 1);
	const [clip] = clips;
	// Beat 4 at 120 BPM is two seconds; beats 4–12 span two seconds at 120 and four at 60.
	assert.equal(clip?.timelineStartFrame, 96_000);
	assert.equal(clip?.durationFrames, 288_000);
	assert.equal(clip?.sourceStartFrame, 0);
	assert.equal(clip?.sourceDurationFrames, 96_000, 'the warp maps eight beats onto two seconds of audio');
	assert.ok(Math.abs(Number(clip?.speedRatio) - 1 / 3) < 1e-6, 'two seconds of source over six seconds of timeline');
	assert.equal(clip?.fadeInFrames, 24_000, 'a one-beat fade at 120 BPM is half a second');
	assert.equal(clip?.title, 'Drumfunk');
	assert.ok(codes(plan).includes('dawproject.speed-change-converted'));
	assert.equal(codes(plan).includes('dawproject.clip-extent-converted'), false, 'a loop region equal to the clip is not a loop');
});

test('channels become tracks with gain, pan, mute and solo, and the notes track is reported not imported', () => {
	const plan = importBitwig();
	const tracks = plan.project.tracks as Record<string, unknown>[];
	assert.deepEqual(tracks.map((track) => track.name), ['Drumloop']);
	assert.equal(tracks[0]?.gain, 0.5);
	assert.equal(tracks[0]?.pan, 0.5, 'normalized 0.75 is half right');
	assert.equal(tracks[0]?.mute, false);
	const master = plan.project.master as Record<string, unknown>;
	assert.equal(master.gain, 0.8);
	const omitted = plan.report.items.find((item) => item.code === 'dawproject.track-content-omitted');
	assert.deepEqual(omitted?.data, { name: 'Bass', contentTypes: ['notes'] });
	assert.ok(codes(plan).includes('dawproject.notes-omitted'));
	assert.ok(codes(plan).includes('dawproject.devices-omitted'));
	assert.ok(codes(plan).includes('dawproject.scenes-omitted') === false, 'an empty Scenes element is nothing to report');
});

test('volume automation becomes the track envelope and markers become timeline markers', () => {
	const plan = importBitwig();
	const [track] = plan.project.tracks as { envelope: { frame: number; value: number }[] }[];
	assert.deepEqual(track?.envelope, [{ frame: 0, value: 0.5 }, { frame: 192_000, value: 1 }]);
	assert.ok(codes(plan).includes('dawproject.automation-hold-converted'));
	const annotations = plan.project.timelineAnnotations as Record<string, unknown>[];
	assert.deepEqual(annotations.map((marker) => [marker.name, marker.positionFrame, marker.kind]), [['Drop', 96_000, 'marker']]);
	assert.equal(plan.report.direction, 'import');
	assert.equal(plan.report.subject.format, 'dawproject');
});

test('the plan creates a valid current project document', () => {
	const plan = importBitwig();
	const project = createCurrentAudioEditorProject(plan.project as never) as Record<string, unknown>;
	assert.equal(project.title, 'Night drive');
	assert.equal((project.tracks as unknown[]).length, 1);
	assert.equal((project.clips as unknown[]).length, 1);
	assert.deepEqual(plan.media, [{ path: 'audio/loop.wav', sourceId: 'source-1' }]);
	assert.equal((project.metadata as Record<string, unknown>).artist, 'Band');
});

test('a seconds arrangement keeps sample positions and converts fader units', () => {
	const plan = importSeconds();
	assert.equal(plan.sampleRate, 44_100);
	assert.equal(plan.title, 'Cubase session', 'the file name stands in when metadata.xml has no title');
	const clips = plan.project.clips as Record<string, number | string>[];
	const riff = clips.find((clip) => clip.title === 'Riff');
	assert.equal(riff?.timelineStartFrame, 66_150);
	assert.equal(riff?.durationFrames, 132_300);
	assert.equal(riff?.sourceStartFrame, 11_025);
	assert.equal(riff?.sourceDurationFrames, 132_300);
	assert.equal(riff?.speedRatio, 1);
	assert.equal(riff?.fadeInFrames, 4_410, 'a negative fade-in is a crossfade of that length');
	assert.equal(riff?.fadeOutFrames, 22_050);
	assert.ok(codes(plan).includes('dawproject.crossfade-converted'));
	const guitar = (plan.project.tracks as Record<string, unknown>[]).find((track) => track.name === 'Guitar');
	assert.ok(Math.abs(Number(guitar?.gain) - 10 ** (-6 / 20)) < 1e-9, '-6 dB is a linear gain');
	assert.equal(guitar?.mute, true);
	assert.equal(guitar?.solo, true);
});

test('a clip that overruns its file is shortened, a disabled clip is dropped, and both are reported', () => {
	const plan = importSeconds();
	const tail = (plan.project.clips as Record<string, number | string>[]).find((clip) => clip.title === 'Tail');
	assert.equal(tail?.sourceStartFrame, 352_800);
	assert.equal(tail?.sourceDurationFrames, 88_200, 'only two seconds of the ten remain after an eight-second offset');
	assert.equal(tail?.durationFrames, 88_200);
	const extent = plan.report.items.find((item) => item.code === 'dawproject.clip-extent-converted');
	assert.equal(extent?.data.looped, false);
	const disabled = plan.report.items.find((item) => item.code === 'dawproject.disabled-clips-omitted');
	assert.deepEqual(disabled?.data, { count: 1 });
	assert.equal((plan.project.clips as unknown[]).length, 3, 'Riff, Tail, and the alias clip');
});

test('external media is missing, not imported silently, and its track still exists', () => {
	const plan = importSeconds();
	const missing = plan.report.items.find((item) => item.code === 'dawproject.media-missing');
	assert.deepEqual(missing?.data, { path: 'abs/ext.wav', external: true });
	assert.equal(missing?.disposition, 'missing');
	const ext = (plan.project.tracks as Record<string, unknown>[]).find((track) => track.name === 'Ext');
	assert.deepEqual(ext?.clipIds, []);
});

test('an alias clip plays the referenced timeline and an open-ended clip runs to the end of its audio', () => {
	const plan = importSeconds();
	const inner = (plan.project.tracks as { name: string; clipIds: string[] }[]).find((track) => track.name === 'Inner');
	const clip = (plan.project.clips as Record<string, number | string>[]).find((candidate) => candidate.id === inner?.clipIds[0]);
	assert.equal(clip?.timelineStartFrame, 0);
	assert.equal(clip?.sourceStartFrame, 0);
	assert.equal(clip?.durationFrames, 441_000, 'ten seconds of file at 44.1 kHz');
});

test('folders own their submix bus, tracks route to it, and sends carry their levels', () => {
	const plan = importSeconds();
	const folders = plan.project.trackFolders as { id: string; name: string }[];
	assert.deepEqual(folders.map((folder) => folder.name), ['Group']);
	const mixer = plan.project.mixer as { groups: { id: string; name: string; gain: number }[]; sends: { name: string }[]; routes: Record<string, { groupId: string | null; sends: Record<string, number> }> };
	assert.deepEqual(mixer.groups.map((group) => [group.id, group.name, group.gain]), [[folders[0]?.id, 'Group', 0.7]]);
	assert.deepEqual(mixer.sends.map((send) => send.name), ['Reverb']);
	const tracks = plan.project.tracks as { id: string; name: string }[];
	const guitar = tracks.find((track) => track.name === 'Guitar')!;
	const inner = tracks.find((track) => track.name === 'Inner')!;
	assert.equal(mixer.routes[guitar.id]?.groupId, folders[0]?.id);
	assert.deepEqual(mixer.routes[guitar.id]?.sends, { 'send-bus-1': 0.3 });
	assert.equal(mixer.routes[inner.id]?.groupId, folders[0]?.id);
	const ext = tracks.find((track) => track.name === 'Ext')!;
	assert.equal(mixer.routes[ext.id], undefined, 'a track outside the folder cannot feed the folder\'s bus');
	const routing = plan.report.items.find((item) => item.code === 'dawproject.routing-omitted');
	assert.deepEqual(routing?.scope, { kind: 'track', id: ext.id });
	const nodes = (plan.project.sequences as { trackNodes: { kind: string; id: string; parentFolderId: string | null }[] }[])[0]?.trackNodes;
	assert.deepEqual(nodes?.map((node) => [node.kind, node.parentFolderId]), [['track', null], ['folder', null], ['track', folders[0]?.id], ['track', folders[0]?.id]]);
	const project = createCurrentAudioEditorProject(plan.project as never) as unknown as { mixer: { routes: Record<string, { groupId: string | null }> } };
	assert.equal(project.mixer.routes[guitar.id]?.groupId, folders[0]?.id, 'the folder bus survives document creation');
});

test('signature automation lands on bars and a change between bars is moved and reported', () => {
	const plan = importSeconds();
	const signature = plan.project.signatureMap as { events: { bar: number; numerator: number; denominator: number }[] };
	assert.deepEqual(signature.events.map((event) => [event.bar, event.numerator, event.denominator]), [[0, 3, 4], [2, 4, 4]]);
	const converted = plan.report.items.find((item) => item.code === 'dawproject.signature-points-converted');
	assert.deepEqual(converted?.data, { points: 1 });
});

test('a project with nothing but a transport still imports as an empty project', () => {
	const document = parseDawprojectDocument('<Project version="1.0"><Application name="x" version="1"/></Project>');
	const plan = buildDawprojectProject(document, { media: new Map(), createStableId: ids() });
	assert.equal(plan.sampleRate, 48_000);
	assert.equal(plan.title, 'DAWproject');
	const project = createCurrentAudioEditorProject(plan.project as never) as Record<string, unknown>;
	assert.deepEqual(project.tracks, []);
	assert.equal((project.tempo as { bpm: number }).bpm, 120);
});
