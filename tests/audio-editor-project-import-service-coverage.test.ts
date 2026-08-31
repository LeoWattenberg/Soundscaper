/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectImportService,
} from '../src/common/editor/controller/project-import-service.ts';
import {
	bextMetadata,
	commandOfType,
	createFixture,
	deferred,
	file,
} from './audio-editor-project-import-service-fixture.ts';

test('audio imports support existing tracks, project-bin placement, and decoder fallback', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	const timeline = await service.importFile(file('voice.wav'), {
		destination: 'timeline', trackId: 'target', timelineStartFrame: 7,
	});
	assert.equal(timeline.destination, 'timeline');
	assert.equal(timeline.trackId, 'target');
	assert.equal(fixture.commands.length, 1);
	assert.equal(fixture.sourceBuffers.size, 1);

	fixture.options.decodeFails = true;
	const bin = await service.importFile(file('fallback.mp3', 'audio/mpeg'), {
		destination: 'project-bin', timelineStartFrame: 0,
	});
	assert.equal(bin.destination, 'project-bin');
	assert.equal(bin.trackId, null);
	assert.equal(fixture.calls.filter((entry) => entry === 'warn-envelope').length, 2);
});

test('decoded audio imports cannot cross projects while decoding or after persistence', async () => {
	const decoding = createFixture();
	const decodeGate = deferred<void>();
	decoding.options.decodeGate = decodeGate.promise;
	const decodeOperation = createProjectImportService(decoding.runtime).importFile(
		file('deferred.mp3', 'audio/mpeg'),
	);
	while (!decoding.calls.includes('decode-started')) await Promise.resolve();
	decoding.setProject({ id: 'replacement', tracks: [], sources: [] });
	decodeGate.resolve();
	await assert.rejects(decodeOperation, /project changed during audio import/iu);
	assert.equal(decoding.commands.length, 0);
	assert.deepEqual(decoding.deletedSources, []);

	const persisted = createFixture();
	const peakGate = deferred<void>();
	persisted.options.peakGate = peakGate.promise;
	const persistedOperation = createProjectImportService(persisted.runtime).importFile(
		file('persisted.mp3', 'audio/mpeg'),
	);
	while (!persisted.calls.includes('peaks-started')) await Promise.resolve();
	persisted.setProject({ id: 'replacement', tracks: [], sources: [] });
	peakGate.resolve();
	await assert.rejects(persistedOperation, /project changed during audio import/iu);
	assert.equal(persisted.commands.length, 0);
	assert.deepEqual(persisted.deletedSources, ['source-1']);
	assert.equal(persisted.sourceBuffers.size, 0);
	assert.equal(persisted.sourcePeaks.size, 0);
});

test('audio imports create indexed tracks and clean persisted data after analysis failure', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	const created = await service.importFile(file('new-track.mp3', 'audio/mpeg'), {
		destination: 'timeline', trackId: null, trackIndex: 1, timelineStartFrame: 3,
	});
	assert.match(created.trackId, /^track-/u);

	fixture.options.peakFails = true;
	await assert.rejects(() => service.importFile(file('broken.mp3', 'audio/mpeg')), /peaks failed/u);
	assert.equal(fixture.deletedSources.length, 1);
	assert.equal(fixture.sourcePeaks.size, 1);

	fixture.options.peakFails = false;
	fixture.options.writerFails = true;
	await assert.rejects(() => service.importFile(file('writer.mp3', 'audio/mpeg')), /write failed/u);
	assert.equal(fixture.calls.includes('writer-abort'), true);
});

test('decoded audio rollback preserves the import failure and removes persisted peaks', async () => {
	const fixture = createFixture();
	const deletedAnalysis: string[] = [];
	fixture.options.commitFails = true;
	fixture.runtime.store.deleteAnalysis = async (key: string) => { deletedAnalysis.push(key); };
	fixture.runtime.store.deleteSource = async () => { throw new Error('source cleanup failed'); };

	await assert.rejects(
		createProjectImportService(fixture.runtime).importFile(file('rollback.mp3', 'audio/mpeg')),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.cause), /commit failed/u);
			assert.match(String(error.errors[0]), /commit failed/u);
			assert.match(String(error.errors[1]), /source cleanup failed/u);
			return true;
		},
	);
	assert.deepEqual(deletedAnalysis, ['peaks:source-1']);
});

