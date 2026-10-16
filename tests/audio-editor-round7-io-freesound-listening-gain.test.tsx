/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const SOUND = {
	id: 42, name: 'Rain.ogg', creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	pageUrl: 'https://freesound.org/s/42/', description: 'A rain recording.', tags: ['rain'], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 12, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
	waveform: { available: true, url: '/api/freesound/sounds/42/waveform?asset=789' },
};

for (const initialGain of [0, 1]) test(`Freesound listening gain starts at ${String(initialGain)} and follows live and paused output changes`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorAudio = globalThis.Audio, priorFetch = globalThis.fetch;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const audios: PreviewAudio[] = [];
	globalThis.Audio = class extends PreviewAudio {
		constructor(source = '') { super(source); audios.push(this); }
	} as unknown as typeof Audio;
	globalThis.fetch = async () => Response.json({ data: { query: 'rain', page: 1, pageSize: 20,
		totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] } });
	const controller = { actions: { project: { importFiles: async () => undefined } },
		getSnapshot: () => ({ productId: 'soundscaper', project: { id: 'project-a' } }),
		captureProjectGeneration: () => ({ projectId: 'project-a', generation: 1 }), assertProjectGeneration: () => undefined };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (gain: number) => { await act(async () => root.render(<FreesoundPanelContainer
		controller={controller} snapshot={{ locale: 'en', audioDevices: { playbackGain: gain }, project: { tracks: [] } }}
		copy={ENGLISH_COPY} freesoundTransport={{ request: async () => Response.json({ data: { connected: false } }),
			openAuthorization: () => undefined }} />)); };
	const clickPreview = async (label: string) => {
		const button = dom.container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === `${label}: Rain.ogg`);
		assert.ok(button);
		await act(async () => reactProps(button).onClick());
	};
	try {
		await render(initialGain);
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		await clickPreview('Play preview');
		assert.equal(audios.length, 1);
		const audio = audios[0]!;
		assert.equal(audio.volume, initialGain, 'the actual new preview inherits the current listening output');
		assert.equal(audio.playCount, 1);
		await render(0.25);
		assert.equal(audio.volume, 0.25);
		assert.equal(audio.playCount, 1, 'changing listening gain retains the current preview transport');
		await clickPreview('Pause preview');
		await render(0);
		assert.equal(audio.volume, 0);
		await clickPreview('Play preview');
		assert.equal(audios.length, 1);
		assert.equal(audio.playCount, 2);
		assert.equal(audio.volume, 0, 'resume retains the listening gain applied while paused');
	} finally {
		await act(async () => root.unmount());
		globalThis.Audio = priorAudio; globalThis.fetch = priorFetch;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});

class PreviewAudio {
	volume = 1;
	preload = '';
	playCount = 0;
	constructor(public src: string) {}
	addEventListener(): void {}
	play(): Promise<void> { this.playCount += 1; return Promise.resolve(); }
	pause(): void {}
	load(): void {}
}
