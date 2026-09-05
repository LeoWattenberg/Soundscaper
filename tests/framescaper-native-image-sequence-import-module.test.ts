/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type {
	NativeMediaImageSequenceInventoryReferenceV25,
	NativeMediaImageSequenceSourcePackReferenceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	composeFramescaperImageSequenceImport,
	framescaperImageSequenceProjectBinClip,
	type ComposeFramescaperImageSequenceImportOptions,
	type FramescaperImageSequenceNativeAdmissionRequest,
	type FramescaperImageSequenceImportPorts,
	type FramescaperImageSequenceSelection,
	type FramescaperSelectedImageSequenceFile,
} from '../src/framescaper/editor-native-image-sequence-import.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';

type Data = Record<string, unknown>;
type Options = ComposeFramescaperImageSequenceImportOptions;
type Request = FramescaperImageSequenceNativeAdmissionRequest;
type InventoryReference = NativeMediaImageSequenceInventoryReferenceV25;
type PackReference = NativeMediaImageSequenceSourcePackReferenceV25;

const RATE = Object.freeze({ num: 24, den: 1 });
const HEADER_BYTES = 128;
const INDEX_BYTES = 64;
const CHARACTERISTICS = Object.freeze({
	backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
	hasAlpha: false, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24',
	chromaFormat: '4:4:4', alphaMode: null, alphaInterpretation: null,
	colour: Object.freeze({
		primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
	}),
});
const FRAME_BYTES: readonly Uint8Array[] = Object.freeze([
	Uint8Array.of(11, 12, 13), Uint8Array.of(21, 22, 23, 24), Uint8Array.of(31, 32, 33, 34, 35),
]);

function project(): Data {
	return createFramescaperProject(PROFILE, {
		id: 'framescaper-image-sequence', primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { ...RATE } }],
	}) as unknown as Data;
}

function snapshot(userEnabled: boolean): unknown {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [{
			domain: 'operation', id: 'image-sequence-import',
			buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled,
		}],
	});
}

/** Each call hands out a fresh stream; composition reads a file twice. */
function slices(bytes: Uint8Array, size: number): Uint8Array[] {
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < bytes.byteLength; offset += size) {
		chunks.push(bytes.slice(offset, offset + size));
	}
	return chunks;
}

function selectedFile(name: string, bytes: Uint8Array): FramescaperSelectedImageSequenceFile {
	return { name, byteLength: bytes.byteLength, chunks: () => slices(bytes, 2) };
}

