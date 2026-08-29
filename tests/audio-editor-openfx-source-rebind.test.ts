/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A Scape import re-mints every source identity that collides with one already in
 * the store, and each product then follows those remaps through its own document
 * references. An OpenFX effect holds two of them: every declared input names a
 * project identity, and a frozen fallback names the external media it rendered.
 * Leaving either behind imports a document that names sources which no longer
 * exist, and loading it fails on the missing identity rather than opening.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { remapScapeProjectSourceReferences } from '../src/common/editor/scape-project-source-remap.ts';
import { rebindFramescaperSourceIdentities } from '../src/framescaper/editor-project-source-rebind.ts';
import { openFxProject } from './helpers/framescaper-unified-render-project-fixture.ts';

interface ProjectSource { readonly id: string; readonly contentSha256?: string }
interface OpenFxInput { readonly name: string; readonly sourceRef: string }

const REMAP = new Map([
	['video-source', 'video-source-2'],
	['audio-source', 'audio-source-2'],
	['ofx-frozen-source', 'ofx-frozen-source-2'],
]);

/** The fixture project with a frozen fallback and an input that names a clip. */
function importedProject() {
	const base = openFxProject('video-source') as Record<string, unknown>;
	const sources = base.sources as readonly ProjectSource[];
	const video = sources.find((source) => source.id === 'video-source');
	assert.ok(video, 'the fixture provides a video source');
	const project: Record<string, unknown> = {
		...base,
		assistanceAssets: [],
		sources: [...sources, { ...video, id: 'ofx-frozen-source', storageKey: 'ofx-frozen-storage' }],
		ofxEffects: (base.ofxEffects as readonly Record<string, unknown>[]).map((effect) => ({
			...effect,
			inputs: [
				...(effect.inputs as readonly OpenFxInput[]),
				{ name: 'Mask', sourceRef: 'video-clip' },
			],
			frozenFallback: {
				externalMediaSourceId: 'ofx-frozen-source',
				renderedAssetSha256: video.contentSha256 ?? '0'.repeat(64),
				frameCount: 240,
				freshness: effect.freshness,
			},
		})),
	};
	const copy = structuredClone(project);
	for (const source of copy.sources as Record<string, unknown>[]) {
		source.id = REMAP.get(String(source.id)) ?? source.id;
	}
	remapScapeProjectSourceReferences(copy, REMAP);
	rebindFramescaperSourceIdentities(copy, REMAP);
	return copy;
}

function effect(project: Record<string, unknown>) {
	const effects = project.ofxEffects as readonly Record<string, unknown>[];
	assert.equal(effects.length, 1);
	return effects[0]!;
}

test('an OpenFX input that names a source follows the import remap', () => {
	const inputs = effect(importedProject()).inputs as readonly OpenFxInput[];

	assert.equal(inputs.find(({ name }) => name === 'Source')?.sourceRef, 'video-source-2');
});

test('an OpenFX input that names something other than a source is left alone', () => {
	const inputs = effect(importedProject()).inputs as readonly OpenFxInput[];

	assert.equal(inputs.find(({ name }) => name === 'Mask')?.sourceRef, 'video-clip');
});

test('a frozen fallback follows the import remap to its media', () => {
	const fallback = effect(importedProject()).frozenFallback as { externalMediaSourceId: string };

	assert.equal(fallback.externalMediaSourceId, 'ofx-frozen-source-2');
});

test('every OpenFX identity the import rewrote still exists in the document', () => {
	const project = importedProject();
	const ids = new Set([
		...(project.sources as readonly ProjectSource[]).map((source) => source.id),
		...(project.clips as readonly { id: string }[]).map((clip) => clip.id),
	]);
	const current = effect(project);

	for (const input of current.inputs as readonly OpenFxInput[]) {
		assert.equal(ids.has(input.sourceRef), true, `input ${input.name} names ${input.sourceRef}`);
	}
	const fallback = current.frozenFallback as { externalMediaSourceId: string };
	assert.equal(ids.has(fallback.externalMediaSourceId), true);
});