test('incremental WAV imports stream PCM and roll back activation failures', async () => {
	const fixture = createFixture();
	fixture.options.incrementalDescriptor = {
		channelCount: 2, frameCount: 64, sampleRate: 48_000, pcmBytes: 512,
	};
	const service = createProjectImportService(fixture.runtime);
	const result = await service.importFile(file('large.wav'));
	assert.equal(result.destination, 'timeline');
	assert.equal(fixture.sourceChunkProviders.size, 1);

	fixture.options.activateFails = true;
	await assert.rejects(() => service.importFile(file('activation.wav')), /activate failed/u);
	assert.equal(fixture.deletedSources.length, 1);
	assert.equal(fixture.sourceBuffers.size, 0);

	fixture.options.activateFails = false;
	fixture.options.writerFails = true;
	await assert.rejects(() => service.importFile(file('stream-write.wav')), /write failed/u);
	assert.equal(fixture.calls.includes('writer-abort'), true);
});

test('incremental PCM imports cannot cross projects after persistence', async () => {
	const fixture = createFixture();
	fixture.options.incrementalDescriptor = {
		channelCount: 2, frameCount: 64, sampleRate: 48_000, pcmBytes: 512,
	};
	const activationGate = deferred<void>();
	fixture.options.activationGate = activationGate.promise;
	const operation = createProjectImportService(fixture.runtime).importFile(file('large.wav'));
	while (!fixture.calls.includes('activate:source-1')) await Promise.resolve();
	fixture.setProject({ id: 'replacement', tracks: [], sources: [] });
	activationGate.resolve();

	await assert.rejects(operation, /project changed during audio import/iu);
	assert.equal(fixture.commands.length, 0);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.equal(fixture.sourceChunkProviders.size, 0);
});

test('small, multichannel, invalid, and unsliceable WAVs use the regular decoder path', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	fixture.options.incrementalDescriptor = {
		channelCount: 1, frameCount: 2, sampleRate: 48_000, pcmBytes: 8,
	};
	await service.importFile(file('small.wav'));
	fixture.options.incrementalDescriptor = {
		channelCount: 6, frameCount: 64, sampleRate: 48_000, pcmBytes: 512,
	};
	await service.importFile(file('surround.wav'));
	fixture.options.inspectThrows = true;
	await service.importFile(file('invalid-header.wav'));
	const unsliceable = { ...file('unsliceable.wav'), slice: undefined };
	await service.importFile(unsliceable);
	assert.equal(fixture.commands.length, 4);
});

test('regular BWF imports preserve source metadata, seed the project once, and spot later sources', async () => {
	const fixture = createFixture();
	fixture.runtime.copy.bextMetadataImportWarning = 'Broadcast-WAV-Metadaten wurden normalisiert.';
	fixture.options.incrementalDescriptor = {
		channelCount: 1,
		frameCount: 2,
		sampleRate: 44_100,
		pcmBytes: 8,
		bext: bextMetadata('44100'),
		metadataWarnings: [{ code: 'bext-field', message: 'A recoverable BEXT field was normalized.' }],
	};
	const service = createProjectImportService(fixture.runtime);
	const first = await service.importFile(file('first-broadcast.wav'), { destination: 'timeline' });
	const firstCommand = fixture.commands[0]?.command;
	const firstSource = commandOfType(firstCommand, 'source/add')?.source as {
		opaqueExtensions?: { bext?: Record<string, unknown> };
	};
	const firstMetadata = commandOfType(firstCommand, 'metadata/update')?.changes as {
		bext?: Record<string, unknown>;
	};
	const firstClip = commandOfType(firstCommand, 'clip/add')?.clip as { timelineStartFrame?: number };
	assert.deepEqual(firstSource.opaqueExtensions?.bext, bextMetadata('44100'));
	assert.equal(firstMetadata.bext?.version, 2);
	assert.equal(firstMetadata.bext?.timeReference, '48000');
	assert.equal(firstClip.timelineStartFrame, 0);
	assert.equal(first.notice, 'Broadcast-WAV-Metadaten wurden normalisiert.');

	fixture.options.incrementalDescriptor = {
		...fixture.options.incrementalDescriptor,
		bext: bextMetadata('88200'),
		metadataWarnings: [],
	};
	await service.importFile(file('second-broadcast.wav'), { destination: 'timeline' });
	const secondCommand = fixture.commands[1]?.command;
	assert.equal(commandOfType(secondCommand, 'metadata/update'), undefined);
	const secondClip = commandOfType(secondCommand, 'clip/add')?.clip as { timelineStartFrame?: number };
	assert.equal(secondClip.timelineStartFrame, 48_000);
});