function pick(value: Data, keys: readonly string[]): Data {
	return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function admissionResponse(request: Request): Data {
	return {
		kind: request.kind, admitted: true,
		schemaFamily: request.schemaFamily, schemaVersion: request.schemaVersion,
		projectId: request.projectId, projectRevision: request.projectRevision,
		sourceId: request.sourceId, inventorySha256: request.inventory.sha256,
		sourcePackSha256: request.sourcePack.sha256, characteristics: { ...CHARACTERISTICS },
	};
}

/** One in-memory stand-in for the native helper, the pack store and the project author. */
function harness(names: readonly string[] = ['shot.0001.png', 'shot.0002.png', 'shot.0003.png']) {
	const order: string[] = [];
	const written: number[] = [];
	const packs: PackReference[] = [];
	const publications: { bytes: Uint8Array; reference: InventoryReference }[] = [];
	const cleanups: InventoryReference[] = [];
	const requests: Request[] = [];
	const completions: Request[] = [];
	const commits: { source: Data; clip: Data }[] = [];
	let capabilityCalls = 0, writers = 0, discards = 0, releases = 0;

	const state = {
		project: project(),
		files: names.map((name, index) => selectedFile(name, FRAME_BYTES[index % FRAME_BYTES.length]!)),
		usable: (_call: number): boolean => true,
		admit: (request: Request): unknown => admissionResponse(request),
		writer: (value: Data): Data => value,
		onCommit: (): void => undefined,
		onRelease: (): void => undefined,
		onDiscard: (): void => undefined,
		onCleanup: (): void => undefined,
		complete: (): void => undefined,
	};

	const select = async (): Promise<FramescaperImageSequenceSelection | null> => {
		order.push('select');
		return {
			sourceId: 'image-sequence-source', projectBinClipId: 'image-sequence-bin-clip',
			name: 'Plate', frameRate: { ...RATE }, files: state.files,
			release: () => { releases += 1; state.onRelease(); },
		};
	};

	const ports: FramescaperImageSequenceImportPorts = {
		capabilities: () => {
			capabilityCalls += 1;
			order.push('capabilities');
			return snapshot(state.usable(capabilityCalls));
		},
		createSourcePackWriter: () => {
			writers += 1;
			order.push('createSourcePackWriter');
			return state.writer({
				write: (chunk: Uint8Array) => { written.push(...chunk); },
				commit: (reference: PackReference) => { order.push('writer.commit'); packs.push(reference); },
				discard: () => { order.push('writer.discard'); discards += 1; state.onDiscard(); },
			}) as never;
		},
		publishInventory: (bytes, reference) => {
			order.push('publishInventory');
			publications.push({ bytes, reference });
		},
		cleanupInventory: (reference) => {
			order.push('cleanupInventory');
			cleanups.push(reference);
			state.onCleanup();
		},
		admit: (request) => {
			order.push('admit');
			requests.push(request);
			return state.admit(request);
		},
		complete: (request) => {
			order.push('complete');
			completions.push(request);
			state.complete();
		},
	};

	const commit: Options['commit'] = (source, clip) => {
		order.push('commit');
		commits.push({ source: source as Data, clip: clip as Data });
		state.onCommit();
	};

	const run = (overrides: Partial<Options> = {}): Promise<void> => (
		composeFramescaperImageSequenceImport({
			profile: PROFILE, project: state.project as never, select, ports, commit, ...overrides,
		})
	);

	return {
		state, order, written, packs, publications, cleanups, requests, completions, commits, ports, run,
		counts: () => ({ writers, discards, releases, capabilityCalls }),
	};
}

test('an admitted png sequence authors one source and bin clip from its packed frames', async () => {
	const fixture = harness();

	await fixture.run();

	assert.deepEqual(fixture.order, [
		'capabilities', 'select', 'createSourcePackWriter', 'writer.commit', 'publishInventory',
		'capabilities', 'admit', 'commit', 'complete',
	]);
	assert.equal(fixture.commits.length, 1);
	const { source, clip } = fixture.commits[0]!;
	const pack = fixture.packs[0]!;
	const expectedSource = {
		kind: 'video', id: 'image-sequence-source', name: 'Plate', storageKey: pack.storageKey,
		mimeType: 'image/png', contentSha256: pack.sha256, videoCodec: 'png',
		width: 1_920, height: 1_080, hasAudio: false,
		sourceFrameCount: 3, sampleFrameCount: 6_000, proxyAttachment: null,
	};
	const expectedSequence = {
		sourceType: 'image-sequence', stem: 'shot.', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 3, frameCount: 3,
	};
	assert.deepEqual(pick(source, Object.keys(expectedSource)), expectedSource);
	assert.deepEqual(pick(source.imageSequence as Data, Object.keys(expectedSequence)), expectedSequence);
	assert.deepEqual(clip, {
		kind: 'video', id: 'image-sequence-bin-clip', binItemId: 'image-sequence-bin-clip',
		sourceId: 'image-sequence-source', title: 'Plate', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 3,
		sourceInFrame: 0, sourceFrameCount: 3, retimeMap: null,
	});
	assert.deepEqual(fixture.counts(), { writers: 1, discards: 0, releases: 1, capabilityCalls: 2 });
	assert.deepEqual(fixture.cleanups, []);
});

test('the admission request names the exact project revision, decode profile and asset digests', async () => {
	const fixture = harness();

	await fixture.run();

	const request = fixture.requests[0]!;
	const inventory = fixture.publications[0]!.reference;
	const expected = {
		kind: 'framescaper-image-sequence-admission-v1', schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'framescaper-image-sequence', projectRevision: Number(fixture.state.project.revision),
		sourceId: 'image-sequence-source', profileId: 'decode-png-sequence',
		frameRate: { num: 24, den: 1 }, frameCount: 3,
	};
	assert.deepEqual(pick(request as unknown as Data, Object.keys(expected)), expected);
	assert.equal(request.inventory, inventory);
	assert.equal(request.sourcePack, fixture.packs[0]);
	assert.equal(Object.isFrozen(request), true, 'the admitted request cannot be edited after the fact');
	assert.deepEqual(fixture.completions, [request], 'settlement names the request that was admitted');
});

test('the published inventory carries the per-frame digests its storage key is bound to', async () => {
	const fixture = harness();

	await fixture.run();

	const { bytes, reference } = fixture.publications[0]!;
	assert.equal(bytesToHex(sha256(bytes)), reference.sha256);
	assert.equal(reference.storageKey, `image-sequence-inventory-sha256:${reference.sha256}`);
	assert.equal(reference.byteLength, bytes.byteLength);
	assert.deepEqual(
		{ frameCount: reference.frameCount, first: reference.firstFrameNumber, last: reference.lastFrameNumber },
		{ frameCount: 3, first: 1, last: 3 },
	);
	const inventory = JSON.parse(new TextDecoder().decode(bytes)) as Data;
	assert.equal(inventory.schemaVersion, 1);
	assert.deepEqual(inventory.entries, FRAME_BYTES.map((frame, index) => ({
		fileName: `shot.000${String(index + 1)}.png`,
		frameNumber: index + 1,
		byteLength: frame.byteLength,
		sha256: bytesToHex(sha256(frame)),
	})));
});

test('the packed payload follows numeric frame order rather than the selected order', async () => {
	const fixture = harness();
	fixture.state.files = [
		selectedFile('shot.0003.png', FRAME_BYTES[2]!),
		selectedFile('shot.0001.png', FRAME_BYTES[0]!),
		selectedFile('shot.0002.png', FRAME_BYTES[1]!),
	];

	await fixture.run();

	const payload = fixture.written.slice(HEADER_BYTES + INDEX_BYTES * 3);
	assert.deepEqual(payload, [...FRAME_BYTES[0]!, ...FRAME_BYTES[1]!, ...FRAME_BYTES[2]!]);
	assert.equal(
		fixture.written.length, HEADER_BYTES + INDEX_BYTES * 3 + 12,
		'the pack is exactly its header, its per-frame index and the twelve payload bytes',
	);
	assert.equal(fixture.packs[0]!.byteLength, fixture.written.length);
	assert.equal(bytesToHex(sha256(Uint8Array.from(fixture.written))), fixture.packs[0]!.sha256);
});

test('each supported still extension selects its own decode profile and mime type', async () => {
	for (const [extension, profileId, mimeType] of [
		['tif', 'decode-tiff-sequence', 'image/tiff'],
		['tiff', 'decode-tiff-sequence', 'image/tiff'],
		['exr', 'decode-openexr-sequence', 'image/x-exr'],
	] as const) {
		const fixture = harness([`plate.0007.${extension}`, `plate.0008.${extension}`]);

		await fixture.run();

		assert.equal(fixture.requests[0]!.profileId, profileId, extension);
		assert.equal(fixture.commits[0]!.source.mimeType, mimeType, extension);
		assert.equal((fixture.commits[0]!.source.imageSequence as Data).extension, extension);
	}
});

test('a cancelled picker imports nothing after the capability check', async () => {
	const fixture = harness();

	await fixture.run({ select: () => null });

	assert.deepEqual(fixture.order, ['capabilities']);
	assert.deepEqual(fixture.commits, []);
	assert.deepEqual(fixture.counts(), { writers: 0, discards: 0, releases: 0, capabilityCalls: 1 });
});

test('an unusable or unreadable capability report refuses the import before the picker opens', async () => {
	const fixture = harness();
	fixture.state.usable = () => false;

	await assert.rejects(() => fixture.run(), /native image-sequence import capability is unavailable/u);
	await assert.rejects(
		() => fixture.run({ ports: { ...fixture.ports, capabilities: () => ({ entries: [] }) } }),
		/native media capability snapshot/u,
	);
	assert.deepEqual(fixture.order, ['capabilities'], 'the picker never opened by either refusal');
});

test('a capability withdrawn between packing and admission rolls the whole import back', async () => {
	const fixture = harness();
	fixture.state.usable = (call) => call === 1;

	await assert.rejects(
		() => fixture.run(),
		/native image-sequence import capability is unavailable/u,
	);
	assert.deepEqual(fixture.order, [
		'capabilities', 'select', 'createSourcePackWriter', 'writer.commit', 'publishInventory',
		'capabilities', 'cleanupInventory', 'writer.discard',
	]);
	assert.deepEqual(fixture.cleanups, [fixture.publications[0]!.reference]);
	assert.deepEqual(fixture.commits, []);
	assert.equal(fixture.counts().releases, 1, 'the picker hold is released after a failed import');
});

test('an admission that does not answer the exact request identity is refused and rolled back', async () => {
	for (const mutation of [
		{ admitted: false }, { sourcePackSha256: 'a'.repeat(64) }, { inventorySha256: 'b'.repeat(64) },
		{ projectRevision: 99 }, { sourceId: 'other-source' },
	]) {
		const fixture = harness();
		fixture.state.admit = (request) => ({ ...admissionResponse(request), ...mutation });

		await assert.rejects(() => fixture.run(), /wrong project or asset identity/u);
		assert.equal(fixture.cleanups.length, 1);
		assert.equal(fixture.counts().discards, 1);
		assert.deepEqual(fixture.commits, []);
	}
});

test('an admission result carrying an unexpected field is refused as an inexact record', async () => {
	const fixture = harness();
	fixture.state.admit = (request) => ({ ...admissionResponse(request), transactionId: 'f'.repeat(40) });

	await assert.rejects(() => fixture.run(), TypeError);
	assert.equal(fixture.counts().discards, 1);
});

test('an admission reporting no coded dimensions is refused', async () => {
	const fixture = harness();
	fixture.state.admit = (request) => ({
		...admissionResponse(request),
		characteristics: { ...CHARACTERISTICS, codedWidth: null, codedHeight: null },
	});

	await assert.rejects(() => fixture.run(), /must report exact coded dimensions/u);
	assert.deepEqual(fixture.commits, []);
});

test('a rollback whose cleanup and discard also fail reports every failure together', async () => {
	const fixture = harness();
	fixture.state.onCommit = () => { throw new Error('project commit refused'); };
	fixture.state.onCleanup = () => { throw new Error('inventory cleanup refused'); };
	fixture.state.onDiscard = () => { throw new Error('pack discard refused'); };

	await assert.rejects(() => fixture.run(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /Image-sequence import and rollback failed/u);
		assert.deepEqual(error.errors.map((entry) => String((entry as Error).message)), [
			'project commit refused', 'inventory cleanup refused', 'pack discard refused',
		]);
		assert.match(String((error.cause as Error).message), /project commit refused/u);
		return true;
	});
	assert.equal(fixture.counts().releases, 1);
});

