/* SPDX-License-Identifier: AGPL-3.0-only */

// Both product adapters use this core; run its refusal matrices once here.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScapeAssetDescriptor, ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import type { PlannedScapeExportAsset } from '../src/common/editor/scape-export-plan.ts';
import type { VideoCubeLutReferenceV1 } from '../src/common/editor/video-color-management-v27.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_BYTES } from '../src/common/editor/video-timing-asset.ts';
import {
	collectFramescaperDurableScapeAssetReferences,
	FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS as ASSET_KINDS,
	planFramescaperDurableScapeExportAssets,
	validateFramescaperDurableScapeAssetReferenceBytes,
	validateFramescaperDurableScapeExportAssetBody,
	validateFramescaperDurableScapeImportAssets,
	type FramescaperDurableScapeAssetProject,
	type FramescaperDurableScapeMetadataStore,
} from '../src/framescaper/editor-scape-durable-asset-plan-core.ts';
import {
	blob, coreProject as project, descriptorFor, digest, lutReference, manifest,
	MAXIMUM_LUT_BYTES, MAXIMUM_STILL_BYTES, MOTION, MOTION_BYTES, MOTION_MIME, MOTION_STACK,
	PROXY_BYTES, proxiedVideoSource, STILL_BYTES, stillSource, store, stored, TIMING, TIMING_MIME,
	LUT_TEXT, LUT, UTF8, type Json,
} from './helpers/framescaper-scape-asset-plan-fixture.ts';

const collect = (input: FramescaperDurableScapeAssetProject) =>
	collectFramescaperDurableScapeAssetReferences(input, 'finishing');
const plan = (
	input: FramescaperDurableScapeAssetProject, metadata: FramescaperDurableScapeMetadataStore, signal?: AbortSignal,
) => planFramescaperDurableScapeExportAssets(collect(input), metadata, 'finishing', signal);
const validateImport = (input: FramescaperDurableScapeAssetProject, inventory: ScapeManifest) =>
	validateFramescaperDurableScapeImportAssets(collect(input), inventory, 'finishing');
const validateBody = (asset: PlannedScapeExportAsset, bytes: Blob, signal?: AbortSignal) =>
	validateFramescaperDurableScapeExportAssetBody(asset, bytes, 'finishing', signal);
const validateBytes = (
	reference: Parameters<typeof validateFramescaperDurableScapeAssetReferenceBytes>[0], bytes: Uint8Array,
) => validateFramescaperDurableScapeAssetReferenceBytes(reference, bytes, 'finishing');

