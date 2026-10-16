/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const RESULT = Object.freeze({
	id: 42,
	name: 'Rain.ogg',
	creator: Object.freeze({
		username: 'field-recorder',
		pageUrl: 'https://freesound.org/people/field-recorder/',
	}),
	pageUrl: 'https://freesound.org/s/42/',
	description: 'Steady rain.',
	tags: Object.freeze(['rain']),
	category: 'Sound effects',
	subcategory: 'Weather',
	createdAt: '2026-04-16T20:07:11.145',
	license: Object.freeze({
		code: 'cc-by',
		name: 'Attribution 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		requiresAttribution: true,
		commercialUseAllowed: true,
	}),
	generativeAiPreference: null,
	explicit: false,
	durationSeconds: 12,
	originalFile: Object.freeze({
		format: 'ogg', channels: 2, byteLength: 4_096, sampleRate: 48_000,
		md5: '0123456789abcdef0123456789abcdef',
	}),
	statistics: Object.freeze({ downloads: 42, averageRating: 4.75, ratingCount: 8 }),
	preview: Object.freeze({
		available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192,
	}),
	waveform: Object.freeze({
		available: true, url: '/api/freesound/sounds/42/waveform?asset=789&source=cdn',
	}),
});

class PendingAudio extends EventTarget {
	src: string;
	preload = '';
	currentTime = 3;
	readonly requests: Array<{ reject: (error: Error) => void; resolve: () => void }> = [];
	rejectOnPause = true;
	constructor(source = '') { super(); this.src = source; }
	play(): Promise<void> {
		return new Promise<void>((resolve, reject) => { this.requests.push({ resolve, reject }); });
	}
	pause(): void {
		if (this.rejectOnPause) this.requests.at(-1)?.reject(new DOMException('Playback was interrupted by pause', 'AbortError'));
	}
	load(): void {}
}

async function withPreview(run: (fixture: Readonly<{
	audios: PendingAudio[];
	press: () => Promise<void>;
	previewLeft: () => string | undefined;
	hide: () => Promise<void>;
}>) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const priorAudio = globalThis.Audio;
	const priorFetch = globalThis.fetch;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const audios: PendingAudio[] = [];
	globalThis.Audio = class extends PendingAudio {
		constructor(source?: string) { super(source); audios.push(this); }
	} as unknown as typeof Audio;
	globalThis.fetch = async (input) => String(input).includes('/oauth/session')
		? Response.json({ data: { connected: false } })
		: Response.json({ data: { query: 'rain', page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
			hasNextPage: false, hasPreviousPage: false, results: [RESULT] } });
	const controller = { actions: { project: { importFiles: async () => undefined } },
		getSnapshot: () => ({ productId: 'soundscaper', project: { id: 'project-a' } }),
		captureProjectGeneration: () => ({ projectId: 'project-a', generation: 1 }),
		assertProjectGeneration: () => undefined };
	const props = { controller, snapshot: { locale: 'en', project: { tracks: [] } }, copy: ENGLISH_COPY };
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive />));
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } }));
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await Promise.resolve(); });
		const press = async (): Promise<void> => {
			await act(async () => reactProps(dom.one('.kw-audio-editor__freesound-preview-button')).onClick());
		};
		await press();
		assert.equal(audios.length, 1);
		await run({ audios, press,
			previewLeft: () => {
				const playhead = dom.find('.kw-audio-editor__freesound-preview-playhead');
				return playhead ? (playhead.style as unknown as CSSStyleDeclaration).left : undefined;
			},
			hide: async () => { await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive={false} />)); },
		});
	} finally {
		await act(async () => root.unmount());
		globalThis.Audio = priorAudio;
		globalThis.fetch = priorFetch;
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

test('pausing a pending native preview preserves its source, seek position and resume owner', async () => {
	await withPreview(async ({ audios, press, previewLeft }) => {
		await act(async () => audios[0]!.dispatchEvent(new Event('timeupdate')));
		await press();
		assert.match(audios[0]!.src, /\/sounds\/42\/preview/u);
		assert.equal(previewLeft(), '25%');
		await press();
		assert.equal(audios.length, 1);
		assert.equal(audios[0]!.requests.length, 2);
	});
});

test('late rejection of interrupted playback cannot destroy its resumed preview', async () => {
	await withPreview(async ({ audios, press }) => {
		audios[0]!.rejectOnPause = false;
		await press();
		await press();
		await act(async () => audios[0]!.requests[0]!.reject(new DOMException('Playback was interrupted', 'AbortError')));
		assert.match(audios[0]!.src, /\/sounds\/42\/preview/u);
	});
});

test('a genuine current playback failure still clears its unavailable preview', async () => {
	await withPreview(async ({ audios, previewLeft }) => {
		await act(async () => audios[0]!.requests[0]!.reject(new DOMException('Media unavailable', 'NotSupportedError')));
		assert.equal(audios[0]!.src, '');
		assert.equal(previewLeft(), undefined);
	});
});

test('hiding the Freesound panel still stops and clears a pending preview', async () => {
	await withPreview(async ({ audios, hide, previewLeft }) => {
		await hide();
		assert.equal(audios[0]!.src, '');
		assert.equal(previewLeft(), undefined);
	});
});
