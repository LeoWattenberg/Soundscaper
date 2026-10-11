/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { imageDevelopHandoffRecipeSha256V1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { inspectPhotoFramescaperHandoffSourcesV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-inspect-v1.ts';
import { withPhotoFramescaperHandoffReadV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-read-v1.ts';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
async function fixture() {
	const base = photoArchiveFixture(1, PNG), photo = base.photo;
	const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	let identity = 0;
	const result = await exportPhotoFramescaperHandoffArchiveV1({ binding, capture: { async withCapture(_binding, consume, options) {
		return await consume(Object.freeze({ schemaVersion: 1, signal: options?.signal ?? new AbortController().signal,
			factsJson: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding)), originalBlob: base.original,
			original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: PNG.length,
				mimeType: 'image/png', width: 1, height: 1, hasAlpha: false }, lutReferences: [], withLutBytes: async () => { throw new Error('No LUT.'); } }));
	} } }, { createId: () => `choice-${String(++identity)}`, now: () => '2026-10-10T00:00:00.000Z',
		openImage: async () => ({ metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'choice-fixture' },
			decodeFrame: async () => ({ rgba: Uint8Array.of(23, 71, 149, 255), durationMicroseconds: null }), close() {} }) });
	return { archive: result.blob, sourceId: 'choice-2', photo };
}

async function editProject(archive: Blob, edit: (project: Record<string, unknown>, files: Map<string, Uint8Array>) => void) {
	return rewriteLutArchiveFixture(archive, files => {
		const project = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as Record<string, unknown>;
		edit(project, files);
		const bytes = new TextEncoder().encode(JSON.stringify(project)); files.set('project.json', bytes);
		const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as { project: { size: number; sha256: string; schemaVersion: number } };
		manifest.project.size = bytes.length; manifest.project.sha256 = createHash('sha256').update(bytes).digest('hex');
		manifest.project.schemaVersion = project.schemaVersion as number; files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	});
}

test('Light archive source inspection lists authenticated scalar choices without body or publication authority', async () => {
	const f = await fixture(), before = new Uint8Array(await f.archive.arrayBuffer());
	const choices = await inspectPhotoFramescaperHandoffSourcesV1({ archive: f.archive });
	assert.equal(choices.schemaVersion, 1); assert.equal(choices.projectId, 'choice-1'); assert.equal(choices.projectRevision, 1);
	assert.equal(typeof choices.title, 'string'); assert.equal(choices.unsupportedImageCount, 0);
	assert.deepEqual(choices.sources, [{ sourceId: f.sourceId, name: f.photo.versions[0]!.name, originalName: f.photo.original.name,
		processVersion: 1, width: 1, height: 1, versionKind: 'master' }]);
	assert.ok(Object.isFrozen(choices)); assert.ok(Object.isFrozen(choices.sources)); assert.ok(Object.isFrozen(choices.sources[0]));
	assert.equal(Object.hasOwn(choices, 'originalBlob'), false); assert.equal(Object.hasOwn(choices.sources[0]!, 'develop'), false);
	assert.deepEqual(new Uint8Array(await f.archive.arrayBuffer()), before);
});

test('Light source choices do not grant body authenticity; selected receive still rejects a corrupt pack', async () => {
	const f = await fixture(), archive = await rewriteLutArchiveFixture(f.archive, files => {
		const key = [...files.keys()].find(name => name.includes('/image/'))!; const bytes = files.get(key)!;
		bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
	});
	assert.equal((await inspectPhotoFramescaperHandoffSourcesV1({ archive })).sources[0]!.sourceId, f.sourceId);
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId }, () => undefined), /SHA|digest|verification/iu);
});

test('Light source inspection authenticates project digest and declared inventory before listing', async () => {
	const f = await fixture();
	const digest = await rewriteLutArchiveFixture(f.archive, files => {
		const text = new TextDecoder().decode(files.get('project.json')); assert.ok(text.includes('"choice-1"'));
		files.set('project.json', new TextEncoder().encode(text.replace('"choice-1"', '"choice-X"')));
	});
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: digest }), /SHA|digest|verification/iu);
	const inventory = await rewriteLutArchiveFixture(f.archive, files => {
		const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as { assets: unknown[] }; manifest.assets = [];
		files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	});
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: inventory }), /inventory|manifest|undeclared|Unreferenced/iu);
});

