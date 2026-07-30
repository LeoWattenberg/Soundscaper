/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createScapeProjectFileService } from '../src/common/editor/controller/scape-project-file-service.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';

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
		openScape: (file, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			openCalls.push([file, { collision: options.collision }]);
			return Object.freeze({ opened: true });
		},
	});
	const inspectedFile = new Blob(['inspect']);
	const openedFile = createScapeArchiveByteSource({
		size: 4,
		read: () => new Uint8Array(4),
	});

	assert.equal(Object.isFrozen(service), true);
	assert.equal(await service.inspectScape(inspectedFile, { marker: 'direct' }), inspected);
	assert.deepEqual(
		await service.openScapeFile(openedFile, (request) => {
			assert.equal(request.kind, 'collision');
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

test('Scape project file composition blocks incompatible archives before native open', async () => {
	const report = Object.freeze({ compatible: false });
	const inspected = Object.freeze({
		exists: false,
		id: 'incompatible-project',
		title: 'Incompatible project',
		featureRequirementsCompatibility: report,
	});
	const openCalls: unknown[][] = [];
	const requests: unknown[] = [];
	const service = createScapeProjectFileService({
		lifetime: new EditorControllerLifetime(),
		store: null,
		productCapabilities: {},
		inspectScapeProject: () => inspected,
		openScape: (input, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			openCalls.push([input, { collision: options.collision }]);
			return 'opened';
		},
	});
	const file = new Blob(['incompatible']);

	assert.deepEqual(await service.openScapeFile(file, (request) => {
		requests.push(request);
		assert.equal(request.kind, 'compatibility');
		assert.equal(request.inspected.featureRequirementsCompatibility, report);
		return 'cancel';
	}), { cancelled: true });
	assert.deepEqual(openCalls, []);

	assert.equal(await service.openScapeFile(file, (request) => {
		requests.push(request);
		return 'open-read-only';
	}), 'opened');
	assert.equal(requests.length, 2);
	assert.deepEqual(openCalls, [[file, { collision: 'copy' }]]);
});
