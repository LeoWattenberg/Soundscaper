/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperV27VisualInspectorCommand,
	createFramescaperV27VisualInspectorModel,
} from '../src/common/editor/ui/framescaper-v27-visual-inspector-model.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { applyFramescaperProjectCommandV27 } from '../src/framescaper/editor-project-v27-commands.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { reimportFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { reimportFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperProjectV24FoundationV27 } from '../src/framescaper/editor-project-v27-validation.ts';
import { prepareFramescaperSelectedAuthoringV27 } from '../src/framescaper/editor-selected-v27-authoring-workflows.ts';
import { createFramescaperSelectedProjectBinThumbnailV27 } from '../src/framescaper/editor-selected-v27-visual-preview.ts';
import { visualProject } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected visual inspector materializes generator, presentation, and linked-mask changes atomically', () => {
	let project = reimportFramescaperProjectV27(PROFILE, visualProject());
	project = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'selection/set', startFrame: 0, endFrame: 0,
		trackIds: ['video-track'], clipIds: ['generator-clip'], frequencyRange: null,
	});
	const projectFoundation = framescaperProjectV24FoundationV27(PROFILE, project);
	assert.deepEqual(record(projectFoundation.selection).clipIds, ['generator-clip']);
	const initial = createFramescaperV27VisualInspectorModel({
		project, selectedClipId: 'generator-clip',
	});
	assert.equal(initial.kind, 'title');
	assert.equal(initial.maskId, null);
	assert.equal(initial.masks.some(({ id }) => id === 'mask'), true);
	assert.equal(initial.presets.length, 0, 'an unbound preset is inventory, not executable state');
	assert.ok(initial.generator && (initial.generator.kind === 'title' || initial.generator.kind === 'text'));
	const generator = { ...initial.generator, text: 'Inspector pixels', color: '#ff0000ff' };
	const command = createFramescaperV27VisualInspectorCommand(project, 'generator-clip', {
		generator,
		opacity: 0.75,
		blendMode: 'screen',
		maskId: 'mask',
		maskWidth: 0.5,
		presetId: null,
	});
	const updated = applyFramescaperProjectCommandV27(PROFILE, project, command);
	const updatedFoundation = framescaperProjectV24FoundationV27(PROFILE, updated);
	const source = records(updatedFoundation.sources).find(({ id }) => id === 'generator-source');
	assert.equal(source?.kind, 'generator');
	const authoredGenerator = record(source?.generator);
	assert.equal(authoredGenerator.kind === 'title' ? authoredGenerator.text : null, 'Inspector pixels');
	assert.deepEqual(updated.videoVisualPresentations.map(({ opacity, blendMode, maskMatteIds }) => ({
		opacity, blendMode, maskMatteIds,
	})), [{ opacity: 0.75, blendMode: 'screen', maskMatteIds: ['mask'] }]);
	const mask = updatedFoundation.videoMaskMattes.find(({ id }) => id === 'mask');
	const output = mask?.nodes.find(({ id }) => id === mask.outputNodeId);
	assert.equal(output?.kind === 'vector-shape' ? output.width : null, 0.5);
	assert.equal(updatedFoundation.revision, number(record(projectFoundation).revision) + 1);
});

test('selected V28 retains the inherited visual inspector through its exact V27 foundation', () => {
	const project = reimportFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		reimportFramescaperProjectV27(PROFILE, visualProject()),
	);
	const model = createFramescaperV27VisualInspectorModel({
		project, selectedClipId: 'generator-clip',
	});
	assert.equal(model.kind, 'title');
	const command = createFramescaperV27VisualInspectorCommand(project, 'generator-clip', {
		generator: model.generator, opacity: 0.75, blendMode: 'screen',
		maskId: null, maskWidth: 1, presetId: null,
	});
	assert.equal((command as Readonly<{ type?: unknown }>).type, 'video-visual-presentation/set');
});

