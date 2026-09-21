/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorController } from '../src/common/editor/app.js';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { ControllerOptions } from '../src/common/editor/controller/composition/controller-options.ts';

const COPY = Object.freeze({
	ready: 'Ready', untitledProject: 'Untitled', track: 'Track',
	projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
	genericError: 'Error: {message}', unknownError: 'Unknown error',
});

const SOUND_WITHOUT_PREVIEW = Object.freeze({
	id: 42,
	name: 'Rain close.ogg',
	pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	description: 'Steady rain near a window.',
	tags: ['rain'],
	category: 'Sound effects',
	subcategory: 'Weather',
	createdAt: '2026-04-16T20:07:11.145',
	license: {
		code: 'cc-by', name: 'Attribution 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		requiresAttribution: true, commercialUseAllowed: true,
	},
	generativeAiPreference: null,
	explicit: false,
	durationSeconds: 12.25,
	originalFile: {
		format: 'ogg', channels: 2, byteLength: 4_096, sampleRate: 48_000,
		md5: '0123456789abcdef0123456789abcdef',
	},
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: false, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
});

test('Soundscaper composes Freesound actions against the configured owned proxy', async () => {
	const requested: string[] = [];
	const controller = createController('soundscaper', async (input) => {
		requested.push(String(input));
		return Response.json({ data: {
			query: 'rain', page: 1, pageSize: 20, totalCount: 0, totalPages: 0,
			hasNextPage: false, hasPreviousPage: false, results: [],
		} });
	});
	try {
		const result = await controller.actions.freesound.search({ query: 'rain' });
		assert.equal(result.totalCount, 0);
		assert.deepEqual(requested, ['https://proxy.example/api/freesound/search?q=rain&page=1&license=all&sort=relevance']);
		assert.equal(
			controller.actions.freesound.previewUrl(42),
			'https://proxy.example/api/freesound/sounds/42/preview',
		);
	} finally {
		await controller.dispose();
	}
});

test('Framescaper keeps the Freesound action boundary disabled', async () => {
	const controller = createController('framescaper', async () => {
		throw new Error('Framescaper must not request Freesound.');
	});
	try {
		await assert.rejects(controller.actions.freesound.search({ query: 'rain' }), /unavailable/iu);
		assert.throws(() => controller.actions.freesound.previewUrl(42), /unavailable/iu);
	} finally {
		await controller.dispose();
	}
});

test('desktop Freesound actions default to the public Soundscaper proxy', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null }),
		fileService: createAudioEditorFileService({ bridge: {} }),
		freesoundFetch: async () => { throw new Error('Preview URL generation must not fetch.'); },
	});
	try {
		assert.equal(
			controller.actions.freesound.previewUrl(42),
			'https://soundscaper.org/api/freesound/sounds/42/preview',
		);
	} finally {
		await controller.dispose();
	}
});

test('Freesound import owns controller import admission for the whole network request', async () => {
	const detail = deferred<Response>();
	let requests = 0;
	const controller = createController('soundscaper', async () => {
		requests += 1;
		return detail.promise;
	});
	try {
		await controller.ready;
		const first = controller.actions.freesound.importSound({ soundId: 42, destination: 'project-bin' });
		const firstFailure = assert.rejects(first, /no HQ OGG preview/iu);
		assert.equal(controller.getSnapshot().importing, true);
		await assert.rejects(
			controller.actions.freesound.importSound({ soundId: 43, destination: 'project-bin' }),
			/editing is blocked/iu,
		);
		await waitFor(() => requests === 1);
		assert.equal(requests, 1);
		detail.resolve(Response.json({ data: SOUND_WITHOUT_PREVIEW }));
		await firstFailure;
		assert.equal(controller.getSnapshot().importing, false);
	} finally {
		await controller.dispose();
	}
});

test('Freesound import refuses to publish after the active project loses write authority', async () => {
	const detail = deferred<Response>();
	const lost = deferred<void>();
	let acquisitions = 0;
	let detailRequested = false;
	let previewRequested = false;
	const controller = createController('soundscaper', async (input) => {
		if (String(input).endsWith('/preview')) {
			previewRequested = true;
			return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
				headers: { 'Content-Type': 'audio/ogg' },
			});
		}
		detailRequested = true;
		return detail.promise;
	}, {
		acquireProjectLock: async (projectId) => {
			acquisitions += 1;
			return acquisitions === 1 ? {
				projectId, readOnly: false, method: 'test', lost: lost.promise, release() {},
			} : {
				projectId, readOnly: true, method: 'test', retryAt: Date.now() + 60_000, release() {},
			};
		},
	});
	try {
		await controller.ready;
		const initialProject = controller.getSnapshot().project;
		assert.ok(initialProject);
		assert.ok(Array.isArray(initialProject.sources));
		const initialSourceCount = initialProject.sources.length;
		const operation = controller.actions.freesound.importSound({ soundId: 42, destination: 'project-bin' });
		const refusal = assert.rejects(operation, /became read-only/iu);
		await waitFor(() => detailRequested && acquisitions === 1 && controller.getSnapshot().importing === true);
		lost.resolve();
		await waitFor(() => controller.getSnapshot().readOnly === true);
		detail.resolve(Response.json({ data: { ...SOUND_WITHOUT_PREVIEW, preview: {
			available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192,
		} } }));
		await refusal;
		assert.equal(previewRequested, false);
		const finalProject = controller.getSnapshot().project;
		assert.ok(finalProject);
		assert.ok(Array.isArray(finalProject.sources));
		assert.equal(finalProject.sources.length, initialSourceCount);
		assert.equal(controller.getSnapshot().importing, false);
	} finally {
		await controller.dispose();
	}
});

function createController(
	productId: string,
	freesoundFetch: typeof fetch,
	overrides: Partial<ControllerOptions> = {},
) {
	return createAudioEditorController(null, {
		headless: true,
		productId,
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null }),
		fileService: createAudioEditorFileService(),
		freesoundFetch,
		freesoundApiBaseUrl: 'https://proxy.example',
		...overrides,
	});
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => { resolve = complete; });
	return Object.freeze({ promise, resolve });
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('Timed out waiting for controller state.');
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}
