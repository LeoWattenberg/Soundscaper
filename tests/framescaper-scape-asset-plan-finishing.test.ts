/* SPDX-License-Identifier: AGPL-3.0-only */

// Core refusal matrices live in framescaper-scape-durable-asset-plan-core.test.ts.
// These cases cover the product adapter's collection shape, forwarding and labels.
import assert from 'node:assert/strict';
import test from 'node:test';

import { VIDEO_TIMING_ASSET_MAXIMUM_BYTES } from '../src/common/editor/video-timing-asset.ts';
import {
	collectFramescaperScapeAssetReferencesFinishing as collect,
	FRAMESCAPER_SCAPE_ASSET_KINDS_FINISHING as ASSET_KINDS,
	planFramescaperScapeExportAssetsFinishing as plan,
	validateFramescaperScapeAssetReferenceBytesFinishing as validateBytes,
	validateFramescaperScapeExportAssetBodyFinishing as validateBody,
	validateFramescaperScapeImportAssetsFinishing as validateImport,
} from '../src/framescaper/editor-scape-asset-plan-finishing.ts';
import {
	blob, descriptorFor, digest, finishingProject as project, lutReference, manifest,
	MAXIMUM_LUT_BYTES, MOTION, MOTION_BYTES, MOTION_STACK, presentation, preset, PROXY_BYTES,
	proxiedVideoSource, STILL_BYTES, stillSource, store, stored, TIMING, TIMING_MIME, LUT, LUT_TEXT, UTF8,
} from './helpers/framescaper-scape-asset-plan-fixture.ts';

test('a project collects one durable reference per still, proxy, timing, cube LUT and motion body', () => {
	const references = collect(project({
		sources: [stillSource(), proxiedVideoSource()],
		videoVisualPresentations: [presentation(lutReference())],
		videoProcessorStacks: [MOTION_STACK],
		videoMotionAnalyses: [MOTION],
	}));

	assert.deepEqual(references.map(({ role }) => role), ['still', 'proxy', 'proxy-timing', 'lut', 'motion']);
	assert.deepEqual(references.map(({ kind }) => kind),
		ASSET_KINDS.filter((kind) => kind !== 'framescaper-freeze-render'));
	assert.deepEqual(references.map(({ entry }) => entry), [
		'framescaper/finishing/still/still-1/body',
		`framescaper/finishing/proxy/${digest(PROXY_BYTES)}/body`,
		`framescaper/finishing/proxy-timing/${TIMING.reference.sha256}.scti`,
		`framescaper/finishing/lut/${LUT.sha256}.cube`,
		`framescaper/finishing/motion/${MOTION.sha256}.json`,
	]);
	assert.deepEqual(references.map(({ maximumBytes }) => maximumBytes), [
		Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
		MAXIMUM_LUT_BYTES, 1024 * 1024 * 1024,
	]);
	assert.deepEqual(references.map(({ byteLength }) => byteLength), [
		null, PROXY_BYTES.byteLength, TIMING.bytes.byteLength, LUT.byteLength, MOTION_BYTES.byteLength,
	]);
	assert.deepEqual(references.map(({ sourceId }) => sourceId), ['still-1', null, null, null, 'video-1']);
	assert.equal(references[0]!.archiveId, 'framescaper:still:still-1');
	assert.equal(references[2]!.timingReference, TIMING.reference);
	assert.deepEqual(references[3]!.lutReference, lutReference());
	assert.equal(references[4]!.processorStack, MOTION_STACK);
	assert.ok(Object.isFrozen(references) && Object.isFrozen(references[0]));
});

test('a still whose render backs a freeze fallback is collected under the freeze-render identity', () => {
	const references = collect(project({
		sources: [stillSource()], videoFreezeFallbacks: [{ renderedSourceId: 'still-1' }],
	}));

	assert.equal(references.length, 1);
	assert.equal(references[0]!.role, 'freeze-render');
	assert.equal(references[0]!.kind, 'framescaper-freeze-render');
	assert.equal(references[0]!.encoding, 'freeze-render-v1');
	assert.equal(references[0]!.archiveId, 'framescaper:freeze-render:still-1');
	assert.equal(references[0]!.entry, 'framescaper/finishing/freeze/still-1/body');
});

test('two presentations and a preset grading through the same cube LUT collect one shared reference', () => {
	const references = collect(project({
		videoVisualPresentations: [presentation(lutReference()), presentation(lutReference()), presentation(null)],
		videoFinishingPresets: [preset(lutReference()), preset(null)],
	}));

	assert.equal(references.length, 1);
	assert.equal(references[0]!.role, 'lut');
	assert.equal(references[0]!.storageKey, 'cube-lut-body');
});

