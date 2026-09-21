/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorController } from '../src/common/editor/app.js';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFreesoundWorkspaceActions } from '../src/common/editor/ui/workspace/freesound-workspace-service.ts';
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

test('the lazy Soundscaper workspace service searches through the configured owned proxy', async () => {
	const requested: string[] = [];
	const controller = createController('soundscaper');
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async (input) => {
			requested.push(String(input));
			return emptySearchResponse();
		},
	});
	try {
		const result = await actions.search({ query: 'rain' });
		assert.equal(result.totalCount, 0);
		assert.deepEqual(requested, ['https://proxy.example/api/freesound/search?q=rain&page=1&license=all&sort=relevance']);
	} finally {
		await controller.dispose();
	}
});

test('the eager controller has no Freesound group and the lazy boundary rejects Framescaper', async () => {
	const controller = createController('framescaper');
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async () => { throw new Error('Framescaper must not request Freesound.'); },
	});
	try {
		assert.equal(Object.hasOwn(controller.actions, 'freesound'), false);
		await assert.rejects(actions.search({ query: 'rain' }), /unavailable/iu);
	} finally {
		await controller.dispose();
	}
});

test('the packaged workspace service defaults to the public Soundscaper proxy', async () => {
	let requestedUrl = '';
	const controller = createController('soundscaper');
	const actions = createFreesoundWorkspaceActions(controller, {
		fetch: async (input) => {
			requestedUrl = String(input);
			return emptySearchResponse();
		},
	});
	try {
		await actions.search({ query: 'rain' });
		assert.equal(requestedUrl, 'https://soundscaper.org/api/freesound/search?q=rain&page=1&license=all&sort=relevance');
	} finally {
		await controller.dispose();
	}
});

test('the workspace service admits only one Freesound import at a time', async () => {
	const detail = deferred<Response>();
	let requests = 0;
	const controller = createController('soundscaper');
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async () => { requests += 1; return detail.promise; },
	});
	try {
		await controller.ready;
		const first = actions.importSound({ soundId: 42, destination: 'project-bin' });
		const firstFailure = assert.rejects(first, /no HQ OGG preview/iu);
		await assert.rejects(
			actions.importSound({ soundId: 43, destination: 'project-bin' }),
			/import is already in progress/iu,
		);
		assert.equal(requests, 1);
		detail.resolve(Response.json({ data: SOUND_WITHOUT_PREVIEW }));
		await firstFailure;
	} finally {
		await controller.dispose();
	}
});

test('a normal import that starts during download explicitly supersedes the Freesound import', async () => {
	const detail = deferred<Response>();
	let importing = false;
	let imported = false;
	let previewRequested = false;
	const projectToken = Object.freeze({ generation: 1, projectId: 'project-a' });
	const controller = {
		actions: { project: { importFiles: async () => { imported = true; } } },
		getSnapshot: () => ({
			productId: 'soundscaper', readOnly: false, importing, project: { id: 'project-a' },
		}),
		captureProjectGeneration: () => projectToken,
		assertProjectGeneration: () => undefined,
	};
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async (input) => {
			if (String(input).endsWith('/preview')) {
				previewRequested = true;
				return oggResponse();
			}
			return detail.promise;
		},
	});
	const operation = actions.importSound({ soundId: 42, destination: 'project-bin' });
	importing = true;
	detail.resolve(Response.json({ data: previewSound() }));

	await assert.rejects(operation, /another import began/iu);
	assert.equal(previewRequested, false);
	assert.equal(imported, false);
});