test('a failing or absent completion port never fails an already committed import', async () => {
	const fixture = harness();
	fixture.state.complete = () => { throw new Error('settlement lost'); };
	const { complete: _complete, ...ports } = fixture.ports;

	await fixture.run();
	await fixture.run({ ports });

	assert.equal(fixture.commits.length, 2);
	assert.equal(fixture.completions.length, 1, 'only the settled import reported a completion');
	assert.deepEqual(fixture.cleanups, [], 'a settled project commit is never rolled back');
	assert.equal(fixture.counts().discards, 0);
});

test('a release failure after a successful import surfaces to the caller', async () => {
	const fixture = harness();
	fixture.state.onRelease = () => { throw new Error('selection release refused'); };

	await assert.rejects(() => fixture.run(), /selection release refused/u);
	assert.equal(fixture.commits.length, 1, 'the project was already authored');
});

test('a failed import whose release also fails reports both the failure and the release error', async () => {
	const fixture = harness();
	fixture.state.onCommit = () => { throw new Error('project commit refused'); };
	fixture.state.onRelease = () => { throw new Error('selection release refused'); };

	await assert.rejects(() => fixture.run(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /selection release failed/u);
		assert.deepEqual(error.errors.map((entry) => String((entry as Error).message)), [
			'project commit refused', 'selection release refused',
		]);
		assert.match(String((error.cause as Error).message), /selection release refused/u);
		return true;
	});
});

