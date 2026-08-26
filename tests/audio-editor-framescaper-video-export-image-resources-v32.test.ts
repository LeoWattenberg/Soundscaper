/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { UnifiedExactRenderPlanV13 } from '../src/common/editor/unified-exact-render-plan.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import {
	cloneFramescaperProjectV32,
	type FramescaperProjectV32,
} from '../src/framescaper/editor-project-v32.ts';
import { createFramescaperVideoExportImageExecutionV32 } from '../src/framescaper/video-export-image-execution-v32.ts';
import { createFramescaperV32ImageFixture } from './helpers/framescaper-v32-image-fixture.ts';

const PROFILE = FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE;

test('V32 export shares one bounded source-frame cache across many image clips', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const project = projectWithRepeatedImageClips(fixture.project, 256);
	const plan = exactPlan(project);
	let bodyLoads = 0;
	const execution = await createFramescaperVideoExportImageExecutionV32({
		profile: PROFILE,
		project,
		foundationPlan: plan,
		store: {
			loadMediaAsset() {
				bodyLoads += 1;
				return Promise.resolve(imageBlob(fixture.bytes));
			},
		},
		signal: new AbortController().signal,
		assertCurrent() {},
	});
	assert.ok(execution);
	assert.equal(bodyLoads, 1, 'one source snapshot serves every clip context');
	const first = await execution.resolve(resolveRequest(plan, 0));
	assert.equal(first.length, 256);
	const firstFrame = first[0]!.frame;
	assert.ok(first.every(({ frame }) => frame === firstFrame),
		'one source/frame decode is shared by every overlapping clip');
	assert.ok(firstFrame.pixels.some((value) => value !== 0));
	const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
	assert.ok(sequence);
	const secondSequenceFrame = Math.ceil(sequence.rate.num / sequence.rate.den);
	const second = await execution.resolve(resolveRequest(plan, secondSequenceFrame));
	assert.equal(second.length, 256);
	const secondFrame = second[0]!.frame;
	assert.notEqual(secondFrame, firstFrame);
	assert.ok(second.every(({ frame }) => frame === secondFrame));
	assert.ok(firstFrame.pixels.every((value) => value === 0),
		'the prior resolved-frame generation is zeroed before replacement');
	execution.dispose();
	assert.ok(secondFrame.pixels.every((value) => value === 0),
		'disposal zeroes and releases the retained generation');
});

test('V32 export rejects aggregate decoded working bytes before reading frame payloads', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const body = forgedLargeFramePack(fixture.bytes);
	const project = projectWithDistinctImageSources(fixture.project, 7, (source) => {
		const canonical = source.canonical as Record<string, unknown>;
		canonical.width = 8_192;
		canonical.height = 2_048;
		source.contentSha256 = body.contentSha256;
	});
	const plan = exactPlan(project);
	let bodyLoads = 0;
	const execution = await createFramescaperVideoExportImageExecutionV32({
		profile: PROFILE,
		project,
		foundationPlan: plan,
		store: {
			loadMediaAsset() {
				bodyLoads += 1;
				return Promise.resolve(imageBlob(body.bytes));
			},
		},
		signal: new AbortController().signal,
		assertCurrent() {},
	});
	assert.ok(execution);
	assert.equal(bodyLoads, 7);
	await assert.rejects(Promise.resolve(execution.resolve(resolveRequest(plan, 0))),
		/decoded working byte bound/iu);
	execution.dispose();
});

test('V32 export admits sequential high-resolution clips from their resolved peak only', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const body = forgedLargeFramePack(fixture.bytes);
	const overlapping = projectWithDistinctImageSources(fixture.project, 7, (source) => {
		const canonical = source.canonical as Record<string, unknown>;
		canonical.width = 8_192;
		canonical.height = 2_048;
		source.contentSha256 = body.contentSha256;
	});
	const project = sequentialImageClips(overlapping);
	const plan = exactPlan(project);
	let bodyLoads = 0;
	const execution = await createFramescaperVideoExportImageExecutionV32({
		profile: PROFILE,
		project,
		foundationPlan: plan,
		store: {
			loadMediaAsset() {
				bodyLoads += 1;
				return Promise.resolve(imageBlob(body.bytes));
			},
		},
		signal: new AbortController().signal,
		assertCurrent() {},
	});
	assert.ok(execution);
	assert.equal(bodyLoads, 7);
	await assert.rejects(Promise.resolve(execution.resolve(resolveRequest(plan, 0))),
		/compressed digest/iu);
	execution.dispose();
});

