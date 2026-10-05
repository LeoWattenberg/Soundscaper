/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import {
	createDesktopOriginalImportRecorder,
	desktopOriginalForProject,
	resetDesktopOriginal,
} from '../src/common/editor/desktop-overwrite-original.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';

const original = { id: 'a'.repeat(48), name: 'Original.wav' };
const source = { id: 'source', kind: 'audio', originalSampleRate: 96_000, sampleRate: 48_000,
	channelCount: 1, frameCount: 96_000 };
const empty = { id: 'project', sources: [], clips: [] };
const imported = { ...empty, sources: [source], clips: [{ id: 'clip' }] };

function wavFile(name = original.name, sampleFormat = 'int16') {
	const bytes = encodeWav([new Float32Array(4)], { sampleRate: 96_000,
		bitDepth: sampleFormat === 'float32' ? 32 : 16, float: sampleFormat === 'float32' });
	return new File([new Uint8Array(bytes).buffer], name);
}

test('overwrite remembers original PCM precision, source rate and source channels', async () => {
	const settings = await resolveDesktopOriginalExportSettings(wavFile(), [source]);
	assert.deepEqual(settings, { format: 'wav', mode: 'mix', range: 'project', sampleRate: 96_000,
		channelMapping: 'mono', sampleFormat: 'int16', bitDepth: 16, includeTail: false });
	const floating = await resolveDesktopOriginalExportSettings(wavFile('float.wav', 'float32'), [source]);
	assert.equal(floating?.sampleFormat, 'float32');
	assert.equal(floating?.bitDepth, 32);
});

test('overwrite keeps AIFF integer precision and refuses unsupported WAV precision', async () => {
	const encoded = encodeAiff([new Float32Array(4)], { sampleRate: 96_000, sampleFormat: 'int32' });
	assert.ok(encoded instanceof Uint8Array);
	const file = new File([new Uint8Array(encoded).buffer], 'sound.aif');
	const settings = await resolveDesktopOriginalExportSettings(file, [source]);
	assert.equal(settings?.format, 'aiff');
	assert.equal(settings?.sampleFormat, 'int32');
	const malformed = wavFile();
	const bytes = new Uint8Array(await malformed.arrayBuffer());
	new DataView(bytes.buffer).setUint16(34, 8, true);
	assert.equal(await resolveDesktopOriginalExportSettings(new File([bytes], 'sound.wav'), [source]), null);
});

test('overwrite retains the declared 20-bit precision within a 24-bit WAV sample word', async () => {
	const bytes = encodeWav([new Float32Array(4)], { sampleRate: 96_000, bitDepth: 20 });
	const settings = await resolveDesktopOriginalExportSettings(new File([new Uint8Array(bytes).buffer], '20-bit.wav'), [source]);
	assert.equal(settings?.sampleFormat, 'int20');
	assert.equal(settings?.bitDepth, 20);
});

test('overwrite refuses project files, unsupported extensions and mismatched containers', async () => {
	for (const name of ['session.soundscape', 'session.framescape', 'session.aup3', 'track.wma', 'track.mp3']) {
		assert.equal(await resolveDesktopOriginalExportSettings(wavFile(name), [source]), null, name);
	}
});

test('overwrite preserves supported video source canvas and exact frame rate', async () => {
	const file = new File(['video'], 'film.mp4', { type: 'video/mp4' });
	const video = { id: 'video', kind: 'video', width: 1920, height: 1080,
		frameRate: { num: 60_000, den: 1001 }, videoCodec: 'h264', audioCodec: 'aac' };
	assert.deepEqual(await resolveDesktopOriginalExportSettings(file, [video, source]), {
		format: 'video-mp4', range: 'project', canvas: { size: { width: 1920, height: 1080 },
			frameRate: { num: 60_000, den: 1001 }, fit: 'contain' }, audioLayout: 'mono',
	});
	assert.equal(await resolveDesktopOriginalExportSettings(file, [{ ...video, videoCodec: 'hevc' }]), null);
	assert.equal(await resolveDesktopOriginalExportSettings(file, [{ ...video, width: 1919 }]), null);
});

test('only one successful import into an empty project enables overwrite', async () => {
	const state = {};
	let project = empty as typeof empty | typeof imported;
	const file = wavFile();
	registerDesktopOriginalFile(file, original);
	let imports = 0;
	const recorder = createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		imports += 1;
		project = { ...imported, sources: [...project.sources, { ...source, id: `source-${String(imports)}` }] };
		return 'imported';
	});
	assert.equal(await recorder(file), 'imported');
	assert.equal(desktopOriginalForProject(state, project.id)?.id, original.id);
	assert.equal(desktopOriginalForProject(state, 'other'), null);
	await recorder(file);
	assert.equal(desktopOriginalForProject(state, project.id), null);
	resetDesktopOriginal(state);
	assert.equal(desktopOriginalForProject(state, project.id), null);
});