test('Light source inspection offers ordinary Source1 with actual image clip context and only stored original spelling', async () => {
	const f = await fixture(); let clipId = '', sequenceId = '', sequenceName = '';
	const archive = await editProject(f.archive, project => {
		const source = (project.sources as Record<string, unknown>[])[0]!;
		source.schemaVersion = 1; delete source.develop; delete source.developed; delete source.provenance;
		const clip = (project.clips as Record<string, unknown>[])[0]!, sequence = (project.sequences as Record<string, unknown>[])[0]!;
		clipId = clip.id as string; sequenceId = sequence.id as string; sequenceName = sequence.name as string;
	});
	const result = await inspectPhotoFramescaperHandoffSourcesV1({ archive });
	assert.deepEqual(result.sources, [{ sourceId: f.sourceId, name: f.photo.versions[0]!.name, originalName: f.photo.original.name.normalize('NFC'),
		processVersion: 1, width: 1, height: 1, imageClips: [{ clipId, sequenceId, sequenceName, scope: 'timeline' }] }]);
	assert.equal(result.unsupportedImageCount, 0);
});

test('Light ordinary source inspection distinguishes actual timeline and bin choices without picking a placement', async () => {
	const f = await fixture(); let firstClip = '', sequenceId = '', sequenceName = '';
	const archive = await editProject(f.archive, project => {
		const source = (project.sources as Record<string, unknown>[])[0]!, clip = (project.clips as Record<string, unknown>[])[0]!;
		source.schemaVersion = 1; delete source.develop; delete source.developed; delete source.provenance;
		const sequence = (project.sequences as Record<string, unknown>[])[0]!;
		firstClip = clip.id as string; sequenceId = clip.sequenceId as string; sequenceName = sequence.name as string;
		(project.projectBin as { clips: unknown[] }).clips.push({ ...clip, id: 'real-bin-clip', sourceStartTicks: '1000000' });
	});
	const choices = await inspectPhotoFramescaperHandoffSourcesV1({ archive });
	assert.deepEqual(choices.sources[0]!.imageClips, [{ clipId: firstClip, sequenceId, sequenceName, scope: 'timeline' },
		{ clipId: 'real-bin-clip', sequenceId, sequenceName, scope: 'bin' }]);
	assert.ok(Object.isFrozen(choices.sources[0]!.imageClips)); assert.ok(choices.sources[0]!.imageClips!.every(Object.isFrozen));
	assert.equal(Object.hasOwn(choices, 'selectedClipId'), false);
});

test('Light ordinary source inspection leaves source-only images unavailable and admits genuine bin-only clips', async () => {
	const f = await fixture();
	for (const bin of [false, true]) {
		const archive = await editProject(f.archive, project => {
			const source = (project.sources as Record<string, unknown>[])[0]!;
			source.schemaVersion = 1; delete source.develop; delete source.developed; delete source.provenance;
			if (bin) (project.projectBin as { clips: unknown[] }).clips.push(...project.clips as unknown[]);
			project.clips = []; for (const track of project.tracks as { clipIds: string[] }[]) track.clipIds = [];
		});
		const result = await inspectPhotoFramescaperHandoffSourcesV1({ archive });
		if (bin) { assert.equal(result.unsupportedImageCount, 0); assert.equal(result.sources[0]!.imageClips![0]!.scope, 'bin'); }
		else { assert.deepEqual(result.sources, []); assert.equal(result.unsupportedImageCount, 1); }
	}
});

test('Light ordinary source inspection counts unsupported static declarations and rejects invalid real clip ownership', async () => {
	const f = await fixture();
	for (const invalid of ['animation', 'format', 'sequence', 'source'] as const) {
		const archive = await editProject(f.archive, project => {
			const source = (project.sources as Record<string, unknown>[])[0]!;
			source.schemaVersion = 1; delete source.develop; delete source.developed; delete source.provenance;
			if (invalid === 'animation') (source.canonical as Record<string, unknown>).frameCount = 2;
			else if (invalid === 'format') (source.original as Record<string, unknown>).recognizedFormat = 'tiff';
			else (project.clips as Record<string, unknown>[])[0]![invalid === 'sequence' ? 'sequenceId' : 'sourceId'] = 'missing';
		});
		if (invalid === 'sequence' || invalid === 'source') await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive }));
		else { const result = await inspectPhotoFramescaperHandoffSourcesV1({ archive }); assert.deepEqual(result.sources, []); assert.equal(result.unsupportedImageCount, 1); }
	}
});

