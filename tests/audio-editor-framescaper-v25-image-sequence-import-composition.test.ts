/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { validateNativeMediaImageSequenceInventoryBytesV25 } from '../src/common/editor/native-media-image-sequence-v25.ts';
import { framescaperNativeProjectActionRuntimeFor } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	bindFramescaperNativeCandidateProjectActions,
	type FramescaperNativeCandidateActionOptions,
} from '../src/framescaper/editor-native-candidate-project-actions.ts';
import type {
	FramescaperImageSequenceNativeAdmissionRequestV25,
	FramescaperImageSequenceSelectionV25,
} from '../src/framescaper/editor-native-image-sequence-import-v25.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { createFramescaperProjectStoreV25 } from '../src/framescaper/editor-project-store-v25.ts';
import { createFramescaperProjectV25, type FramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const POLICY_ROWS = [
	'codec-native-ffmpeg-current-set',
	'codec-decode-png-image-sequence',
	'codec-decode-tiff-image-sequence',
	'codec-decode-openexr-image-sequence',
] as const;
const PROFILE = FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
let fixtureIndex = 0;

test('the menu-owned dormant V25 action imports selected files through assets, native admission, and one CAS mutation', async () => {
	const fixture = await actionFixture();
	const files = [file('shot_003.png', 'third'), file('shot_001.png', 'first'), file('shot_002.png', 'second')];
	fixture.select = () => ({
		sourceId: 'sequence-source', projectBinClipId: 'sequence-bin', name: 'Sequence',
		frameRate: { num: 24_000, den: 1_001 }, files,
	});
	const binding = await fixture.bind();
	await framescaperNativeProjectActionRuntimeFor(fixture.owner)!.run('image-sequence-import');

	const saved = await fixture.store.projectRepository.load(fixture.project.id) as FramescaperProjectV25;
	const source = videoSource(saved, 'sequence-source');
	const sequence = source.imageSequence as Readonly<Record<string, unknown>>;
	assert.equal(saved.revision, Number(fixture.project.revision) + 1);
	assert.equal(source.storageKey, (sequence.sourcePack as Readonly<Record<string, unknown>>).storageKey);
	assert.equal(source.contentSha256, (sequence.sourcePack as Readonly<Record<string, unknown>>).sha256);
	assert.equal(sequence.frameCount, 3);
	assert.equal(Object.hasOwn(sequence, 'frames'), false);
	const projectBin = saved.projectBin as Readonly<{
		readonly clips: readonly Readonly<Record<string, unknown>>[];
	}>;
	const binClip = projectBin.clips
		.find(({ id }) => id === 'sequence-bin');
	assert.deepEqual(binClip && {
		id: binClip.id, binItemId: binClip.binItemId, sourceId: binClip.sourceId,
		sequenceFrameCount: binClip.sequenceFrameCount, sourceFrameCount: binClip.sourceFrameCount,
	}, {
		id: 'sequence-bin', binItemId: 'sequence-bin', sourceId: 'sequence-source',
		sequenceFrameCount: 3, sourceFrameCount: 3,
	});
	assert.equal(binding.project().revision, saved.revision);
	assert.deepEqual(validateNativeMediaImageSequenceInventoryBytesV25(
		sequence.inventory, fixture.inventoryBytes!,
	).map(({ fileName }) => fileName), ['shot_001.png', 'shot_002.png', 'shot_003.png']);
	assert.equal(JSON.stringify(fixture.admissionRequest).includes('/'), false, 'no selected path crosses admission');
	assert.equal(JSON.stringify(saved).includes('/private/'), false, 'no selected path reaches project JSON');
	assert.deepEqual(fixture.events.filter((event) => !event.startsWith('pack-write:')), [
		'capabilities', 'select', 'pack-commit', 'inventory-publish',
		'capabilities', 'native-admit',
	]);
});

test('numeric gaps and duplicates fail before asset publication, native admission, or project mutation', async () => {
	for (const [files, pattern] of [
		[[file('shot_001.png', 'one'), file('shot_003.png', 'three')], /missing/u],
		[[file('shot_001.png', 'one'), file('shot_001.png', 'other')], /same frame number|duplicate/u],
	] as const) {
		const fixture = await actionFixture();
		fixture.select = () => ({
			sourceId: 'sequence-source', projectBinClipId: 'sequence-bin', name: 'Sequence',
			frameRate: { num: 24, den: 1 }, files,
		});
		const binding = await fixture.bind();
		await assert.rejects(() => binding.runtime.run('image-sequence-import'), pattern);
		assert.deepEqual(fixture.events, ['capabilities', 'select']);
		assert.equal((await fixture.store.projectRepository.load(fixture.project.id))?.revision,
			fixture.project.revision);
	}
});

test('runtime capability is rechecked before native admission and a stale or forged result rolls assets back', async () => {
	const fixture = await actionFixture();
	fixture.select = () => ({
		sourceId: 'sequence-source', projectBinClipId: 'sequence-bin', name: 'Sequence',
		frameRate: { num: 25, den: 1 }, files: [file('shot_001.png', 'one')],
	});
	fixture.admit = (request) => ({
		...admission(request), sourcePackSha256: 'ff'.repeat(32),
	});
	const binding = await fixture.bind();
	await assert.rejects(() => binding.runtime.run('image-sequence-import'), /admission.*identity|source.pack/iu);
	assert.deepEqual(fixture.events.filter((event) => !event.startsWith('pack-write:')), [
		'capabilities', 'select', 'pack-commit', 'inventory-publish',
		'capabilities', 'native-admit', 'inventory-cleanup', 'pack-discard',
	]);
	assert.equal((await fixture.store.projectRepository.load(fixture.project.id))?.revision,
		fixture.project.revision);

	const blocked = await actionFixture(false);
	let selected = false;
	blocked.select = () => { selected = true; return null; };
	const blockedBinding = await blocked.bind();
	await assert.rejects(() => blockedBinding.runtime.run('image-sequence-import'), /capability.*unavailable/iu);
	assert.equal(selected, false);
	assert.deepEqual(blocked.events, ['capabilities']);

	const changed = await actionFixture();
	changed.select = () => ({
		sourceId: 'sequence-source', projectBinClipId: 'sequence-bin', name: 'Sequence',
		frameRate: { num: 25, den: 1 }, files: [file('shot_001.png', 'one')],
	});
	const changedOptions = changed.options();
	if (typeof changedOptions.imageSequence === 'function') throw new Error('Expected direct image-sequence ports.');
	let checks = 0;
	const changedBinding = await bindFramescaperNativeCandidateProjectActions({
		...changedOptions,
		imageSequence: {
			...changedOptions.imageSequence,
			capabilities: () => {
				changed.events.push('capabilities');
				return capabilitySnapshot((checks += 1) === 1);
			},
		},
	});
	await assert.rejects(
		() => changedBinding.runtime.run('image-sequence-import'),
		/capability.*unavailable/iu,
	);
	assert.equal(changed.events.includes('native-admit'), false);
	assert.deepEqual(changed.events.filter((event) => !event.startsWith('pack-write:')), [
		'capabilities', 'select', 'pack-commit', 'inventory-publish',
		'capabilities', 'inventory-cleanup', 'pack-discard',
	]);
});

test('selected V20 cannot compose the dormant image-sequence action or reach its picker', async () => {
	const fixture = await actionFixture();
	let selected = false;
	fixture.select = () => { selected = true; return null; };
	await assert.rejects(() => bindFramescaperNativeCandidateProjectActions({
		...fixture.options(), profile: FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
	}), /only.*dormant V25\/V26/iu);
	assert.equal(selected, false);
});

async function actionFixture(usable = true) {
	const store = createFramescaperProjectStoreV25(PROFILE, { indexedDB: null });
	const project = createFramescaperProjectV25(PROFILE, {
		...framescaperV20Options(),
		id: `image-sequence-${usable ? 'usable' : 'blocked'}-${String(fixtureIndex += 1)}`,
		videoTransitionsByTrackId: { 'video-track': [] },
	});
	await store.projectRepository.createIfAbsent!(project);
	const owner = Object.freeze({ candidate: 25, usable });
	const events: string[] = [];
	let inventoryBytes: Uint8Array | null = null;
	let admissionRequest: FramescaperImageSequenceNativeAdmissionRequestV25 | null = null;
	let select: () => FramescaperImageSequenceSelectionV25 | null = () => null;
	let admit = (request: FramescaperImageSequenceNativeAdmissionRequestV25): unknown => admission(request);
	const options = (): FramescaperNativeCandidateActionOptions => ({
		owner, profile: PROFILE, store, projectId: project.id,
		intents: {
			imageSequenceImport: () => { events.push('select'); return select(); },
			renderQueueEnqueue: () => null, proxyGenerate: () => null,
			proxyAttach: () => null, proxyDetach: () => null, proxyRelink: () => null,
		},
		imageSequence: {
			capabilities: () => {
				events.push('capabilities');
				return capabilitySnapshot(usable);
			},
			clearedPolicyRowIds: () => POLICY_ROWS,
			createSourcePackWriter: () => ({
				write: (chunk: Uint8Array) => { events.push(`pack-write:${String(chunk.byteLength)}`); },
				commit: () => { events.push('pack-commit'); },
				discard: () => { events.push('pack-discard'); },
			}),
			publishInventory: (bytes: Uint8Array) => {
				events.push('inventory-publish'); inventoryBytes = bytes.slice();
			},
			cleanupInventory: () => { events.push('inventory-cleanup'); },
			admit: (request: FramescaperImageSequenceNativeAdmissionRequestV25) => {
				events.push('native-admit'); admissionRequest = structuredClone(request);
				return admit(request);
			},
		},
		nativeServices: { enqueue: async () => ({}) },
		proxy: {
			enqueueProxy: () => 'proxy-job', reattestAttachment: () => true,
			cleanupBody: () => undefined,
		},
		now: () => '2026-08-22T18:00:00.000Z',
	});
	return {
		store, project, owner, events, options,
		bind: () => bindFramescaperNativeCandidateProjectActions(options()),
		get inventoryBytes() { return inventoryBytes; },
		get admissionRequest() { return admissionRequest; },
		set select(value: () => FramescaperImageSequenceSelectionV25 | null) { select = value; },
		set admit(value: typeof admit) { admit = value; },
	};
}

function file(name: string, content: string) {
	const bytes = new TextEncoder().encode(content);
	return Object.freeze({
		name, byteLength: bytes.byteLength,
		chunks: () => Object.freeze([bytes.slice()]),
	});
}

function capabilitySnapshot(usable: boolean) {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: usable,
		entries: [{
			domain: 'operation', id: 'image-sequence-import', policyCleared: true,
			buildSupported: true, probeSucceeded: true, selfTestPassed: true,
			userEnabled: usable,
		}],
	});
}

function admission(request: FramescaperImageSequenceNativeAdmissionRequestV25) {
	return Object.freeze({
		kind: 'framescaper-image-sequence-admission-v1', admitted: true,
		projectId: request.projectId, projectRevision: request.projectRevision,
		sourceId: request.sourceId, inventorySha256: request.inventory.sha256,
		sourcePackSha256: request.sourcePack.sha256, characteristics: characteristics(),
	});
}

function characteristics() {
	return normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
		hasAlpha: true, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgba',
		chromaFormat: '4:4:4', alphaMode: 'straight', alphaInterpretation: 'transparency',
		colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'full' },
	});
}

function videoSource(project: FramescaperProjectV25, id: string): Readonly<Record<string, unknown>> {
	const source = project.sources.find((candidate) => candidate.id === id);
	if (!source || source.kind !== 'video') throw new Error(`Missing video source ${id}.`);
	return source;
}
