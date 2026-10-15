/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { developPropertiesFixtureCurrentV1, generatedDevelopSpecCurrentV1, generatedDevelopCurrentV1,
	GENERATED_CURRENT_TIME } from './helpers/lightscaper-develop-properties-current-fixture.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopSelectionV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import type { ImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { parsePhotoDevelopWorkspaceCurrentV1, serializePhotoDevelopWorkspaceCurrentV1 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';

const runs = { endOnFailure: true, numRuns: 10 };
type Fixture = Awaited<ReturnType<typeof developPropertiesFixtureCurrentV1>>;
function active(photo: PhotoDocumentCurrentV1) { const version = photo.versions.find(value => value.id === photo.activeVersionId); assert.ok(version); return version; }
async function photo(f: Fixture, index = 0) { return (await f.inspect())[index]!.photo; }
function repairs(value: Readonly<ImageDevelopStateThroughV4>) { return value.processVersion === 3 || value.processVersion === 4 ? value.repairs : { schemaVersion: 1, spots: [] }; }

test('seeded Current3 native history branches, named snapshots and reopening preserve immutable recipe records and complete resources', async () => {
	await fc.assert(fc.asyncProperty(fc.array(generatedDevelopSpecCurrentV1, { minLength: 2, maxLength: 4 }), generatedDevelopSpecCurrentV1, fc.nat(),
		async (edits, branchSpec, offset) => {
			const f = await developPropertiesFixtureCurrentV1(2);
			try {
				const custody = await f.inspectCustody(), initial = await photo(f), initialEntries = active(initial).workspace!.entries;
				const authored = edits.map((spec, index) => generatedDevelopCurrentV1({ ...spec, name: `${spec.name} ${String(index)}` }, f.resourcesForRecipe));
				for (const develop of authored) {
					const before = await photo(f), serialized = JSON.stringify(before); await f.record(develop);
					assert.equal(JSON.stringify(before), serialized); assert.deepEqual((await f.read()).develop, develop);
				}
				const expected = [...initialEntries.map(entry => entry.develop), ...authored], captured = authored.at(-1)!;
				let state = await f.read(); assert.deepEqual(active(await photo(f)).workspace!.entries.map(entry => entry.develop), expected);
				await f.apply({ type: 'save-develop-snapshot', versionId: state.versionId, id: 'generated-snapshot', name: branchSpec.name, createdAt: GENERATED_CURRENT_TIME });
				const beforeSelection = active(await photo(f)).workspace!, cursor = offset % expected.length;
				await f.apply({ type: 'select-develop-history', versionId: state.versionId, cursor });
				const selected = active(await photo(f)); assert.deepEqual(selected.develop, expected[cursor]); assert.deepEqual(selected.workspace!.entries, beforeSelection.entries);
				assert.equal(selected.workspace!.schemaVersion, 3); assert.equal((await photo(f)).schemaVersion, 3);
				const branch = generatedDevelopCurrentV1({ ...branchSpec, name: `Branch ${branchSpec.name}` }, f.resourcesForRecipe); await f.record(branch);
				let workspace = active(await photo(f)).workspace!;
				assert.deepEqual(workspace.entries.map(entry => entry.develop), [...expected.slice(0, cursor + 1), branch]);
				assert.deepEqual(workspace.snapshots[0]!.develop, captured); assert.equal(workspace.snapshots[0]!.name, branchSpec.name);
				state = await f.read(); await f.apply({ type: 'restore-develop-snapshot', versionId: state.versionId, snapshotId: 'generated-snapshot', label: 'Restore', createdAt: GENERATED_CURRENT_TIME });
				workspace = active(await photo(f)).workspace!; assert.deepEqual(workspace.entries.at(-1)!.develop, captured); assert.deepEqual((await f.read()).develop, captured);
				assert.deepEqual(parsePhotoDevelopWorkspaceCurrentV1(serializePhotoDevelopWorkspaceCurrentV1(workspace)), workspace);
				const beforeNoop = await photo(f), noOp = await f.record(captured); assert.equal(noOp.snapshot.revision, beforeNoop.revision); assert.deepEqual(await photo(f), beforeNoop);
				const final = await f.inspect(); await f.reopen(); assert.deepEqual(await f.inspect(), final); assert.deepEqual((await f.read()).develop, captured);
				assert.deepEqual(await f.inspectCustody(), custody); assert.ok(f.borrowed.length > 0); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
			} finally { await f.close(); }
		}), { ...runs, seed: 2026101501 });
});

