/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	bindFramescaperNativeImageSequenceActionNativeMedia as bindAction,
	createFramescaperNativeImageSequenceActionRuntimeNativeMedia as createRuntime,
} from '../src/framescaper/editor-native-image-sequence-action.ts';
import {
	createFramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

interface ActionRuntime {
	readonly surfaces: readonly string[];
	run(surface: string, request?: unknown): Promise<void>;
}

interface WriteRecord {
	readonly storageKey: string;
	readonly metadata: Data;
	readonly options: Readonly<{ expectedBytes: number; expectedSha256: string }>;
	readonly chunks: number[];
	readonly bytes: number[];
	readonly publicationMetadata: Data;
	aborted: boolean;
}

const RATE = Object.freeze({ num: 24, den: 1 });
const TRANSACTION = 'f'.repeat(40);
const INVENTORY_PREFIX = 'image-sequence-inventory-sha256:';
const PACK_PREFIX = 'image-sequence-pack-sha256:';
const FRAMES = Object.freeze([
	Object.freeze({ name: 'shot.0001.png', bytes: Uint8Array.of(1, 2, 3) }),
	Object.freeze({ name: 'shot.0002.png', bytes: Uint8Array.of(4, 5, 6, 7) }),
]);
const CHARACTERISTICS = Object.freeze({
	backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
	hasAlpha: false, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24',
	chromaFormat: '4:4:4', alphaMode: null, alphaInterpretation: null,
	colour: Object.freeze({
		primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
	}),
});

function capabilities(): unknown {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [{
			domain: 'operation', id: 'image-sequence-import',
			buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true,
		}],
	});
}

function project(id = 'framescaper-v20'): Data {
	return createFramescaperProjectNativeMedia(
		PROFILE, { ...framescaperV20Options(), id } as never,
	) as unknown as Data;
}

/** One in-memory stand-in for the main-owned import authority and the local body store. */
function harness() {
	const control: Data[] = [];
	const commands: unknown[] = [];
	const writes: WriteRecord[] = [];
	const discards: string[] = [];
	const bodies = new Map<string, number[]>();
	let minted = 0;

	const state = {
		selection: {
			selectionId: 'a'.repeat(40),
			files: FRAMES.map((frame, index) => ({
				fileId: String(index).padStart(40, '0'),
				name: frame.name,
				byteLength: frame.bytes.byteLength,
			})),
		} as unknown,
		mintId: (): string => `minted-${String(++minted)}`,
		metadataFor: (_storageKey: string): unknown => null,
		onMetadata: (_storageKey: string): void => undefined,
		onAdmit: (): void => undefined,
		maximumChunkBytes: 8,
		ownedPublication: true,
		bodySlice: (bytes: Uint8Array, offset: number, length: number): Uint8Array => (
			bytes.slice(offset, offset + length)
		),
		abort: async (): Promise<void> => undefined,
		commit: async (): Promise<void> => undefined,
		save: async (): Promise<void> => undefined,
		undo: async (): Promise<void> => undefined,
		project: project(),
		saves: 0,
		undos: 0,
		releases: 0,
	};

	const bridge: Data = {
		capabilities: async () => capabilities(),
		selectImageSequence: async () => state.selection,
		readImageSequenceFile: async (request: Data) => {
			const frame = FRAMES[Number(String(request.fileId))]!;
			const offset = Number(request.offset);
			return frame.bytes.slice(offset, offset + Number(request.length));
		},
		releaseImageSequence: async () => { state.releases += 1; return true; },
		imageSequenceImport: async (value: unknown) => {
			const request = value as Data;
			control.push(request);
			if (request.operation === 'begin') return { operation: 'begun', transactionId: TRANSACTION };
			if (request.operation === 'commit') return { operation: 'committed', transactionId: TRANSACTION };
			if (request.operation === 'discard') return { operation: 'discarded', transactionId: TRANSACTION };
			if (request.operation === 'complete') return { operation: 'completed', transactionId: TRANSACTION };
			if (request.operation !== 'admit') throw new Error('unexpected control operation');
			state.onAdmit();
			const admission = request.admission as Data;
			return {
				operation: 'admitted', transactionId: TRANSACTION,
				result: {
					kind: admission.kind, admitted: true,
					schemaFamily: admission.schemaFamily, schemaVersion: admission.schemaVersion,
					projectId: admission.projectId, projectRevision: admission.projectRevision,
					sourceId: admission.sourceId,
					inventorySha256: (admission.inventory as Data).sha256,
					sourcePackSha256: (admission.sourcePack as Data).sha256,
					characteristics: CHARACTERISTICS,
				},
			};
		},
		writeImageSequenceImportChunk: async (request: Data) => {
			const asset = String(request.asset);
			const target = bodies.get(asset) ?? [];
			bodies.set(asset, target);
			const bytes = request.bytes as Uint8Array;
			const offset = Number(request.offset);
			for (let index = 0; index < bytes.byteLength; index += 1) target[offset + index] = bytes[index]!;
			return { operation: 'written' };
		},
		readImageSequenceImportBody: async (request: Data) => state.bodySlice(
			Uint8Array.from(bodies.get(String(request.asset)) ?? []),
			Number(request.offset), Number(request.length),
		),
	};

	const store: Data = {
		getMediaAssetMetadata: async (storageKey: string) => {
			state.onMetadata(storageKey);
			return state.metadataFor(storageKey);
		},
		beginMediaAssetWrite: async (
			storageKey: string,
			metadata: Data,
			options: Readonly<{ expectedBytes: number; expectedSha256: string }>,
		) => {
			const record: WriteRecord = {
				storageKey, metadata, options, chunks: [], bytes: [], aborted: false,
				publicationMetadata: {
					sourceId: storageKey, kind: metadata.kind, encoding: metadata.encoding,
					mimeType: metadata.mimeType, size: options.expectedBytes, sha256: options.expectedSha256,
				},
			};
			writes.push(record);
			return {
				maximumChunkBytes: state.maximumChunkBytes,
				write: async (bytes: Uint8Array) => {
					record.chunks.push(bytes.byteLength);
					record.bytes.push(...bytes);
				},
				commitOwned: async () => (state.ownedPublication
					? {
						metadata: record.publicationMetadata,
						discardIfCurrent: async () => { discards.push(storageKey); return true; },
					}
					: { metadata: record.publicationMetadata }),
				abort: async () => { record.aborted = true; await state.abort(); },
			};
		},
	};

	const owner = {
		get project(): unknown { return state.project; },
		actions: {
			edit: {
				commit: async (command: unknown) => { commands.push(command); await state.commit(); },
				undo: async () => { state.undos += 1; await state.undo(); },
			},
			project: { save: async () => { state.saves += 1; await state.save(); } },
		},
	};

	const options = {
		profile: PROFILE, owner, store, bridge, mintId: () => state.mintId(),
	};
	const runtime = (): ActionRuntime => createRuntime(options as never) as unknown as ActionRuntime;
	const run = (target: ActionRuntime): Promise<void> => target.run(
		'image-sequence-import', { frameRate: RATE },
	);
	const operations = (): string[] => control.map((request) => String(request.operation));

	return {
		state, control, commands, writes, discards, bodies, owner, options,
		runtime, run, operations,
	};
}

