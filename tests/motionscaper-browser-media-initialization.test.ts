/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { probeBrowserWebCodecsAudioEncoding } from '../src/common/editor/browser-webcodecs-audio-profile.ts';
import { resolveVideoWebCodecsSupport } from '../src/common/editor/video-webcodecs-capability.ts';

function documentOwner(events: string[], failQuery = false, failCleanup = false) {
	return {
		createElement(tag: string) {
			events.push(`create:${tag}`);
			return {
				canPlayType(type: string) {
					events.push(`media:${type}`);
					if (failQuery) throw new Error('media initialization refused');
					return ''; // Decoder availability is not encoder admission.
				},
				remove() { events.push('remove'); if (failCleanup) throw new Error('media cleanup refused'); },
			};
		},
	};
}

async function inDocument<Value>(document: unknown, run: () => Promise<Value>): Promise<Value> {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
	try { return await run(); }
	finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
}
const canvas = { width: 96, height: 64, frameRate: { num: 2, den: 1 } };
const audio = { sampleRate: 48_000, channelCount: 2, bitrate: 128_000 };

for (const first of ['video', 'audio'] as const) {
	test(`Motion linked media initializes the document before ${first}-first native admission`, async () => {
		const events: string[] = []; const owner = documentOwner(events);
		const videoProbe = { async isConfigSupported() { events.push('video'); return { supported: true }; } };
		const audioProbe = { async isConfigSupported() { events.push('audio'); return { supported: true }; } };
		await inDocument(owner, async () => {
			const video = async () => assert.equal((await resolveVideoWebCodecsSupport('h264', canvas, 2_000_000, videoProbe)).tier, 'webcodecs');
			const sound = async () => assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', audio, audioProbe), true);
			if (first === 'video') { await video(); await sound(); } else { await sound(); await video(); }
		});
		assert.deepEqual(events, ['create:video', 'media:video/mp4', 'remove', first, first === 'video' ? 'audio' : 'video']);
	});
}

test('Motion media initialization refuses failed setup before a native probe and retries without retaining the element', async () => {
	const events: string[] = []; const owner = documentOwner(events, true);
	let calls = 0; const encoder = { async isConfigSupported() { calls++; return { supported: true }; } };
	await inDocument(owner, async () => {
		assert.equal((await resolveVideoWebCodecsSupport('h264', canvas, 2_000_000, encoder)).tier, 'ffmpeg');
		assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', audio, encoder), false);
	});
	assert.equal(calls, 0);
	assert.deepEqual(events, ['create:video', 'media:video/mp4', 'remove', 'create:video', 'media:video/mp4', 'remove']);
});

test('Motion media initialization does not claim initialization across document owners or document-free worker realms', async () => {
	const events: string[] = []; const encoder = { async isConfigSupported() { events.push('audio'); return { supported: false }; } };
	for (const owner of [documentOwner(events), undefined, documentOwner(events)]) {
		await inDocument(owner, async () => assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', audio, encoder), false));
	}
	assert.deepEqual(events, ['create:video', 'media:video/mp4', 'remove', 'audio', 'audio', 'create:video', 'media:video/mp4', 'remove', 'audio']);
});

test('Motion media initialization does not cache failed cleanup or probe an unavailable native API', async () => {
	const events: string[] = []; const owner = documentOwner(events, false, true);
	let calls = 0; const encoder = { async isConfigSupported() { calls++; return { supported: true }; } };
	await inDocument(owner, async () => {
		assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', audio, undefined), false);
		assert.equal(events.length, 0);
		assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', audio, encoder), false);
		assert.equal(await probeBrowserWebCodecsAudioEncoding('aac', audio, encoder), false);
	});
	assert.equal(calls, 0); assert.equal(events.filter(event => event === 'remove').length, 2);
});
