/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { freesoundWorkspaceActions, importFreesoundSound,
	type FreesoundWorkspaceController } from '../src/common/editor/ui/workspace/freesound-workspace-service.ts';

const SOUND = {
	id: 42, name: 'Rain.ogg', pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'recorder', pageUrl: 'https://freesound.org/people/recorder/' },
	description: 'Rain', tags: [], category: null, subcategory: null, createdAt: '2026-04-16T20:07:11.145',
	license: { code: 'cc0', name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	generativeAiPreference: null, explicit: false, durationSeconds: 1,
	originalFile: { format: 'ogg', channels: 2, byteLength: 4096, sampleRate: 48000, md5: '0'.repeat(32) },
	statistics: { downloads: 1, averageRating: 1, ratingCount: 1 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
};

test('a cached Freesound service reads a callback installed or replaced after its first creation', async () => {
	const fixture = createController();
	let originalFetches = 0, accepted = 0, declined = 0;
	const actions = freesoundWorkspaceActions(fixture.controller, {
		maximumOriginalBytes: 4, authenticated: () => true,
		fetch: async (input) => {
			if (new URL(String(input)).pathname.endsWith('/original')) {
				originalFetches += 1;
				return new Response(Uint8Array.of(1, 2, 3), { headers: { 'Content-Type': 'audio/ogg' } });
			}
			return Response.json({ data: SOUND });
		},
	});
	freesoundWorkspaceActions(fixture.controller, { confirmFileSizeWarning: async () => { accepted += 1; return true; } });
	await actions.importSound({ soundId: 42, destination: 'project-bin' });
	assert.equal(accepted, 1);
	assert.equal(originalFetches, 1);
	assert.equal(fixture.imported.length, 1);
	freesoundWorkspaceActions(fixture.controller, { confirmFileSizeWarning: async () => { declined += 1; return false; } });
	await assert.rejects(actions.importSound({ soundId: 42, destination: 'project-bin' }), { name: 'AbortError' });
	assert.equal(declined, 1);
	assert.equal(originalFetches, 1);
	assert.equal(fixture.imported.length, 1);
});

test('direct Project Bin import can supply the warning port before a Freesound panel creates its cache', async () => {
	const fixture = createController();
	const priorFetch = globalThis.fetch;
	globalThis.fetch = async () => { throw new Error('The direct drop must use its supplied transport.'); };
	let prompts = 0;
	try {
		await importFreesoundSound(fixture.controller, { soundId: 42, destination: 'project-bin' }, {
			maximumOriginalBytes: 4, authenticated: () => true,
			confirmFileSizeWarning: async (warning) => { assert.equal(warning.byteLength, 4096); prompts += 1; return true; },
			fetch: async (input) => new URL(String(input)).pathname.endsWith('/original')
				? new Response(Uint8Array.of(1, 2, 3), { headers: { 'Content-Type': 'audio/ogg' } })
				: Response.json({ data: SOUND }),
		});
		assert.equal(prompts, 1);
		assert.equal(fixture.imported.length, 1);
	} finally { globalThis.fetch = priorFetch; }
});

test('late installed warning callbacks retain the captured project fence before media requests', async () => {
	const fixture = createController();
	let originalFetches = 0;
	const actions = freesoundWorkspaceActions(fixture.controller, {
		maximumOriginalBytes: 4, authenticated: () => true,
		fetch: async (input) => {
			if (new URL(String(input)).pathname.endsWith('/original')) originalFetches += 1;
			return Response.json({ data: SOUND });
		},
	});
	freesoundWorkspaceActions(fixture.controller, {
		confirmFileSizeWarning: async () => { fixture.changeProject(); return true; },
	});
	await assert.rejects(actions.importSound({ soundId: 42, destination: 'project-bin' }), /project changed/iu);
	assert.equal(originalFetches, 0);
	assert.equal(fixture.imported.length, 0);
});

function createController() {
	const imported: File[][] = [];
	const token = Object.freeze({ generation: 1, projectId: 'project' });
	let current = true;
	const controller: FreesoundWorkspaceController = {
		actions: { project: { importFiles: async (files) => { imported.push(files); } } },
		getSnapshot: () => ({ productId: 'soundscaper', project: { id: 'project' }, importing: false, readOnly: false }),
		captureProjectGeneration: () => token,
		assertProjectGeneration: () => { if (!current) throw new Error('Project changed'); },
	};
	return { controller, imported, changeProject: () => { current = false; } };
}
