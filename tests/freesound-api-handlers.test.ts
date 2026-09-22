/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	handleFreesoundPreviewRequest,
	handleFreesoundSearchRequest,
	handleFreesoundSoundRequest,
	type FreesoundFunctionContext,
} from '../functions/api/freesound/_shared/handlers.ts';

const API_KEY = 'server-secret-api-key';
const previewUrl = 'https://cdn.freesound.org/previews/123/123456_789-hq.ogg';

function soundFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 123456,
		name: 'Rain.ogg',
		tags: ['rain'],
		description: 'Steady rain.',
		category: null,
		subcategory: null,
		created: '2026-04-16T20:07:11.145',
		license: 'http://creativecommons.org/licenses/by-nc/4.0/',
		gen_ai_preference: null,
		type: 'ogg',
		channels: 2,
		filesize: 4_096,
		duration: 12.25,
		samplerate: 48_000,
		username: 'recordist',
		md5: '0123456789abcdef0123456789abcdef',
		is_explicit: false,
		previews: { 'preview-hq-ogg': previewUrl },
		num_downloads: 42,
		avg_rating: 4.5,
		num_ratings: 8,
		...overrides,
	};
}

function context(
	request: Request,
	params: Record<string, string | string[]> = {},
	env: Record<string, string | undefined> = { FREESOUND_API_KEY: API_KEY },
): FreesoundFunctionContext {
	return { request, params, env };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(value), {
		...init,
		headers: { 'Content-Type': 'application/json', ...init.headers },
	});
}

test('search sends the token only to a fixed Freesound endpoint and returns owned JSON', async () => {
	let upstreamRequest: Request | undefined;
	const fetchImpl: typeof fetch = async (input, init) => {
		upstreamRequest = new Request(input, init);
		return jsonResponse({ count: 21, next: 'secret-upstream-url', previous: null, results: [soundFixture()] });
	};
	const request = new Request(
		'https://soundscaper.org/api/freesound/search?q=rain&page=2&license=cc-by&sort=newest',
		{ headers: { Origin: 'soundscaper-app://bundle' } },
	);
	const response = await handleFreesoundSearchRequest(context(request), { fetchImpl });

	assert.equal(response.status, 200);
	assert.equal(response.headers.get('access-control-allow-origin'), 'soundscaper-app://bundle');
	assert.match(response.headers.get('cache-control') ?? '', /s-maxage/u);
	assert(upstreamRequest);
	const upstreamUrl = new URL(upstreamRequest.url);
	assert.equal(upstreamUrl.origin, 'https://freesound.org');
	assert.equal(upstreamUrl.pathname, '/apiv2/search/');
	assert.equal(upstreamUrl.searchParams.get('query'), 'rain');
	assert.equal(upstreamUrl.searchParams.get('page'), '2');
	assert.equal(upstreamUrl.searchParams.get('page_size'), '20');
	assert.equal(upstreamUrl.searchParams.get('sort'), 'created_desc');
	assert.equal(upstreamUrl.searchParams.get('filter'), 'license:Attribution');
	assert.equal(upstreamUrl.searchParams.has('token'), false);
	assert.equal(upstreamRequest.redirect, 'manual');
	assert.equal(upstreamRequest.headers.get('authorization'), `Token ${API_KEY}`);
	const body = await response.text();
	const payload = JSON.parse(body) as { data: { results: Array<{ id: number }> } };
	assert.equal(payload.data.results[0]?.id, 123456);
	assert.doesNotMatch(body, new RegExp(API_KEY, 'u'));
	assert.doesNotMatch(body, /cdn\.freesound/u);
	assert.doesNotMatch(body, /secret-upstream-url/u);
});

