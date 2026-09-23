/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFreesoundUploadQueue,
	type FreesoundDescribeUploadRequest,
} from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { createImportedSourceProvenance } from '../src/common/editor/source-provenance.ts';

test('the Freesound upload queue uploads one item at a time and keeps going after failure', async () => {
	const pending: Array<{
		readonly file: File;
		resolve(value: Readonly<{ uploadFilename: string }>): void;
		reject(error: Error): void;
	}> = [];
	const queue = createFreesoundUploadQueue({
		upload: (file) => new Promise((resolve, reject) => pending.push({ file, resolve, reject })),
		describe: async () => ({ soundId: 1, status: 'pending_moderation' }),
		createId: (() => { let id = 0; return () => `upload-${String(++id)}`; })(),
	});

	queue.enqueueFiles([
		new File(['one'], 'one.wav', { type: 'audio/wav' }),
		new File(['two'], 'two.flac', { type: 'audio/flac' }),
		new File(['three'], 'three.ogg', { type: 'audio/ogg' }),
	]);
	await tick();
	assert.equal(pending.length, 1);
	assert.equal(pending[0]?.file.name, 'one.wav');
	assert.deepEqual(queue.getSnapshot().items.map(({ status }) => status), [
		'uploading', 'queued', 'queued',
	]);

	pending.shift()?.resolve({ uploadFilename: 'one-remote.wav' });
	await tick();
	assert.equal(pending.length, 1);
	assert.equal(pending[0]?.file.name, 'two.flac');
	assert.deepEqual(queue.getSnapshot().items.map(({ status }) => status), [
		'ready-to-publish', 'uploading', 'queued',
	]);

	pending.shift()?.reject(new Error('Quota reached'));
	await tick();
	assert.equal(pending.length, 1);
	assert.equal(pending[0]?.file.name, 'three.ogg');
	assert.deepEqual(queue.getSnapshot().items.map(({ status }) => status), [
		'ready-to-publish', 'failed', 'uploading',
	]);
	assert.equal(queue.getSnapshot().items[1]?.errorMessage, 'Quota reached');
});

test('clip materialization runs inside the FIFO and provides publish defaults', async () => {
	const calls: string[] = [];
	const queue = createFreesoundUploadQueue({
		materializeClip: async ({ clipId }) => {
			calls.push(`materialize:${clipId}`);
			return {
				file: new File(['clip'], 'Rendered clip.wav', { type: 'audio/wav' }),
				clipTitle: 'Interview extract',
				description: 'Recorded with Field microphone',
			};
		},
		upload: async (file) => {
			calls.push(`upload:${file.name}`);
			return { uploadFilename: 'remote-render.wav' };
		},
		describe: async () => ({ soundId: 2, status: 'pending_processing' }),
		createId: () => 'clip-upload',
	});

	const firstId = queue.enqueueClip({ projectId: 'project-a', clipId: 'clip-a', clipTitle: 'Clip A' });
	const duplicateId = queue.enqueueClip({ projectId: 'project-a', clipId: 'clip-a', clipTitle: 'Clip A' });
	assert.equal(duplicateId, firstId);
	await settled(queue);
	const item = queue.getSnapshot().items[0];
	assert.deepEqual(calls, ['materialize:clip-a', 'upload:Rendered clip.wav']);
	assert.equal(item?.status, 'ready-to-publish');
	assert.equal(item?.title, 'Interview extract');
	assert.equal(item?.description, 'Recorded with Field microphone');
	assert.equal(item?.uploadFilename, 'remote-render.wav');
	assert.equal(queue.getSnapshot().items.length, 1);
});

test('unsupported-but-decodable files are prepared as WAV before upload', async () => {
	const calls: string[] = [];
	const queue = createFreesoundUploadQueue({
		prepareFile: async (file) => {
			calls.push(`prepare:${file.name}`);
			return new File(['wav'], 'voice.wav', { type: 'audio/wav' });
		},
		upload: async (file) => {
			calls.push(`upload:${file.name}`);
			return { uploadFilename: 'voice.wav' };
		},
		describe: async () => ({ status: 'submitted' }),
		createId: () => 'voice-upload',
	});
	queue.enqueueFiles([new File(['m4a'], 'voice.m4a', { type: 'audio/mp4' })]);
	await settled(queue);
	assert.deepEqual(calls, ['prepare:voice.m4a', 'upload:voice.wav']);
	assert.equal(queue.getSnapshot().items[0]?.fileName, 'voice.wav');
});

test('a .wave file is transcoded because the authenticated proxy admits only .wav', async () => {
	const calls: string[] = [];
	const queue = createFreesoundUploadQueue({
		prepareFile: async (file) => {
			calls.push(`prepare:${file.name}`);
			return new File(['wav'], 'voice.wav', { type: 'audio/wav' });
		},
		upload: async (file) => {
			calls.push(`upload:${file.name}`);
			return { uploadFilename: 'voice.wav' };
		},
		describe: async () => ({ status: 'submitted' }),
		createId: () => 'wave-upload',
	});
	queue.enqueueFiles([new File(['wave'], 'voice.wave', { type: 'audio/wav' })]);
	await settled(queue);
	assert.deepEqual(calls, ['prepare:voice.wave', 'upload:voice.wav']);
});