test('failed imports leave an eligible original intact and restored documents cannot adopt one', async () => {
	const file = wavFile();
	registerDesktopOriginalFile(file, original);
	const state = {};
	let project = empty as typeof empty | typeof imported;
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = imported;
	})(file);
	await assert.rejects(createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		throw new Error('Decode failed');
	})(file), /Decode failed/u);
	assert.equal(desktopOriginalForProject(state, project.id)?.id, original.id);
	const restored = {};
	await createDesktopOriginalImportRecorder({ state: restored, getProject: () => imported }, async () => undefined)(file);
	assert.equal(desktopOriginalForProject(restored, imported.id), null);
});

test('an import that changes the active document does not retain an original', async () => {
	const state = {};
	let project = empty as typeof empty | typeof imported;
	const file = wavFile();
	registerDesktopOriginalFile(file, original);
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = { ...imported, id: 'replacement' };
	})(file);
	assert.equal(desktopOriginalForProject(state, project.id), null);
});

test('concurrent imports and resets cannot restore a pending original', async () => {
	const file = wavFile();
	registerDesktopOriginalFile(file, original);
	const state = {};
	let project = empty as typeof empty | typeof imported;
	let imports = 0;
	const recorder = createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		imports += 1;
		project = { ...imported, sources: [...project.sources, { ...source, id: `source-${String(imports)}` }] };
	});
	await Promise.all([recorder(file), recorder(file)]);
	assert.equal(desktopOriginalForProject(state, project.id), null);
	resetDesktopOriginal(state);
	project = empty;
	const pending = recorder(file);
	await Promise.resolve();
	resetDesktopOriginal(state);
	await pending;
	assert.equal(desktopOriginalForProject(state, project.id), null);
});

test('an unreadable optional source probe does not fail a completed import', async () => {
	const file = { name: 'Original.wav', size: 4, slice: () => ({ async arrayBuffer() {
		throw new Error('Original was removed');
	} }) };
	registerDesktopOriginalFile(file, original);
	const state = {};
	let project = empty as typeof empty | typeof imported;
	assert.equal(await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = imported;
		return 'completed';
	})(file), 'completed');
	assert.equal(desktopOriginalForProject(state, project.id), null);
});

test('compressed settings preserve FLAC precision and derive MP3 VBR quality from the source rate', async () => {
	const flac = new Uint8Array(42);
	flac.set(new TextEncoder().encode('fLaC'));
	flac[7] = 34;
	flac[20] = 1;
	flac[21] = 0x70;
	assert.equal((await resolveDesktopOriginalExportSettings(new File([flac], 'Original.flac'), [source]))?.bitDepth, 24);
	const mp3 = new Uint8Array(24_000);
	mp3.set([0xff, 0xfb, 0x90, 0]);
	mp3.set(new TextEncoder().encode('Xing'), 36);
	const settings = await resolveDesktopOriginalExportSettings(new File([mp3], 'Original.mp3'),
		[{ ...source, originalSampleRate: 44_100, sampleRate: 48_000, frameCount: 48_000 }]);
	assert.equal(settings?.bitRateMode, 'variable');
	assert.equal(settings?.bitRate, 128);
	assert.equal(settings?.vbrQuality, 2);
	assert.equal(settings?.sampleRate, 44_100);
});

test('MP3 CBR and tagged LAME VBR retain their different bitrate strategies', async () => {
	const cbr = new Uint8Array(1000);
	cbr.set([0xff, 0xfb, 0xb0, 0]);
	const cbrSettings = await resolveDesktopOriginalExportSettings(new File([cbr], 'CBR.mp3'), [source]);
	assert.equal(cbrSettings?.bitRateMode, 'constant');
	assert.equal(cbrSettings?.bitRate, 192);
	const vbr = cbr.slice();
	vbr.set(new TextEncoder().encode('Xing'), 36);
	new DataView(vbr.buffer).setUint32(40, 8, false);
	new DataView(vbr.buffer).setUint32(44, 58, false);
	vbr.set(new TextEncoder().encode('LAME3.100'), 48);
	const vbrSettings = await resolveDesktopOriginalExportSettings(new File([vbr], 'VBR.mp3'), [source]);
	assert.equal(vbrSettings?.bitRateMode, 'variable');
	assert.equal(vbrSettings?.vbrQuality, 4);
});

test('skipped imports preserve the eligible original and resets release native authority once', async () => {
	const file = wavFile();
	const releases: string[] = [];
	registerDesktopOriginalFile(file, original, (id) => { releases.push(id); });
	const state = {};
	let project = empty as typeof empty | typeof imported;
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = imported;
	})(file);
	await createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => undefined)(file);
	assert.equal(desktopOriginalForProject(state, project.id)?.id, original.id);
	assert.deepEqual(releases, []);
	resetDesktopOriginal(state);
	resetDesktopOriginal(state);
	await Promise.resolve();
	assert.deepEqual(releases, [original.id]);
});