test('default fetch keeps the global receiver required by the Workers runtime', async () => {
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = function (input, init) {
		assert.equal(this, globalThis);
		calls += 1;
		assert.equal(new URL(String(input)).origin, 'https://freesound.org');
		assert.equal(new Headers(init?.headers).get('authorization'), `Token ${API_KEY}`);
		return Promise.resolve(jsonResponse({ count: 1, results: [soundFixture()] }));
	};
	try {
		const response = await handleFreesoundSearchRequest(context(
			new Request('https://soundscaper.org/api/freesound/search?q=rain'),
		));
		assert.equal(response.status, 200);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('metadata redirects are rejected without following their location', async () => {
	let calls = 0;
	const response = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), { fetchImpl: async (_input, init) => {
		calls += 1;
		assert.equal(init?.redirect, 'manual');
		return new Response(null, {
			status: 302,
			headers: { Location: 'https://attacker.example/collect' },
		});
	} });
	assert.equal(calls, 1);
	assert.equal(response.status, 502);
	assert.equal((await response.json() as { error: { code: string } }).error.code, 'upstream_error');
});

test('request admission fails closed before contacting Freesound', async () => {
	let calls = 0;
	const fetchImpl: typeof fetch = async () => {
		calls += 1;
		throw new Error('must not be called');
	};
	const cases = [
		[new Request('https://framescaper.org/api/freesound/search?q=rain'), 404, 'not_found'],
		[new Request('https://soundscaper.org/api/freesound/search?q=rain', {
			headers: { Origin: 'https://attacker.example' },
		}), 403, 'origin_forbidden'],
		[new Request('https://soundscaper.org/api/freesound/search?page=0'), 400, 'invalid_request'],
		[new Request('https://soundscaper.org/api/freesound/search?q=rain', { method: 'POST' }), 405, 'method_not_allowed'],
	] as const;
	for (const [request, status, code] of cases) {
		const response = await handleFreesoundSearchRequest(context(request), { fetchImpl });
		assert.equal(response.status, status);
		assert.equal((await response.json() as { error: { code: string } }).error.code, code);
	}
	const unavailable = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'), {}, {},
	), { fetchImpl });
	assert.equal(unavailable.status, 503);
	assert.equal(calls, 0);
});

test('OPTIONS returns narrowly scoped desktop CORS policy without an upstream call', async () => {
	const request = new Request('https://soundscaper.org/api/freesound/search', {
		method: 'OPTIONS',
		headers: { Origin: 'soundscaper-app://bundle' },
	});
	const response = await handleFreesoundSearchRequest(context(request), {
		fetchImpl: async () => { throw new Error('must not fetch'); },
	});

	assert.equal(response.status, 204);
	assert.equal(response.headers.get('access-control-allow-origin'), 'soundscaper-app://bundle');
	assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
	assert.equal(response.headers.get('access-control-allow-headers'), 'Range');
});

test('sound detail validates its numeric ID and maps upstream not-found responses', async () => {
	let calledUrl = '';
	const fetchImpl: typeof fetch = async (input) => {
		calledUrl = String(input);
		return new Response(null, { status: 404 });
	};
	const invalid = await handleFreesoundSoundRequest(context(
		new Request('https://soundscaper.org/api/freesound/sounds/not-a-number'),
		{ id: 'not-a-number' },
	), { fetchImpl });
	assert.equal(invalid.status, 400);
	assert.equal(calledUrl, '');

	const missing = await handleFreesoundSoundRequest(context(
		new Request('https://soundscaper.org/api/freesound/sounds/123456'),
		{ id: '123456' },
	), { fetchImpl });
	assert.equal(missing.status, 404);
	assert.equal(new URL(calledUrl).pathname, '/apiv2/sounds/123456/');
});

test('sound detail accepts Freesound WavPack metadata in the owned data envelope', async () => {
	const response = await handleFreesoundSoundRequest(context(
		new Request('https://soundscaper.org/api/freesound/sounds/123456'),
		{ id: '123456' },
	), { fetchImpl: async () => jsonResponse(soundFixture({
		license: 'http://creativecommons.org/licenses/by/3.0/',
		type: 'wv',
	})) });

	assert.equal(response.status, 200);
	const payload = await response.json() as { data: {
		id: number; preview: { available: boolean }; license: { code: string; url: string };
		originalFile: { format: string };
	} };
	assert.equal(payload.data.id, 123456);
	assert.equal(payload.data.preview.available, true);
	assert.equal(payload.data.originalFile.format, 'wv');
	assert.equal(payload.data.license.code, 'cc-by');
	assert.equal(payload.data.license.url, 'https://creativecommons.org/licenses/by/3.0/');
});

