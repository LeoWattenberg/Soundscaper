/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFreesoundImportService } from '../src/common/editor/controller/import/freesound-import-service.ts';

const SOUND = Object.freeze({
	id: 42,
	name: 'Rain close.ogg',
	pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	description: 'Steady rain near a window.',
	tags: ['rain', 'field-recording'],
	category: 'Sound effects',
	subcategory: 'Weather',
	createdAt: '2026-04-16T20:07:11.145',
	license: {
		code: 'cc-by' as const,
		name: 'Attribution 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		requiresAttribution: true,
		commercialUseAllowed: true,
	},
	generativeAiPreference: 'no-additional-preferences',
	explicit: false,
	durationSeconds: 12.25,
	originalFile: {
		format: 'ogg', channels: 2, byteLength: 4_096, sampleRate: 48_000,
		md5: '0123456789abcdef0123456789abcdef',
	},
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
	waveform: { available: true, url: '/api/freesound/sounds/42/waveform?asset=789&source=cdn' },
});

test('Freesound search uses the owned proxy contract', async () => {
	const requests: Request[] = [];
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'contribution-42',
		importFile: async () => undefined,
		fetch: async (input, init) => {
			requests.push(new Request(input, init));
			return Response.json({ data: {
				query: 'rain', page: 2, pageSize: 20, totalCount: 21, totalPages: 2,
				hasNextPage: false, hasPreviousPage: true, results: [SOUND],
			} });
		},
	});

	const page = await service.search({ query: 'rain', page: 2, license: 'cc-by', sort: 'newest' });

	assert.equal(page.results[0]?.id, 42);
	assert.deepEqual(page.results[0]?.waveform, SOUND.waveform);
	assert.equal(requests.length, 1);
	const url = new URL(requests[0]!.url);
	assert.equal(url.pathname, '/api/freesound/search');
	assert.equal(url.searchParams.get('q'), 'rain');
	assert.equal(url.searchParams.get('page'), '2');
	assert.equal(url.searchParams.get('license'), 'cc-by');
	assert.equal(url.searchParams.get('sort'), 'newest');
	assert.equal(requests[0]?.credentials, 'omit');
});

test('Freesound search treats an absent waveform as unavailable and rejects malformed availability', async () => {
	let waveform: unknown = undefined;
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'unused',
		importFile: async () => undefined,
		fetch: async () => Response.json({ data: {
			query: 'rain', page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
			hasNextPage: false, hasPreviousPage: false,
			results: [{ ...SOUND, waveform }],
		} }),
	});

	const page = await service.search({ query: 'rain' });
	assert.deepEqual(page.results[0]?.waveform, { available: false, url: null });

	waveform = { available: 'yes' };
	await assert.rejects(service.search({ query: 'rain' }), /waveform available/iu);

	waveform = { available: true, url: 'https://cdn.freesound.org/api/freesound/sounds/42/waveform' };
	await assert.rejects(service.search({ query: 'rain' }), /waveform URL/iu);

	waveform = { available: true, url: '/api/freesound/sounds/41/waveform?asset=789&source=cdn' };
	await assert.rejects(service.search({ query: 'rain' }), /waveform URL/iu);

	waveform = { available: false, url: SOUND.waveform.url };
	await assert.rejects(service.search({ query: 'rain' }), /waveform URL/iu);
});

test('Freesound search accepts the proxy maximum and an empty upstream description', async () => {
	const response = JSON.stringify({ data: {
		query: 'ambience', page: 1, pageSize: 20, totalCount: 20, totalPages: 1,
		hasNextPage: false, hasPreviousPage: false,
		results: Array.from({ length: 20 }, (_, index) => ({
			...SOUND,
			id: index + 1,
			pageUrl: `https://freesound.org/s/${String(index + 1)}/`,
			waveform: { available: false, url: null },
			description: index === 0 ? '' : 'x'.repeat(65_536),
			})),
	} });
	assert(response.length > 1024 * 1024);
	assert(response.length <= 2 * 1024 * 1024);
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'unused',
		importFile: async () => undefined,
		fetch: async () => new Response(response, {
			headers: { 'Content-Type': 'application/json', 'Content-Length': String(response.length) },
		}),
	});

	const page = await service.search({ query: 'ambience' });

	assert.equal(page.results[0]?.description, '');
});

