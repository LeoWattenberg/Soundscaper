/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Two functions decide what counts as a source reference in a Framescaper
 * document, and they have to agree. The rebinder follows a reference when a Scape
 * import re-mints identities; retention counts a reference when it decides which
 * stored media is still reachable. A reference one of them knows about and the
 * other does not is a bug either way round: rewritten but then collected as
 * garbage, or retained but left pointing at an identity that no longer exists.
 *
 * A visual graph reaches media the timeline never places - a matte input, an
 * external generator's input, an OpenFX named input - so none of these can be
 * found by walking clips.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { collectProjectSourceIds } from '../src/common/editor/retention.js';
import { rebindFramescaperSourceIdentities } from '../src/framescaper/editor-project-source-rebind.ts';
import { rebindFramescaperVisualSourceIdentitiesVisual } from '../src/framescaper/editor-project-visual-source-rebind.ts';
import { openFxProject } from './helpers/framescaper-unified-render-project-fixture.ts';

interface ProjectSource { readonly id: string; readonly kind?: string }

/** Media reached only through a visual graph, never through a clip. */
const UNPLACED = Object.freeze({
	matte: 'matte-input-source',
	generator: 'generator-input-source',
	openFx: 'openfx-input-source',
});

function projectWithVisualInputs() {
	const base = openFxProject('video-source') as Record<string, unknown>;
	const sources = base.sources as readonly ProjectSource[];
	const video = sources.find((source) => source.id === 'video-source');
	assert.ok(video, 'the fixture provides a video source');
	return {
		...base,
		assistanceAssets: [],
		sources: [
			...sources,
			{ ...video, id: UNPLACED.matte, storageKey: UNPLACED.matte },
			{ ...video, id: UNPLACED.generator, storageKey: UNPLACED.generator },
			{ ...video, id: UNPLACED.openFx, storageKey: UNPLACED.openFx },
			{
				...video,
				id: 'generator-source',
				storageKey: 'generator-source',
				kind: 'generator',
				generator: {
					kind: 'external-generator',
					inputs: [{ name: 'In', sourceRef: UNPLACED.generator }],
				},
			},
		],
		videoMaskMattes: [{ id: 'matte', inputs: [{ name: 'Matte', sourceRef: UNPLACED.matte }] }],
		ofxEffects: (base.ofxEffects as readonly Record<string, unknown>[]).map((effect) => ({
			...effect,
			inputs: [
				...(effect.inputs as readonly unknown[]),
				{ name: 'Matte', sourceRef: UNPLACED.openFx },
			],
		})),
	} as Record<string, unknown>;
}

test('no clip places the media these visual graphs reach', () => {
	const placed = new Set((projectWithVisualInputs().clips as readonly { sourceId?: string }[])
		.map((clip) => clip.sourceId));

	for (const [label, sourceId] of Object.entries(UNPLACED)) {
		assert.equal(placed.has(sourceId), false, `${label} media must not be on the timeline`);
	}
});

test('the rebinder rewrites every visual graph input', () => {
	const project = projectWithVisualInputs();
	const remap = new Map(Object.values(UNPLACED).map((sourceId) => [sourceId, `${sourceId}-2`]));
	rebindFramescaperSourceIdentities(project, remap);
	rebindFramescaperVisualSourceIdentitiesVisual(project, remap);

	const mattes = project.videoMaskMattes as readonly { inputs: readonly { sourceRef: string }[] }[];
	assert.equal(mattes[0]?.inputs[0]?.sourceRef, `${UNPLACED.matte}-2`);
	const generator = (project.sources as readonly Record<string, unknown>[])
		.find((source) => source.kind === 'generator');
	assert.equal(
		((generator?.generator as { inputs: readonly { sourceRef: string }[] }).inputs[0]?.sourceRef),
		`${UNPLACED.generator}-2`,
	);
	const effect = (project.ofxEffects as readonly Record<string, unknown>[])[0]!;
	const openFxInput = (effect.inputs as readonly { name: string; sourceRef: string }[])
		.find(({ name }) => name === 'Matte');
	assert.equal(openFxInput?.sourceRef, `${UNPLACED.openFx}-2`);
});

test('retention keeps every source the rebinder would rewrite', () => {
	const retained = collectProjectSourceIds(projectWithVisualInputs());

	for (const [label, sourceId] of Object.entries(UNPLACED)) {
		assert.equal(retained.has(sourceId), true, `${label} media must survive a retention sweep`);
	}
});

test('an input that names something other than a source is not retained as one', () => {
	const project = projectWithVisualInputs();
	project.ofxEffects = (project.ofxEffects as readonly Record<string, unknown>[]).map((effect) => ({
		...effect,
		inputs: [...(effect.inputs as readonly unknown[]), { name: 'Target', sourceRef: 'video-clip' }],
	}));

	assert.equal(collectProjectSourceIds(project).has('video-clip'), false);
});
