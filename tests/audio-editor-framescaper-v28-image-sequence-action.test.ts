/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindFramescaperNativeImageSequenceActionV28,
} from '../src/framescaper/editor-native-image-sequence-action-v28.ts';
import { applyFramescaperProjectCommandV28 } from '../src/framescaper/editor-project-v28-commands.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';

test('selected V28 imports a pathless sequence through main admission, local bodies, history, and save', async () => {
	const fixture = actionFixture();
	bindFramescaperNativeImageSequenceActionV28({
		profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		owner: fixture.controller,
		store: fixture.store,
		bridge: fixture.bridge,
		mintId: fixture.mintId,
	});
	assert.deepEqual(framescaperNativeProjectActionRuntimeFor(fixture.controller)?.surfaces, [
		'render-queue-enqueue', 'image-sequence-import',
	]);
	await framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run(
		'image-sequence-import', { frameRate: { num: 24_000, den: 1_001 } },
	);
	const source = fixture.controller.project.sources.find(({ id }) => id === 'sequence-source') as
		Readonly<Record<string, unknown>> | undefined;
	assert.equal(source?.kind, 'video');
	const imageSequence = source?.imageSequence as Readonly<Record<string, unknown>> | undefined;
	assert.equal(imageSequence?.frameCount, 1);
	assert.deepEqual(imageSequence?.frameRate, { num: 24_000, den: 1_001 });
	const projectBin = fixture.controller.project.projectBin as Readonly<{
		clips: readonly Readonly<{ id: string; sourceId: string }>[];
	}>;
	assert.equal(projectBin.clips.some(
		({ id, sourceId }: Readonly<{ id: string; sourceId: string }>) => (
			id === 'sequence-bin' && sourceId === 'sequence-source'
		),
	), true);
	assert.deepEqual([...fixture.store.rows.values()].map(({ kind }) => kind).sort(), [
		'image-sequence-inventory', 'image-sequence-source-pack',
	]);
	assert.deepEqual(fixture.events.filter((event) => !event.startsWith('write:')), [
		'begin', 'pack-commit', 'inventory-commit', 'admit',
		'commit-project', 'save-project', 'complete',
	]);
});

test('selected V28 binds image-sequence import before its controller has loaded a project', async () => {
	// The desktop controller binds its native surfaces while it is being
	// constructed, so `owner.project` is still null; requiring a project here
	// threw before the editor could mount and took packaged Framescaper down.
	const fixture = actionFixture();
	fixture.detachProject();
	bindFramescaperNativeImageSequenceActionV28({
		profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		owner: fixture.controller,
		store: fixture.store,
		bridge: fixture.bridge,
		mintId: fixture.mintId,
	});
	assert.deepEqual(framescaperNativeProjectActionRuntimeFor(fixture.controller)?.surfaces, [
		'render-queue-enqueue', 'image-sequence-import',
	]);
	await assert.rejects(() => framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run(
		'image-sequence-import', { frameRate: { num: 24_000, den: 1_001 } },
	), /Framescaper V28 project must be an object/u, 'the import itself still requires a project');
	fixture.attachProject();
	await framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run(
		'image-sequence-import', { frameRate: { num: 24_000, den: 1_001 } },
	);
	assert.equal(fixture.controller.project.sources.some(({ id }) => id === 'sequence-source'), true);
});

test('a failed V28 save undoes project state and discards only newly mirrored bodies', async () => {
	const fixture = actionFixture();
	fixture.failSave = true;
	bindFramescaperNativeImageSequenceActionV28({
		profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		owner: fixture.controller,
		store: fixture.store,
		bridge: fixture.bridge,
		mintId: fixture.mintId,
	});
	await assert.rejects(
		() => framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run(
			'image-sequence-import', { frameRate: { num: 24_000, den: 1_001 } },
		),
		/save refused/iu,
	);
	assert.equal(fixture.controller.project.sources.some(({ id }) => id === 'sequence-source'), false);
	assert.equal(fixture.store.rows.size, 0);
	assert.equal(fixture.events.includes('undo-project'), true);
	assert.equal(fixture.events.includes('discard'), true);
});

test('selected V28 refuses a missing or non-reduced user rate before desktop selection', async () => {
	for (const request of [undefined, { frameRate: { num: 48_000, den: 2_002 } }] as const) {
		const fixture = actionFixture();
		bindFramescaperNativeImageSequenceActionV28({
			profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			owner: fixture.controller,
			store: fixture.store,
			bridge: fixture.bridge,
			mintId: fixture.mintId,
		});
		await assert.rejects(
			() => framescaperNativeProjectActionRuntimeFor(fixture.controller)!.run(
				'image-sequence-import', request,
			),
			/user-selected|exact reduced rational/iu,
		);
		assert.deepEqual(fixture.events, []);
	}
});

