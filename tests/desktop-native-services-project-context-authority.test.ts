/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FramescaperNativeProjectContextAuthority,
} from '../desktop/native-services-project-context-authority.ts';
import {
	createUnifiedExactRenderPlanWithTimingSidecars,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createFramescaperNativeRenderPlanAuthorityNativeMedia,
} from '../src/framescaper/editor-native-render-plan-authority.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanNativeMedia,
} from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';

const PROJECT_SHA256 = 'a1'.repeat(32);

test('project context retains the exact project-bin identity through production wiring', () => {
	const authority = contextAuthority();
	assert.deepEqual(authority.projectState('project-1'), {
		schemaFamily: 'framescaper', schemaVersion: 1,
		open: true, writable: true, binId: 'project-bin',
	});

	const wrongBin = contextAuthority({ binId: 'other-bin' });
	assert.throws(
		() => wrongBin.projectState('project-1'),
		/exact project-bin identity/iu,
	);
});

test('project context authenticates V12 and V14 OpenFX timing assets', async () => {
	for (const version of [12, 14] as const) {
		const fixture = version === 12 ? v12TimingPlan() : v14TimingPlan();
		const { plan } = fixture;
		const input = Object.freeze({
			inputIndex: 0,
			sourceId: plan.sources[0]!.sourceId,
			...fixture.publication.reference,
		});
		const body = Object.freeze({
			kind: 'video-timing' as const, encoding: input.encoding,
			sourceId: input.storageKey, storageKey: input.storageKey,
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
			byteLength: input.byteLength, sha256: input.sha256,
		});
		const authority = contextAuthority({
			body,
			bytes: fixture.publication.bytes,
			projectRevision: plan.project.revision,
		});
		const assets = await authority.openFxTimingAssets(plan);
		assert.equal(assets.length, 1);
		assert.deepEqual(assets[0]!.input, input);
		assert.deepEqual(assets[0]!.bytes, fixture.publication.bytes);
		assert.notEqual(assets[0]!.bytes, fixture.publication.bytes);
	}
});

function contextAuthority(options: Readonly<{
	readonly binId?: string;
	readonly body?: Readonly<{
		readonly kind: 'video-timing'; readonly encoding: string;
		readonly sourceId: string; readonly storageKey: string;
		readonly mimeType: string; readonly byteLength: number; readonly sha256: string;
	}>;
	readonly bytes?: Uint8Array;
	readonly projectRevision?: number;
}> = {}): FramescaperNativeProjectContextAuthority {
	const bodies = options.body === undefined ? [] : [options.body];
	const projectRevision = options.projectRevision ?? 1;
	return new FramescaperNativeProjectContextAuthority({
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectState: () => Object.freeze({
			schemaFamily: 'framescaper', schemaVersion: 1,
			open: true, writable: true, binId: options.binId ?? 'project-bin',
		}),
		projectRecord: (projectId) => Object.freeze({
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId, projectRevision,
			projectSha256: PROJECT_SHA256, bodies,
		}),
		readProjectBundle: async () => Object.freeze({
			project: Object.freeze({
				schemaFamily: 'framescaper', schemaVersion: 1,
				projectRevision, sha256: PROJECT_SHA256,
			}),
			bodies,
		}),
		readBody: async () => new Uint8Array(options.bytes ?? []),
	});
}

function v12TimingPlan() {
	const fixture = unifiedExactVfrPlanFixture(12, '12'.repeat(32));
	return Object.freeze({
		plan: createUnifiedExactRenderPlanWithTimingSidecars(
			fixture.plan, fixture.timingSidecars,
		),
		publication: fixture.publication,
	});
}

function v14TimingPlan() {
	const publication = createVideoTimingAssetPublication('12'.repeat(32), {
		timescale: 1_000,
		presentationTicks: [0n, 10n, 30n, 60n, 100n, 150n, 210n, 280n, 360n, 450n],
		finalFrameDurationTicks: 100n,
	});
	const options = structuredClone(framescaperV20Options());
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.timingAsset = publication.reference;
	source.timingDecision = {
		mode: 'exact', rate: { num: 10, den: 1 }, backend: 'demuxer',
	};
	const project = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options,
	);
	const projectSource = project.sources.find(({ id }) => id === 'video-source')!;
	registerVideoTimingIndex(
		projectSource,
		validateVideoTimingAssetBytes(publication.reference, publication.bytes),
	);
	try {
		const authority = createFramescaperNativeRenderPlanAuthorityNativeMedia(project);
		return Object.freeze({
			plan: createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
				FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project, authority,
			),
			publication,
		});
	} finally {
		unregisterVideoTimingIndex(projectSource);
	}
}