test('BWF spotting respects explicit and project-bin placement and warns on invalid deltas', async () => {
	const fixture = createFixture();
	fixture.runtime.copy.bextMetadataImportWarning = 'Broadcast-WAV-Metadaten wurden normalisiert.';
	fixture.runtime.copy.bextSpotOutOfRangeWarning = 'Die Quelle wurde bei Frame null platziert.';
	fixture.setProject({
		id: 'current',
		metadata: { bext: { ...bextMetadata('96000'), version: 2 } },
		tracks: [{ id: 'target', type: 'audio' }],
		sources: [],
	});
	fixture.options.incrementalDescriptor = {
		channelCount: 1,
		frameCount: 2,
		sampleRate: 48_000,
		pcmBytes: 8,
		bext: bextMetadata('48000'),
		metadataWarnings: [],
	};
	const service = createProjectImportService(fixture.runtime);
	await service.importFile(file('explicit.wav'), {
		destination: 'timeline',
		trackId: 'target',
		timelineStartFrame: 73,
	});
	const explicitClip = commandOfType(fixture.commands[0]?.command, 'clip/add')?.clip as { timelineStartFrame?: number };
	assert.equal(explicitClip.timelineStartFrame, 73);

	await service.importFile(file('bin.wav'), { destination: 'project-bin' });
	const binClip = commandOfType(fixture.commands[1]?.command, 'project-bin/add')?.clip as { timelineStartFrame?: number };
	assert.equal(binClip.timelineStartFrame, 0);

	const negative = await service.importFile(file('negative.wav'), { destination: 'timeline' });
	const negativeClip = commandOfType(fixture.commands[2]?.command, 'clip/add')?.clip as { timelineStartFrame?: number };
	assert.equal(negativeClip.timelineStartFrame, 0);
	assert.match(String(negative.notice), /Frame null/u);

	fixture.options.incrementalDescriptor = {
		...fixture.options.incrementalDescriptor,
		bext: bextMetadata('18446744073709551615'),
	};
	const unsafe = await service.importFile(file('unsafe.wav'), { destination: 'timeline' });
	const unsafeClip = commandOfType(fixture.commands[3]?.command, 'clip/add')?.clip as { timelineStartFrame?: number };
	assert.equal(unsafeClip.timelineStartFrame, 0);
	assert.match(String(unsafe.notice), /Frame null/u);

	fixture.setProject({
		id: 'current',
		metadata: { bext: { ...bextMetadata('9007199254740993'), version: 2 } },
		tracks: [{ id: 'target', type: 'audio' }],
		sources: [],
	});
	fixture.options.incrementalDescriptor = {
		...fixture.options.incrementalDescriptor,
		bext: bextMetadata('9007199254740994'),
	};
	await service.importFile(file('large-exact-reference.wav'), { destination: 'timeline' });
	const exactClip = commandOfType(fixture.commands[4]?.command, 'clip/add')?.clip as { timelineStartFrame?: number };
	assert.equal(exactClip.timelineStartFrame, 1);
});