test('an admitted image sequence commits its source and bin clip and settles the transaction', async () => {
	const fixture = harness();

	await fixture.run(fixture.runtime());

	assert.deepEqual(fixture.operations(), ['begin', 'commit', 'commit', 'admit', 'complete']);
	assert.equal(fixture.commands.length, 1);
	const batch = fixture.commands[0] as Readonly<{ type: string; commands: readonly Data[] }>;
	assert.equal(batch.type, 'batch');
	const [source, binClip] = batch.commands as readonly Data[];
	assert.equal(source!.type, 'video-source/professional-add');
	const admitted = source!.source as Data;
	assert.equal(admitted.id, 'minted-1');
	assert.equal((admitted.imageSequence as Data).frameCount, FRAMES.length);
	assert.equal(binClip!.type, 'project-bin/add');
	assert.deepEqual(
		{ id: (binClip!.clip as Data).id, sourceId: (binClip!.clip as Data).sourceId },
		{ id: 'minted-2', sourceId: 'minted-1' },
	);
	assert.equal(fixture.state.saves, 1);
	assert.equal(fixture.state.undos, 0);
	assert.equal(fixture.state.releases, 1);
	assert.deepEqual(fixture.discards, []);
});

test('each mirrored body is written under its digest-bound key with its immutable descriptor', async () => {
	const fixture = harness();

	await fixture.run(fixture.runtime());

	assert.equal(fixture.writes.length, 2, 'the inventory is mirrored before the source pack');
	const [inventory, pack] = fixture.writes as readonly WriteRecord[];
	assert.equal(inventory!.storageKey.startsWith(INVENTORY_PREFIX), true);
	assert.equal(pack!.storageKey.startsWith(PACK_PREFIX), true);
	assert.deepEqual(inventory!.metadata, {
		name: inventory!.storageKey, kind: 'image-sequence-inventory',
		encoding: 'framescaper-image-sequence-inventory-v1', mimeType: 'application/json',
	});
	assert.deepEqual(pack!.metadata, {
		name: pack!.storageKey, kind: 'image-sequence-source-pack',
		encoding: 'framescaper-image-sequence-source-pack-v1',
		mimeType: 'application/vnd.soundscaper.image-sequence-pack',
	});
	for (const [asset, record] of [['inventory', inventory!], ['pack', pack!]] as const) {
		assert.equal(record.options.expectedSha256, record.storageKey.split(':')[1]);
		assert.deepEqual(record.bytes, fixture.bodies.get(asset), `the mirrored ${asset} is byte-exact`);
		assert.equal(record.options.expectedBytes, record.bytes.length);
		assert.equal(record.chunks.every((length) => length <= 8 && length > 0), true);
		assert.equal(record.chunks.length, Math.ceil(record.bytes.length / 8));
	}
});

