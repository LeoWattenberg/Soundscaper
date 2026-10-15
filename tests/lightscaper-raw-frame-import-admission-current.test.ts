/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceV4, type FramescaperImageSourceV4 } from '../src/common/editor/timeline-image-model-v4.ts';
import { createFramescaperScapeProjectAssetExtension } from '../src/framescaper/editor-scape-assets.ts';
import { validateTimelineImageCurrentArchiveAssets } from '../src/framescaper/editor-scape-asset-plan-timeline-image-current.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../src/framescaper/editor-project-assistance-foundation.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createRawFrameFixtureCurrentV1, rawFixtureSha256CurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';

type Fixture = Awaited<ReturnType<typeof createRawFrameFixtureCurrentV1>>;

/** Match the actual archive inventory without reading, staging or allocating
 * the declared body. Import admission must run before any of those owners. */
function archive(fixture: Fixture, source: Readonly<FramescaperImageSourceV4>) {
	const project = { ...fixture.project(), sources: [source] };
	const bytes = new TextEncoder().encode(JSON.stringify(project));
	const manifest: ScapeManifest = { format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', size: bytes.byteLength, sha256: rawFixtureSha256CurrentV1(bytes), schemaFamily: 'framescaper', schemaVersion: 1 },
		assets: [{ sourceId: `framescaper:image:${source.id}`, kind: 'framescaper-image-asset', encoding: 'framescaper-image-asset-v1',
			entry: `framescaper/timelineImage/image/${source.id}/body`, size: source.assetByteLength, sha256: source.contentSha256, mimeType: source.mimeType }] };
	return { project, manifest };
}

test('Light RAW Current archive import admits a genuine native receipt through its selected extension', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	const source = normalizeFramescaperImageSourceV4(f.source), { project, manifest } = archive(f, source), decoded = f.calls.decoded;
	const extension = createFramescaperScapeProjectAssetExtension(PROFILE);
	assert.doesNotThrow(() => extension.validateImportAssets(project, manifest));
	const admitted = validateTimelineImageCurrentArchiveAssets(framescaperProjectTimelineImageFoundationShapeAssistance(project), manifest);
	assert.equal(admitted.images.references.length, 1);
	assert.equal(admitted.images.references[0]!.source.schemaVersion, 1);
	assert.equal(f.calls.decoded, decoded);
});

test('Light RAW Current archive import refuses an honestly repacked unrelated receipt before staging', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	// Whole pack, Original and generic receipt digests are genuine. The extra
	// generic receipt data must never reach the legacy parser during staging.
	const pack = createFramescaperImageFramePackV1({ original: f.original,
		receipt: { schemaVersion: 1, kind: 'raw-original', raw: f.raw, unrelated: 'x'.repeat(65_536) },
		width: 32, height: 32, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: f.cache }] });
	const source = normalizeFramescaperImageSourceV4({ ...f.source, contentSha256: pack.contentSha256,
		assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256 });
	const { project, manifest } = archive(f, source), decoded = f.calls.decoded;
	assert.notEqual(source.conversionReceiptSha256, f.source.conversionReceiptSha256);
	const extension = createFramescaperScapeProjectAssetExtension(PROFILE);
	assert.throws(() => extension.validateImportAssets(project, manifest), /conversion receipt.*exact native declaration/iu);
	assert.equal(f.calls.decoded, decoded);
});

test('Light RAW Current archive import refuses over-budget declared pack retention before staging', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	// 120 MiB is inside Source4's permanent pack scalar limit and the archive
	// input limit. Three retained packs plus the fixed native decode maximum
	// exceed one GiB even though the declared Original/extent are small.
	const source = normalizeFramescaperImageSourceV4({ ...f.source, assetByteLength: 120 * 1024 * 1024 });
	const { project, manifest } = archive(f, source), decoded = f.calls.decoded;
	const extension = createFramescaperScapeProjectAssetExtension(PROFILE);
	assert.throws(() => extension.validateImportAssets(project, manifest), /RAW archive pack and decode.*1 GiB/iu);
	assert.equal(f.calls.decoded, decoded);
});
