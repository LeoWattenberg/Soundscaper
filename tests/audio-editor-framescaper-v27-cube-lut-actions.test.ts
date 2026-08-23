/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFramescaperOwnedFinishingCommandV27 } from '../src/framescaper/editor-project-v27-finishing-command.ts';
import {
	createFramescaperCubeLutActionsV27,
} from '../src/framescaper/editor-cube-lut-actions-v27.ts';

test('selected V27 imports one exact cube body and attaches it through stale-safe history', async () => {
	const project = lutProject();
	const commands: unknown[] = [];
	const bodies = new Map<string, Readonly<{ blob: Blob; metadata: Readonly<Record<string, unknown>> }>>();
	const owner = {
		project,
		actions: { edit: { commit(command: unknown) {
			commands.push(command);
			applyFramescaperOwnedFinishingCommandV27(project, command as never);
			return command;
		} } },
	};
	const actions = createFramescaperCubeLutActionsV27({
		owner,
		store: {
			getMediaAssetMetadata: async (key) => bodies.has(key)
				? bodies.get(key)!.metadata : null,
			writeMediaAsset: async (key, blob, metadata) => {
				bodies.set(key, { blob, metadata: { ...metadata, size: blob.size } });
			},
			deleteMediaAsset: async (key) => bodies.delete(key),
		},
	});
	assert.deepEqual(actions.targets(), [
		{ kind: 'presentation', id: 'presentation-1', label: 'Presentation presentation-1' },
		{ kind: 'preset', id: 'preset-1', label: 'Preset Warm look' },
	]);
	const file = new File([identityCube()], 'identity.cube', { type: 'text/plain' });
	const reference = await actions.importCubeLut({
		target: { kind: 'presentation', id: 'presentation-1' }, file,
	});
	assert.equal(reference.storageKey, `lut-sha256:${reference.sha256}`);
	assert.equal(reference.byteLength, file.size);
	assert.equal(commands.length, 1);
	assert.deepEqual(project.videoVisualPresentations[0]!.grade!.lut, reference);
	assert.equal(await bodies.get(reference.storageKey)!.blob.text(), identityCube());
	assert.deepEqual(bodies.get(reference.storageKey)!.metadata, {
		name: 'identity.cube', mimeType: 'text/plain', sha256: reference.sha256,
		size: file.size,
	});

	const presetReference = await actions.importCubeLut({
		target: { kind: 'preset', id: 'preset-1' }, file,
	});
	assert.deepEqual(presetReference, reference);
	assert.equal(bodies.size, 1, 'digest-identical LUTs reuse one authenticated body');
	assert.equal(commands.length, 2);
	assert.deepEqual(project.videoFinishingPresets[0]!.template.grade!.lut, reference);
	await actions.importCubeLut({
		target: { kind: 'preset', id: 'preset-1' }, file,
	});
	assert.equal(commands.length, 2, 'reattaching the same LUT is a history no-op');
});

test('selected V27 rejects invalid cube files and rolls back a new body after commit failure', async () => {
	const project = lutProject();
	const deleted: string[] = [];
	let writes = 0;
	const actions = createFramescaperCubeLutActionsV27({
		owner: {
			project,
			actions: { edit: { commit() { throw new Error('planned stale publication'); } } },
		},
		store: {
			getMediaAssetMetadata: async () => null,
			writeMediaAsset: async () => { writes += 1; },
			deleteMediaAsset: async (key) => { deleted.push(key); return true; },
		},
	});
	await assert.rejects(actions.importCubeLut({
		target: { kind: 'presentation', id: 'presentation-1' },
		file: new File([identityCube()], 'identity.txt'),
	}), /\.cube/iu);
	await assert.rejects(actions.importCubeLut({
		target: { kind: 'presentation', id: 'presentation-1' },
		file: new File([Uint8Array.of(0xff)], 'invalid.cube'),
	}), /UTF-8/iu);
	assert.equal(writes, 0);
	await assert.rejects(actions.importCubeLut({
		target: { kind: 'presentation', id: 'presentation-1' },
		file: new File([identityCube()], 'identity.cube'),
	}), /planned stale publication/u);
	assert.equal(writes, 1);
	assert.match(deleted[0] ?? '', /^lut-sha256:[a-f0-9]{64}$/u);
	assert.equal(project.videoVisualPresentations[0]!.grade!.lut, null);
});

function lutProject() {
	return {
		schemaVersion: 27, id: 'project-1', revision: 1,
		videoVisualPresentations: [{
			schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'clip-1' },
			enabled: true, opacity: 1, blendMode: 'normal', grade: grade(),
			processorStackId: null, maskMatteIds: [],
		}],
		videoFinishingPresets: [{
			schemaVersion: 1, kind: 'video-finishing-preset', id: 'preset-1', name: 'Warm look',
			template: { enabled: true, opacity: 1, blendMode: 'normal', grade: grade() },
		}],
	};
}

function grade() {
	return {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null,
	};
}

function identityCube(): string {
	return [
		'TITLE "Identity"',
		'LUT_3D_SIZE 2',
		'DOMAIN_MIN 0 0 0',
		'DOMAIN_MAX 1 1 1',
		'0 0 0', '0 0 1', '0 1 0', '0 1 1',
		'1 0 0', '1 0 1', '1 1 0', '1 1 1', '',
	].join('\n');
}