test('Freesound search omits Sampling+ and direct imports reject it', async () => {
	const legacySound = {
		...SOUND,
		license: {
			code: 'sampling-plus' as const,
			name: 'Sampling+ 1.0',
			url: 'https://creativecommons.org/licenses/sampling+/1.0/',
			requiresAttribution: true,
			commercialUseAllowed: false,
		},
	};
	const requests: string[] = [];
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'legacy-contribution',
		importFile: async () => assert.fail('Sampling+ must not reach project import'),
		fetch: async (input) => {
			requests.push(String(input));
			return Response.json({ data: String(input).includes('/search') ? {
				query: 'legacy', page: 1, pageSize: 20, totalCount: 2, totalPages: 1,
				hasNextPage: false, hasPreviousPage: false, results: [SOUND, legacySound],
			} : legacySound });
		},
	});

	const page = await service.search({ query: 'legacy', license: 'all' });
	assert.deepEqual(page.results.map(({ license }) => license.code), ['cc-by']);
	await assert.rejects(
		service.importSound({ soundId: 42, destination: 'project-bin' }),
		/license code/iu,
	);
	assert.equal(requests.some((url) => url.endsWith('/preview')), false);
});

test('Freesound import snapshots attribution and sends a local OGG through normal import', async () => {
	const imports: Array<{
		file: File;
		options: Record<string, unknown>;
		assertProjectCurrent: (() => void) | undefined;
	}> = [];
	const requests: Request[] = [];
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'contribution-42',
		importFile: async (file, options, assertProjectCurrent) => {
			imports.push({ file, options, assertProjectCurrent });
			return { sourceId: 'source-42' };
		},
		fetch: async (input, init) => {
			const request = new Request(input, init);
			requests.push(request);
			if (request.url.endsWith('/preview')) {
				return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
					headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '4' },
				});
			}
			return Response.json({ data: SOUND });
		},
	});

	const result = await service.importSound({
		soundId: 42,
		destination: 'timeline',
		trackId: 'track-a',
		timelineStartFrame: 24_000,
	});

	assert.deepEqual(result, { sourceId: 'source-42' });
	assert.equal(requests.length, 2);
	assert.equal(imports.length, 1);
	assert.equal(imports[0]?.file.name, 'Rain close.ogg');
	assert.equal(imports[0]?.file.type, 'audio/ogg');
	assert.deepEqual(new Uint8Array(await imports[0]!.file.arrayBuffer()), new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
	assert.equal(imports[0]?.options.destination, 'timeline');
	assert.equal(imports[0]?.options.trackId, 'track-a');
	assert.equal(imports[0]?.options.timelineStartFrame, 24_000);
	assert.equal(typeof imports[0]?.assertProjectCurrent, 'function');
	assert.deepEqual(imports[0]?.options.sourceProvenance, {
		schemaVersion: 1,
		classification: 'imported',
		contributions: [{
			id: 'contribution-42',
			origin: {
				kind: 'freesound', soundId: 42,
				title: 'Rain close.ogg',
				soundUrl: 'https://freesound.org/s/42/',
				creator: 'field-recorder',
				creatorUrl: 'https://freesound.org/people/field-recorder/',
				license: {
					family: 'cc-by', name: 'Attribution 4.0',
					url: 'https://creativecommons.org/licenses/by/4.0/',
				},
				importedVariant: 'preview-hq-ogg',
				originalFileName: 'Rain close.ogg', mimeType: 'audio/ogg',
			},
			metadata: {
				normalized: {}, raw: {}, namespaces: { freesound: SOUND },
			},
			attachments: [],
			warnings: [],
		}],
	});
	assert.doesNotMatch(JSON.stringify(imports[0]?.options), /cdn\.freesound/u);
});