test('a second import that reuses a source but adds a clip disables overwrite', async () => {
	const file = wavFile();
	registerDesktopOriginalFile(file, original);
	const state = {};
	let project = empty as typeof empty | typeof imported;
	const recorder = createDesktopOriginalImportRecorder({ state, getProject: () => project }, async () => {
		project = { ...imported, clips: [...project.clips, { id: `clip-${String(project.clips.length)}` }] };
	});
	await recorder(file);
	assert.ok(desktopOriginalForProject(state, project.id));
	await recorder(file);
	assert.equal(desktopOriginalForProject(state, project.id), null);
});

test('CRC-protected MP3 VBR tags retain their quality and M4A brands cannot prove AAC', async () => {
	const mp3 = new Uint8Array(24_000);
	mp3.set([0xff, 0xfa, 0x90, 0]);
	mp3.set(new TextEncoder().encode('Xing'), 38);
	new DataView(mp3.buffer).setUint32(42, 8, false);
	new DataView(mp3.buffer).setUint32(46, 58, false);
	mp3.set(new TextEncoder().encode('LAME3.100'), 50);
	const settings = await resolveDesktopOriginalExportSettings(new File([mp3], 'CRC.mp3'), [source]);
	assert.equal(settings?.bitRateMode, 'variable');
	assert.equal(settings?.vbrQuality, 4);
	const iso = new Uint8Array(32);
	iso.set(new TextEncoder().encode('ftypM4A '), 4);
	assert.equal(await resolveDesktopOriginalExportSettings(new File([iso], 'ALAC.m4a'), [source]), null);
	assert.equal(await resolveDesktopOriginalExportSettings(new File([iso], 'movie.mp4'), [source]), null);
});

test('WavPack floating point precision is retained and hybrid data remains ineligible', async () => {
	const bytes = new Uint8Array(32);
	bytes.set(new TextEncoder().encode('wvpk'));
	new DataView(bytes.buffer).setUint32(24, 0x83, true);
	const settings = await resolveDesktopOriginalExportSettings(new File([bytes], 'float.wv'), [source]);
	assert.equal(settings?.sampleFormat, 'float32');
	assert.equal(settings?.bitDepth, 32);
	new DataView(bytes.buffer).setUint32(24, 0x8b, true);
	assert.equal(await resolveDesktopOriginalExportSettings(new File([bytes], 'hybrid.wv'), [source]), null);
});

test('silent video overwrite omits audio delivery settings', async () => {
	const file = new File(['video'], 'film.mp4', { type: 'video/mp4' });
	const video = { id: 'video', kind: 'video', width: 192, height: 144,
		frameRate: { num: 25, den: 1 }, videoCodec: 'h264', audioCodec: null, hasAudio: false };
	const settings = await resolveDesktopOriginalExportSettings(file, [video]);
	assert.ok(settings);
	assert.equal(Object.hasOwn(settings, 'audioLayout'), false);
});

test('video overwrite refuses missing imported audio and ingest conformance', async () => {
	const file = new File(['video'], 'film.mp4', { type: 'video/mp4' });
	const video = { id: 'video', kind: 'video', width: 1920, height: 1080,
		frameRate: { num: 25, den: 1 }, videoCodec: 'h264', audioCodec: null,
		hasAudio: false, characteristics: { audioStreams: [{ codec: 'aac' }] } };
	assert.equal(await resolveDesktopOriginalExportSettings(file, [video]), null);
	assert.ok(await resolveDesktopOriginalExportSettings(file, [video, source]));
	assert.equal(await resolveDesktopOriginalExportSettings(file, [{ ...video,
		timingDecision: { mode: 'conform-cfr-at-ingest' } }, source]), null);
});

test('M4A codec inspection bounds work in misleading container payloads', async () => {
	const bytes = new Uint8Array(24_000);
	const view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('ftypM4A '), 4);
	for (let offset = 64; offset < 8192; offset += 64) {
		view.setUint32(offset, 16_384 - offset, false);
		bytes.set(new TextEncoder().encode('mp4a'), offset + 4);
	}
	const entry = 20_000;
	view.setUint32(entry, 80, false);
	bytes.set(new TextEncoder().encode('mp4a'), entry + 4);
	bytes.set(new TextEncoder().encode('esds'), entry + 40);
	bytes.set([4, 1, 0x40], entry + 48);
	assert.equal(await resolveDesktopOriginalExportSettings(new File([bytes], 'misleading.m4a'), [source]), null);
	// The same short AAC entry remains eligible without the misleading payload.
	const ordinary = new Uint8Array(100);
	ordinary.set(new TextEncoder().encode('ftypM4A '), 4);
	ordinary.set(bytes.subarray(entry, entry + 80), 16);
	assert.ok(await resolveDesktopOriginalExportSettings(new File([ordinary], 'ordinary.m4a'), [source]));
});
