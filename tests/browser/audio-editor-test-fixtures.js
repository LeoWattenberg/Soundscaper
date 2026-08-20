import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { createAup3Fixture } from '../aup3-fixture.js';
import { aup4NativeRichFixture } from '../fixtures/aup4-native-rich.js';
import { encodeAudacityBinaryXml } from '../../src/common/editor/audacity-binary-xml.js';
import {
	initializeAup4Database,
	insertAup4SampleBlock,
	prepareAup4PortableExport,
	writeAup4Document,
} from '../../src/common/editor/aup4-database.js';
import { createEffect, createMissingEffect } from '../../src/common/editor/effects.js';
import {
	createAup4ProjectDocument,
	createAup4SampleBlock,
} from '../../src/common/editor/aup4-profile.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
} from '../../src/common/editor/project-current.ts';

export const AUDIO_EDITOR_PATHS = [
	{
		path: '/embed/en/',
		projectName: 'Untitled project',
		trackName: 'Track 1',
		status: 'Editor ready. Create a project or import audio.',
		arm: 'Arm for recording',
		fullscreen: 'Fullscreen',
	},
	{
		path: '/embed/de/',
		projectName: 'Unbenanntes Projekt',
		trackName: 'Spur 1',
		status: 'Editor bereit. Erstelle ein Projekt oder importiere Audio.',
		arm: 'Für Aufnahme aktivieren',
		fullscreen: 'Vollbild',
	},
];

function createWavFixture({ name, frequency, duration = 0.8, sampleRate = 48_000, channelCount = 2, channelAmplitudes = null }) {
	const frameCount = Math.round(duration * sampleRate);
	const bytesPerSample = 2;
	const dataLength = frameCount * channelCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);

	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
	buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
	buffer.writeUInt16LE(bytesPerSample * 8, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);

	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const phase = channel === 0 ? 0 : Math.PI / 3;
			const amplitude = channelAmplitudes?.[channel] ?? 0.35;
			const sample = Math.sin(2 * Math.PI * frequency * frame / sampleRate + phase) * amplitude;
			const offset = 44 + (frame * channelCount + channel) * bytesPerSample;
			buffer.writeInt16LE(Math.round(sample * 32767), offset);
		}
	}

	return { name, mimeType: 'audio/wav', buffer };
}

export const toneA = createWavFixture({ name: 'browser-tone-a.wav', frequency: 330 });
export const toneB = createWavFixture({ name: 'browser-tone-b.wav', frequency: 660 });
export const monoTone = createWavFixture({ name: 'browser-mono-tone.wav', frequency: 440, channelCount: 1 });
export const longTone = createWavFixture({ name: 'browser-long-tone.wav', frequency: 220, duration: 8, channelCount: 1 });
export const asymmetricStereoTone = createWavFixture({
	name: 'browser-asymmetric-stereo-tone.wav',
	frequency: 275,
	channelAmplitudes: [0.1, 0.7],
});
export const captionLabels = {
	name: 'browser-captions.srt',
	mimeType: 'application/x-subrip',
	buffer: Buffer.from([
		'1',
		'00:00:00,250 --> 00:00:01,500',
		'Intro caption',
		'',
		'2',
		'00:00:02,000 --> 00:00:03,250',
		'Outro caption',
		'',
	].join('\n')),
};
export const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';

let aup4FixtureSql;
export async function createAup4MissingEffectFixture() {
	const SQL = await (aup4FixtureSql ||= initSqlJs());
	const sampleRate = 48_000;
	const frameCount = sampleRate;
	const source = createAudioSource({
		id: 'missing-effects-source',
		storageKey: 'missing-effects-source',
		name: 'Missing effects source',
		frameCount,
		channelCount: 1,
		sampleRate,
		originalSampleRate: sampleRate,
	});
	const clip = createAudioClip({
		id: 'missing-effects-clip',
		sourceId: source.id,
		title: 'Missing effects audio',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
	});
	const track = createAudioTrack({
		id: 'missing-effects-track',
		name: 'Missing effects track',
		clipIds: [clip.id],
		effects: [
			createEffect('audacity-invert', { id: 'fixture-invert' }),
			createMissingEffect({
				id: 'fixture-superverb',
				enabled: true,
				missing: {
					name: 'SuperVerb',
					nativeId: 'Effect_VST3_Acme_SuperVerb_/plugins/superverb.vst3',
					reason: 'plugin-unavailable',
					source: 'aup4',
				},
			}),
			createEffect('audacity-echo', {
				id: 'fixture-echo',
				params: { delaySeconds: 0.1, decay: 0.25 },
			}),
		],
	}, sampleRate);
	const project = createCurrentAudioEditorProject({
		id: 'missing-effects-project',
		title: 'Missing effects fixture',
		sampleRate,
		sources: [source],
		clips: [clip],
		tracks: [track],
		selection: {
			startFrame: 0,
			endFrame: frameCount,
			trackIds: [track.id],
			clipIds: [clip.id],
		},
		view: { selectedTrackIds: [track.id] },
	});
	const samples = Float32Array.from(
		{ length: frameCount },
		(_value, frame) => Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.2,
	);
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const blockId = insertAup4SampleBlock(database, createAup4SampleBlock(samples));
		const channelBlocks = new Map([
			[`${source.id}:0`, [{ blockId, start: 0, sampleCount: frameCount }]],
		]);
		writeAup4Document(
			database,
			encodeAudacityBinaryXml(createAup4ProjectDocument(project, channelBlocks)),
			{ autosave: false, now: 0 },
		);
		prepareAup4PortableExport(database);
		return database.export();
	} finally {
		database.close();
	}
}

export {
	expect,
	test,
	AxeBuilder,
	createHash,
	readFile,
	initSqlJs,
	createAup3Fixture,
	aup4NativeRichFixture,
	encodeAudacityBinaryXml,
	initializeAup4Database,
	insertAup4SampleBlock,
	prepareAup4PortableExport,
	writeAup4Document,
	createEffect,
	createMissingEffect,
	createAup4ProjectDocument,
	createAup4SampleBlock,
	createAudioClip,
	createCurrentAudioEditorProject,
	createAudioSource,
	createAudioTrack,
};
