/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';

void test('native Scape opening accepts the unnamed Blob supported by archive inspection', async () => {
	const blob = new Blob(['archive']);
	const manifest: ScapeManifest = {
		format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', size: 0, sha256: '0'.repeat(64), schemaFamily: 'soundscaper', schemaVersion: 1 },
		assets: [],
	};
	const fixture = createFixture({
		async importScapeProject(input) {
			assert.equal(input, blob);
			return { project: project('imported'), readOnly: false, manifest };
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.openScape(blob);
	assert.equal(result?.manifest, manifest);
	assert.deepEqual(fixture.switched, ['imported']);
});

void test('a named non-project file is rejected before archive import', async () => {
	let imports = 0;
	const fixture = createFixture({ async importScapeProject() {
		imports += 1;
		return { project: project(), readOnly: false, manifest: {} };
	} });
	await assert.rejects(createNativeProjectService(fixture.runtime).openScape(nativeFile('audio.wav')), /Choose a Scape/);
	assert.equal(imports, 0);
});

void test('unknown storage estimates remain absent in portable codec options', async () => {
	const fixture = createFixture();
	const client = fixture.runtime.createAup4Client({});
	const stopped = new Error('stop after observing portable options');
	const service = createNativeProjectService({
		...fixture.runtime,
		store: { ...fixture.runtime.store, async estimateStorage() { return { usage: null, quota: null }; } },
		createAup4Client: () => ({ ...client, async openFile(_id, _file, options) {
			assert.equal(options.usage, undefined);
			assert.equal(options.quota, undefined);
			throw stopped;
		} }),
	});
	await assert.rejects(service.openAup4(nativeFile('project.aup4')), error => error === stopped);
	assert.equal(fixture.state.importing, false);
});