function actionFixture() {
	const events: string[] = [];
	const project = createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, {
		id: 'image-sequence-v28-project',
	});
	let current = project;
	let prior = project;
	let failSave = false;
	const rows = new Map<string, Record<string, unknown>>();
	const bodies = new Map<'pack' | 'inventory', Uint8Array>();
	const selectedBytes = new TextEncoder().encode('png-frame');
	const transactionId = '7a'.repeat(20);
	let id = 0;
	const controller = {
		get project() { return current; },
		actions: {
			edit: {
				commit(command: unknown) {
					events.push('commit-project');
					prior = current;
					current = applyFramescaperProjectCommandV28(
						FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, current, command,
						{ now: '2026-08-24T00:00:00.000Z' },
					);
				},
				undo() { events.push('undo-project'); current = prior; },
			},
			project: {
				async save() {
					events.push('save-project');
					if (failSave) throw new Error('save refused');
				},
			},
		},
	};
	bindFramescaperNativeProjectActionRuntime(controller,
		createFramescaperNativeProjectActionSubsetRuntime(['render-queue-enqueue'], {
			'render-queue-enqueue': async () => undefined,
		}));
	const bridge = {
		capabilities: async () => capabilitySnapshot(),
		selectImageSequence: async () => ({
			selectionId: '1a'.repeat(20),
			files: [{ fileId: '2b'.repeat(20), name: 'shot.0001.png', byteLength: selectedBytes.byteLength }],
		}),
		readImageSequenceFile: async () => selectedBytes.slice(),
		releaseImageSequence: async () => true,
		writeImageSequenceImportChunk: async (request: Readonly<{
			asset: 'pack' | 'inventory'; offset: number; bytes: Uint8Array;
		}>) => {
			events.push(`write:${request.asset}`);
			const priorBytes = bodies.get(request.asset) ?? new Uint8Array();
			assert.equal(request.offset, priorBytes.byteLength);
			const next = new Uint8Array(priorBytes.byteLength + request.bytes.byteLength);
			next.set(priorBytes); next.set(request.bytes, priorBytes.byteLength);
			bodies.set(request.asset, next);
			return {};
		},
		readImageSequenceImportBody: async (request: Readonly<{
			asset: 'pack' | 'inventory'; offset: number; length: number;
		}>) => bodies.get(request.asset)!.slice(request.offset, request.offset + request.length),
		imageSequenceImport: async (request: Readonly<Record<string, unknown>>) => {
			if (request.operation === 'begin') { events.push('begin'); return { operation: 'begun', transactionId }; }
			if (request.operation === 'commit') {
				events.push(`${String(request.asset)}-commit`);
				return { operation: 'committed' };
			}
			if (request.operation === 'admit') {
				events.push('admit');
				const admission = request.admission as Readonly<Record<string, unknown>>;
				const inventory = admission.inventory as Readonly<Record<string, unknown>>;
				const pack = admission.sourcePack as Readonly<Record<string, unknown>>;
				return { operation: 'admitted', transactionId, result: {
					kind: admission.kind, admitted: true, projectId: admission.projectId,
					projectRevision: admission.projectRevision, sourceId: admission.sourceId,
					inventorySha256: inventory.sha256, sourcePackSha256: pack.sha256,
					characteristics: characteristics(),
				} };
			}
			if (request.operation === 'complete') { events.push('complete'); return { operation: 'completed', transactionId }; }
			if (request.operation === 'discard') { events.push('discard'); return { operation: 'discarded' }; }
			throw new Error(`Unexpected import operation ${String(request.operation)}.`);
		},
	};
	const store = {
		rows,
		getMediaAssetMetadata: async (key: string) => rows.get(key) ?? null,
		beginMediaAssetWrite: async (key: string, metadata: Record<string, unknown>, expected: Readonly<{
			expectedBytes: number; expectedSha256: string;
		}>) => {
			const chunks: Uint8Array[] = [];
			return {
				maximumChunkBytes: 4 * 1024 * 1024,
				write: async (bytes: Uint8Array) => { chunks.push(bytes.slice()); },
				abort: async () => undefined,
				commitOwned: async () => {
					const body = concatenate(chunks);
					assert.equal(body.byteLength, expected.expectedBytes);
					assert.equal(createHash('sha256').update(body).digest('hex'), expected.expectedSha256);
					const row = { ...metadata, sourceId: key, size: body.byteLength, sha256: expected.expectedSha256 };
					rows.set(key, row);
					return { metadata: row, discardIfCurrent: async () => rows.delete(key) };
				},
			};
		},
	};
	return {
		controller, bridge, store, events,
		mintId: () => (++id === 1 ? 'sequence-source' : 'sequence-bin'),
		detachProject() { current = null as unknown as typeof project; },
		attachProject() { current = project; },
		get failSave() { return failSave; },
		set failSave(value: boolean) { failSave = value; },
	};
}

function capabilitySnapshot() {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [{
			domain: 'operation', id: 'image-sequence-import', policyCleared: true,
			buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true,
		}],
	});
}

function characteristics() {
	return {
		backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
		hasAlpha: true, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgba',
		chromaFormat: '4:4:4', alphaMode: 'straight', alphaInterpretation: 'transparency',
		colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'full' },
	};
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}
