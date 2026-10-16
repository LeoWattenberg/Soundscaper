/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import React, { act } from 'react';
import { FreesoundPanelContainer } from '../src/common/editor/ui/workspace/FreesoundPanelContainer.tsx';
import type { FreesoundClientTransport } from '../src/common/editor/ui/workspace/freesound-auth-upload-client.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const SOUND = {
	id: 42, name: 'Rain in the garden', pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	description: 'A garden field recording.', tags: ['rain'], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 12, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
};

for (const changeAccount of [false, true]) test(`mounted original-download expiry ${changeAccount ? 'preserves the replacement' : 'expires its original'} account`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorFetch = globalThis.fetch;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let release!: (response: Response) => void;
	let requested!: () => void;
	const originalRequested = new Promise<void>(resolve => { requested = resolve; });
	const originalResponse = new Promise<Response>(resolve => { release = resolve; });
	const transport: FreesoundClientTransport = {
		openAuthorization: () => undefined,
		request: async (path, init) => {
			if (path.endsWith('/oauth/session')) return init?.method === 'DELETE'
				? new Response(null, { status: 204 }) : data({ connected: true, user: { username: 'original-account' } });
			if (path.endsWith('/oauth/start')) return data({
				attemptId: 'replacement', handoffToken: 'replacement-handoff',
				authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary-client&response_type=code&state=replacement&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			});
			if (path.endsWith('/oauth/poll')) return data({ connected: true, user: { username: 'new-account' } });
			if (path.endsWith('/uploads/pending')) return data({ pendingDescription: [], pendingProcessing: [], pendingModeration: [] });
			assert.equal(path, '/api/freesound/sounds/42/original');
			requested();
			return originalResponse;
		},
	};
	globalThis.fetch = async input => {
		const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
		if (path.endsWith('/sounds/42')) return data(SOUND);
		assert.equal(path, '/api/freesound/search');
		return data({ query: 'rain', page: 1, pageSize: 20, totalCount: 1, totalPages: 1,
			hasNextPage: false, hasPreviousPage: false, results: [SOUND] });
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const controller = {
		actions: { project: { importFiles: async () => { assert.fail('Unauthorized download cannot import'); } } },
		getSnapshot: () => ({ productId: 'soundscaper', readOnly: false, importing: false, project: { id: 'project-a' } }),
		captureProjectGeneration: () => ({ projectId: 'project-a', generation: 1 }),
		assertProjectGeneration: () => undefined,
	};
	const button = (name: string) => {
		const found = dom.container.querySelectorAll('button').find(candidate => candidate.textContent.trim().endsWith(name));
		assert.ok(found, `Missing mounted button ${name}`);
		return found;
	};
	try {
		await act(async () => { root.render(<FreesoundPanelContainer controller={controller}
			snapshot={{ locale: 'en', project: { tracks: [] } }} copy={ENGLISH_COPY} freesoundTransport={transport} />); });
		await act(async () => { await setImmediate(); });
		assert.match(dom.container.textContent, /Connected as original-account/u);
		await act(async () => { reactProps(dom.one('input')).onChange({ currentTarget: { value: 'rain' } }); });
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await setImmediate(); });
		await act(async () => { reactProps(button('Add to project: Rain in the garden')).onClick(); await originalRequested; });
		if (changeAccount) {
			await act(async () => { reactProps(button('Disconnect')).onClick(); await setImmediate(); });
			await act(async () => { reactProps(button('Connect to Freesound')).onClick(); await setImmediate(); });
			assert.match(dom.container.textContent, /Connected as new-account/u);
		}
		await act(async () => {
			release(Response.json({ error: { code: 'not_authenticated', message: 'Old account expired.' } }, { status: 401 }));
			await setImmediate();
		});
		assert.match(dom.container.textContent, /Old account expired\./u);
		if (changeAccount) assert.match(dom.container.textContent, /Connected as new-account/u);
		else assert.ok(button('Connect to Freesound'));
	} finally {
		release(new Response(null, { status: 401 }));
		await act(async () => root.unmount());
		globalThis.fetch = priorFetch;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function data(value: unknown): Response { return Response.json({ data: value }); }
