/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

function createRuntime(): ProjectImportRuntime {
	const callable = () => undefined;
	return new Proxy<Record<string, unknown>>({}, {
		get(target, name) {
			if (Object.hasOwn(target, name)) return target[name as keyof typeof target];
			if (name === 'copy') return { timelineFramesFinite: 'Frames must be finite.' };
			if (name === 'getProject') return () => ({ tracks: [], sources: [] });
			return callable;
		},
	}) as ProjectImportRuntime;
}

test('project import options resolve automatic destinations deterministically', () => {
	const service = createProjectImportService(createRuntime());
	assert.deepEqual(service.normalizeImportOptions({ projectBinVisible: true }), {
		destination: 'project-bin',
		trackId: null,
		timelineStartFrame: 0,
	});
	assert.deepEqual(service.normalizeImportOptions({
		destination: 'timeline',
		trackId: 'track-1',
		timelineStartFrame: 12.6,
		linkedVideoLocatorId: 'locator_0000000000000001',
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	}), {
		destination: 'timeline',
		trackId: 'track-1',
		timelineStartFrame: 13,
		linkedVideoLocatorId: 'locator_0000000000000001',
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});
});

test('project import options reject unsupported destinations and non-finite frames', () => {
	const service = createProjectImportService(createRuntime());
	assert.throws(() => service.normalizeImportOptions({ destination: 'library' }), /Unsupported audio import destination/u);
	assert.throws(() => service.normalizeImportTimelineStartFrame(Number.POSITIVE_INFINITY), /Frames must be finite/u);
	for (const linkedVideoLocatorId of ['', '/tmp/movie.mp4', 'https://example.test/movie.mp4', ['locator_0000000000000001']]) {
		assert.throws(
			() => service.normalizeImportOptions({
				linkedVideoLocatorId,
				linkedVideoLocatorRevision: 'revision_0000000000000001',
			}),
			/opaque linked video locator/iu,
		);
	}
	assert.throws(
		() => service.normalizeImportOptions({ linkedVideoLocatorId: 'locator_0000000000000001' }),
		/locator and revision.*together/iu,
	);
});

test('a linked video locator is refused and released for non-video imports', async () => {
	const released: string[] = [];
	const runtime = createRuntime() as Record<string, unknown>;
	runtime.isLegacyAupFile = () => false;
	runtime.isAudioEditorVideoFile = () => false;
	runtime.store = {
		async releaseLinkedVideoOriginalLocator(locatorId: string) { released.push(locatorId); return true; },
	};
	const service = createProjectImportService(runtime as ProjectImportRuntime);
	await assert.rejects(
		service.importFile({ name: 'audio.wav', size: 1 }, {
			linkedVideoLocatorId: 'locator_0000000000000001',
			linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/only be used for a video import/iu,
	);
	assert.deepEqual(released, ['locator_0000000000000001']);
});

test('already-normalized default placement remains implicit when routed to video import', async () => {
	const runtime = createRuntime() as Record<string, unknown>;
	runtime.isLegacyAupFile = () => false;
	runtime.isAudioEditorVideoFile = () => true;
	runtime.importVideoFile = async (_file: unknown, options: unknown) => options;
	const service = createProjectImportService(runtime as ProjectImportRuntime);
	const options = service.normalizeImportOptions({ destination: 'project-bin' });
	assert.equal(options.timelineStartExplicit, false);
	assert.equal(Object.keys(options).includes('timelineStartExplicit'), false);
	const routed = await service.importFile({ name: 'movie.mp4' }, options);
	assert.equal(routed, options);
	assert.equal(routed.timelineStartExplicit, false);
});

test('normalization failures release a syntactically valid chosen locator', async () => {
	const released: string[] = [];
	const runtime = createRuntime() as Record<string, unknown>;
	runtime.store = {
		async releaseLinkedVideoOriginalLocator(locatorId: string) { released.push(locatorId); return true; },
	};
	const service = createProjectImportService(runtime as ProjectImportRuntime);
	await assert.rejects(
		service.importFile({ name: 'movie.mp4' }, {
			destination: 'invalid',
			linkedVideoLocatorId: 'locator_0000000000000001',
			linkedVideoLocatorRevision: 'bad',
		}),
		/Unsupported audio import destination/u,
	);
	await assert.rejects(
		service.importFile({ name: 'movie.mp4' }, {
			linkedVideoLocatorId: 'locator_0000000000000001',
			linkedVideoLocatorRevision: 'bad',
		}),
		/locator and revision.*together/iu,
	);
	assert.deepEqual(released, ['locator_0000000000000001', 'locator_0000000000000001']);
});

test('empty, blocked, and multi-file linked imports release their unused locator', async () => {
	for (const [files, blocked] of [
		[[], false],
		[[{ name: 'movie.mp4' }], true],
		[[{ name: 'one.mp4' }, { name: 'two.mp4' }], false],
	] as const) {
		const released: string[] = [];
		const runtime = createRuntime() as Record<string, unknown>;
		runtime.editingBlocked = () => blocked;
		runtime.isAudioEditorVideoFile = () => true;
		runtime.handleError = () => undefined;
		runtime.store = {
			async releaseLinkedVideoOriginalLocator(locatorId: string) { released.push(locatorId); return true; },
		};
		const service = createProjectImportService(runtime as ProjectImportRuntime);
		await service.importFiles(files, {
			linkedVideoLocatorId: 'locator_0000000000000001',
			linkedVideoLocatorRevision: 'revision_0000000000000001',
		});
		assert.deepEqual(released, ['locator_0000000000000001']);
	}
});
