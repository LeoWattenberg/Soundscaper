/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createHash } from 'node:crypto';

import {
	createAdmChna,
	encodeChnaPayload,
	generateAdmAxml,
	parseRiffAxmlChunk,
	parseRiffChnaChunk,
	validateAdmChnaConsistency,
} from '../src/common/editor/adm-metadata.ts';
import { createImportedAdmPassthroughMetadata } from '../src/common/editor/controller/wav-import-metadata.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import {
	createDeliveryReportForPlan,
	countUnreportedDeliveryConversions,
} from '../src/common/editor/delivery-conversion-inventory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { validateAudioEditorProject } from '../src/common/editor/project.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

/**
 * 6A-5's acceptance, run through the ordinary export path.
 *
 * The three claims the slice makes are the three tests here: passthrough is
 * byte-identical to what it was before immersive delivery existed, an authored
 * object programme survives a save and reopen, and a binaural delivery reports
 * which renderer placed it.
 */

const BED_5_1_4 = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Ltf', 'Rtf', 'Ltr', 'Rtr'] as const;

function immersiveProject(objects: readonly Record<string, unknown>[] = []) {
	return createCurrentAudioEditorProject({
		id: 'immersive-acceptance',
		title: 'Immersive master',
		now: '2026-08-18T12:00:00.000Z',
		masterChannels: BED_5_1_4.length + objects.length,
		sources: [
			{
				id: 'bed-source', storageKey: 'pcm/bed', name: 'Bed', mimeType: 'audio/wav',
				frameCount: 4, channelCount: 10, sampleRate: 48_000, sampleFormat: 'float32',
			},
			{
				id: 'voice-source', storageKey: 'pcm/voice', name: 'Voice', mimeType: 'audio/wav',
				frameCount: 4, channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32',
			},
		],
		clips: [
			{ id: 'bed-clip', sourceId: 'bed-source', durationFrames: 4 },
			{ id: 'voice-clip', sourceId: 'voice-source', durationFrames: 4 },
		],
		tracks: [
			{ type: 'audio', id: 'bed', name: 'Bed', clipIds: ['bed-clip'] },
			{ type: 'audio', id: 'voice', name: 'Voice', clipIds: ['voice-clip'] },
		],
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Immersive programme', language: 'eng' },
				content: { name: 'Main', language: 'eng' },
				bed: {
					name: '5.1.4 bed',
					layout: '5.1.4',
					assignments: BED_5_1_4.map((bedChannel, sourceChannel) => ({
						stripKind: 'track' as const, stripId: 'bed', sourceChannel, bedChannel,
					})),
				},
				...(objects.length ? { objects } : {}),
			},
		},
	});
}

const NARRATOR = Object.freeze({
	id: 'narrator', name: 'Narrator', stripKind: 'track', stripId: 'voice',
	sourceChannel: 0, gain: 0.8, position: { azimuth: -25, elevation: 15, distance: 0.6 },
});

test('an authored object project round-trips a save and reopen unchanged', () => {
	const project = immersiveProject([NARRATOR]);
	assert.equal(validateAudioEditorProject(project as never), true);

	// A save is JSON and a reopen is validation, so this is the whole round trip.
	const reopened = JSON.parse(JSON.stringify(project));
	assert.equal(validateAudioEditorProject(reopened), true);
	assert.deepEqual(reopened.metadata.adm, JSON.parse(JSON.stringify(project.metadata.adm)));
	assert.equal(reopened.metadata.adm.objects.length, 1);
	assert.deepEqual(reopened.metadata.adm.objects[0].position, {
		azimuth: -25, elevation: 15, distance: 0.6,
	});
	assert.equal(reopened.masterChannels, 11, 'the bed plus its object');

	// And the project declares the capability it needs, so opening it somewhere
	// without immersive delivery reports the loss rather than dropping it.
	assert.ok(
		project.featureRequirements.requirements.some(
			({ id }: { id: string }) => id === 'soundscaper.immersive-adm',
		),
		'the immersive requirement is declared',
	);
});

test('an object programme reaches a BW64 whose CHNA and AXML agree with each other', () => {
	const project = immersiveProject([NARRATOR]);
	const plan = createExportPlan(project, { format: 'bw64', dither: 'none' });
	assert.equal(plan.channelCount, 11);
	assert.deepEqual([...(plan.adm?.channelOrder ?? [])], [...BED_5_1_4, 'narrator']);

	const bytes = encodeWav(
		Array.from({ length: 11 }, (_value, channel) => Float32Array.of(channel / 20, 0, -channel / 20, 0)),
		{
			container: 'bw64', sampleRate: plan.sampleRate, bitDepth: 24, dither: 'none',
			bext: plan.bext, preDataChunks: plan.preDataChunks, trailingChunks: plan.trailingChunks,
		},
	);
	const chna = parseRiffChnaChunk(chunkPayload(bytes, 'chna'));
	const axml = parseRiffAxmlChunk(chunkPayload(bytes, 'axml'));
	validateAdmChnaConsistency(axml, chna, 11);
	assert.equal(chna.numTracks, 11);
	assert.equal(axml.objects.length, 2, 'the bed and one object');
	assert.ok(axml.rawXml.includes('<position coordinate="azimuth">-25.0</position>'));
});

