/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectVisualService } from '../src/common/editor/controller/project-visual-service.ts';
import type { ProjectVisualStore } from '../src/common/editor/controller/project-visual-types.ts';

function fixture(store: ProjectVisualStore) {
	const source = { id: 'video', kind: 'video' };
	const project = { id: 'project', schemaVersion: 17, sources: [source], tracks: [], clips: [] };
	const minted: string[] = [];
	const revoked: string[] = [];
	const service = createProjectVisualService({
		getProject: () => project, captureProject: () => project, assertProject() {},
		missingSourceIds: new Set(), sourceBuffers: new Map(), sourcePeaks: new Map(),
		waveformPcmWindows: new Map(), projectDurationFrames: () => 0, store,
		url: {
			createObjectURL() { const url = `blob:${minted.length}`; minted.push(url); return url; },
			revokeObjectURL(url) { revoked.push(url); },
		},
	});
	return { service, source, minted, revoked };
}

void test('visual activation rejects an invalid stored original before creating a URL', async () => {
	const { service, source, minted } = fixture({
		async loadMediaAsset() { return { corrupt: true }; },
		async listVideoDerivatives() { return []; }, async loadVideoDerivative() { return null; },
	});
	await assert.rejects(service.activateVideoSource(source), /Blob/);
	assert.deepEqual(minted, []);
});

void test('invalid stored derivative releases the original URL and publishes no visual', async () => {
	const { service, source, minted, revoked } = fixture({
		async loadMediaAsset() { return new Blob(['video']); },
		async listVideoDerivatives() { return [{ type: 'poster' }]; },
		async loadVideoDerivative() { return { corrupt: true }; },
	});
	await assert.rejects(service.activateVideoSource(source), /Blob/);
	assert.deepEqual(revoked, minted);
	assert.equal(minted.length, 1);
	assert.equal(service.getVideoSourceVisualData(source.id)?.mediaUrl, null);
});

void test('invalid derivative metadata releases the original URL before reading its body', async () => {
	let reads = 0;
	const { service, source, minted, revoked } = fixture({
		async loadMediaAsset() { return new Blob(['video']); },
		async listVideoDerivatives() { return [{ type: 'thumbnail', width: 'bad' }]; },
		async loadVideoDerivative() { reads += 1; return new Blob(['image']); },
	});
	await assert.rejects(service.activateVideoSource(source), /metadata|width/);
	assert.equal(reads, 0);
	assert.deepEqual(revoked, minted);
	assert.equal(minted.length, 1);
});