test('Light source inspection retains two distinct choices in project order without selecting either', async () => {
	const f = await fixture(), archive = await editProject(f.archive, (project, files) => {
		const sources = project.sources as Record<string, unknown>[], first = sources[0]!;
		sources.push({ ...structuredClone(first), id: 'second-image', storageKey: 'second-image', name: 'Second saved recipe' });
		const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as { assets: Array<{ kind: string; sourceId: string; entry: string }> };
		const pack = manifest.assets.find(row => row.kind === 'framescaper-image-asset')!;
		const entry = 'framescaper/timelineImage/image/second-image/body'; files.set(entry, files.get(pack.entry)!.slice());
		manifest.assets.push({ ...pack, sourceId: 'framescaper:image:second-image', entry });
		files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
	});
	const result = await inspectPhotoFramescaperHandoffSourcesV1({ archive });
	assert.deepEqual(result.sources.map(source => [source.sourceId, source.name]), [[f.sourceId, f.photo.versions[0]!.name], ['second-image', 'Second saved recipe']]);
	assert.equal(Object.hasOwn(result, 'selectedSourceId'), false); assert.equal(result.unsupportedImageCount, 0);
});

test('Light source inspection reports mask-bound geometry as unavailable without discarding its recipe', async () => {
	const f = await fixture(), archive = await editProject(f.archive, project => {
		const source = normalizeFramescaperImageSourceV2((project.sources as unknown[])[0]);
		const develop = { ...source.develop, effects: [{ id: 'masked-crop', type: 'develop-geometry-v1', enabled: true, params: {} }],
			masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'rectangle',
				nodes: [{ id: 'rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }] }],
			maskBindings: [{ effectId: 'masked-crop', maskId: 'mask' }] };
		project.sources = [normalizeFramescaperImageSourceV2({ ...source, develop,
			provenance: { ...source.provenance, developSha256: imageDevelopHandoffRecipeSha256V1(develop) } })];
	});
	const result = await inspectPhotoFramescaperHandoffSourcesV1({ archive });
	assert.deepEqual(result.sources, []); assert.equal(result.unsupportedImageCount, 1);
	await assert.rejects(withPhotoFramescaperHandoffReadV1({ archive, sourceId: f.sourceId }, () => undefined), /geometry/iu);
});

test('Light source inspection refuses future project and future source schemas', async () => {
	const f = await fixture();
	for (const target of ['project', 'source'] as const) {
		const archive = await editProject(f.archive, project => {
			if (target === 'project') project.schemaVersion = 999;
			else (project.sources as Record<string, unknown>[])[0]!.schemaVersion = 3;
		});
		await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive }));
	}
});

test('Light source inspection pins genuine immutable Blob and private signal before yielding', async () => {
	const f = await fixture(), stop = new AbortController(); let shadows = 0;
	const request = { archive: f.archive, signal: stop.signal }, result = inspectPhotoFramescaperHandoffSourcesV1(request);
	request.archive = new Blob();
	Object.defineProperty(f.archive, 'size', { get() { shadows++; throw Symbol('late Blob shadow'); } });
	Object.defineProperty(stop.signal, 'aborted', { get() { shadows++; throw Symbol('late signal shadow'); } });
	assert.equal((await result).sources[0]!.sourceId, f.sourceId); assert.equal(shadows, 0);
});

test('Light source inspection rejects request getters, inherited fields, forged Blob and foreign signals before I/O', async () => {
	const f = await fixture(); let getters = 0;
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1(Object.defineProperty({ archive: f.archive }, 'archive', { get() { getters++; return f.archive; } })));
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1(Object.create({ archive: f.archive }) as { archive: Blob }));
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: Object.create(Blob.prototype) as Blob }));
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: f.archive, signal: { aborted: false } as AbortSignal }));
	assert.equal(getters, 0);
});

test('Light source inspection preserves an opaque native cancellation reason and enforces fixed input limits', async () => {
	const f = await fixture(), stop = new AbortController(), reason = Symbol('inspection cancellation'); stop.abort(reason);
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: f.archive, signal: stop.signal }), error => error === reason);
	let oversized = new Blob([Uint8Array.of(0)]);
	for (let index = 0; index < 28; index++) oversized = new Blob([oversized, oversized]);
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: new Blob([oversized, Uint8Array.of(0)]) }), /bound/iu);
	await assert.rejects(inspectPhotoFramescaperHandoffSourcesV1({ archive: new Blob() }), /bound/iu);
});