test('Freesound import admits every OGG MIME forwarded by the owned proxy', async () => {
	for (const mimeType of ['audio/ogg', 'application/ogg', 'audio/vorbis']) {
		const imports: Array<{ file: File; options: Record<string, unknown> }> = [];
		const service = createFreesoundImportService({
			enabled: true,
			apiBaseUrl: 'https://soundscaper.org',
			createContributionId: () => 'contribution-42',
			importFile: async (file, options) => { imports.push({ file, options }); },
			fetch: async (input) => String(input).endsWith('/preview')
				? new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
					headers: { 'Content-Type': `${mimeType}; codecs=vorbis` },
				})
				: Response.json({ data: SOUND }),
		});

		await service.importSound({ soundId: 42, destination: 'project-bin' });

		assert.equal(imports.length, 1);
		assert.equal(imports[0]?.file.type, mimeType);
		const provenance = imports[0]?.options.sourceProvenance as Readonly<{
			contributions: readonly Readonly<{ origin: Readonly<{ mimeType?: string }> }>[];
		}>;
		assert.equal(provenance.contributions[0]?.origin.mimeType, mimeType);
	}
});

test('Freesound import rejects oversized previews before buffering them', async () => {
	let imported = false;
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		maximumPreviewBytes: 16,
		createContributionId: () => 'contribution-42',
		importFile: async () => { imported = true; },
		fetch: async (input) => String(input).endsWith('/preview')
			? new Response(null, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '17' } })
			: Response.json({ data: SOUND }),
	});

	await assert.rejects(service.importSound({ soundId: 42, destination: 'project-bin' }), /too large/iu);
	assert.equal(imported, false);
});

test('Freesound import caps an unlabelled preview stream and cancels it at the first excess chunk', async () => {
	const result = await rejectOversizedPreviewStream(null);

	assert.equal(result.imported, false);
	assert.equal(result.pullCount, 2, 'the third chunk is never requested');
	assert.ok(result.cancelReason instanceof RangeError);
});

test('Freesound import does not trust an undersized Content-Length while streaming a preview', async () => {
	const result = await rejectOversizedPreviewStream('1');

	assert.equal(result.imported, false);
	assert.equal(result.pullCount, 2, 'the declared byte count cannot bypass the streaming cap');
	assert.ok(result.cancelReason instanceof RangeError);
});

test('Freesound import remains bound to the project where the request began', async () => {
	let projectCurrent = true;
	let imported = false;
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'contribution-42',
		importFile: async () => { imported = true; },
		fetch: async (input) => {
			if (String(input).endsWith('/preview')) throw new Error('must not download');
			projectCurrent = false;
			return Response.json({ data: SOUND });
		},
	});

	await assert.rejects(
		service.importSound(
			{ soundId: 42, destination: 'project-bin' },
			() => { if (!projectCurrent) throw new Error('project changed'); },
		),
		/project changed/iu,
	);
	assert.equal(imported, false);
});

test('Freesound actions fail closed when the product does not enable them', async () => {
	const service = createFreesoundImportService({
		enabled: false,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'unused',
		importFile: async () => undefined,
		fetch: async () => { throw new Error('must not fetch'); },
	});

	await assert.rejects(service.search({ query: 'rain' }), /unavailable/iu);
	await assert.rejects(service.importSound({ soundId: 42, destination: 'project-bin' }), /unavailable/iu);
});

async function rejectOversizedPreviewStream(contentLength: string | null): Promise<Readonly<{
	imported: boolean;
	pullCount: number;
	cancelReason: unknown;
}>> {
	let imported = false;
	let pullCount = 0;
	let cancelReason: unknown;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			pullCount += 1;
			if (pullCount === 1) controller.enqueue(new Uint8Array([0x4f, 0x67, 0x67]));
			else if (pullCount === 2) controller.enqueue(new Uint8Array([0x53, 0x00]));
			else controller.close();
		},
		cancel(reason) { cancelReason = reason; },
	}, { highWaterMark: 0 });
	const headers: Record<string, string> = { 'Content-Type': 'audio/ogg' };
	if (contentLength !== null) headers['Content-Length'] = contentLength;
	const service = createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		maximumPreviewBytes: 4,
		createContributionId: () => 'contribution-42',
		importFile: async () => { imported = true; },
		fetch: async (input) => String(input).endsWith('/preview')
			? new Response(stream, { headers })
			: Response.json({ data: SOUND }),
	});

	await assert.rejects(
		service.importSound({ soundId: 42, destination: 'project-bin' }),
		/The Freesound preview is too large to import\./u,
	);
	return Object.freeze({ imported, pullCount, cancelReason });
}