test('V32 export accounts for snapshot range-read peak before opening a large frame pack', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const expanded = structuredClone(fixture.project);
	const source = expanded.sources.find(({ kind }) => kind === 'image');
	assert.ok(source);
	(source as unknown as Record<string, unknown>).assetByteLength = 250 * 1024 * 1024;
	const project = cloneFramescaperProjectV32(PROFILE, expanded);
	const plan = exactPlan(project);
	let bodyLoads = 0;
	await assert.rejects(createFramescaperVideoExportImageExecutionV32({
		profile: PROFILE,
		project,
		foundationPlan: plan,
		store: {
			loadMediaAsset() {
				bodyLoads += 1;
				return Promise.resolve(imageBlob(fixture.bytes));
			},
		},
		signal: new AbortController().signal,
		assertCurrent() {},
	}), /snapshots exceed their working byte bound/iu);
	assert.equal(bodyLoads, 0);
});

test('V32 export bounds aggregate retained reader metadata before the next body opens', async () => {
	const fixture = createFramescaperV32ImageFixture({
		imageOnly: true,
		receipt: { decoder: 'test', padding: 'x'.repeat(1024 * 1024), schemaVersion: 1 },
	});
	const project = projectWithDistinctImageSources(fixture.project, 20, () => {});
	const plan = exactPlan(project);
	let bodyLoads = 0;
	await assert.rejects(createFramescaperVideoExportImageExecutionV32({
		profile: PROFILE,
		project,
		foundationPlan: plan,
		store: {
			loadMediaAsset() {
				bodyLoads += 1;
				return Promise.resolve(imageBlob(fixture.bytes));
			},
		},
		signal: new AbortController().signal,
		assertCurrent() {},
	}), /reader metadata exceeds its working byte bound/iu);
	assert.ok(bodyLoads > 0 && bodyLoads < 20);
});

test('V32 export preflights overlapping full-canvas planes before reading image frames', async () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const body = corruptFirstFramePayload(fixture.bytes);
	const expanded = structuredClone(fixture.project);
	const source = expanded.sources.find(({ kind }) => kind === 'image');
	assert.ok(source);
	(source as unknown as Record<string, unknown>).contentSha256 = body.contentSha256;
	const project = projectWithRepeatedImageClips(cloneFramescaperProjectV32(PROFILE, expanded), 8);
	const plan = exactPlan(project, 1_920, 1_080);
	const execution = await createFramescaperVideoExportImageExecutionV32({
		profile: PROFILE,
		project,
		foundationPlan: plan,
		store: { loadMediaAsset: () => Promise.resolve(imageBlob(body.bytes)) },
		signal: new AbortController().signal,
		assertCurrent() {},
	});
	assert.ok(execution);
	await assert.rejects(Promise.resolve(execution.resolve(resolveRequest(plan, 0))),
		/compositing working byte bound/iu);
	execution.dispose();
});

function projectWithRepeatedImageClips(
	projectValue: FramescaperProjectV32,
	count: number,
): FramescaperProjectV32 {
	const project = structuredClone(projectValue);
	const clip = project.clips.find(({ kind }) => kind === 'image');
	const track = project.tracks.find(({ type, clipIds }) => type === 'video' && (
		clip ? clipIds.includes(String(clip.id)) : false
	));
	if (!clip || !track) throw new Error('The image resource fixture lost its timeline placement.');
	for (let index = 1; index < count; index += 1) {
		const duplicate = structuredClone(clip) as unknown as Record<string, unknown>;
		duplicate.id = `image-clip-${String(index + 1)}`;
		(project.clips as unknown as Record<string, unknown>[]).push(duplicate);
		(track.clipIds as string[]).push(String(duplicate.id));
	}
	return cloneFramescaperProjectV32(PROFILE, project);
}