test('a mixed selection is refused by the sequence resolver before a writer is created', async () => {
	const fixture = harness(['shot.0001.png', 'other.0002.png']);

	await assert.rejects(() => fixture.run(), /exactly one sequence/u);
	assert.deepEqual(fixture.counts(), { writers: 0, discards: 0, releases: 1, capabilityCalls: 1 });
});

test('a file stream that disagrees with its declared length or bytes is refused before packing', async () => {
	const fixture = harness();

	for (const [chunks, expected] of [
		[(): unknown => 3, /stream is not iterable/u],
		[() => [Uint8Array.of(1, 2, 3, 4)], /exceeds its declared length/u],
		[() => [Uint8Array.of(1, 2)], /short byte stream/u],
		[() => [new Uint8Array(0), Uint8Array.of(1, 2, 3)], /chunk is empty, oversized, or not bytes/u],
		[() => ['not bytes'], /chunk is empty, oversized, or not bytes/u],
	] as const) {
		fixture.state.files = [{ name: 'shot.0001.png', byteLength: 3, chunks } as never];
		await assert.rejects(() => fixture.run(), expected);
	}
	assert.deepEqual(fixture.counts(), { writers: 0, discards: 0, releases: 5, capabilityCalls: 5 });
});

test('a selection carrying an unexpected field is refused without releasing the picker hold', async () => {
	const fixture = harness();
	const selected = {
		sourceId: 'image-sequence-source', projectBinClipId: 'bin', name: 'Plate',
		frameRate: { ...RATE }, files: fixture.state.files, release: () => undefined,
		directoryPath: '/tmp/plates',
	};

	await assert.rejects(
		() => fixture.run({ select: () => selected as never }),
		/exact pathless record/u,
	);
	assert.equal(fixture.counts().releases, 0);
});