test('generator presets are executable only while a retained owning source binds their digest', () => {
	const base = visualProject();
	const generator = base.sources.find(({ id }) => id === 'generator-source');
	assert.ok(generator?.kind === 'generator');
	const importedBase = {
		...structuredClone(base),
		videoVisualPresets: base.videoVisualPresets.map((preset, index) => index === 0 ? {
			...preset,
			modelKind: 'generator' as const,
			authoredStateSha256: fingerprintNativeMediaPlan(generator).sha256,
		} : preset),
	};
	const project = reimportFramescaperProjectV27(PROFILE, importedBase);
	const model = createFramescaperV27VisualInspectorModel({
		project, selectedClipId: 'generator-clip',
	});
	assert.deepEqual(model.presets.map(({ id }) => id), ['preset']);
	const command = createFramescaperV27VisualInspectorCommand(project, 'generator-clip', {
		generator: null,
		opacity: 1,
		blendMode: 'normal',
		maskId: null,
		maskWidth: 1,
		presetId: 'preset',
	});
	const updated = applyFramescaperProjectCommandV27(PROFILE, project, command);
	assert.equal(updated.videoVisualPresentations.length, 1);
	assert.equal(createFramescaperV27VisualInspectorModel({
		project: updated, selectedClipId: 'generator-clip',
	}).presets[0]?.id, 'preset');
});

test('adjustment-layer authoring materializes a known executable effect chain over its video target', async () => {
	const project = reimportFramescaperProjectV27(PROFILE, visualProject());
	const prepared = await prepareFramescaperSelectedAuthoringV27(
		'video-adjustment-layer', project, {} as never,
	);
	assert.ok(prepared);
	const updated = applyFramescaperProjectCommandV27(PROFILE, project, prepared.command);
	const foundation = framescaperProjectV24FoundationV27(PROFILE, updated);
	assert.equal(foundation.videoAdjustmentLayers.length, 2);
	const adjustment = foundation.videoAdjustmentLayers.find(({ effectIds }) => effectIds.length > 0);
	assert.ok(adjustment);
	const clip = records(foundation.clips).find(({ id }) => id === 'video-clip');
	assert.equal(clip?.kind, 'video');
	const effect = records(clip?.videoEffects).find(({ id }) => id === adjustment.effectIds[0]);
	assert.equal(effect?.type, 'color-adjust');
	assert.equal(record(effect?.params).brightness, 0.25);
});

test('Project Bin thumbnails consume the same exact presentation and mask materializer as program preview', async () => {
	const base = structuredClone(visualProject()) as unknown as Record<string, unknown>;
	const clips = base.clips as Record<string, unknown>[];
	const clip = clips.find(({ id }) => id === 'generator-clip');
	assert.ok(clip);
	base.clips = clips.filter(({ id }) => id !== 'generator-clip');
	const track = (base.tracks as Record<string, unknown>[]).find(({ id }) => id === 'video-track');
	assert.ok(track && Array.isArray(track.clipIds));
	track.clipIds = track.clipIds.filter((id) => id !== 'generator-clip');
	const bin = base.projectBin as Record<string, unknown>;
	bin.clips = [...bin.clips as unknown[], clip];
	const source = (base.sources as Record<string, unknown>[]).find(({ id }) => id === 'generator-source');
	assert.ok(source);
	source.generator = { kind: 'solid', color: '#ff0000ff' };
	base.videoMaskMattes = [{
		schemaVersion: 1, id: 'bin-mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle',
			x: 0, y: 0, width: 0.5, height: 1 }],
		outputNodeId: 'shape',
	}];
	const presentation = {
		schemaVersion: 1, id: 'bin-presentation', owner: { kind: 'clip', id: 'generator-clip' },
		enabled: true, opacity: 0.5, blendMode: 'normal', maskMatteIds: ['bin-mask'],
		grade: null, processorStackId: null,
	};
	let project = reimportFramescaperProjectV27(PROFILE, base);
	project = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'video-visual-presentation/set', presentationId: presentation.id,
		expectedPresentation: null, presentation,
	});
	const thumbnail = await createFramescaperSelectedProjectBinThumbnailV27({
		profile: PROFILE, project, store: {} as never,
		clipId: 'generator-clip', width: 4, height: 2,
	});
	assert.ok(thumbnail);
	assert.deepEqual(thumbnail.presentationIds, ['bin-presentation']);
	assert.deepEqual(thumbnail.maskIds, ['bin-mask']);
	assert.equal(thumbnail.opacity, 0.5);
	assert.deepEqual([...thumbnail.pixels.slice(0, 4)], [255, 0, 0, 128]);
	assert.deepEqual([...thumbnail.pixels.slice(3 * 4, 4 * 4)], [255, 0, 0, 0]);
});

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return value.map(record);
}

function number(value: unknown): number {
	if (typeof value !== 'number') throw new TypeError('Expected a number.');
	return value;
}