test('incremental BWF import metadata is atomic with source activation and commit', async () => {
	const success = createFixture();
	success.options.incrementalDescriptor = {
		channelCount: 2,
		frameCount: 64,
		sampleRate: 48_000,
		pcmBytes: 512,
		bext: bextMetadata('96000'),
		metadataWarnings: [{ code: 'bext-version', message: 'Imported legacy BEXT metadata.' }],
	};
	const successfulResult = await createProjectImportService(success.runtime).importFile(file('incremental-bwf.wav'));
	const successfulCommand = success.commands[0]?.command;
	const successfulSource = commandOfType(successfulCommand, 'source/add')?.source as {
		opaqueExtensions?: { bext?: Record<string, unknown> };
	};
	assert.deepEqual(successfulSource.opaqueExtensions?.bext, bextMetadata('96000'));
	assert.equal(
		(commandOfType(successfulCommand, 'metadata/update')?.changes as { bext?: { timeReference?: string } }).bext?.timeReference,
		'96000',
	);
	assert.match(String(successfulResult.notice), /legacy BEXT metadata/u);

	const activationFailure = createFixture();
	activationFailure.options.incrementalDescriptor = {
		channelCount: 2,
		frameCount: 64,
		sampleRate: 48_000,
		pcmBytes: 512,
		bext: bextMetadata('96000'),
		metadataWarnings: [],
	};
	activationFailure.options.activateFails = true;
	await assert.rejects(
		() => createProjectImportService(activationFailure.runtime).importFile(file('activation-bwf.wav')),
		/activate failed/u,
	);
	assert.equal(activationFailure.commands.length, 0);
	assert.equal(activationFailure.deletedSources.length, 1);

	const commitFailure = createFixture();
	commitFailure.options.incrementalDescriptor = {
		channelCount: 2,
		frameCount: 64,
		sampleRate: 48_000,
		pcmBytes: 512,
		bext: bextMetadata('96000'),
		metadataWarnings: [],
	};
	commitFailure.options.commitFails = true;
	await assert.rejects(
		() => createProjectImportService(commitFailure.runtime).importFile(file('commit-bwf.wav')),
		/commit failed/u,
	);
	assert.equal(commitFailure.commands.length, 0);
	assert.equal(commitFailure.deletedSources.length, 1);
});

test('structured legacy AUP imports persist PCM chunks, progress, and warnings', async () => {
	const legacy = createFixture();
	const legacyResult = await createProjectImportService(legacy.runtime).importFile(file('session.aup'));
	assert.equal(legacyResult.notice, 'AUP imported. Warning: converted.');
	assert.equal(legacy.calls.filter((entry) => entry.startsWith('write:')).length, 1);
	assert.equal(legacy.calls.includes('save-project'), true);
	assert.equal(legacy.statuses.some(([message]) => message === 'Importing AUP 0%'), true);
});

test('legacy AUP imports cannot cross projects while decoding or after persistence', async () => {
	const decoding = createFixture();
	const decodeGate = deferred<void>();
	decoding.options.legacyDecodeGate = decodeGate.promise;
	const decodeOperation = createProjectImportService(decoding.runtime).importFile(file('session.aup'));
	while (!decoding.calls.includes('legacy-decode-started')) await Promise.resolve();
	decoding.setProject({ id: 'replacement', tracks: [], sources: [] });
	decodeGate.resolve();

	await assert.rejects(decodeOperation, /project changed during Audacity project import/iu);
	assert.equal(decoding.calls.includes('save-project'), false);
	assert.equal(decoding.calls.some((entry) => entry.startsWith('switch:')), false);
	assert.deepEqual(decoding.deletedSources, []);

	const persisted = createFixture();
	const peakGate = deferred<void>();
	persisted.options.peakGate = peakGate.promise;
	const persistedOperation = createProjectImportService(persisted.runtime).importFile(file('session.aup'));
	while (!persisted.calls.includes('peaks-started')) await Promise.resolve();
	persisted.setProject({ id: 'replacement', tracks: [], sources: [] });
	peakGate.resolve();

	await assert.rejects(persistedOperation, /project changed during Audacity project import/iu);
	assert.equal(persisted.calls.includes('save-project'), false);
	assert.equal(persisted.calls.some((entry) => entry.startsWith('switch:')), false);
	assert.deepEqual(persisted.deletedSources, ['structured-source']);
});

