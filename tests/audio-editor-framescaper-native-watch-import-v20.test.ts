/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperNativeWatchImportClientV20,
	type FramescaperNativeWatchImportControllerV20,
} from '../src/framescaper/editor-native-watch-import-client-v20.ts';

const BYTES = new TextEncoder().encode('watch-video');
const DIGEST = createHash('sha256').update(BYTES).digest('hex');
const CLAIM_ID = '1a'.repeat(16);
const LOCATOR_ID = '2b'.repeat(16);
const LOCATOR_REVISION = '3c'.repeat(16);

test('selected V20 links one verified pathless claim into the project bin and retries completion', async () => {
	const fixture = createFixture('link', [false, true]);
	assert.equal(await fixture.client.pollNow(), true);
	assert.deepEqual(fixture.importOptions, [{
		destination: 'project-bin', linkedVideoLocatorId: LOCATOR_ID,
		linkedVideoLocatorRevision: LOCATOR_REVISION,
	}]);
	assert.equal(fixture.project.revision, 2);
	assert.equal(fixture.flushes, 2, 'a refused completion re-flushes the exact revision before retry');
	assert.deepEqual(fixture.completions.map((completion) => completion.success), [true, true]);
	assert.deepEqual(fixture.claimRequests, [{ projectId: 'project-1', projectRevision: 1 }]);
	await fixture.client.dispose();
});

test('copy mode imports without a locator binding and main owns locator cleanup', async () => {
	const fixture = createFixture('copy');
	assert.equal(await fixture.client.pollNow(), true);
	assert.deepEqual(fixture.importOptions, [{ destination: 'project-bin' }]);
	assert.equal(fixture.completions[0]?.success, true);
});

test('digest tamper and stale project claims fail without mutating the project', async () => {
	const tampered = createFixture('link', [true], new TextEncoder().encode('other-video'));
	assert.equal(await tampered.client.pollNow(), false);
	assert.equal(tampered.project.revision, 1);
	assert.deepEqual(tampered.completions.map((completion) => completion.success), [false]);

	const stale = createFixture('link');
	stale.beforeClaimReturn = () => { stale.project = { ...stale.project, revision: 2 }; };
	assert.equal(await stale.client.pollNow(), false);
	assert.equal(stale.importOptions.length, 0);
	assert.equal(stale.completions[0]?.success, false);
});

test('non-V20 projects and absent ports remain dormant and schedule no work', async () => {
	const fixture = createFixture('link');
	fixture.project = { ...fixture.project, schemaVersion: 25 } as never;
	assert.equal(await fixture.client.pollNow(), false);
	assert.equal(fixture.claimRequests.length, 0);
	const unavailable = createFramescaperNativeWatchImportClientV20({
		controller: fixture.controller, linkedVideoOriginalPort: null, bridge: null,
		autoStart: false,
	});
	assert.equal(unavailable.available, false);
	assert.equal(await unavailable.pollNow(), false);
});

function createFixture(
	importMode: 'link' | 'copy',
	completionResults = [true],
	bytes: Uint8Array = BYTES,
) {
	let project = projectV20(1);
	let beforeClaimReturn: (() => void) | null = null;
	let flushes = 0;
	const importOptions: Readonly<Record<string, unknown>>[] = [];
	const completions: Array<Readonly<{
		claimId: string; projectId: string; expectedProjectRevision: number;
		committedProjectRevision: number; success: boolean;
	}>> = [];
	const claimRequests: Array<Readonly<{ projectId: string; projectRevision: number }>> = [];
	const file = new File([Uint8Array.from(bytes).buffer], 'clip.mp4', {
		type: 'video/mp4', lastModified: 20,
	});
	const controller = {
		get project() { return project; },
		actions: { project: {
			importFiles: async (_files: readonly Blob[], options: Readonly<Record<string, unknown>>) => {
				importOptions.push(options);
				project = projectV20(2, true);
			},
			flush: async () => { flushes += 1; },
		} },
	} as FramescaperNativeWatchImportControllerV20;
	const client = createFramescaperNativeWatchImportClientV20({
		controller,
		linkedVideoOriginalPort: {
			load: async () => Object.freeze({ blob: file, locatorRevision: LOCATOR_REVISION }),
			reconcile: async () => 0,
		},
		bridge: {
			claimWatchImport: async (request) => {
				claimRequests.push(request);
				beforeClaimReturn?.();
				return Object.freeze({
					claimId: CLAIM_ID, projectId: 'project-1', projectRevision: 1,
					importMode, locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
					name: 'clip.mp4', size: bytes.byteLength, mimeType: 'video/mp4',
					lastModified: 20, contentSha256: DIGEST,
				});
			},
			completeWatchImport: async (request) => {
				completions.push(request);
				return completionResults.shift() ?? true;
			},
		},
		autoStart: false,
	});
	return {
		client, controller, importOptions, completions, claimRequests,
		get project() { return project; },
		set project(value) { project = value as ReturnType<typeof projectV20>; },
		get flushes() { return flushes; },
		set beforeClaimReturn(value: (() => void) | null) { beforeClaimReturn = value; },
	};
}

function projectV20(revision: number, imported = false) {
	return Object.freeze({
		schemaVersion: 20 as const, id: 'project-1', revision,
		sources: Object.freeze(imported ? [Object.freeze({
			kind: 'video', id: 'video-source-1', contentSha256: DIGEST,
		})] : []),
		projectBin: Object.freeze({ clips: Object.freeze(imported ? [Object.freeze({
			kind: 'video', id: 'video-clip-1', sourceId: 'video-source-1',
		})] : []) }),
	});
}