test('cancelling a Freesound workspace import releases its admission', async () => {
	const detail = deferred<Response>();
	let requests = 0;
	const controller = createController('soundscaper');
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async () => {
			requests += 1;
			return requests === 1 ? detail.promise : Response.json({ data: SOUND_WITHOUT_PREVIEW });
		},
	});
	try {
		await controller.ready;
		const abort = new AbortController();
		const operation = actions.importSound({
			soundId: 42, destination: 'project-bin', signal: abort.signal,
		});
		abort.abort();
		detail.resolve(Response.json({ data: SOUND_WITHOUT_PREVIEW }));
		await assert.rejects(operation, /abort/iu);
		await assert.rejects(
			actions.importSound({ soundId: 43, destination: 'project-bin' }),
			/no HQ OGG preview/iu,
		);
		assert.equal(requests, 2);
	} finally {
		await controller.dispose();
	}
});

test('the lazy import is revoked when its captured project switches', async () => {
	const detail = deferred<Response>();
	let previewRequested = false;
	const controller = createController('soundscaper');
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async (input) => {
			if (String(input).endsWith('/preview')) {
				previewRequested = true;
				return oggResponse();
			}
			return detail.promise;
		},
	});
	try {
		await controller.ready;
		const originalProjectId = controller.getSnapshot().project?.id;
		const operation = actions.importSound({ soundId: 42, destination: 'project-bin' });
		const refusal = assert.rejects(operation, /project changed/iu);
		await controller.actions.project.create({ title: 'Replacement', skipFlush: true });
		assert.notEqual(controller.getSnapshot().project?.id, originalProjectId);
		detail.resolve(Response.json({ data: previewSound() }));
		await refusal;
		assert.equal(previewRequested, false);
	} finally {
		await controller.dispose();
	}
});

test('the lazy import refuses to publish after the active project loses write authority', async () => {
	const detail = deferred<Response>();
	const lost = deferred<void>();
	let acquisitions = 0;
	let detailRequested = false;
	let previewRequested = false;
	const controller = createController('soundscaper', {
		acquireProjectLock: async (projectId) => {
			acquisitions += 1;
			return acquisitions === 1 ? {
				projectId, readOnly: false, method: 'test', lost: lost.promise, release() {},
			} : {
				projectId, readOnly: true, method: 'test', retryAt: Date.now() + 60_000, release() {},
			};
		},
	});
	const actions = createFreesoundWorkspaceActions(controller, {
		apiBaseUrl: 'https://proxy.example',
		fetch: async (input) => {
			if (String(input).endsWith('/preview')) {
				previewRequested = true;
				return oggResponse();
			}
			detailRequested = true;
			return detail.promise;
		},
	});
	try {
		await controller.ready;
		const initialProject = controller.getSnapshot().project as Readonly<{ sources: readonly unknown[] }> | null;
		const initialSourceCount = initialProject?.sources.length;
		const operation = actions.importSound({ soundId: 42, destination: 'project-bin' });
		const refusal = assert.rejects(operation, /became read-only/iu);
		await waitFor(() => detailRequested && acquisitions === 1);
		lost.resolve();
		await waitFor(() => controller.getSnapshot().readOnly === true);
		detail.resolve(Response.json({ data: previewSound() }));
		await refusal;
		assert.equal(previewRequested, false);
		const finalProject = controller.getSnapshot().project as Readonly<{ sources: readonly unknown[] }> | null;
		assert.equal(finalProject?.sources.length, initialSourceCount);
	} finally {
		await controller.dispose();
	}
});

function createController(productId: string, overrides: Partial<ControllerOptions> = {}) {
	return createAudioEditorController(null, {
		headless: true,
		productId,
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null }),
		fileService: createAudioEditorFileService(),
		...overrides,
	});
}

function emptySearchResponse(): Response {
	return Response.json({ data: {
		query: 'rain', page: 1, pageSize: 20, totalCount: 0, totalPages: 0,
		hasNextPage: false, hasPreviousPage: false, results: [],
	} });
}

function previewSound() {
	return { ...SOUND_WITHOUT_PREVIEW, preview: {
		available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192,
	} };
}

function oggResponse(): Response {
	return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
		headers: { 'Content-Type': 'audio/ogg' },
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
