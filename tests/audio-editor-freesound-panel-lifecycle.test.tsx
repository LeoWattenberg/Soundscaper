/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';

import {
	FreesoundPanelContainer,
	freesoundPreviewUrl,
	freesoundWaveformUrl,
} from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
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

test('the grouped Freesound panel forwards activity state to its preview owner', () => {
	const source = readFileSync(new URL(
		'../src/common/editor/ui/workspace/WorkspacePanelContent.jsx', import.meta.url,
	), 'utf8');
	assert.match(
		source,
		/<DeferredWorkspacePanel\b[^>]*\bpanelActive=\{panelActive\}/u,
	);
});

test('Freesound previews use the hosting web origin and the public proxy in the packaged app', () => {
	assert.equal(
		freesoundPreviewUrl(42, { protocol: 'https:', origin: 'https://feature.soundscaper.pages.dev' }),
		'https://feature.soundscaper.pages.dev/api/freesound/sounds/42/preview',
	);
	assert.equal(
		freesoundPreviewUrl(42, { protocol: 'soundscaper-app:', origin: 'null' }),
		'https://soundscaper.org/api/freesound/sounds/42/preview',
	);
	assert.throws(() => freesoundPreviewUrl(0), /valid Freesound sound ID/iu);
});

test('Freesound waveforms use the hosting web origin and the public proxy in the packaged app', () => {
	const waveformPath = '/api/freesound/sounds/42/waveform?asset=789&source=cdn';
	assert.equal(
		freesoundWaveformUrl(42, waveformPath, { protocol: 'https:', origin: 'https://feature.soundscaper.pages.dev' }),
		`https://feature.soundscaper.pages.dev${waveformPath}`,
	);
	assert.equal(
		freesoundWaveformUrl(42, waveformPath, { protocol: 'soundscaper-app:', origin: 'null' }),
		`https://soundscaper.org${waveformPath}`,
	);
	assert.throws(() => freesoundWaveformUrl(0, waveformPath), /valid Freesound sound ID/iu);
	assert.throws(() => freesoundWaveformUrl(42, 'https://example.org/waveform.png'), /valid Freesound waveform path/iu);
	assert.throws(() => freesoundWaveformUrl(42, '/api/freesound/sounds/43/waveform?asset=789'), /valid Freesound waveform path/iu);
});