test('direct uploads get an extension-derived allowlisted MIME type', async () => {
	const uploads: File[] = [];
	const queue = createFreesoundUploadQueue({
		upload: async (file) => {
			uploads.push(file);
			return { uploadFilename: file.name };
		},
		describe: async () => ({ status: 'submitted' }),
		createId: (() => { let id = 0; return () => `mime-${String(++id)}`; })(),
	});
	queue.enqueueFiles([
		new File(['aiff'], 'field.aiff'),
		new File(['mp3'], 'interview.mp3', { type: 'application/octet-stream' }),
	]);
	await settled(queue);
	assert.deepEqual(uploads.map(({ name, type }) => ({ name, type })), [
		{ name: 'field.aiff', type: 'audio/aiff' },
		{ name: 'interview.mp3', type: 'audio/mpeg' },
	]);
});

test('publishing validates metadata and records the submitted sound', async () => {
	let request: FreesoundDescribeUploadRequest | undefined;
	const queue = createFreesoundUploadQueue({
		upload: async () => ({ uploadFilename: 'remote.wav' }),
		describe: async (value) => {
			request = value;
			return { soundId: 44, status: 'pending_moderation', soundUrl: 'https://freesound.org/s/44/' };
		},
		createId: () => 'upload-a',
	});
	queue.enqueueFiles([new File(['audio'], 'Morning birds.wav', { type: 'audio/wav' })]);
	await settled(queue);

	await assert.rejects(queue.publish('upload-a', {
		title: '', description: 'Birds', tags: ['birds'], categoryId: 'ss-n', license: 'cc-by',
	}), /title/u);
	await assert.rejects(queue.publish('upload-a', {
		title: 'Morning birds', description: 'Birds', tags: ['birds', 'dawn', 'nature'],
		categoryId: 'ss-n', license: 'cc-by',
	}), /rights/u);
	await queue.publish('upload-a', {
		title: 'Morning birds', description: 'Birds at dawn.', tags: ['birds', 'dawn', 'nature'],
		categoryId: 'ss-n', license: 'cc-by', rightsConfirmed: true,
	});

	assert.deepEqual(request, {
		uploadFilename: 'remote.wav',
		title: 'Morning birds', description: 'Birds at dawn.', tags: ['birds', 'dawn', 'nature'],
		categoryId: 'ss-n', license: 'cc-by',
	});
	const submitted = queue.getSnapshot().items[0];
	assert.equal(submitted?.status, 'submitted');
	assert.equal(submitted?.title, 'Morning birds');
	assert.equal(submitted?.description, 'Birds at dawn.');
	assert.equal(submitted?.license, 'cc-by');
	assert.equal(submitted?.rightsConfirmed, true);
	assert.equal(submitted?.soundId, 44);
	assert.equal(submitted?.remoteStatus, 'pending_moderation');
});

test('clip provenance restricts relicensing and appends immutable attribution', async () => {
	let request: FreesoundDescribeUploadRequest | undefined;
	const queue = createFreesoundUploadQueue({
		materializeClip: async () => ({
			file: new File(['clip'], 'derived.wav', { type: 'audio/wav' }),
			clipTitle: 'Derived clip',
			clip: { title: 'Derived clip', durationFrames: 4 },
			source: {
				name: 'source.wav', mimeType: 'audio/wav', sampleRate: 48_000,
				channelCount: 1, frameCount: 4,
				provenance: createImportedSourceProvenance({
					id: 'sound-42',
					origin: {
						kind: 'freesound', soundId: 42, title: 'Rain',
						soundUrl: 'https://freesound.org/s/42/', creator: 'Ada',
						creatorUrl: 'https://freesound.org/people/Ada/',
						license: { family: 'cc-by', name: 'CC BY', url: 'https://creativecommons.org/licenses/by/4.0/' },
						importedVariant: 'original', originalFileName: 'rain.wav', mimeType: 'audio/wav',
					},
					metadata: { normalized: {}, raw: {}, namespaces: {} }, attachments: [], warnings: [],
				}),
			},
		}),
		upload: async () => ({ uploadFilename: 'derived.wav' }),
		describe: async (value) => { request = value; return { status: 'submitted' }; },
		createId: () => 'derived-upload',
	});
	queue.enqueueClip({ projectId: 'project-a', clipId: 'clip-a' });
	await settled(queue);
	const item = queue.getSnapshot().items[0];
	assert.deepEqual(item?.allowedLicenses, ['cc-by']);
	assert.match(item?.attributionText ?? '', /Rain.*Ada.*CC BY/isu);
	await assert.rejects(queue.publish('derived-upload', {
		title: 'Derived clip', description: 'Edited rain.', tags: ['rain', 'field', 'edited'],
		categoryId: 'ss-n', license: 'cc0',
	}), /incompatible/iu);
	await queue.publish('derived-upload', {
		title: 'Derived clip', description: 'Edited rain.', tags: ['rain', 'field', 'edited'],
		categoryId: 'ss-n', license: 'cc-by',
	});
	assert.match(request?.description ?? '', /Required attribution/iu);
	assert.match(request?.description ?? '', /https:\/\/freesound\.org\/s\/42\//u);
});

async function tick(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function settled(queue: ReturnType<typeof createFreesoundUploadQueue>): Promise<void> {
	for (let attempt = 0; attempt < 20 && queue.getSnapshot().active; attempt += 1) await tick();
	assert.equal(queue.getSnapshot().active, false, 'queue did not settle');
}