test('search accepts WavPack beside other formats and Freesound deed URLs', async () => {
	const response = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), { fetchImpl: async () => jsonResponse({
		count: 2,
		results: [
			soundFixture({ license: 'http://creativecommons.org/licenses/by-nc/4.0/', type: 'wv' }),
			soundFixture(),
		],
	}) });

	assert.equal(response.status, 200);
	const payload = await response.json() as { data: { results: Array<{
		license: { code: string; url: string }; originalFile: { format: string };
	}> } };
	assert.deepEqual(payload.data.results.map(({ originalFile }) => originalFile.format), ['wv', 'ogg']);
	assert.equal(payload.data.results[0]?.license.code, 'cc-by-nc');
	assert.equal(payload.data.results[0]?.license.url, 'https://creativecommons.org/licenses/by-nc/4.0/');
});

test('all-license search allowlists displayed licenses and omits legacy Sampling records', async () => {
	let upstreamUrl: URL | undefined;
	const response = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=legacy&license=all'),
	), { fetchImpl: async (input) => {
		upstreamUrl = new URL(String(input));
		return jsonResponse({
			count: 4,
			results: [
				soundFixture({ license: 'Attribution' }),
				soundFixture({ license: 'Sampling' }),
				soundFixture({ license: 'Sampling+' }),
				soundFixture({ license: 'https://creativecommons.org/licenses/sampling+/1.0/' }),
			],
		});
	} });

	assert.equal(response.status, 200);
	assert.equal(
		upstreamUrl?.searchParams.get('filter'),
		'license:("Creative Commons 0" OR Attribution OR "Attribution NonCommercial")',
	);
	const payload = await response.json() as { data: { results: Array<{ license: { code: string } }> } };
	assert.deepEqual(payload.data.results.map(({ license }) => license.code), ['cc-by']);
});

test('sound detail and preview reject Sampling licenses so direct IDs cannot bypass filtering', async () => {
	for (const license of ['Sampling', 'Sampling+', 'http://creativecommons.org/licenses/sampling/1.0/']) {
		const fetchImpl = async () => jsonResponse(soundFixture({ license }));
		const detail = await handleFreesoundSoundRequest(context(
			new Request('https://soundscaper.org/api/freesound/sounds/123456'),
			{ id: '123456' },
		), { fetchImpl });
		assert.equal(detail.status, 502);
		assert.equal(
			(await detail.json() as { error: { code: string } }).error.code,
			'invalid_upstream_response',
		);
		const preview = await handleFreesoundPreviewRequest(context(new Request(
			'https://soundscaper.org/api/freesound/sounds/123456/preview',
		), { id: '123456' }), { fetchImpl });
		assert.equal(preview.status, 502);
		assert.equal(
			(await preview.json() as { error: { code: string } }).error.code,
			'invalid_upstream_response',
		);
	}
});

test('preview resolves the trusted CDN URL server-side and streams a single range', async () => {
	const requests: Request[] = [];
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
			controller.close();
		},
	});
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		if (requests.length === 1) return jsonResponse(soundFixture());
		return new Response(body, {
			status: 206,
			headers: {
				'Accept-Ranges': 'bytes',
				'Content-Length': '4',
				'Content-Range': 'bytes 0-3/100',
				'Content-Type': 'audio/ogg',
				ETag: 'preview-etag',
			},
		});
	};
	const response = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
		{ headers: { Origin: 'soundscaper-app://bundle', Range: 'bytes=0-3' } },
	), { id: '123456' }), { fetchImpl });

	assert.equal(requests.length, 2);
	assert.equal(requests[0]?.headers.get('authorization'), `Token ${API_KEY}`);
	assert.equal(requests[1]?.url, previewUrl);
	assert.equal(requests[1]?.headers.get('authorization'), null);
	assert.equal(requests[1]?.headers.get('range'), 'bytes=0-3');
	assert.equal(requests[1]?.redirect, 'manual');
	assert.equal(response.status, 206);
	assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
	assert.equal(response.headers.get('content-disposition'), 'inline; filename="freesound-123456-preview.ogg"');
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0x4f, 0x67, 0x67, 0x53]));
});