test('a project collects one durable reference per still, proxy, timing, cube LUT and motion body', () => {
	const references = collect(project({
		sources: [stillSource(), proxiedVideoSource()],
		luts: [lutReference()],
		processorStacks: [MOTION_STACK],
		motionAnalyses: [MOTION],
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
	assert.deepEqual(references.map(({ encoding }) => encoding), ['still-image-v1', 'video-proxy-v1',
		TIMING.reference.encoding, 'cube-lut-v1', 'motion-analysis-json-v1']);
	assert.deepEqual(references.map(({ mimeType }) => mimeType),
		['image/png', 'video/mp4', TIMING_MIME, 'text/plain', MOTION_MIME]);
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
	assert.equal(references[4]!.motionReference, MOTION);
	assert.equal(references[4]!.processorStack, MOTION_STACK);
	assert.ok(Object.isFrozen(references) && Object.isFrozen(references[0]));
});

test('a still whose render backs a freeze fallback is collected under the freeze-render identity', () => {
	const references = collect(project({
		sources: [stillSource()], freezeRenderedSourceIds: ['still-1'],
	}));

	assert.equal(references.length, 1);
	assert.equal(references[0]!.role, 'freeze-render');
	assert.equal(references[0]!.kind, 'framescaper-freeze-render');
	assert.equal(references[0]!.encoding, 'freeze-render-v1');
	assert.equal(references[0]!.archiveId, 'framescaper:freeze-render:still-1');
	assert.equal(references[0]!.entry, 'framescaper/finishing/freeze/still-1/body');
});

test('a still whose ID needs escaping keeps the raw ID in its archive identity but not in its entry', () => {
	const references = collect(project({ sources: [stillSource({ id: 'still.a:b' })] }));

	assert.equal(references[0]!.archiveId, 'framescaper:still:still.a:b');
	assert.equal(references[0]!.entry, 'framescaper/finishing/still/still.a_3Ab/body');
});

test('a video with no proxy attachment and a source of another kind contribute no references', () => {
	assert.deepEqual(collect(project({
		sources: [{ id: 'video-1', kind: 'video', proxyAttachment: null }, { id: 'audio-1', kind: 'audio' }],
	})), []);
});

test('a still is refused when its ID, media type, storage key or content digest is not exact', () => {
	const refuse = (overrides: Json): (() => unknown) => () => collect(project({ sources: [stillSource(overrides)] }));

	assert.throws(refuse({ id: 42 }), {
		name: 'TypeError', message: 'finishing still source ID must be a stable ID.',
	});
	assert.throws(refuse({ id: '-still-1' }), {
		name: 'TypeError', message: 'finishing still source ID must be a stable ID.',
	});
	assert.throws(refuse({ mimeType: 'application/pdf' }), {
		name: 'TypeError', message: 'finishing still still-1 has an invalid media type.',
	});
	assert.throws(refuse({ contentSha256: digest(STILL_BYTES).toUpperCase() }), {
		name: 'TypeError', message: 'finishing still digest is invalid.',
	});
	assert.throws(refuse({ storageKey: '' }), {
		name: 'TypeError', message: 'finishing still storage key must be a stable ID.',
	});
});

test('repeated cube LUT references collect one shared reference', () => {
	const references = collect(project({
		luts: [lutReference(), lutReference(), lutReference()],
	}));

	assert.equal(references.length, 1);
	assert.equal(references[0]!.role, 'lut');
	assert.equal(references[0]!.storageKey, 'cube-lut-body');
});

test('two cube LUTs that collide on digest or storage key without agreeing are refused as conflicts', () => {
	const conflicting = (second: VideoCubeLutReferenceV1): (() => unknown) => () => collect(project({
		luts: [lutReference(), second],
	}));

	assert.throws(conflicting(lutReference({ size: 3 })), {
		message: `finishing Scape asset framescaper:lut:${LUT.sha256} has a conflicting identity or role.`,
	});
	assert.throws(conflicting(lutReference({ sha256: 'ab'.repeat(32) })), {
		message: 'finishing Scape asset framescaper:lut:abababababababababababababababababababababababababababababababab'
			+ ' has a conflicting identity or role.',
	});
});

test('a cube LUT reference outside its digest or size bound is refused before it can be planned', () => {
	const refuse = (overrides: Partial<VideoCubeLutReferenceV1>): void => assert.throws(
		() => collect(project({ luts: [lutReference(overrides)] })),
		{ name: 'RangeError', message: 'finishing lut archive reference exceeds its digest or size bound.' },
	);

	refuse({ byteLength: MAXIMUM_LUT_BYTES + 1 });
	refuse({ byteLength: 0 });
	refuse({ sha256: 'not-a-digest' });
});

test('a motion analysis whose processor stack is absent from the project is refused by analysis ID', () => {
	assert.throws(
		() => collect(project({ processorStacks: [], motionAnalyses: [MOTION] })),
		{ message: 'finishing motion analysis motion-1 has no processor stack.' },
	);
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
	assert.equal(assets[0]!.kind, 'framescaper-still');
	assert.equal(assets[0]!.encoding, 'still-image-v1');
	assert.equal(Object.hasOwn(assets[0]!, 'timingReference'), false);
	assert.equal(assets[2]!.timingReference, TIMING.reference);
	assert.ok(Object.isFrozen(assets) && Object.isFrozen(assets[0]));
});

test('planning refuses a body whose stored size, byte length or digest no longer matches the project', async () => {
	const still = project({ sources: [stillSource()] });
	const proxy = project({ sources: [proxiedVideoSource()] });

	await assert.rejects(plan(still, store({ 'still-body': stored('still-body', { sha256: 'ab'.repeat(32) }) })), {
		message: 'finishing still body still-body is missing or stale.',
	});
	await assert.rejects(plan(still, store({ 'still-body': stored('still-body', { size: MAXIMUM_STILL_BYTES + 1 }) })), {
		code: 'FILE_SIZE_WARNING',
	});
	await assert.rejects(
		plan(proxy, store({ 'video-proxy-body': stored('video-proxy-body', { size: PROXY_BYTES.byteLength + 1 }) })),
		{ message: 'finishing proxy body video-proxy-body is missing or stale.' },
	);
});

test('planning requires stored metadata to be a record whose size is a positive integer', async () => {
	const still = project({ sources: [stillSource()] });

	await assert.rejects(plan(still, store({ 'still-body': null })), {
		name: 'TypeError', message: 'finishing still archive metadata is missing.',
	});
	await assert.rejects(plan(still, store({ 'still-body': stored('still-body', { size: 0 }) })), {
		name: 'RangeError', message: 'finishing still archive size must be positive.',
	});
	await assert.rejects(plan(still, store({ 'still-body': stored('still-body', { size: 12.5 }) })), {
		name: 'RangeError', message: 'finishing still archive size must be positive.',
	});
});

test('planning refuses a stored media type that contradicts the reference but accepts an absent one', async () => {
	const still = project({ sources: [stillSource()] });

	await assert.rejects(plan(still, store({ 'still-body': stored('still-body', { mimeType: 'image/jpeg' }) })), {
		message: 'finishing still body still-body has a conflicting media type.',
	});
	const assets = await plan(still, store({ 'still-body': stored('still-body', { mimeType: undefined }) }));
	assert.equal(assets[0]!.mimeType, 'image/png');
});

test('planning stops at the caller signal before the store is read and again after each read', async () => {
	const aborted = new AbortController();
	aborted.abort();
	const midFlight = new AbortController();
	const calls: string[] = [];
	const project2 = project({ sources: [stillSource(), proxiedVideoSource()] });

	await assert.rejects(plan(project2, store({}, { calls }), aborted.signal), { name: 'AbortError' });
	assert.deepEqual(calls, []);
	await assert.rejects(
		plan(project2, store({}, { calls, onCall: () => { midFlight.abort(); } }), midFlight.signal),
		{ name: 'AbortError' },
	);
	assert.deepEqual(calls, ['still-body']);
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

test('import validation refuses an inventory that drops or adds a durable finishing descriptor', () => {
	const projectValue = project({ sources: [stillSource()] });
	const [reference] = collect(projectValue);
	const extra = { ...descriptorFor(reference!), sourceId: 'framescaper:still:still-2' };

	assert.throws(() => validateImport(projectValue, manifest([])), {
		message: 'The finishing Scape archive has an incomplete durable finishing asset inventory.',
	});
	assert.throws(() => validateImport(projectValue, manifest([descriptorFor(reference!), extra])), {
		message: 'The finishing Scape archive has an incomplete durable finishing asset inventory.',
	});
});

test('import validation refuses two descriptors that claim the same archive identity', () => {
	const projectValue = project({ sources: [stillSource(), proxiedVideoSource()] });
	const references = collect(projectValue);
	const duplicated = [descriptorFor(references[0]!), descriptorFor(references[0]!), descriptorFor(references[1]!)];

	assert.throws(() => validateImport(projectValue, manifest(duplicated)), {
		message: 'The finishing Scape asset framescaper:still:still-1 is duplicated.',
	});
});

test('import validation refuses a descriptor whose kind, entry, digest or size conflicts with the project', () => {
	const projectValue = project({ sources: [stillSource()] });
	const [reference] = collect(projectValue);
	const refuse = (overrides: Partial<ScapeAssetDescriptor>): void => assert.throws(
		() => validateImport(projectValue, manifest([{ ...descriptorFor(reference!), ...overrides }])),
		{ message: 'The finishing Scape still descriptor is missing or conflicts with project authority.' },
	);

	refuse({ sourceId: 'framescaper:still:still-2' });
	refuse({ kind: 'framescaper-freeze-render' });
	refuse({ encoding: 'still-image-v2' });
	refuse({ entry: 'framescaper/finishing/still/still-2/body' });
	refuse({ mimeType: 'image/jpeg' });
	refuse({ sha256: 'ab'.repeat(32) });
	refuse({ size: 0 });
	refuse({ size: 12.5 });
	refuse({ size: Number.MAX_SAFE_INTEGER + 1 });
});

test('import validation holds a descriptor to the exact byte length a fixed-size reference declares', () => {
	const projectValue = project({ sources: [proxiedVideoSource()] });
	const references = collect(projectValue);
	const descriptors = references.map((reference) => descriptorFor(reference));

	assert.doesNotThrow(() => validateImport(projectValue, manifest(descriptors)));
	assert.throws(
		() => validateImport(projectValue, manifest([
			{ ...descriptors[0]!, size: PROXY_BYTES.byteLength - 1 }, descriptors[1]!,
		])),
		{ message: 'The finishing Scape proxy descriptor is missing or conflicts with project authority.' },
	);
});

test('export body validation refuses a body whose length or bytes changed after admission', async () => {
	const assets = await plan(project({ sources: [stillSource()] }), store());
	const asset = assets[0]!;

	await validateBody(asset, blob(STILL_BYTES));
	await assert.rejects(validateBody(asset, blob(UTF8.encode('finishing still bodx'))), {
		message: 'The finishing still archive body changed after admission.',
	});
	await assert.rejects(validateBody(asset, blob(STILL_BYTES.slice(0, 8))), {
		message: 'The finishing still archive body changed after admission.',
	});
});

test('export body validation abandons its digest when the caller signal is already aborted', async () => {
	const assets = await plan(project({ sources: [stillSource()] }), store());
	const controller = new AbortController();
	controller.abort();

	await assert.rejects(validateBody(assets[0]!, blob(STILL_BYTES), controller.signal), { name: 'AbortError' });
});

test('export body validation requires the planned asset to still carry the reference it was planned from', async () => {
	const assets = await plan(project({ sources: [stillSource()] }), store());
	const asset = assets[0]!;
	const rewritten = (overrides: Json): PlannedScapeExportAsset =>
		({ ...asset, ...overrides } as unknown as PlannedScapeExportAsset);

	await assert.rejects(validateBody(rewritten({ source: 'still-1' }), blob(STILL_BYTES)), {
		name: 'TypeError', message: 'finishing planned archive source is missing.',
	});
	await assert.rejects(validateBody(rewritten({ source: { name: asset.source.name } }), blob(STILL_BYTES)), {
		name: 'TypeError', message: 'The finishing planned archive asset lost its exact reference.',
	});
	await assert.rejects(validateBody(rewritten({ source: { archiveReference: [] } }), blob(STILL_BYTES)), {
		name: 'TypeError', message: 'The finishing planned archive asset lost its exact reference.',
	});
	for (const drift of [{ sourceId: 'other' }, { kind: 'framescaper-cube-lut' }, { storageKey: 'other' },
		{ expectedSha256: 'ab'.repeat(32) }]) {
		await assert.rejects(validateBody(rewritten(drift), blob(STILL_BYTES)), {
			message: 'The finishing planned archive asset drifted from its reference.',
		});
	}
});

test('export body validation re-parses a cube LUT body and refuses geometry the project disowns', async () => {
	const admitted = await plan(project({ luts: [lutReference()] }), store());
	const drifted = await plan(
		project({ luts: [lutReference({ size: 3 })] }), store(),
	);

	await validateBody(admitted[0]!, blob(UTF8.encode(LUT_TEXT)));
	await assert.rejects(validateBody(drifted[0]!, blob(UTF8.encode(LUT_TEXT))), {
		message: 'The finishing cube LUT archive body conflicts with its project reference.',
	});
});

test('export body validation re-checks a motion body against the processor stack the project holds', async () => {
	const owned = project({ processorStacks: [MOTION_STACK], motionAnalyses: [MOTION] });
	const rebound = project({
		processorStacks: [{ ...MOTION_STACK, sourceId: 'video-2' }],
		motionAnalyses: [{ ...MOTION, sourceId: 'video-2' }],
	});
	const admitted = await plan(owned, store());
	const stale = await plan(rebound, store());

	await validateBody(admitted[0]!, blob(MOTION_BYTES));
	await assert.rejects(validateBody(stale[0]!, blob(MOTION_BYTES)), {
		name: 'RangeError', message: 'The motion analysis is stale because its settings digest changed.',
	});
});

test('reference byte validation refuses cube LUT text that is not decodable or does not parse', () => {
	const [reference] = collect(project({ luts: [lutReference()] }));

	assert.doesNotThrow(() => validateBytes(reference!, UTF8.encode(LUT_TEXT)));
	assert.throws(() => validateBytes(reference!, Uint8Array.of(0xff, 0xfe)), { name: 'TypeError' });
	assert.throws(() => validateBytes(reference!, UTF8.encode(LUT_TEXT.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 3'))), {
		name: 'RangeError',
	});
	assert.throws(() => validateBytes(reference!, UTF8.encode(LUT_TEXT.replace('Fixture', 'Fixturx'))), {
		message: 'The finishing cube LUT archive body conflicts with its project reference.',
	});
});

test('reference byte validation refuses motion bytes whose digest or body identity moved', () => {
	const [reference] = collect(project({
		processorStacks: [MOTION_STACK], motionAnalyses: [MOTION],
	}));

	assert.doesNotThrow(() => validateBytes(reference!, MOTION_BYTES));
	assert.throws(() => validateBytes(reference!, UTF8.encode(`${new TextDecoder().decode(MOTION_BYTES)} `)), {
		name: 'RangeError', message: 'The motion analysis body digest or byte length changed.',
	});
});

test('reference byte validation ignores the roles whose bodies carry no parsed authority', () => {
	const references = collect(project({
		sources: [stillSource(), proxiedVideoSource()], freezeRenderedSourceIds: ['still-1'],
	}));

	assert.deepEqual(references.map(({ role }) => role), ['freeze-render', 'proxy', 'proxy-timing']);
	for (const reference of references) {
		assert.doesNotThrow(() => validateBytes(reference, Uint8Array.of(0xff)));
	}
});
