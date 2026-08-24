/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
} from '../src/framescaper/editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperNativeWatchImportClientV28,
	type FramescaperNativeWatchImportControllerV28,
} from '../src/framescaper/editor-native-watch-import-client-v28.ts';

const BYTES = new TextEncoder().encode('selected-v28-watch-video');
const DIGEST = createHash('sha256').update(BYTES).digest('hex');
const PROXY_DIGEST = '9a'.repeat(32);
const CLAIM_ID = '1a'.repeat(16);
const LOCATOR_ID = '2b'.repeat(16);
const LOCATOR_REVISION = '3c'.repeat(16);

test('selected V28 imports into its exact bin then completes requested authenticated proxy work', async () => {
	const fixture = createFixture({ generateProxies: true, completionResults: [false, true] });
	assert.equal(await fixture.client.pollNow(), true);
	assert.deepEqual(fixture.importOptions, [{
		destination: 'project-bin', linkedVideoLocatorId: LOCATOR_ID,
		linkedVideoLocatorRevision: LOCATOR_REVISION,
	}]);
	assert.deepEqual(fixture.proxySources, ['video-source-1']);
	assert.equal(fixture.project.revision, 3);
	assert.equal(fixture.flushes, 3,
		'the imported and proxied V28 snapshot is flushed before each durable acknowledgement');
	assert.deepEqual(fixture.completions.map(({ success }) => success), [true, true]);
	assert.deepEqual(fixture.completions[0], {
		claimId: CLAIM_ID, projectId: 'project-28', projectSchemaVersion: 28,
		binId: 'project-bin', sourceId: 'video-source-1', contentSha256: DIGEST,
		expectedProjectRevision: 1, committedProjectRevision: 3, success: true,
	});
	assert.equal(JSON.stringify(fixture.completions).includes('/private'), false);
	await fixture.client.dispose();
});

test('selected V28 restart resumes only the missing proxy for an already imported digest', async () => {
	const fixture = createFixture({
		generateProxies: true, existingSourceId: 'video-source-1', initialRevision: 2,
	});
	assert.equal(await fixture.client.pollNow(), true);
	assert.deepEqual(fixture.importOptions, []);
	assert.equal(fixture.loads, 0, 'proxy-only recovery does not rematerialize an external file');
	assert.deepEqual(fixture.proxySources, ['video-source-1']);
	assert.equal(fixture.project.revision, 3);
	assert.equal(fixture.completions[0]?.committedProjectRevision, 3);
});

test('selected V28 rejects stale, path-bearing, and wrong-bin claims before mutation', async () => {
	for (const claimPatch of [
		{ binId: 'other-bin' },
		{ path: '/private/watch.mov' },
		{ projectSchemaVersion: 20 },
	] as const) {
		const fixture = createFixture({ claimPatch });
		assert.equal(await fixture.client.pollNow(), false);
		assert.deepEqual(fixture.importOptions, []);
		assert.deepEqual(fixture.proxySources, []);
		assert.equal(fixture.project.revision, 1);
	}
});

function createFixture(options: Readonly<{
	generateProxies?: boolean;
	existingSourceId?: string | null;
	initialRevision?: number;
	completionResults?: boolean[];
	claimPatch?: Readonly<Record<string, unknown>>;
}> = {}) {
	const existingSourceId = options.existingSourceId ?? null;
	let project = projectV28(options.initialRevision ?? 1, existingSourceId !== null, false);
	let flushes = 0;
	let loads = 0;
	const importOptions: Readonly<Record<string, unknown>>[] = [];
	const proxySources: string[] = [];
	const completions: Array<Record<string, unknown>> = [];
	const completionResults = [...(options.completionResults ?? [true])];
	const controller = {
		get project() { return project; },
		actions: { project: {
			importFiles: async (_files: readonly Blob[], value: Readonly<Record<string, unknown>>) => {
				importOptions.push(value);
				project = projectV28(project.revision + 1, true, false);
			},
			flush: async () => { flushes += 1; },
		} },
	} as FramescaperNativeWatchImportControllerV28;
	const proxy = registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto', previewTrust: () => 'unavailable', setMode: async () => undefined,
		pressure: () => null, reportPreviewPressure: async () => undefined,
		generate: async (sourceId) => {
			proxySources.push(sourceId);
			project = projectV28(project.revision + 1, true, true);
		},
		attachExisting: async () => undefined, detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	});
	bindFramescaperVideoProxyActionRuntime(controller, proxy);
	const file = new File([Uint8Array.from(BYTES).buffer], 'watch.mov', {
		type: 'video/quicktime', lastModified: 20,
	});
	const client = createFramescaperNativeWatchImportClientV28({
		controller,
		linkedVideoOriginalPort: {
			load: async () => {
				loads += 1;
				return Object.freeze({ blob: file, locatorRevision: LOCATOR_REVISION });
			},
			reconcile: async () => 0,
		},
		bridge: {
			claimWatchImport: async () => ({
				claimId: CLAIM_ID, projectId: 'project-28', projectRevision: project.revision,
				projectSchemaVersion: 28, binId: 'project-bin',
				generateProxies: options.generateProxies === true, existingSourceId,
				importMode: 'link', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
				name: 'watch.mov', size: BYTES.byteLength, mimeType: 'video/quicktime',
				lastModified: 20, contentSha256: DIGEST,
				...options.claimPatch,
			}) as never,
			completeWatchImport: async (request) => {
				completions.push(request as unknown as Record<string, unknown>);
				return completionResults.shift() ?? true;
			},
		},
		autoStart: false,
	});
	return {
		client, controller, importOptions, proxySources, completions,
		get project() { return project; },
		get flushes() { return flushes; },
		get loads() { return loads; },
	};
}

function projectV28(revision: number, imported: boolean, proxied: boolean) {
	const source = Object.freeze({
		kind: 'video', id: 'video-source-1', contentSha256: DIGEST,
		proxyAttachment: proxied ? Object.freeze({
			originalSha256: DIGEST, sha256: PROXY_DIGEST,
		}) : null,
	});
	return Object.freeze({
		schemaVersion: 28 as const, id: 'project-28', revision,
		sources: Object.freeze(imported ? [source] : []),
		projectBin: Object.freeze({ clips: Object.freeze(imported ? [Object.freeze({
			kind: 'video', id: 'bin-video-1', sourceId: source.id,
		})] : []) }),
	});
}