test('a selection with an unusable file list, release capability or identifier is refused', async () => {
	const fixture = harness();
	const base = {
		sourceId: 'image-sequence-source', projectBinClipId: 'bin', name: 'Plate',
		frameRate: { ...RATE }, files: fixture.state.files, release: () => undefined,
	};
	const padded = [...fixture.state.files] as unknown as Data;
	padded.directory = '/tmp/plates';

	for (const [selected, expected] of [
		[{ ...base, files: [] }, /bounded dense file list/u],
		[{ ...base, files: padded }, /bounded dense file list/u],
		[{ ...base, files: {} }, /bounded dense file list/u],
		[{ ...base, release: null }, /explicit release capability/u],
		[{ ...base, sourceId: '../escape' }, /Candidate source ID is invalid/u],
		[{ ...base, projectBinClipId: '' }, /Candidate Project Bin clip ID is invalid/u],
		[{ ...base, name: 'Plate\u0000' }, /Candidate source name is invalid/u],
	] as const) {
		await assert.rejects(() => fixture.run({ select: () => selected as never }), expected);
	}
	assert.equal(fixture.counts().writers, 0);
});

test('a selected file that names a path, an empty body or no stream factory is refused', async () => {
	const fixture = harness();

	for (const [file, expected] of [
		[{ name: 'plates/shot.0001.png', byteLength: 3, chunks: () => [] }, /pathless bounded name/u],
		[{ name: '', byteLength: 3, chunks: () => [] }, /pathless bounded name/u],
		[{ name: 'shot.0001.png', byteLength: 0, chunks: () => [] }, /bounded length and byte-stream/u],
		[{ name: 'shot.0001.png', byteLength: 3, chunks: null }, /bounded length and byte-stream/u],
		[{ name: 'shot.0001.png', byteLength: 3, chunks: () => [], extra: 1 }, /exact pathless record/u],
	] as const) {
		fixture.state.files = [file as never];
		await assert.rejects(() => fixture.run(), expected);
	}
	assert.equal(fixture.counts().writers, 0);
});

test('composition refuses ports that cannot admit, clean up, complete, select or commit', async () => {
	const fixture = harness();

	for (const [overrides, expected] of [
		[{ ports: { ...fixture.ports, admit: undefined } }, /requires port admit/u],
		[{ ports: { ...fixture.ports, cleanupInventory: 'later' } }, /requires port cleanupInventory/u],
		[{ ports: { ...fixture.ports, capabilities: null } }, /requires port capabilities/u],
		[{ ports: { ...fixture.ports, complete: {} } }, /valid optional completion port/u],
		[{ select: null }, /selection and commit ports/u],
		[{ commit: null }, /selection and commit ports/u],
	] as const) {
		await assert.rejects(() => fixture.run(overrides as never), expected);
	}
	assert.deepEqual(fixture.order, [], 'no port is consulted once the contract is refused');
});

test('a source-pack writer without a discard capability is refused before any body is packed', async () => {
	const fixture = harness();
	fixture.state.writer = (value) => { const { discard: _discard, ...rest } = value; return rest; };

	await assert.rejects(() => fixture.run(), /source-pack writer requires discard/u);
	assert.deepEqual(fixture.order, ['capabilities', 'select', 'createSourcePackWriter']);
	assert.equal(fixture.counts().releases, 1);
});

test('composition refuses a foreign runtime profile and a foreign project domain', async () => {
	const fixture = harness();

	await assert.rejects(() => fixture.run({ profile: { ...PROFILE } }), TypeError);
	await assert.rejects(
		() => fixture.run({ project: { ...fixture.state.project, schemaFamily: 'soundscaper' } as never }),
		RangeError,
	);
	assert.deepEqual(fixture.order, []);
});

test('the bin clip refuses a project that cannot name its primary sequence', () => {
	assert.throws(
		() => framescaperImageSequenceProjectBinClip(
			{ sequences: [], primarySequenceId: 'main-sequence', sampleRate: 48_000 } as never,
			'bin-clip',
			{ id: 'source', name: 'Plate', frameCount: 4, frameRate: { ...RATE } } as never,
		),
		/requires its primary sequence timing authority/u,
	);
});
