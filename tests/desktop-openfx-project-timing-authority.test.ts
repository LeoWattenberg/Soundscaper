/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { authenticateOpenFxProjectTimingAssets } from '../desktop/openfx-main-project-timing-authority.ts';
import type { NativeProjectMediaBody } from '../desktop/native-services-video-timing-staging.ts';
import {
	createUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV12,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { VIDEO_TIMING_ASSET_MIME_TYPE } from '../src/common/editor/video-timing-asset.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';

const PROJECT_SHA256 = 'a1'.repeat(32);

test('project custody resolves exact VFR timing bytes without exposing a renderer body port', async () => {
	const fixture = authorityFixture();
	const assets = await authenticateOpenFxProjectTimingAssets(fixture.options());
	assert.equal(assets.length, 1);
	assert.deepEqual(assets[0]!.input, fixture.input);
	assert.deepEqual(assets[0]!.bytes, fixture.bytes);
	assert.notEqual(assets[0]!.bytes, fixture.bytes);
	fixture.bytes[0] ^= 0xff;
	assert.notEqual(assets[0]!.bytes[0], fixture.bytes[0]);
});

test('project custody rejects bundle-only timing authority and changed project revisions', async () => {
	const outside = authorityFixture({ recordBodies: [] });
	await assert.rejects(
		() => authenticateOpenFxProjectTimingAssets(outside.options()),
		/outside.*current project/iu,
	);

	const changed = authorityFixture({ changeAfterRead: true });
	await assert.rejects(
		() => authenticateOpenFxProjectTimingAssets(changed.options()),
		/project changed|current project revision/iu,
	);
});

test('project custody rejects tampered SCTI and a forged bundle fingerprint', async () => {
	const tampered = authorityFixture({ tamperBody: true });
	await assert.rejects(
		() => authenticateOpenFxProjectTimingAssets(tampered.options()),
		/changed|digest|binding/iu,
	);
	const forged = authorityFixture({ bundleSha256: 'b2'.repeat(32) });
	await assert.rejects(
		() => authenticateOpenFxProjectTimingAssets(forged.options()),
		/project bundle changed/iu,
	);
});

function authorityFixture(options: Readonly<{
	readonly recordBodies?: readonly NativeProjectMediaBody[];
	readonly tamperBody?: boolean;
	readonly changeAfterRead?: boolean;
	readonly bundleSha256?: string;
}> = {}) {
	const timing = unifiedExactVfrPlanFixture(12, 'c3'.repeat(32));
	const plan = createUnifiedExactRenderPlanWithTimingSidecars(
		timing.plan, timing.timingSidecars,
	) as UnifiedExactRenderPlanV12;
	const input = Object.freeze({
		inputIndex: 0,
		sourceId: plan.sources[0]!.sourceId,
		...timing.publication.reference,
	});
	const body: NativeProjectMediaBody = Object.freeze({
		kind: 'video-timing', encoding: input.encoding,
		sourceId: input.storageKey, storageKey: input.storageKey,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength: input.byteLength, sha256: input.sha256,
	});
	const bytes = new Uint8Array(timing.publication.bytes);
	let recordReads = 0;
	return {
		input,
		bytes,
		options: () => ({
			plan,
			project: {
				projectRecord: (projectId: string) => {
					recordReads += 1;
					return {
						projectId,
						projectRevision: options.changeAfterRead && recordReads > 1 ? 2 : 1,
						projectSha256: PROJECT_SHA256,
						bodies: options.recordBodies ?? [body],
					};
				},
				readProjectBundle: async () => ({
					project: { projectRevision: 1, sha256: options.bundleSha256 ?? PROJECT_SHA256 },
					bodies: [body],
				}),
				readBody: async () => {
					const result = new Uint8Array(bytes);
					if (options.tamperBody) result[result.length - 1] ^= 0xff;
					return result;
				},
			},
			parseBundle: (value: unknown) => value as {
				project: { projectRevision: number; sha256: string };
				bodies: readonly NativeProjectMediaBody[];
			},
		}),
	};
}
