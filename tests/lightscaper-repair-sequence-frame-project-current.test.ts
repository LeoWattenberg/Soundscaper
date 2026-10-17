/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPhotoFramescaperCollectionHandoffProjectV1, type PhotoFramescaperCollectionHandoffProjectIdentityV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-project-v1.ts';
import { createPhotoFramescaperCollectionHandoffProjectCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-project-current-v1.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { normalizeFramescaperImageSourceV3 } from '../src/common/editor/timeline-image-model-v3.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { cloneFramescaperProject, validateFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { editableImageFixture, PROFILE } from './helpers/framescaper-editable-image-current-fixture.ts';

const IDENTITY: PhotoFramescaperCollectionHandoffProjectIdentityV1 = Object.freeze({ projectId: 'sequence-project', sequenceId: 'sequence', trackId: 'images',
	clipIds: Object.freeze(['clip-repaired', 'clip-painted', 'clip-legacy']), name: 'Current ordered photos', now: '2026-10-13T00:00:00.000Z' });
async function currentProject(sources: unknown, identity: PhotoFramescaperCollectionHandoffProjectIdentityV1 = IDENTITY): Promise<FramescaperProject> {
	return createPhotoFramescaperCollectionHandoffProjectCurrentV1(sources, identity);
}

function sources() {
	const base = editableImageFixture({ crop: false, sourceId: 'source-repaired' }).source;
	const repaired = replaceImageDevelopRepairSpotsV1(base.develop, { schemaVersion: 1, spots: [{ id: 'retained-repair', mode: 'clone', enabled: true,
		target: { x: .75, y: .25 }, source: { x: .25, y: .25 }, radius: .2, feather: 0, opacity: 1 }] });
	// Independent SCMASK01 one-cell declaration. The pure project owner grants
	// no body authenticity; native archive tests separately verify its bytes.
	const bytes = Uint8Array.of(83, 67, 77, 65, 83, 75, 48, 49, 1, 0, 0, 0, 1, 0, 0, 0, 64);
	const digest = createHash('sha256').update(bytes).digest('hex');
	const painted = normalizeImageDevelopStateCurrentV1({ ...base.develop, masks: [{ schemaVersion: 2, name: 'Unused original paint', id: 'paint', kind: 'matte',
		inputs: [{ name: 'original-alpha', kind: 'alpha', sourceRef: `brush-mask-v1:1:1:${digest}` }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'original-alpha' }], outputNodeId: 'alpha' }], maskBindings: [] });
	function successor(develop: unknown, sourceId: string, photoSchema: 2 | 3) {
		const current = normalizeImageDevelopStateCurrentV1(develop), origin = base.provenance.origin;
		assert.equal(origin.schemaFamily, 'lightscaper'); if (origin.schemaFamily !== 'lightscaper') assert.fail('The fixture requires actual Light origin facts.');
		return normalizeFramescaperImageSourceV3({ ...base, id: sourceId, storageKey: sourceId, schemaVersion: 3, develop: current,
			provenance: createImageDevelopHandoffProvenanceV2({ original: base.provenance.original, develop: current,
				origin: { ...origin, schemaVersion: photoSchema, photoId: sourceId } }) });
	}
	return [successor(repaired, 'source-repaired', 3), successor(painted, 'source-painted', 2),
		normalizeFramescaperImageSourceV2({ ...base, id: 'source-legacy', storageKey: 'source-legacy' })] as const;
}

test('Light Current sequence preserves mixed Source3 repairs, truthful Photo2 paint and Source2 in query order', async () => {
	const input = sources(), before = structuredClone(input), project = await currentProject(input);
	assert.equal(project.schemaVersion, 1); assert.equal(validateFramescaperProject(PROFILE, project), true);
	assert.deepEqual(cloneFramescaperProject(PROFILE, project), project); assert.deepEqual(project.sources, before); assert.deepEqual(input, before);
	assert.deepEqual(project.sources.map(source => source.schemaVersion), [3, 3, 2]);
	assert.deepEqual(project.sources.map(source => source.kind === 'image' ? source.develop.processVersion : null), [3, 2, 2]);
	assert.equal(input[0].original.sha256, input[1].original.sha256); assert.equal(input[1].original.sha256, input[2].original.sha256);
	assert.deepEqual(project.tracks[0]!.clipIds, IDENTITY.clipIds);
	assert.deepEqual(project.clips.map(clip => clip.kind === 'image' ? [clip.sourceId, clip.sequenceStartFrame, clip.sequenceFrameCount] : null),
		[['source-repaired', 0, 30], ['source-painted', 30, 30], ['source-legacy', 60, 30]]);
	assert.equal(project.primarySequenceId, IDENTITY.sequenceId); assert.deepEqual(project.projectBin.clips, []);
});