test('planning admits every collected reference and carries timing authority only for timing bodies', async () => {
	const assets = await plan(project({ sources: [stillSource(), proxiedVideoSource()] }), store());

	assert.deepEqual(assets.map(({ sourceId }) => sourceId), [
		'framescaper:still:still-1',
		`framescaper:proxy:${digest(PROXY_BYTES)}`,
		`framescaper:proxy-timing:${TIMING.reference.sha256}`,
	]);
	assert.deepEqual(assets.map(({ storageKey }) => storageKey), [
		'still-body', 'video-proxy-body', TIMING.reference.storageKey,
	]);
	assert.deepEqual(assets.map(({ size }) => size), [
		STILL_BYTES.byteLength, PROXY_BYTES.byteLength, TIMING.bytes.byteLength,
	]);
	assert.deepEqual(assets.map(({ mimeType }) => mimeType), ['image/png', 'video/mp4', TIMING_MIME]);
	assert.deepEqual(assets.map(({ source }) => source.name), [
		'still:framescaper:still:still-1',
		`proxy:framescaper:proxy:${digest(PROXY_BYTES)}`,
		`proxy-timing:framescaper:proxy-timing:${TIMING.reference.sha256}`,
	]);
	assert.equal(assets[0]!.expectedSha256, digest(STILL_BYTES));
	assert.equal(assets[0]!.encoding, 'still-image-v1');
	assert.equal(Object.hasOwn(assets[0]!, 'timingReference'), false);
	assert.equal(assets[2]!.timingReference, TIMING.reference);
	assert.ok(Object.isFrozen(assets) && Object.isFrozen(assets[0]));
});

test('import validation admits descriptors that match project authority and ignores other products', () => {
	const projectValue = project({ sources: [stillSource(), proxiedVideoSource()] });
	const references = collect(projectValue);
	const descriptors = references.map((reference) => descriptorFor(reference));
	const foreign = { ...descriptors[0]!, kind: 'soundscaper-audio-source', sourceId: 'audio-1' };

	const validated = validateImport(projectValue, manifest([...descriptors, foreign]));

	assert.deepEqual(validated.references, references);
	assert.deepEqual([...validated.descriptorByArchiveId.keys()], references.map(({ archiveId }) => archiveId));
	assert.equal(validated.descriptorByArchiveId.get('framescaper:still:still-1')?.entry, references[0]!.entry);
	assert.ok(Object.isFrozen(validated));
});

test('the finishing adapter forwards body and reference-byte validation', async () => {
	const value = project({
		sources: [stillSource()], videoVisualPresentations: [presentation(lutReference())],
		videoProcessorStacks: [MOTION_STACK], videoMotionAnalyses: [MOTION],
	});
	const assets = await plan(value, store());
	const references = collect(value);
	const bytes = [STILL_BYTES, UTF8.encode(LUT_TEXT), MOTION_BYTES];
	for (const [index, asset] of assets.entries()) {
		await validateBody(asset, blob(bytes[index]!));
		assert.doesNotThrow(() => validateBytes(references[index]!, bytes[index]!));
	}
});

test('the finishing adapter forwards cancellation before and during metadata reads and body validation', async () => {
	const value = project({ sources: [stillSource(), proxiedVideoSource()] });
	const aborted = new AbortController();
	aborted.abort();
	const calls: string[] = [];
	await assert.rejects(plan(value, store({}, { calls }), aborted.signal), { name: 'AbortError' });
	assert.deepEqual(calls, []);
	const midFlight = new AbortController();
	await assert.rejects(plan(value, store({}, {
		calls, onCall: () => { midFlight.abort(); },
	}), midFlight.signal), { name: 'AbortError' });
	assert.deepEqual(calls, ['still-body']);
	const [asset] = await plan(value, store());
	await assert.rejects(validateBody(asset!, blob(STILL_BYTES), aborted.signal), { name: 'AbortError' });
});

test('the finishing adapter retains its own error labels at every core entry point', async () => {
	assert.throws(() => collect(project({ sources: [stillSource({ id: 42 })] })), {
		name: 'TypeError', message: 'finishing still source ID must be a stable ID.',
	});
	const value = project({ sources: [stillSource()] });
	await assert.rejects(plan(value, store({ 'still-body': stored('still-body', { sha256: 'ab'.repeat(32) }) })), {
		message: 'finishing still body still-body is missing or stale.',
	});
	assert.throws(() => validateImport(value, manifest([])), {
		message: 'The finishing Scape archive has an incomplete durable finishing asset inventory.',
	});
	const [asset] = await plan(value, store());
	await assert.rejects(validateBody(asset!, blob(new Uint8Array(STILL_BYTES.byteLength))), {
		message: 'The finishing still archive body changed after admission.',
	});
	const [lut] = collect(project({ videoVisualPresentations: [presentation(lutReference())] }));
	assert.throws(() => validateBytes(lut!, UTF8.encode(LUT_TEXT.replace('Fixture', 'Fixturx'))), {
		message: 'The finishing cube LUT archive body conflicts with its project reference.',
	});
});
