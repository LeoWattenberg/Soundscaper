/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperUpdateChecker, dispatchMotionscaperUpdateCheck, MOTION_UPDATE_RESPONSE_BYTES } from '../desktop/motionscaper-update-check.ts';

const release = (tag_name: string, prerelease = true) => ({ tag_name, prerelease, draft: false, html_url: 'https://untrusted.example/download' });
const caller = { ownWindow: true, mainFrame: true, url: 'motionscaper-app://bundle/de/' };

test('Motion updates select only the newest compatible own release and construct its fixed repository link', async () => {
	let request: RequestInit | undefined;
	const check = createMotionscaperUpdateChecker('0.1.0-alpha.1', async (url, options) => {
		assert.equal(String(url), 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20'); request = options;
		return Response.json([release('framescaper-v9.0.0'), release('v99.0.0'), release('motionscaper-v0.1.0-alpha.2'), release('motionscaper-v0.2.0-beta.1'), { ...release('motionscaper-v9.0.0'), draft: true }]);
	});
	assert.deepEqual(await check(), { status: 'available', version: '0.2.0-beta.1', url: 'https://github.com/LeoWattenberg/Soundscaper/releases/tag/motionscaper-v0.2.0-beta.1' });
	assert.equal(request?.redirect, 'error'); assert.equal(request?.credentials, 'omit'); assert.ok(request?.signal instanceof AbortSignal);
});

test('stable Motion versions exclude previews and malformed or unsafe numeric tags', async () => {
	const check = createMotionscaperUpdateChecker('1.0.0', async () => Response.json([
		release('motionscaper-v2.0.0-beta.1'), release('motionscaper-v9007199254740992.0.0', false), release('motionscaper-v01.0.0', false), release('motionscaper-v1.0.0', false),
	]));
	assert.deepEqual(await check(), { status: 'current' });
	let fetched = false;
	assert.deepEqual(await createMotionscaperUpdateChecker('bad-version', () => { fetched = true; return Promise.resolve(Response.json([])); })(), { status: 'error' });
	assert.equal(fetched, false);
});

test('Motion checks search bounded repository pages without following a server supplied destination', async () => {
	const urls: string[] = [], signals: (AbortSignal | null | undefined)[] = [];
	const check = createMotionscaperUpdateChecker('0.1.0-alpha.1', (url, options) => {
		urls.push(String(url)); signals.push(options?.signal);
		return Promise.resolve(urls.length === 1
			? Response.json([release('framescaper-v9.0.0')], { headers: { Link: '<https://untrusted.example/steal>; rel="next"' } })
			: Response.json([release('motionscaper-v0.2.0-beta.1')]));
	});
	assert.equal((await check()).status, 'available');
	assert.deepEqual(urls, ['https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20', 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20&page=2']);
	assert.equal(signals[0], signals[1]);
});

test('an unfinished bounded release history cannot report that Motion is current', async () => {
	let requests = 0;
	const check = createMotionscaperUpdateChecker('0.1.0-alpha.1', () => {
		requests += 1; return Promise.resolve(Response.json([], { headers: { Link: '<https://untrusted.example/next>; rel="next"' } }));
	});
	assert.deepEqual(await check(), { status: 'error' }); assert.equal(requests, 10);
});

test('Motion update bounds cancel a declared oversized response before reading or returning', async () => {
	let read = false, cancelled = false;
	const body = new ReadableStream<Uint8Array>({ pull: () => { read = true; }, cancel: async () => { await Promise.resolve(); cancelled = true; } }, { highWaterMark: 0 });
	const check = createMotionscaperUpdateChecker('0.1.0-alpha.1', () => Promise.resolve(new Response(body, { headers: { 'Content-Length': String(MOTION_UPDATE_RESPONSE_BYTES + 1) } })));
	assert.deepEqual(await check(), { status: 'error' }); assert.equal(read, false); assert.equal(cancelled, true);
});

test('Motion updates enforce emitted bytes, release count and valid JSON with cleanup before settlement', async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({ start: controller => controller.enqueue(new Uint8Array(MOTION_UPDATE_RESPONSE_BYTES + 1)), cancel: () => { cancelled = true; } });
	assert.deepEqual(await createMotionscaperUpdateChecker('0.1.0-alpha.1', () => Promise.resolve(new Response(body)))(), { status: 'error' }); assert.equal(cancelled, true);
	for (const response of [Response.json(Array.from({ length: 21 }, () => release('motionscaper-v0.2.0'))), new Response('{'), new Response('denied', { status: 403 })]) {
		assert.deepEqual(await createMotionscaperUpdateChecker('0.1.0-alpha.1', () => Promise.resolve(response))(), { status: 'error' });
	}
});

test('concurrent manual Motion checks share one bounded fetch and permit a later retry', async () => {
	let requests = 0; let finish: ((value: Response) => void) | undefined;
	const check = createMotionscaperUpdateChecker('0.1.0-alpha.1', () => { requests += 1; return new Promise<Response>(resolve => { finish = resolve; }); });
	const first = check(), second = check(); assert.equal(first, second); assert.equal(requests, 1);
	assert.ok(finish); finish(Response.json([])); assert.deepEqual(await first, { status: 'current' });
	const retry = check(); assert.equal(requests, 2); finish(Response.json([release('motionscaper-v0.2.0')])); assert.equal((await retry).status, 'available');
});

test('Motion update IPC admits only the own main document and an empty request before network or dialog work', async () => {
	let calls = 0; const check = async () => { calls += 1; };
	for (const context of [{ ...caller, ownWindow: false }, { ...caller, mainFrame: false }, { ...caller, url: 'framescaper-app://bundle/' }, { ...caller, url: 'motionscaper-app://bundle/de/?tag=foreign' }]) {
		await assert.rejects(dispatchMotionscaperUpdateCheck(context, {}, check), /Untrusted/u);
	}
	for (const request of [null, [], { url: 'https://untrusted.example' }]) await assert.rejects(dispatchMotionscaperUpdateCheck(caller, request, check), /request/u);
	assert.equal(calls, 0); await dispatchMotionscaperUpdateCheck(caller, {}, check); assert.equal(calls, 1);
});