test('seeded whole-Photo Current command undo/redo advances native revisions while restoring complete repaired and legacy states', async () => {
	await fc.assert(fc.asyncProperty(fc.array(generatedDevelopSpecCurrentV1, { minLength: 2, maxLength: 4 }), async specs => {
		const f = await developPropertiesFixtureCurrentV1(2);
		try {
			const custody = await f.inspectCustody(), owner = await f.openCommandOwner(1), states = [owner.history.present];
			for (const [index, spec] of specs.entries()) {
				const old = owner.history, serialized = JSON.stringify(old), develop = generatedDevelopCurrentV1({ ...spec, name: `Edit ${String(index)} ${spec.name}` }, f.resourcesForRecipe);
				await owner.execute({ type: 'record-develop', versionId: owner.history.present.activeVersionId, develop, label: 'Generated command', createdAt: GENERATED_CURRENT_TIME });
				assert.equal(JSON.stringify(old), serialized); assert.deepEqual(active(owner.history.present).develop, develop); states.push(owner.history.present);
			}
			await owner.execute({ type: 'save-develop-snapshot', id: 'whole-photo-snapshot', name: 'Captured repair', createdAt: GENERATED_CURRENT_TIME }); states.push(owner.history.present);
			let revision = owner.history.present.revision;
			for (const expected of states.slice(0, -1).reverse()) {
				const actual = await owner.undo(); assert.equal(actual.revision, ++revision);
				assert.deepEqual(actual, { ...expected, schemaVersion: 3, revision }); assert.deepEqual(await photo(f, 1), actual);
			}
			assert.equal(owner.canUndo, false); assert.equal(active(owner.history.present).develop.processVersion, 2); assert.equal(owner.history.present.schemaVersion, 3);
			for (const expected of states.slice(1)) {
				const actual = await owner.redo(); assert.equal(actual.revision, ++revision);
				assert.deepEqual(actual, { ...expected, schemaVersion: 3, revision }); assert.deepEqual(await photo(f, 1), actual);
			}
			assert.equal(owner.canRedo, false); const final = owner.history.present; await owner.close();
			const reopened = await f.openCommandOwner(1); assert.deepEqual(reopened.history.present, final); assert.equal(reopened.canUndo, false); await reopened.close();
			await f.reopen(); assert.deepEqual(await photo(f, 1), final); assert.deepEqual(await f.inspectCustody(), custody);
		} finally { await f.close(); }
	}), { ...runs, seed: 2026101502, numRuns: 8 });
});

