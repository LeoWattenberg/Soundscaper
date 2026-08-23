/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { applyFramescaperProjectCommandV27 } from '../src/framescaper/editor-project-v27-commands.ts';
import { framescaperProjectForRuntimeConsumersV27 } from '../src/framescaper/editor-project-v27-runtime.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { prepareFramescaperSelectedAuthoringV27 } from '../src/framescaper/editor-selected-v27-authoring-workflows.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 generator persists and exposes its source name to the runtime timeline', async () => {
	const project = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	const prepared = await prepareFramescaperSelectedAuthoringV27(
		'video-solid', project, unusedStore(),
	);
	assert.ok(prepared);
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, prepared.command);
	const state = visualState(applied);
	const generator = state.clips.find(({ kind }) => kind === 'generator');
	assert.ok(generator?.kind === 'generator');
	assert.equal(state.sources.find(({ id }) => id === generator.sourceId)?.name, 'Solid');
	const runtime = framescaperProjectForRuntimeConsumersV27(PROFILE, applied);
	const runtimeClip = (runtime.clips as Readonly<Record<string, unknown>>[])
		.find(({ id }) => id === generator.id);
	assert.equal(runtimeClip?.title, 'Solid');
});

test('selected V27 dissolve authoring allocates the canonical transition through inherited history', async () => {
	const prepared = await prepareFramescaperSelectedAuthoringV27(
		'video-transition-dissolve', transitionProject(), unusedStore(),
	);
	assert.ok(prepared);
	const project = applyFramescaperProjectCommandV27(PROFILE, transitionProject(), prepared.command);
	const track = visualState(project).tracks.find(({ id }) => id === 'video-track');
	assert.equal(track?.type, 'video');
	assert.deepEqual(track?.type === 'video' ? track.videoTransitions?.map((transition) => ({
		type: transition.type,
		outgoingClipId: transition.outgoingClipId,
		incomingClipId: transition.incomingClipId,
		durationFrames: transition.durationFrames,
	})) : [], [{
		type: 'dissolve', outgoingClipId: 'video-clip', incomingClipId: 'incoming-video',
		durationFrames: 5,
	}]);
});

test('selected V27 still import persists owned image media and managed sRGB state', async () => {
	const assets = new Map<string, Blob>();
	const store = mediaStore(assets);
	const restore = installStillPicker(new File(['plate'], 'Plate.png', { type: 'image/png' }));
	try {
		const prepared = await prepareFramescaperSelectedAuthoringV27(
			'video-still', createFramescaperProjectV27(PROFILE, framescaperV20Options()), store,
		);
		assert.ok(prepared);
		const project = applyFramescaperProjectCommandV27(
			PROFILE, createFramescaperProjectV27(PROFILE, framescaperV20Options()), prepared.command,
		);
		const state = visualState(project);
		const source = state.sources.find(({ kind }) => kind === 'still');
		assert.ok(source?.kind === 'still' && typeof source.storageKey === 'string');
		assert.equal(source.name, 'Plate.png');
		assert.equal(source.width, 640);
		assert.equal(source.height, 360);
		assert.equal(assets.has(source.storageKey), true);
		assert.equal(state.clips.some(({ kind, sourceId }) => (
			kind === 'still' && sourceId === source.id
		)), true);
		assert.equal(state.videoSourceColorInterpretations.find(({ sourceId }) => (
			sourceId === source.id
		))?.provenance, 'default-still-srgb-full');
		await prepared.rollback?.();
		assert.equal(assets.has(source.storageKey), false);
	} finally {
		restore();
	}
});

test('selected V27 freeze authoring digest-binds a locally rendered still fallback', async () => {
	const assets = new Map<string, Blob>();
	const project = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	const prepared = await prepareFramescaperSelectedAuthoringV27(
		'video-freeze', project, mediaStore(assets, new Blob(['poster'], { type: 'image/webp' })),
	);
	assert.ok(prepared);
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, prepared.command);
	const state = visualState(applied);
	const source = state.sources.find(({ kind }) => kind === 'still');
	assert.ok(source?.kind === 'still' && typeof source.storageKey === 'string');
	assert.equal(state.videoFreezeFallbacks.some(({ renderedSourceId, renderedAssetSha256 }) => (
		renderedSourceId === source.id && renderedAssetSha256 === source.contentSha256
	)), true);
	assert.equal(assets.has(source.storageKey), true);
});

function transitionProject() {
	const options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[];
	clips.push({
		...structuredClone(clips[0]), id: 'incoming-video', sequenceStartFrame: 10,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	(tracks[0]!.clipIds as string[]).push('incoming-video');
	return createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
	});
}

function unusedStore(): AudioEditorProjectStore {
	return Object.freeze({}) as unknown as AudioEditorProjectStore;
}

function mediaStore(assets: Map<string, Blob>, poster: Blob | null = null): AudioEditorProjectStore {
	return Object.freeze({
		async writeMediaAsset(sourceId: string, blob: Blob): Promise<void> { assets.set(sourceId, blob); },
		async deleteMediaAsset(sourceId: string): Promise<void> { assets.delete(sourceId); },
		async loadVideoDerivative(): Promise<Blob | null> { return poster; },
	}) as unknown as AudioEditorProjectStore;
}

function installStillPicker(file: File): () => void {
	const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
	let change: (() => void) | null = null;
	const input = {
		type: '', accept: '', hidden: false, files: [file], remove: () => undefined,
		addEventListener: (type: string, listener: () => void): void => {
			if (type === 'change') change = listener;
		},
		click: (): void => { change?.(); },
	};
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { createElement: () => input, body: { append: () => undefined } },
	});
	Object.defineProperty(globalThis, 'createImageBitmap', {
		configurable: true,
		value: async () => ({ width: 640, height: 360, close: () => undefined }),
	});
	return () => {
		if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
		else Reflect.deleteProperty(globalThis, 'document');
		if (bitmapDescriptor) Object.defineProperty(globalThis, 'createImageBitmap', bitmapDescriptor);
		else Reflect.deleteProperty(globalThis, 'createImageBitmap');
	};
}

interface VisualState {
	readonly tracks: readonly Readonly<{
		readonly id: string;
		readonly type: string;
		readonly videoTransitions?: readonly Readonly<{
			readonly type: string;
			readonly outgoingClipId: string;
			readonly incomingClipId: string;
			readonly durationFrames: number;
		}>[];
	}>[];
	readonly sources: readonly Readonly<{
		readonly id: string;
		readonly kind: string;
		readonly name?: string;
		readonly width?: number;
		readonly height?: number;
		readonly storageKey?: string;
		readonly contentSha256?: string;
	}>[];
	readonly clips: readonly Readonly<{
		readonly id: string;
		readonly kind: string;
		readonly sourceId?: string;
	}>[];
	readonly videoSourceColorInterpretations: readonly Readonly<{
		readonly sourceId: string;
		readonly provenance: string;
	}>[];
	readonly videoFreezeFallbacks: readonly Readonly<{
		readonly renderedSourceId: string;
		readonly renderedAssetSha256: string;
	}>[];
}

function visualState(value: unknown): VisualState {
	return value as VisualState;
}