test('preview aborts and cancels an upstream body that stalls after its headers', async () => {
	let previewSignal: AbortSignal | undefined;
	let cancelReason: unknown;
	let calls = 0;
	const response = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
	), { id: '123456' }), {
		timeoutMs: 10,
		fetchImpl: async (_input, init) => {
			calls += 1;
			if (calls === 1) return jsonResponse(soundFixture());
			previewSignal = init?.signal ?? undefined;
			return new Response(new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([0x4f]));
				},
				cancel(reason) {
					cancelReason = reason;
				},
			}), { headers: { 'Content-Type': 'audio/ogg' } });
		},
	});

	assert.equal(response.status, 200);
	assert(response.body);
	const reader = response.body.getReader();
	assert.deepEqual(await reader.read(), { done: false, value: new Uint8Array([0x4f]) });
	await assert.rejects(reader.read(), /timed out/iu);
	assert.equal(previewSignal?.aborted, true);
	assert.match(String(cancelReason), /timed out/iu);
});

test('canceling a preview response cancels upstream and clears its idle deadline', async () => {
	let previewSignal: AbortSignal | undefined;
	let cancelReason: unknown;
	let calls = 0;
	const response = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
	), { id: '123456' }), {
		timeoutMs: 20,
		fetchImpl: async (_input, init) => {
			calls += 1;
			if (calls === 1) return jsonResponse(soundFixture());
			previewSignal = init?.signal ?? undefined;
			return new Response(new ReadableStream<Uint8Array>({
				cancel(reason) {
					cancelReason = reason;
				},
			}), { headers: { 'Content-Type': 'audio/ogg' } });
		},
	});

	assert(response.body);
	await response.body.cancel('consumer stopped');
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(cancelReason, 'consumer stopped');
	assert.equal(previewSignal?.aborted, false);
});

test('preview admits the valid one-byte zero range and rejects an empty suffix range', async () => {
	const ranges: string[] = [];
	const fetchImpl: typeof fetch = async (_input, init) => {
		const request = new Request(_input, init);
		if (request.url.startsWith('https://freesound.org/')) return jsonResponse(soundFixture());
		ranges.push(request.headers.get('range') ?? '');
		return new Response(new Uint8Array([0x4f]), {
			status: 206,
			headers: {
				'Content-Type': 'audio/ogg',
				'Content-Length': '1',
				'Content-Range': 'bytes 0-0/100',
			},
		});
	};
	const admitted = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
		{ headers: { Range: 'bytes=0-0' } },
	), { id: '123456' }), { fetchImpl });
	assert.equal(admitted.status, 206);
	assert.deepEqual(ranges, ['bytes=0-0']);

	const rejected = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
		{ headers: { Range: 'bytes=-0' } },
	), { id: '123456' }), { fetchImpl });
	assert.equal(rejected.status, 416);
	assert.deepEqual(ranges, ['bytes=0-0']);
});

test('preview forwards every admitted OGG MIME for the import client', async () => {
	for (const mimeType of ['audio/ogg', 'application/ogg', 'audio/vorbis']) {
		let calls = 0;
		const response = await handleFreesoundPreviewRequest(context(new Request(
			'https://soundscaper.org/api/freesound/sounds/123456/preview',
		), { id: '123456' }), {
			fetchImpl: async () => {
				calls += 1;
				return calls === 1
					? jsonResponse(soundFixture())
					: new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
						headers: { 'Content-Type': `${mimeType}; codecs=vorbis` },
					});
			},
		});

		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), `${mimeType}; codecs=vorbis`);
		assert.deepEqual(
			new Uint8Array(await response.arrayBuffer()),
			new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
		);
	}
});