const selectionSpecs = fc.record({ kind: fc.constantFrom('repairs', 'global', 'local', 'full'), geometry: fc.boolean() });
test('seeded Current3 partial native sync isolates repair, geometry, local and global groups without new body writes or idempotent history', async () => {
	await fc.assert(fc.asyncProperty(generatedDevelopSpecCurrentV1, generatedDevelopSpecCurrentV1, selectionSpecs, async (donorSpec, targetSpec, spec) => {
		const f = await developPropertiesFixtureCurrentV1(3);
		try {
			const donor = generatedDevelopCurrentV1(donorSpec, f.resourcesForRecipe), target = generatedDevelopCurrentV1({ ...targetSpec, name: `Target ${targetSpec.name}` }, f.resourcesForRecipe);
			await f.record(donor); await f.record(target, 1); await f.record(target, 2);
			const custody = await f.inspectCustody(), before = await f.inspect(), source = await f.read(), targets = [await f.read(1), await f.read(2)], child = f.session.develop.settingsCurrent!;
			const local = spec.kind === 'local' || spec.kind === 'full', global = spec.kind === 'global' || spec.kind === 'full', selectedRepairs = spec.kind === 'repairs' || spec.kind === 'full';
			const selection: ImageDevelopSelectionV4 = { effectTypes: spec.kind === 'full' ? 'all' : global ? ['white-balance-v1', 'tone-ladder-v1'] : [],
				geometry: spec.geometry, localAdjustments: local, repairs: selectedRepairs, rawDevelopment: false };
			let analysisWrites = 0; f.native.observeTransactions((_transaction, stores, mode) => { if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].includes('analysis')) analysisWrites++; });
			const packet = await child.copySelected({ ...f.source(0, donor), selection }); assert.equal(packet.develop.processVersion, 3); assert.deepEqual(repairs(packet.develop), selectedRepairs ? donor.repairs : { schemaVersion: 1, spots: [] });
			const request = { schemaVersion: 3 as const, catalogId: source.catalogId, targets: targets.map(row => ({ photoId: row.photoId, versionId: row.versionId, expectedRevision: row.revision })),
				action: { kind: 'paste' as const, settings: packet }, label: 'Generated sync', createdAt: GENERATED_CURRENT_TIME };
			const receipt = await child.applyBatch(request); assert.equal(receipt.completion, 'finished'); assert.deepEqual(receipt.notices, []);
			assert.ok(receipt.outcomes.every(outcome => outcome.status === 'applied' || outcome.status === 'unchanged'));
			const applied = [await f.read(1), await f.read(2)];
			for (const row of applied) {
				assert.equal(row.develop.processVersion, 3); assert.deepEqual(repairs(row.develop), selectedRepairs ? donor.repairs : target.repairs);
				assert.deepEqual(row.develop.geometry, spec.geometry ? donor.geometry : target.geometry);
				assert.deepEqual(row.develop.masks, local ? donor.masks : target.masks); assert.deepEqual(row.develop.maskBindings, local ? donor.maskBindings : target.maskBindings);
				for (const id of ['white', 'global-tone'] as const) assert.deepEqual(row.develop.effects.find(effect => effect.id === id), (global ? donor : target).effects.find(effect => effect.id === id));
				assert.deepEqual(row.develop.effects.find(effect => effect.id === 'local-tone'), (local ? donor : target).effects.find(effect => effect.id === 'local-tone'));
				assert.deepEqual(row.develop.effects.find(effect => effect.id === 'chroma'), (spec.kind === 'full' ? donor : target).effects.find(effect => effect.id === 'chroma'));
				assert.equal(new Set(row.develop.effects.map(effect => effect.id)).size, row.develop.effects.length);
				assert.equal(new Set(row.develop.masks.map(mask => mask.id)).size, row.develop.masks.length);
			}
			const stable = await f.inspect(), repeated = await child.applyBatch({ ...request, targets: applied.map(row => ({ photoId: row.photoId, versionId: row.versionId, expectedRevision: row.revision })) });
			assert.ok(repeated.outcomes.every(outcome => outcome.status === 'unchanged')); assert.deepEqual(await f.inspect(), stable); assert.deepEqual(stable[0], before[0]);
			await f.reopen(); assert.deepEqual(await f.inspect(), stable); assert.deepEqual(await f.inspectCustody(), custody); assert.equal(analysisWrites, 0);
		} finally { f.native.observeTransactions(null); await f.close(); }
	}), { ...runs, seed: 2026101503, numRuns: 12 });
});

test('generated repair snapshots and inactive history keep unused brush authentication mandatory before unrelated native publication', async () => {
	await fc.assert(fc.asyncProperty(generatedDevelopSpecCurrentV1, async spec => {
		const f = await developPropertiesFixtureCurrentV1(2);
		try {
			const recipe = generatedDevelopCurrentV1(spec, f.resourcesForRecipe); await f.record(recipe);
			const selected = await f.read(); await f.apply({ type: 'save-develop-snapshot', versionId: selected.versionId, id: 'retained', name: spec.name, createdAt: GENERATED_CURRENT_TIME });
			await f.record(defaultImageDevelopStateV2()); const owner = await f.openCommandOwner(), before = owner.history, nativeBefore = await f.inspect();
			assert.equal(active(before.present).develop.processVersion, 2); assert.equal(active(before.present).workspace!.schemaVersion, 3);
			assert.deepEqual(active(before.present).workspace!.snapshots[0]!.develop, recipe);
			await f.corruptResource(f.resourcesForRecipe.unusedBrush.storageKey);
			await assert.rejects(owner.execute({ type: 'set-metadata', changes: { title: 'Requires full retained authentication' } }));
			assert.equal(owner.history, before); assert.deepEqual(await f.inspect(), nativeBefore); await owner.close();
		} finally { await f.close(); }
	}), { ...runs, seed: 2026101504, numRuns: 4 });
});