test('Freesound waveform seeks, starts or resumes preview, and reuses the active audio', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorAudio = globalThis.Audio;
	const priorFetch = globalThis.fetch;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const audioInstances: MockAudio[] = [];
	globalThis.Audio = class extends MockAudio {
		constructor(source?: string) {
			super(source);
			audioInstances.push(this);
		}
	} as unknown as typeof Audio;
	globalThis.fetch = async () => Response.json({ data: {
		query: 'rain', page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
		hasNextPage: false, hasPreviousPage: false, results: [RESULT],
	} });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const projectToken = Object.freeze({ projectId: 'project-a', generation: 1 });
	const controller = {
		actions: { project: { importFiles: async () => undefined } },
		getSnapshot: () => ({
			productId: 'soundscaper', readOnly: false, importing: false,
			project: { id: 'project-a' },
		}),
		captureProjectGeneration: () => projectToken,
		assertProjectGeneration: () => undefined,
	};
	const props = {
		controller,
		snapshot: { locale: 'en', project: { tracks: [] } },
		copy: ENGLISH_COPY,
	};

	try {
		await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive />));
		await act(async () => {
			reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } });
		});
		await act(async () => {
			reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await Promise.resolve();
		});
		const waveform = dom.one('.kw-audio-editor__freesound-waveform');
		Object.defineProperty(waveform, 'getBoundingClientRect', {
			value: () => ({ left: 100, width: 200 }), configurable: true,
		});
		await act(async () => reactProps(waveform).onClick({ clientX: 150, currentTarget: waveform }));
		assert.equal(audioInstances.length, 1);
		assert.equal(audioInstances[0]?.playCount, 1);
		assert.equal(audioInstances[0]?.currentTime, 3);
		audioInstances[0].currentTime = 0;
		audioInstances[0].emit('loadedmetadata');
		assert.equal(audioInstances[0]?.currentTime, 3);

		await act(async () => reactProps(waveform).onClick({ clientX: 250, currentTarget: waveform }));
		assert.equal(audioInstances.length, 1);
		assert.equal(audioInstances[0]?.playCount, 1);
		assert.equal(audioInstances[0]?.currentTime, 9);

		const pauseButton = dom.container.querySelectorAll('button')
			.find((candidate) => candidate.getAttribute('aria-label') === 'Pause preview: Rain.ogg');
		assert.ok(pauseButton, 'playing result exposes pause');
		await act(async () => reactProps(pauseButton).onClick());
		assert.equal(audioInstances[0]?.pauseCount, 1);
		assert.notEqual(audioInstances[0]?.src, '');
		assert.equal(audioInstances[0]?.loadCount, 0);

		await act(async () => reactProps(waveform).onClick({ clientX: 200, currentTarget: waveform }));
		assert.equal(audioInstances.length, 1);
		assert.equal(audioInstances[0]?.currentTime, 6);
		assert.equal(audioInstances[0]?.playCount, 2);

		const secondPauseButton = dom.container.querySelectorAll('button')
			.find((candidate) => candidate.getAttribute('aria-label') === 'Pause preview: Rain.ogg');
		assert.ok(secondPauseButton, 'waveform seek resumes the paused result');
		await act(async () => reactProps(secondPauseButton).onClick());
		const resumeButton = dom.container.querySelectorAll('button')
			.find((candidate) => candidate.getAttribute('aria-label') === 'Play preview: Rain.ogg');
		assert.ok(resumeButton, 'paused result exposes play');
		await act(async () => reactProps(resumeButton).onClick());
		assert.equal(audioInstances.length, 1);
		assert.equal(audioInstances[0]?.playCount, 3);

		await act(async () => root.render(<FreesoundPanelContainer {...props} panelActive={false} />));

		assert.equal(audioInstances[0]?.pauseCount, 3);
		assert.equal(audioInstances[0]?.loadCount, 1);
		assert.equal(audioInstances[0]?.src, '');
	} finally {
		await act(async () => root.unmount());
		globalThis.Audio = priorAudio;
		globalThis.fetch = priorFetch;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('connected original imports over 128 MiB require confirmation before the exact HQ preview retry', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorFetch = globalThis.fetch;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const publicPaths: string[] = [];
	const authenticatedPaths: string[] = [];
	const imports: Array<{ file: File; options: Readonly<Record<string, unknown>> }> = [];
	const oversized = {
		...RESULT,
		originalFile: { ...RESULT.originalFile, byteLength: 128 * 1024 * 1024 + 1 },
	};
	globalThis.fetch = async (input) => {
		const url = new URL(String(input), 'https://soundscaper.org');
		publicPaths.push(url.pathname);
		if (url.pathname.endsWith('/preview')) {
			return new Response(Uint8Array.of(0x4f, 0x67, 0x67, 0x53), {
				headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '4' },
			});
		}
		if (url.pathname.endsWith('/search')) {
			return Response.json({ data: {
				query: 'rain', page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
				hasNextPage: false, hasPreviousPage: false, results: [oversized],
			} });
		}
		return Response.json({ data: oversized });
	};
	const transport = {
		request: async (path: string) => {
			authenticatedPaths.push(path);
			if (path.endsWith('/oauth/session')) {
				return Response.json({ data: { connected: true, user: { id: 5, username: 'uploader' } } });
			}
			if (path.endsWith('/uploads/pending')) {
				return Response.json({ data: {
					pendingDescription: [], pendingProcessing: [], pendingModeration: [],
				} });
			}
			throw new Error(`Unexpected authenticated path: ${path}`);
		},
		openAuthorization: () => undefined,
	};
	const projectToken = Object.freeze({ projectId: 'project-a', generation: 1 });
	const controller = {
		actions: { project: {
			importFiles: async ([file]: File[], options: Readonly<Record<string, unknown>> = {}) => {
				imports.push({ file: file!, options });
			},
		} },
		getSnapshot: () => ({
			productId: 'soundscaper', readOnly: false, importing: false,
			project: { id: 'project-a' },
		}),
		captureProjectGeneration: () => projectToken,
		assertProjectGeneration: () => undefined,
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const flush = async () => {
		await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
	};
	const button = (prefix: string) => dom.container.querySelectorAll('button')
		.find((candidate) => candidate.textContent?.startsWith(prefix));
	try {
		await act(async () => root.render(<FreesoundPanelContainer
			controller={controller}
			snapshot={{
				locale: 'en', selectedTrackId: 'track-a',
				project: { id: 'project-a', tracks: [{ id: 'track-a', type: 'audio' }] },
			}}
			copy={ENGLISH_COPY}
			freesoundTransport={transport}
		/>));
		await flush();
		assert.ok(dom.container.textContent?.includes('Connected as uploader'));
		const searchInput = dom.container.querySelectorAll('input').find(({ type }) => type === 'search');
		assert.ok(searchInput);
		await act(async () => reactProps(searchInput).onChange({ currentTarget: { value: 'rain' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		await flush();

		for (const [label, destination] of [
			['Insert at playhead', 'timeline'],
			['Add to Project Bin', 'project-bin'],
		] as const) {
			const importButton = button(label);
			assert.ok(importButton);
			await act(async () => reactProps(importButton).onClick());
			await flush();
			assert.ok(dom.find('[data-freesound-original-fallback-dialog="true"]'));
			assert.equal(imports.length, destination === 'timeline' ? 0 : 1,
				'oversized original is never retried without confirmation');
			const confirm = button('Import HQ preview');
			assert.ok(confirm);
			await act(async () => reactProps(confirm).onClick());
			await flush();
			await flush();
			assert.equal(imports.at(-1)?.options.destination, destination);
			assert.equal(imports.at(-1)?.file.type, 'audio/ogg');
		}

		assert.equal(authenticatedPaths.some((path) => path.endsWith('/original')), false);
		assert.equal(publicPaths.filter((path) => path.endsWith('/preview')).length, 2);
		assert.equal(imports.length, 2);
	} finally {
		await act(async () => root.unmount());
		globalThis.fetch = priorFetch;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

class MockAudio {
	src: string;
	preload = '';
	currentTime = 0;
	playCount = 0;
	pauseCount = 0;
	loadCount = 0;
	readonly listeners = new Map<string, Array<() => void>>();
	constructor(source = '') { this.src = source; }
	addEventListener(type: string, listener: () => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
	play(): Promise<void> { this.playCount += 1; return Promise.resolve(); }
	pause(): void { this.pauseCount += 1; }
	load(): void { this.loadCount += 1; }
}