test('preview rejects multi-ranges and untrusted media before streaming', async () => {
	let calls = 0;
	const invalidRange = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
		{ headers: { Range: 'bytes=0-2,4-8' } },
	), { id: '123456' }), { fetchImpl: async () => { calls += 1; throw new Error('unused'); } });
	assert.equal(invalidRange.status, 416);
	assert.equal(calls, 0);

	const malicious = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
	), { id: '123456' }), {
		fetchImpl: async () => {
			calls += 1;
			return jsonResponse(soundFixture({ previews: {
				'preview-hq-ogg': 'https://internal.example/private',
			} }));
		},
	});
	assert.equal(malicious.status, 502);
	assert.equal(calls, 1);

	const wrongMedia = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview',
	), { id: '123456' }), {
		fetchImpl: async () => {
			calls += 1;
			return calls === 2
				? jsonResponse(soundFixture())
				: new Response('<html>not audio</html>', { headers: { 'Content-Type': 'text/html' } });
		},
	});
	assert.equal(wrongMedia.status, 502);
	assert.equal((await wrongMedia.json() as { error: { code: string } }).error.code, 'invalid_upstream_response');
});

test('preview HEAD checks metadata without returning or buffering a media body', async () => {
	const methods: string[] = [];
	const response = await handleFreesoundPreviewRequest(context(new Request(
		'https://soundscaper.org/api/freesound/sounds/123456/preview', { method: 'HEAD' },
	), { id: '123456' }), {
		fetchImpl: async (input, init) => {
			const request = new Request(input, init);
			methods.push(request.method);
			return methods.length === 1
				? jsonResponse(soundFixture())
				: new Response(null, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '100' } });
		},
	});

	assert.equal(response.status, 200);
	assert.deepEqual(methods, ['GET', 'HEAD']);
	assert.equal(response.body, null);
	assert.equal(response.headers.get('content-length'), '100');
});

test('upstream timeouts and malformed JSON become structured gateway errors', async () => {
	const timeout = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), {
		timeoutMs: 1,
		fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
		}),
	});
	assert.equal(timeout.status, 504);
	assert.equal((await timeout.json() as { error: { code: string } }).error.code, 'upstream_timeout');

	const malformed = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), { fetchImpl: async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }) });
	assert.equal(malformed.status, 502);
	assert.equal((await malformed.json() as { error: { code: string } }).error.code, 'invalid_upstream_response');
});

test('the upstream deadline remains active while a JSON response body is read', async () => {
	const response = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), {
		timeoutMs: 1,
		fetchImpl: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				init?.signal?.addEventListener('abort', () => {
					controller.error(new DOMException('aborted', 'AbortError'));
				});
			},
		}), { headers: { 'Content-Type': 'application/json' } }),
	});
	assert.equal(response.status, 504);
	assert.equal((await response.json() as { error: { code: string } }).error.code, 'upstream_timeout');
});

test('upstream rate limits are normalized without relaying an arbitrary Retry-After value', async () => {
	const admitted = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), { fetchImpl: async () => new Response(null, { status: 429, headers: { 'Retry-After': '45' } }) });
	assert.equal(admitted.status, 503);
	assert.equal(admitted.headers.get('retry-after'), '45');

	const rejected = await handleFreesoundSearchRequest(context(
		new Request('https://soundscaper.org/api/freesound/search?q=rain'),
	), { fetchImpl: async () => new Response(null, {
		status: 429,
		headers: { 'Retry-After': 'Wed, 21 Oct 2099 07:28:00 GMT' },
	}) });
	assert.equal(rejected.status, 503);
	assert.equal(rejected.headers.get('retry-after'), null);
});
