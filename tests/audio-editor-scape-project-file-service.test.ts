/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createScapeProjectFileService } from '../src/common/editor/controller/scape-project-file-service.ts';

test('Scape project file composition shares owned inspection with collision-gated opens', async () => {
	const lifetime = new EditorControllerLifetime();
	const store = { loadProject: () => null };
	const inspected = Object.freeze({ exists: true, id: 'existing-project' });
	const inspectionCalls: unknown[][] = [];
	const openCalls: unknown[][] = [];
	const service = createScapeProjectFileService({
		lifetime,
		store,
		productCapabilities: {},
		inspectScapeProject: (file, receivedStore, options) => {
			inspectionCalls.push([file, receivedStore, options]);
			return inspected;
		},
		openScape: (...args) => {
			openCalls.push(args);
			return Object.freeze({ opened: true });
		},
	});
	const inspectedFile = new Blob(['inspect']);
	const openedFile = new Blob(['open']);

	assert.equal(Object.isFrozen(service), true);
	assert.equal(await service.inspectScape(inspectedFile, { marker: 'direct' }), inspected);
	assert.deepEqual(
		await service.openScapeFile(openedFile, (request) => {
			assert.equal(request.file, openedFile);
			assert.equal(request.inspected, inspected);
			return 'replace';
		}, { marker: 'open' }),
		{ opened: true },
	);
	assert.equal(inspectionCalls.length, 2);
	assert.equal(inspectionCalls[0]?.[0], inspectedFile);
	assert.equal(inspectionCalls[1]?.[0], openedFile);
	assert.equal(inspectionCalls[0]?.[1], store);
	assert.equal(inspectionCalls[1]?.[1], store);
	assert.equal((inspectionCalls[0]?.[2] as Readonly<Record<string, unknown>>).marker, 'direct');
	assert.equal((inspectionCalls[1]?.[2] as Readonly<Record<string, unknown>>).marker, 'open');
	assert.deepEqual(openCalls, [[openedFile, { collision: 'replace' }]]);
});