test('a body already held locally is verified against its descriptor instead of mirrored again', async () => {
	const fixture = harness();
	await fixture.run(fixture.runtime());
	const stored = new Map(fixture.writes.map((write) => [write.storageKey, write.publicationMetadata]));
	fixture.writes.length = 0;
	fixture.state.metadataFor = (storageKey) => stored.get(storageKey) ?? null;

	await fixture.run(fixture.runtime());

	assert.equal(fixture.writes.length, 0, 'an immutable body is never written twice');
	assert.equal(fixture.commands.length, 2);
	assert.equal(fixture.state.saves, 2);
	assert.deepEqual(fixture.discards, []);
});

test('a local body whose metadata contradicts the descriptor refuses the whole import', async () => {
	const fixture = harness();
	fixture.state.metadataFor = (storageKey) => (storageKey.startsWith(INVENTORY_PREFIX)
		? {
			sourceId: storageKey, kind: 'image-sequence-inventory',
			encoding: 'framescaper-image-sequence-inventory-v0', mimeType: 'application/json',
			size: 1, sha256: storageKey.slice(INVENTORY_PREFIX.length),
		}
		: null);

	await assert.rejects(
		() => fixture.run(fixture.runtime()),
		/conflicts with its immutable descriptor/u,
	);
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.writes.length, 0);
});

test('a non-record local body metadata row is refused before any body is mirrored', async () => {
	const fixture = harness();
	fixture.state.metadataFor = () => 'image-sequence-inventory';

	await assert.rejects(() => fixture.run(fixture.runtime()), TypeError);
	assert.equal(fixture.writes.length, 0);
	assert.deepEqual(fixture.commands, []);
});

test('a writer whose chunk ceiling exceeds the mirroring bound is refused without being aborted', async () => {
	const fixture = harness();
	fixture.state.maximumChunkBytes = 16 * 1024 * 1024 + 1;

	await assert.rejects(() => fixture.run(fixture.runtime()), TypeError);
	assert.equal(fixture.writes.length, 1);
	assert.equal(fixture.writes[0]!.aborted, false, 'a rejected writer is never entered');
	assert.deepEqual(fixture.commands, []);
});

test('a writer that cannot report a chunk ceiling at all is refused', async () => {
	const fixture = harness();
	fixture.state.maximumChunkBytes = 0;

	await assert.rejects(
		() => fixture.run(fixture.runtime()),
		/exact bounded owned writer/u,
	);
});

test('a publication that cannot be discarded is refused and the writer is aborted', async () => {
	const fixture = harness();
	fixture.state.ownedPublication = false;

	await assert.rejects(() => fixture.run(fixture.runtime()), TypeError);
	assert.equal(fixture.writes[0]!.aborted, true);
	assert.deepEqual(fixture.discards, []);
});

test('a short read from the committed transaction body aborts the mirror', async () => {
	const fixture = harness();
	fixture.state.bodySlice = (bytes, offset, length) => bytes.slice(offset, offset + length - 1);

	await assert.rejects(() => fixture.run(fixture.runtime()), /inexact range/u);
	assert.equal(fixture.writes.length, 1);
	assert.equal(fixture.writes[0]!.aborted, true);
	assert.deepEqual(fixture.commands, []);
});

test('a mirror failure whose abort also fails reports both causes together', async () => {
	const fixture = harness();
	fixture.state.bodySlice = (bytes, offset, length) => bytes.slice(offset, offset + length - 1);
	fixture.state.abort = async () => { throw new Error('abort failed'); };

	await assert.rejects(() => fixture.run(fixture.runtime()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /body mirror cleanup failed/u);
		assert.equal(error.errors.length, 2);
		assert.match(String((error.errors[0] as Error).message), /inexact range/u);
		assert.match(String((error.errors[1] as Error).message), /abort failed/u);
		return true;
	});
});

test('a project swapped before mirroring refuses admission without touching the body store', async () => {
	const fixture = harness();
	fixture.state.onAdmit = () => { fixture.state.project = project('framescaper-v20-other'); };

	await assert.rejects(
		() => fixture.run(fixture.runtime()),
		/project changed during image-sequence admission/u,
	);
	assert.equal(fixture.writes.length, 0);
	assert.deepEqual(fixture.commands, []);
});