test('Light Current sequence keeps retained Photo3 provenance when selected recipe is legacy and repairs are absent', async () => {
	const input = sources(), original = input[0], develop = normalizeImageDevelopStateCurrentV1({ ...input[2].develop, processVersion: 1 });
	const origin = original.provenance.origin; assert.equal(origin.schemaFamily, 'lightscaper');
	if (origin.schemaFamily !== 'lightscaper') assert.fail('Light origin is required.');
	const legacySelected = normalizeFramescaperImageSourceV3({ ...original, develop,
		provenance: createImageDevelopHandoffProvenanceV2({ original: original.provenance.original, develop, origin }) });
	const project = await currentProject([legacySelected], { ...IDENTITY, clipIds: ['only'] });
	assert.deepEqual(project.sources, [legacySelected]); assert.equal(legacySelected.develop.processVersion, 1);
	assert.equal(legacySelected.provenance.origin.schemaVersion, 3);
});

test('Light Current sequence retains exact fractional duration ceiling and identity failures before assembly', async () => {
	const input = sources().map((source, index) => {
		const durationTicks = ['50000', '1000000', '1'][index]!;
		return source.schemaVersion === 3 ? normalizeFramescaperImageSourceV3({ ...source, canonical: { ...source.canonical, durationTicks } })
			: normalizeFramescaperImageSourceV2({ ...source, canonical: { ...source.canonical, durationTicks } });
	});
	const project = await currentProject(input);
	assert.deepEqual(project.clips.map(clip => clip.kind === 'image' ? [clip.sequenceStartFrame, clip.sequenceFrameCount] : null), [[0, 2], [2, 30], [32, 1]]);
	await assert.rejects(currentProject(input, { ...IDENTITY, clipIds: ['same', 'same', 'last'] }), /distinct|collision/iu);
	await assert.rejects(currentProject(input, { ...IDENTITY, projectId: input[0]!.id }), /distinct|collision/iu);
});

test('Light Current sequence true image-source commands and undo redo retain full repairs and declared resources', async () => {
	const input = sources(), project = await currentProject(input), expected = project.sources[0]!, replacement = { ...input[0], name: 'A real sequence edit' };
	const command = { type: 'image-source/set' as const, sourceId: expected.id, expectedSource: expected, source: replacement };
	const history = executeFramescaperProjectCommand(PROFILE, createFramescaperProjectHistory(PROFILE, project), command);
	assert.equal(history.present.sources[0]!.name, replacement.name);
	assert.deepEqual(undoFramescaperProjectCommand(PROFILE, history).present.sources, project.sources);
	const redone = redoFramescaperProjectCommand(PROFILE, undoFramescaperProjectCommand(PROFILE, history)).present;
	assert.equal(redone.revision, history.present.revision + 2);
	assert.ok(Number.isFinite(Date.parse(redone.updatedAt)) && Date.parse(redone.updatedAt) >= Date.parse(history.present.updatedAt));
	assert.deepEqual({ ...redone, revision: history.present.revision, updatedAt: history.present.updatedAt }, history.present);
	assert.deepEqual(history.present.sources.slice(1), input.slice(1)); assert.deepEqual(project.sources, input);
});

test('Light Current sequence rejects closed hostile inputs and future source authority without getters', async () => {
	const input = sources(); let getters = 0;
	const hostile = [...input]; Object.defineProperty(hostile, '0', { enumerable: true, get() { getters++; return input[0]; } });
	await assert.rejects(currentProject(hostile));
	await assert.rejects(currentProject(input, Object.defineProperty({ ...IDENTITY }, 'name', { enumerable: true, get() { getters++; return 'bad'; } })));
	await assert.rejects(currentProject([{ ...input[0], schemaVersion: 4 }], { ...IDENTITY, clipIds: ['only'] }));
	await assert.rejects(currentProject([{ ...input[0], canonical: { ...input[0].canonical, frameCount: 2 } }], { ...IDENTITY, clipIds: ['only'] }));
	assert.equal(getters, 0);
});

test('Light permanent collection ProjectV1 remains strict Source2 and unchanged for genuine legacy inputs', async () => {
	const input = sources(), legacy = [input[2]], identity = { ...IDENTITY, clipIds: ['legacy-clip'] };
	const old = createPhotoFramescaperCollectionHandoffProjectV1(legacy, identity);
	assert.deepEqual(await currentProject(legacy, identity), old);
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([input[0]], identity), /version|unsupported|source/iu);
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([input[1]], identity), /version|unsupported|source/iu);
});