test('immersive delivery is itemized, and nothing about it goes unreported', () => {
	const project = immersiveProject([NARRATOR]);
	const plan = createExportPlan(project, { format: 'bw64', dither: 'none' });
	const report = createDeliveryReportForPlan(plan, { sampleRate: project.sampleRate });
	const codes = report.items.map(({ code }: { code: string }) => code);
	assert.ok(codes.includes('delivery.adm-immersive-bed'));
	assert.ok(codes.includes('delivery.adm-objects'));
	assert.equal(countUnreportedDeliveryConversions(plan, { sampleRate: project.sampleRate }, report), 0);
});

test('a binaural delivery reports the renderer that placed it', () => {
	const project = immersiveProject([NARRATOR]);
	const plan = createExportPlan(project, { format: 'wav', binaural: true, dither: 'none' });
	assert.equal(plan.channelCount, 2, 'headphones have two ears');
	assert.equal(plan.binaural?.sourceChannelCount, 11);

	const report = createDeliveryReportForPlan(plan, { sampleRate: project.sampleRate });
	const item = report.items.find(({ code }: { code: string }) => code === 'delivery.binaural-render');
	assert.equal(item?.severity, 'warning');
	assert.equal(item?.data.renderer, 'parametric-spherical-head');
	assert.equal(item?.data.bedLayout, '5.1.4');
	assert.equal(item?.data.objects, 1);
	assert.equal(countUnreportedDeliveryConversions(plan, { sampleRate: project.sampleRate }, report), 0);

	// The refusals stay refusals, at plan time where they can still be acted on.
	assert.throws(
		() => createExportPlan(project, { format: 'bw64', binaural: true, dither: 'none' }),
		/container-declares-a-different-programme/u,
	);
	assert.throws(
		() => createExportPlan(project, { format: 'wav', binaural: true, mode: 'stems' }),
		/stems/u,
	);
});

test('an ADM passthrough delivery still reproduces its pristine bytes exactly', async () => {
	// Byte preservation is the whole passthrough contract, and 6A-5 must not have
	// come near it. The check is a digest of the chunks the plan reproduces, not a
	// description of them, so a difference anywhere in those bytes fails.
	const chna = encodeChnaPayload(createAdmChna({ layout: 'stereo' }));
	const axml = new TextEncoder().encode(generateAdmAxml({ programmeName: 'Pristine master', layout: 'stereo' }));
	const channels = [Float32Array.of(-1, 0, 0.5), Float32Array.of(0.5, 0, -1)];
	const imported = encodeWav(channels, {
		container: 'bw64', sampleRate: 48_000, bitDepth: 24, dither: 'none',
		preDataChunks: riffChunk('chna', chna),
		trailingChunks: riffChunk('axml', axml),
	});
	const descriptor = await inspectWavBlobPcm(new Blob([imported as Uint8Array<ArrayBuffer>]));
	assert.equal(descriptor.adm?.valid, true);

	const source = {
		id: 'source', storageKey: 'pcm/source', name: 'Imported', mimeType: 'audio/wav',
		frameCount: 3, channelCount: 2, sampleRate: 48_000, sampleFormat: 'int24' as const,
	};
	const metadata = createImportedAdmPassthroughMetadata({
		candidate: descriptor.adm, source, descriptor, project: { revision: 0 },
	});
	assert.equal(metadata?.mode, 'passthrough');

	const project = createCurrentAudioEditorProject({
		id: 'passthrough-acceptance', now: '2026-08-18T12:00:00.000Z', revision: 1,
		masterChannels: 2,
		sources: [source],
		clips: [{ id: 'clip', sourceId: source.id, durationFrames: source.frameCount }],
		tracks: [{ type: 'audio', id: 'bed', name: 'Bed', clipIds: ['clip'] }],
		metadata: { adm: metadata },
	} as never);
	const plan = createExportPlan(project, { format: 'bw64', bitDepth: 24, dither: 'none' });
	assert.equal(plan.adm?.mode, 'passthrough');
	assert.equal(digest(plan.preDataChunks), digest(riffChunk('chna', chna)));
	assert.equal(digest(plan.trailingChunks), digest(riffChunk('axml', axml)));

	// And the delivery still reports byte preservation and nothing else, because
	// nothing about a passthrough is authored.
	const report = createDeliveryReportForPlan(plan, { sampleRate: project.sampleRate });
	assert.deepEqual(
		report.items.filter(({ code }: { code: string }) => code.startsWith('delivery.adm'))
			.map(({ code }: { code: string }) => code),
		['delivery.adm-passthrough'],
	);
});

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	chunk.set(new TextEncoder().encode(id), 0);
	new DataView(chunk.buffer).setUint32(4, payload.byteLength, true);
	chunk.set(payload, 8);
	return chunk;
}

function digest(value: Uint8Array | readonly Uint8Array[] | undefined): string {
	assert.ok(value, 'the plan reproduces the pristine chunks');
	const hash = createHash('sha256');
	for (const chunk of Array.isArray(value) ? value : [value as Uint8Array]) hash.update(chunk);
	return hash.digest('hex');
}

/**
 * Walk a BW64's chunks, honouring the 64-bit size a `data` chunk declares in
 * ds64 rather than the 32-bit sentinel it writes in its own header.
 */
function chunkPayload(bytes: Uint8Array, id: string): Uint8Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (offset: number) => new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
	let dataBytes = 0;
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const chunkId = ascii(offset);
		let size = view.getUint32(offset + 4, true);
		if (chunkId === 'ds64') dataBytes = Number(view.getBigUint64(offset + 16, true));
		if (chunkId === 'data' && size === 0xffff_ffff) size = dataBytes;
		if (chunkId === id) return bytes.subarray(offset, offset + 8 + size + (size & 1));
		offset += 8 + size + (size & 1);
	}
	assert.fail(`missing ${id} chunk`);
}