test('a project swapped while bodies are mirrored discards every publication it made', async () => {
	const fixture = harness();
	fixture.state.onMetadata = (storageKey) => {
		if (storageKey.startsWith(PACK_PREFIX)) fixture.state.project = project('framescaper-v20-other');
	};

	await assert.rejects(
		() => fixture.run(fixture.runtime()),
		/project changed during image-sequence admission/u,
	);
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.state.saves, 0);
	assert.equal(fixture.state.undos, 0);
	assert.equal(fixture.discards.length, 2);
	assert.equal(fixture.discards[0]!.startsWith(PACK_PREFIX), true, 'publications unwind in reverse');
	assert.equal(fixture.discards[1]!.startsWith(INVENTORY_PREFIX), true);
});

test('a refused edit commit discards the mirrored bodies and never undoes an uncommitted edit', async () => {
	const fixture = harness();
	fixture.state.commit = async () => { throw new Error('commit refused'); };

	await assert.rejects(() => fixture.run(fixture.runtime()), /commit refused/u);
	assert.equal(fixture.state.undos, 0, 'nothing was committed, so nothing is undone');
	assert.equal(fixture.state.saves, 0);
	assert.equal(fixture.discards.length, 2);
});

test('a failed project save undoes the committed edit and discards the mirrored bodies', async () => {
	const fixture = harness();
	fixture.state.save = async () => { throw new Error('save failed'); };

	await assert.rejects(() => fixture.run(fixture.runtime()), /save failed/u);
	assert.equal(fixture.state.undos, 1);
	assert.equal(fixture.discards.length, 2);
});

test('a failed save whose undo also fails reports the rollback failure with both causes', async () => {
	const fixture = harness();
	fixture.state.save = async () => { throw new Error('save failed'); };
	fixture.state.undo = async () => { throw new Error('undo failed'); };

	await assert.rejects(() => fixture.run(fixture.runtime()), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /commit rollback failed/u);
		assert.equal(error.errors.length, 2);
		assert.match(String((error.errors[1] as Error).message), /undo failed/u);
		return true;
	});
	assert.equal(fixture.discards.length, 2, 'the bodies are still unwound after a failed undo');
});

test('a cancelled picker imports nothing and never opens a transaction', async () => {
	const fixture = harness();
	fixture.state.selection = null;

	await fixture.run(fixture.runtime());

	assert.deepEqual(fixture.operations(), []);
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.writes.length, 0);
	assert.equal(fixture.state.releases, 0);
});

test('an identity factory that mints an unusable id refuses before the picker is opened', async () => {
	const fixture = harness();
	fixture.state.mintId = () => 'minted id/one';

	await assert.rejects(() => fixture.run(fixture.runtime()), /source ID is invalid/u);
	assert.equal(fixture.state.releases, 0);
	assert.deepEqual(fixture.operations(), []);
});

test('a second import waits for the one in flight and still runs after it fails', async () => {
	const fixture = harness();
	let release = (): void => undefined;
	let reached = (): void => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const parked = new Promise<void>((resolve) => { reached = resolve; });
	let first = true;
	fixture.state.commit = async () => {
		if (!first) return;
		first = false;
		reached();
		await gate;
		throw new Error('first import failed');
	};
	const runtime = fixture.runtime();

	const failing = assert.rejects(fixture.run(runtime), /first import failed/u);
	const second = fixture.run(runtime);
	await parked;
	assert.equal(fixture.commands.length, 1, 'the queued import has not started');
	assert.deepEqual(
		fixture.operations().filter((operation) => operation === 'begin'),
		['begin'],
		'the queued import has not opened its own transaction',
	);

	release();
	await failing;
	await second;
	assert.equal(fixture.commands.length, 2);
	assert.equal(fixture.state.saves, 1);
});

test('binding refuses a controller that has no existing native action runtime', () => {
	const fixture = harness();

	assert.throws(
		() => bindAction(fixture.options as never),
		/requires its existing native action runtime/u,
	);
});

test('binding composes the import surface onto the existing runtime and refuses a second binding', async () => {
	const fixture = harness();
	let attached = 0;
	const existing = createFramescaperNativeProjectActionSubsetRuntime(
		['proxy-attach'], { 'proxy-attach': () => { attached += 1; } },
	);
	bindFramescaperNativeProjectActionRuntime(fixture.owner, existing);

	const bound = bindAction(fixture.options as never);

	assert.deepEqual(bound.surfaces, ['proxy-attach', 'image-sequence-import']);
	assert.equal(framescaperNativeProjectActionRuntimeFor(fixture.owner), bound);
	await bound.run('proxy-attach');
	assert.equal(attached, 1, 'the existing owner keeps its own surfaces');
	assert.throws(() => bindAction(fixture.options as never), /already bound/u);
});