function projectWithDistinctImageSources(
	projectValue: FramescaperProjectV32,
	count: number,
	mutateSource: (source: Record<string, unknown>) => void,
): FramescaperProjectV32 {
	const project = structuredClone(projectValue);
	const source = project.sources.find(({ kind }) => kind === 'image');
	const clip = project.clips.find(({ kind }) => kind === 'image');
	const track = project.tracks.find(({ type, clipIds }) => type === 'video' && (
		clip ? clipIds.includes(String(clip.id)) : false
	));
	if (!source || !clip || !track) throw new Error('The image resource fixture lost its source placement.');
	mutateSource(source as unknown as Record<string, unknown>);
	for (let index = 1; index < count; index += 1) {
		const sourceId = `image-source-${String(index + 1)}`;
		const duplicateSource = structuredClone(source) as unknown as Record<string, unknown>;
		duplicateSource.id = sourceId;
		duplicateSource.storageKey = sourceId;
		const duplicateClip = structuredClone(clip) as unknown as Record<string, unknown>;
		duplicateClip.id = `image-clip-${String(index + 1)}`;
		duplicateClip.sourceId = sourceId;
		(project.sources as unknown as Record<string, unknown>[]).push(duplicateSource);
		(project.clips as unknown as Record<string, unknown>[]).push(duplicateClip);
		(track.clipIds as string[]).push(String(duplicateClip.id));
	}
	return cloneFramescaperProjectV32(PROFILE, project);
}

function sequentialImageClips(projectValue: FramescaperProjectV32): FramescaperProjectV32 {
	const project = structuredClone(projectValue);
	let index = 0;
	for (const clip of project.clips) {
		if (clip.kind !== 'image') continue;
		(clip as unknown as Record<string, unknown>).sequenceStartFrame = index * 200;
		index += 1;
	}
	return cloneFramescaperProjectV32(PROFILE, project);
}

function exactPlan(
	project: FramescaperProjectV32,
	width = 2,
	height = 2,
): UnifiedExactRenderPlanV13 {
	return {
		version: 13,
		output: { canvas: { width, height, fit: 'stretch' } },
		nodes: project.clips.flatMap((clip) => clip.kind === 'image' ? [{
			kind: 'visual',
			modelId: clip.id,
			placement: {},
			authoredState: { source: { kind: 'generator' } },
		}] : []),
	} as unknown as UnifiedExactRenderPlanV13;
}

function resolveRequest(plan: UnifiedExactRenderPlanV13, sequenceFrame: number) {
	return {
		frame: Object.freeze({
			index: sequenceFrame,
			timelineSample: sequenceFrame,
			timelinePosition: { num: sequenceFrame, den: 1 },
			layers: Object.freeze([]),
		}),
		sequencePosition: Object.freeze({ num: sequenceFrame, den: 1 }),
		width: plan.output.canvas.width,
		height: plan.output.canvas.height,
		signal: new AbortController().signal,
	};
}

function forgedLargeFramePack(bytesValue: Uint8Array): Readonly<{
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly contentSha256: string;
}> {
	const bytes = bytesValue.slice() as Uint8Array<ArrayBuffer>;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	view.setUint32(96, 8_192, true);
	view.setUint32(100, 2_048, true);
	const indexOffset = Number(view.getBigUint64(64, true));
	const frameCount = view.getUint32(104, true);
	for (let index = 0; index < frameCount; index += 1) {
		view.setBigUint64(indexOffset + index * 128 + 32, 64n * 1024n * 1024n, true);
	}
	corruptFirstFrame(view, bytes);
	return Object.freeze({ bytes, contentSha256: bytesToHex(sha256(bytes)) });
}

function corruptFirstFramePayload(bytesValue: Uint8Array): Readonly<{
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly contentSha256: string;
}> {
	const bytes = bytesValue.slice() as Uint8Array<ArrayBuffer>;
	corruptFirstFrame(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes);
	return Object.freeze({ bytes, contentSha256: bytesToHex(sha256(bytes)) });
}

function corruptFirstFrame(view: DataView, bytes: Uint8Array): void {
	const frameDataOffset = Number(view.getBigUint64(80, true));
	bytes[frameDataOffset] = bytes[frameDataOffset]! ^ 1;
}

function imageBlob(bytes: Uint8Array): Blob {
	const owned = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return new Blob([owned]);
}
