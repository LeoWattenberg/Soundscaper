/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import type { NativeProjectDocument } from '../src/common/editor/controller/native-project-types.ts';
import { readDawprojectArchive, writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const SAMPLE_RATE = 48_000;
const FRAMES = 1_000;

const PROJECT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project version="1.0">
  <Application name="Other DAW" version="9"/>
  <Transport><Tempo unit="bpm" value="90" id="tempo"/><TimeSignature numerator="4" denominator="4" id="sig"/></Transport>
  <Structure>
    <Track contentType="audio" id="t1" name="Guitar"><Channel role="regular" destination="m" id="c1"><Volume unit="linear" value="0.5" id="v1"/></Channel></Track>
    <Track contentType="audio" id="mt" name="Master"><Channel role="master" id="m"/></Track>
  </Structure>
  <Arrangement id="arr"><Lanes timeUnit="seconds" id="l0"><Lanes track="t1" id="l1"><Clips id="cl">
    <Clip time="0.5" duration="0.01" playStart="0" name="Take"><Audio channels="2" duration="${FRAMES / SAMPLE_RATE}" sampleRate="${SAMPLE_RATE}" id="a1"><File path="audio/take.wav"/></Audio></Clip>
  </Clips></Lanes></Lanes></Arrangement>
</Project>
`;

function wavBlob(): Blob {
	const channel = new Float32Array(FRAMES).map((_, index) => (index % 100) / 100 - 0.5);
	return new Blob([encodeWav([channel, channel], { sampleRate: SAMPLE_RATE, float: true }) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
}

async function dawprojectFile(name = 'Session.dawproject'): Promise<Blob & { name: string }> {
	const archive = await writeDawprojectArchive({
		projectXml: PROJECT_XML, metadataXml: '<MetaData><Title>Imported</Title></MetaData>',
		files: [{ path: 'audio/take.wav', blob: wavBlob() }],
	});
	Object.defineProperty(archive, 'name', { value: name });
	return archive as Blob & { name: string };
}

function writerCapture() {
	const written: { sourceId: string; frames: number; channels: number }[] = [];
	const store = {
		estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
		beginSourceWrite: async (sourceId: string) => ({
			write: async (channels: readonly Float32Array[]) => {
				written.push({ sourceId, frames: channels[0]?.length ?? 0, channels: channels.length });
			},
			commit: async () => undefined,
			abort: async () => undefined,
		}),
		deleteSource: async () => undefined,
	};
	return { written, store };
}

test('opening a DAWproject decodes its audio, persists sources, switches projects and publishes the report', async () => {
	const { written, store } = writerCapture();
	const fixture = createFixture({ store });
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.openDawproject(await dawprojectFile());
	assert.ok(result);
	const project = result.project as NativeProjectDocument & { tracks: { name: string; gain: number }[]; clips: Record<string, number>[] };
	assert.equal(project.title, 'Imported');
	assert.equal(project.schemaVersion, 17, 'the import creates a current document');
	assert.deepEqual(project.tracks.map((track) => [track.name, track.gain]), [['Guitar', 0.5]]);
	assert.equal(project.clips[0]?.timelineStartFrame, SAMPLE_RATE / 2);
	assert.equal(project.clips[0]?.durationFrames, 480);
	assert.deepEqual(written, [{ sourceId: project.sources[0]!.id, frames: FRAMES, channels: 2 }], 'the WAV is persisted once, in full');
	assert.deepEqual(fixture.switched, [project.id]);
	assert.equal(fixture.state.importing, false);
	const report = (fixture.state as { deliveryReport?: unknown }).deliveryReport as { subject: { format: string }; direction: string; items: { code: string }[] };
	assert.equal(report.subject.format, 'dawproject');
	assert.equal(report.direction, 'import');
	assert.ok(report.items.some((item) => item.code === 'dawproject.audio-imported'));
	assert.equal(fixture.statuses.at(-1)?.state, 'success');
});

test('a file that is not a DAWproject is refused before anything is read', async () => {
	const fixture = createFixture();
	const service = createNativeProjectService(fixture.runtime);
	const wrong = new Blob(['x']);
	Object.defineProperty(wrong, 'name', { value: 'song.aup4' });
	await assert.rejects(service.openDawproject(wrong as Blob & { name: string }), TypeError);
	assert.deepEqual(fixture.switched, []);
});

test('a failed switch deletes the sources the open persisted and clears the importing flag', async () => {
	const { store } = writerCapture();
	const deleted: string[] = [];
	const fixture = createFixture({
		store: { ...store, deleteSource: async (sourceId: string) => { deleted.push(sourceId); } },
		switchProject: async () => { throw new Error('switch failed'); },
	});
	const service = createNativeProjectService(fixture.runtime);
	await assert.rejects(service.openDawproject(await dawprojectFile()), /switch failed/u);
	assert.equal(deleted.length, 1, 'the persisted source is not left behind');
	assert.equal(fixture.state.importing, false);
});

test('an archive whose audio cannot be decoded imports the structure and reports the media', async () => {
	const archive = await writeDawprojectArchive({
		projectXml: PROJECT_XML, metadataXml: '',
		files: [{ path: 'audio/take.wav', blob: new Blob(['not audio at all']) }],
	});
	Object.defineProperty(archive, 'name', { value: 'broken.dawproject' });
	const { written, store } = writerCapture();
	const fixture = createFixture({ store });
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.openDawproject(archive as Blob & { name: string });
	assert.equal(written.length, 0);
	assert.equal((result?.project as unknown as { clips: unknown[] }).clips.length, 0);
	const report = (fixture.state as { deliveryReport?: unknown }).deliveryReport as { items: { code: string }[] };
	assert.ok(report.items.some((item) => item.code === 'dawproject.media-undecodable'));
});

function exportableProject() {
	return createCurrentAudioEditorProject({
		id: 'project-a', title: 'Mix one', sampleRate: SAMPLE_RATE,
		sources: [{ id: 's1', name: 'take.wav', frameCount: FRAMES, channelCount: 2, sampleRate: SAMPLE_RATE }],
		clips: [{ id: 'c1', sourceId: 's1', title: 'Take', timelineStartFrame: 480, durationFrames: FRAMES, sourceDurationFrames: FRAMES }],
		tracks: [{ type: 'audio', id: 't1', name: 'Guitar', clipIds: ['c1'], gain: 0.5 }],
	} as never) as unknown as NativeProjectDocument;
}

test('exporting writes an archive with the project, its metadata and float32 WAV, through the interchange purpose', async () => {
	const saved: Record<string, unknown>[] = [];
	const channel = new Float32Array(FRAMES).fill(0.25);
	const fixture = createFixture({
		getProject: () => exportableProject(),
		loadStoredSourceChannels: async () => [channel, channel],
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => null,
			prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async (request) => { saved.push(request as unknown as Record<string, unknown>); return { fileName: request.suggestedName }; },
		},
		product: { name: 'Soundscaper' },
		applicationVersion: '1.0.0-test',
	});
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.saveDawproject();
	assert.equal(result.fileName, 'Mix-one.dawproject');
	assert.equal(saved.length, 1);
	assert.equal(saved[0]?.purpose, 'interchange');
	assert.equal(saved[0]?.suggestedName, 'Mix-one.dawproject');
	assert.equal(saved[0]?.mimeType, 'application/zip');
	const archive = await readDawprojectArchive(saved[0]?.blob as Blob);
	try {
		const document = parseDawprojectDocument(archive.projectXml, archive.metadataXml);
		assert.deepEqual(document.application, { name: 'Soundscaper', version: '1.0.0-test' });
		assert.deepEqual(document.tracks.map((track) => track.name), ['Guitar', 'Master']);
		assert.equal(document.metadata.title, 'Mix one');
		const wav = await archive.readEntry('audio/001-take.wav');
		assert.ok(wav, 'the source is embedded under its registered path');
		assert.equal(wav.size, 44 + FRAMES * 2 * 4 + 0, 'a float32 stereo WAV of every frame');
	} finally {
		await archive.close();
	}
	const report = (fixture.state as { deliveryReport?: unknown }).deliveryReport as { subject: { format: string }; direction: string };
	assert.equal(report.subject.format, 'dawproject');
	assert.equal(report.direction, 'export');
	assert.equal(fixture.statuses.at(-1)?.state, 'success');
});

test('a cancelled save keeps the report readable and a missing source refuses the export', async () => {
	const fixture = createFixture({
		getProject: () => exportableProject(),
		loadStoredSourceChannels: async () => [new Float32Array(FRAMES)],
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => null,
			prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async () => { throw new DOMException('cancelled', 'AbortError'); },
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	await assert.rejects(service.saveDawproject(), /cancelled/u);
	assert.equal(((fixture.state as { deliveryReport?: unknown }).deliveryReport as { subject: { format: string } }).subject.format, 'dawproject');

	const missing = createFixture({ getProject: () => exportableProject(), hasMissingTimelineSources: () => true });
	await assert.rejects(createNativeProjectService(missing.runtime).saveDawproject(), /Missing sources/u);
	assert.equal((missing.state as { deliveryReport?: unknown }).deliveryReport, undefined);
});