test('legacy AUP imports reject malformed descriptors and clean completed source writes', async () => {
	const malformed = createFixture();
	malformed.options.structuredDecoded = { warnings: [], sources: [] };
	await assert.rejects(
		() => createProjectImportService(malformed.runtime).importFile(file('malformed.aup')),
		/Structured project required/iu,
	);

	const missing = createFixture();
	missing.options.structuredDecoded = {
		project: { id: 'bad', sources: [] },
		sources: [{ sourceId: 'absent', channels: [] }],
		warnings: [],
	};
	await assert.rejects(
		() => createProjectImportService(missing.runtime).importFile(file('missing.aup')),
		/Missing absent/iu,
	);

	const invalidPcm = createFixture();
	invalidPcm.options.structuredDecoded = {
		project: {
			id: 'bad-pcm',
			sources: [{
				id: 'structured-source', name: 'Bad source', mimeType: 'audio/wav',
				sampleRate: 48_000, channelCount: 1, frameCount: 2,
			}],
		},
		sources: [{ sourceId: 'structured-source', channels: [Float32Array.of(1)] }],
		warnings: [],
	};
	await assert.rejects(
		() => createProjectImportService(invalidPcm.runtime).importFile(file('bad-pcm.aup')),
		/Invalid Bad source/iu,
	);
});

test('multi-file imports skip legacy blocks, summarize failures, and offset target tracks', async () => {
	const legacy = createFixture();
	legacy.options.videoFailureName = 'bad.mp4';
	const legacyService = createProjectImportService(legacy.runtime);
	await legacyService.importFiles([
		file('project.aup'),
		file('e000.au'),
		file('good.mp4', 'video/mp4'),
		file('bad.mp4', 'video/mp4'),
	]);
	assert.equal(legacy.statuses.at(-1)?.[0], '2 succeeded, 1 failed');
	assert.equal(legacy.calls.includes('error:video failed'), true);
	assert.equal((legacy.runtime.state as { importing: boolean }).importing, false);

	const placement = createFixture();
	await createProjectImportService(placement.runtime).importFiles([
		file('one.mp4', 'video/mp4'),
		file('two.mp4', 'video/mp4'),
	], { destination: 'timeline', trackId: 'target', timelineStartFrame: 9 });
	assert.deepEqual(placement.placements, [
		{ destination: 'timeline', trackId: 'target', timelineStartFrame: 9 },
		{ destination: 'timeline', trackId: null, timelineStartFrame: 9, trackIndex: 1 },
	]);
	assert.equal(placement.statuses.at(-1)?.[0], 'one.mp4 imported two.mp4 imported');

	placement.options.blocked = true;
	assert.equal(await createProjectImportService(placement.runtime).importFiles([file('ignored.mp4', 'video/mp4')]), undefined);
	assert.equal(await createProjectImportService(placement.runtime).importFiles([]), undefined);
});

test('import options reject invalid tracks and unsafe frame values', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	assert.throws(() => service.normalizeImportTimelineStartFrame(Number.MAX_VALUE), /finite/iu);
	assert.throws(() => service.normalizeImportOptions({ destination: 'elsewhere' }), /Unsupported/u);
	await assert.rejects(
		() => service.importFile(file('missing-track.mp3', 'audio/mpeg'), {
			destination: 'timeline', trackId: 'missing', timelineStartFrame: 0,
		}),
		/Audio track not found/iu,
	);
	fixture.setProject({ id: 'current', tracks: [{ id: 'video', type: 'video' }], sources: [] });
	await assert.rejects(
		() => service.importFile(file('video-track.mp3', 'audio/mpeg'), {
			destination: 'timeline', trackId: 'video', timelineStartFrame: 0,
		}),
		/Audio track not found/iu,
	);
});
