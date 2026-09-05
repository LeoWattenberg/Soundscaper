/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * A finishing cube LUT import is a two-phase publication: a digest-addressed body
 * write followed by a history command, with the new body rolled back whenever the
 * command cannot be published. Both phases run against a recording store and a
 * real finishing project record, so refusals surface as typed errors.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-identity.ts';
import {
	VIDEO_COLOR_LIMITS_V1,
	type VideoCubeLutReferenceV1,
} from '../src/common/editor/video-color-management-v27.ts';
import {
	bindFramescaperCubeLutActionsFinishing,
	createFramescaperCubeLutActionsFinishing,
	framescaperCubeLutActionsFinishingFor,
	framescaperCubeLutActionsFor,
	type FramescaperCubeLutActionsFinishing,
} from '../src/framescaper/editor-cube-lut-actions-finishing.ts';
import { applyFramescaperOwnedFinishingCommandFinishing } from '../src/framescaper/editor-project-finishing-finishing-command.ts';

type Json = Record<string, unknown>;

interface WriteLog {
	readonly key: string;
	readonly body: Blob;
	readonly metadata: Json;
	readonly options: Json;
}

type HarnessOptions = Readonly<{
	project?: Json;
	metadata?: Json | null;
	onMetadata?: (project: Json) => void | Promise<void>;
	onWrite?: () => void;
	commit?: (command: Json, project: Json) => void;
	onDelete?: () => unknown;
}>;

interface Harness {
	readonly actions: FramescaperCubeLutActionsFinishing;
	readonly project: Json;
	readonly commits: Json[];
	readonly writes: WriteLog[];
	readonly deletes: string[];
}

const UTF8 = new TextEncoder();
const LUT_TEXT = [
	'TITLE "Fixture"', 'LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 0.0 0.0', '0.0 1.0 0.0', '1.0 1.0 0.0',
	'0.0 0.0 1.0', '1.0 0.0 1.0', '0.0 1.0 1.0', '1.0 1.0 1.0', '',
].join('\n');
const LUT_BYTES = UTF8.encode(LUT_TEXT);
const DIGEST = bytesToHex(sha256(LUT_BYTES));
const STORAGE_KEY = `lut-sha256:${DIGEST}`;

test('the actions refuse an owner without an edit commit and a store missing an asset method', () => {
	assert.throws(
		() => createFramescaperCubeLutActionsFinishing({
			owner: { project: project(), actions: { edit: {} } } as never, store: store(),
		}),
		{ name: 'TypeError', message: /requires a controller owner\./u },
	);
	assert.throws(
		() => createFramescaperCubeLutActionsFinishing({ owner: null as never, store: store() }),
		{ name: 'TypeError', message: /requires a controller owner\./u },
	);
	for (const missing of ['getMediaAssetMetadata', 'writeMediaAsset', 'deleteMediaAsset']) {
		const partial = store() as unknown as Json;
		delete partial[missing];
		assert.throws(
			() => createFramescaperCubeLutActionsFinishing({ owner: owner(), store: partial as never }),
			{ name: 'TypeError', message: /requires an exact asset store\./u },
		);
	}
});

test('binding publishes the runtime for its owner and the lookup answers null for anything unbound', () => {
	const runtime = harness().actions;
	const controller: Json = {};
	const callable = (): void => undefined;

	assert.equal(framescaperCubeLutActionsFinishingFor(controller), null);
	bindFramescaperCubeLutActionsFinishing(controller, runtime);

	assert.equal(framescaperCubeLutActionsFinishingFor(controller), runtime);
	assert.equal(framescaperCubeLutActionsFinishingFor({}), null);
	assert.equal(framescaperCubeLutActionsFinishingFor(null), null);
	assert.equal(framescaperCubeLutActionsFinishingFor('controller'), null);
	assert.equal(framescaperCubeLutActionsFor, framescaperCubeLutActionsFinishingFor);
	assert.equal(Object.isFrozen(runtime), true);
	// The lookup admits callable owners, but only a plain object may be bound to one.
	assert.equal(framescaperCubeLutActionsFinishingFor(callable), null);
	for (const rejected of [null, callable]) {
		assert.throws(
			() => bindFramescaperCubeLutActionsFinishing(rejected as never, runtime),
			{ name: 'TypeError', message: /A finishing cube LUT owner is required\./u },
		);
	}
});

test('targets lists every visual presentation before every finishing preset with its own label', () => {
	const runner = harness({ project: project({
		videoVisualPresentations: [presentation(), { ...presentation(), id: 'presentation-2' }],
	}) });

	assert.deepEqual(runner.actions.targets(), [
		{ kind: 'presentation', id: 'presentation-1', label: 'Presentation presentation-1' },
		{ kind: 'presentation', id: 'presentation-2', label: 'Presentation presentation-2' },
		{ kind: 'preset', id: 'preset-1', label: 'Preset Warm highlights' },
	]);
});

test('targets refuses a foreign project family and a collection that is not an array', () => {
	assert.throws(
		() => harness({ project: project({ schemaFamily: 'soundscaper' }) }).actions.targets(),
		{ name: 'RangeError', message: /cannot author a foreign project\./u },
	);
	assert.throws(
		() => harness({ project: project({ videoFinishingPresets: {} }) }).actions.targets(),
		{ name: 'TypeError', message: /finishing finishing presets must be an array\./u },
	);
});

test('importing into a visual presentation writes the digest body once and publishes the graded presentation', async () => {
	const runner = harness();

	const reference = await importInto(runner, { kind: 'presentation', id: 'presentation-1' });

	assert.deepEqual(reference, {
		storageKey: STORAGE_KEY, sha256: DIGEST, byteLength: LUT_BYTES.byteLength,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
	});
	assert.equal(runner.writes.length, 1);
	const write = runner.writes[0]!;
	assert.equal(write.key, STORAGE_KEY);
	assert.equal(write.body.type, 'text/plain');
	assert.equal(await write.body.text(), LUT_TEXT);
	assert.deepEqual(write.metadata, { name: 'fixture.cube', mimeType: 'text/plain', sha256: DIGEST });
	assert.deepEqual(write.options, {});
	assert.deepEqual(runner.commits, [{
		type: 'video-visual-presentation/set',
		presentationId: 'presentation-1',
		expectedPresentation: presentation(),
		presentation: { ...presentation(), grade: gradeWithLut() },
	}]);
	assert.deepEqual(runner.project.videoVisualPresentations, [
		{ ...presentation(), grade: gradeWithLut() },
	]);
	assert.deepEqual(runner.deletes, []);
});

test('importing into a finishing preset publishes the preset template carrying the LUT', async () => {
	const runner = harness();

	const reference = await importInto(runner, { kind: 'preset', id: 'preset-1' });

	assert.equal(reference.storageKey, STORAGE_KEY);
	assert.deepEqual(runner.commits, [{
		type: 'video-finishing-preset/set',
		finishingPresetId: 'preset-1',
		expectedFinishingPreset: preset(),
		finishingPreset: { ...preset(), template: { ...template(), grade: gradeWithLut() } },
	}]);
	assert.deepEqual(runner.project.videoFinishingPresets, [
		{ ...preset(), template: { ...template(), grade: gradeWithLut() } },
	]);
});

test('a target that already carries the imported LUT returns the reference without publishing a command', async () => {
	const runner = harness({
		project: project({ videoVisualPresentations: [presentation(gradeWithLut())] }),
		metadata: { size: LUT_BYTES.byteLength, sha256: DIGEST },
	});

	const reference = await importInto(runner, { kind: 'presentation', id: 'presentation-1' });

	assert.equal(reference.sha256, DIGEST);
	assert.deepEqual(runner.commits, []);
	assert.deepEqual(runner.writes, []);
});

test('an existing digest body is reused without a second write when its recorded bytes and digest match', async () => {
	const runner = harness({ metadata: { byteLength: LUT_BYTES.byteLength, sha256: DIGEST } });

	const reference = await importInto(runner, { kind: 'presentation', id: 'presentation-1' });

	assert.equal(reference.storageKey, STORAGE_KEY);
	assert.deepEqual(runner.writes, []);
	assert.equal(runner.commits.length, 1);
	assert.deepEqual(runner.deletes, []);
});

test('an existing digest body whose recorded size or digest disagrees refuses before any write', async () => {
	const wrongSize = harness({ metadata: { size: 5, sha256: DIGEST } });
	const wrongDigest = harness({ metadata: { size: LUT_BYTES.byteLength, sha256: 'a'.repeat(64) } });

	for (const runner of [wrongSize, wrongDigest]) {
		await assert.rejects(
			importInto(runner, { kind: 'presentation', id: 'presentation-1' }),
			{ name: 'Error', message: /body is corrupt or conflicting\./u },
		);
		assert.deepEqual(runner.writes, []);
		assert.deepEqual(runner.commits, []);
		assert.deepEqual(runner.deletes, []);
	}
});

test('a second import refuses while the first one is still running and is admitted once it settles', async () => {
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let gated = true;
	const runner = harness({ onMetadata: async () => {
		if (gated) await gate;
	} });

	const first = importInto(runner, { kind: 'presentation', id: 'presentation-1' });
	await assert.rejects(
		importInto(runner, { kind: 'preset', id: 'preset-1' }),
		{ name: 'Error', message: /import is already running\./u },
	);
	gated = false;
	release();
	await first;

	await importInto(runner, { kind: 'preset', id: 'preset-1' });
	assert.deepEqual(runner.commits.map((command) => command.type), [
		'video-visual-presentation/set', 'video-finishing-preset/set',
	]);
});

test('an already-aborted signal throws its own reason before the store is consulted', async () => {
	const runner = harness();
	const controller = new AbortController();
	const reason = new Error('the operator cancelled the LUT import');
	controller.abort(reason);

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, cubeFile(), controller.signal),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(runner.writes, []);
	assert.deepEqual(runner.commits, []);
});

test('a signal without a reason aborts the import as a DOMException named AbortError', async () => {
	const runner = harness();
	const controller = new AbortController();
	const promise = importInto(
		runner, { kind: 'presentation', id: 'presentation-1' }, cubeFile(), controller.signal,
	);
	controller.abort();

	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof DOMException);
		assert.equal(error.name, 'AbortError');
		return true;
	});
});

test('a cancellation observed after the metadata read refuses before the body is written', async () => {
	const controller = new AbortController();
	const runner = harness({ onMetadata: () => { controller.abort(new Error('cancelled mid-read')); } });

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, cubeFile(), controller.signal),
		{ name: 'Error', message: 'cancelled mid-read' },
	);
	assert.deepEqual(runner.writes, []);
	assert.deepEqual(runner.commits, []);
	assert.deepEqual(runner.deletes, []);
});

test('a cancellation observed after the body write rolls the new body back and forwards the signal', async () => {
	const controller = new AbortController();
	const runner = harness({ onWrite: () => { controller.abort(new Error('cancelled mid-write')); } });

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, cubeFile(), controller.signal),
		{ name: 'Error', message: 'cancelled mid-write' },
	);
	assert.deepEqual(runner.writes[0]!.options, { signal: controller.signal });
	assert.deepEqual(runner.commits, []);
	assert.deepEqual(runner.deletes, [STORAGE_KEY]);
});

test('a target changed between its snapshot and publication refuses and removes the new body', async () => {
	const runner = harness({ onMetadata: (value) => {
		(value.videoVisualPresentations as Json[])[0]!.opacity = 0.5;
	} });

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }),
		{ name: 'Error', message: /target changed before publication\./u },
	);
	assert.equal(runner.writes.length, 1);
	assert.deepEqual(runner.commits, []);
	assert.deepEqual(runner.deletes, [STORAGE_KEY]);
});

test('a commit that does not apply its command refuses the publication and removes the new body', async () => {
	const runner = harness({ commit: () => undefined });

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }),
		{ name: 'Error', message: /did not publish its exact target\./u },
	);
	assert.equal(runner.commits.length, 1);
	assert.deepEqual(runner.deletes, [STORAGE_KEY]);
});

test('a rollback that reports the body was not removed raises both failures together', async () => {
	const refusal = new Error('the finishing history refused the command');
	const runner = harness({ commit: () => { throw refusal; }, onDelete: () => false });

	const error = await importInto(runner, { kind: 'presentation', id: 'presentation-1' })
		.then(() => null, (thrown: unknown) => thrown);

	assert.ok(error instanceof AggregateError);
	assert.equal(error.message, 'Cube LUT publication and body rollback both failed.');
	assert.equal(error.cause, refusal);
	assert.equal(error.errors.length, 2);
	assert.equal(error.errors[0], refusal);
	assert.equal((error.errors[1] as Error).message, 'The new cube LUT body was not removed.');
	assert.deepEqual(runner.deletes, [STORAGE_KEY]);
});

test('a rollback whose delete throws still raises both failures together', async () => {
	const refusal = new Error('the finishing history refused the command');
	const cleanup = new Error('the asset store is offline');
	const runner = harness({ commit: () => { throw refusal; }, onDelete: () => { throw cleanup; } });

	const error = await importInto(runner, { kind: 'preset', id: 'preset-1' })
		.then(() => null, (thrown: unknown) => thrown);

	assert.ok(error instanceof AggregateError);
	assert.deepEqual(error.errors, [refusal, cleanup]);
});

test('a commit failure over a pre-existing body leaves that body in place', async () => {
	const runner = harness({
		metadata: { size: LUT_BYTES.byteLength, sha256: DIGEST },
		commit: () => { throw new Error('the finishing history refused the command'); },
	});

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }),
		{ name: 'Error', message: 'the finishing history refused the command' },
	);
	assert.deepEqual(runner.writes, []);
	assert.deepEqual(runner.deletes, []);
});

test('an unresolvable or malformed cube LUT target refuses before the store is consulted', async () => {
	const runner = harness();

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-9' }),
		{ name: 'ReferenceError', message: 'finishing visual presentation presentation-9 is unavailable.' },
	);
	await assert.rejects(
		importInto(runner, { kind: 'preset', id: 'preset-9' }),
		{ name: 'ReferenceError', message: 'finishing finishing preset preset-9 is unavailable.' },
	);
	await assert.rejects(
		importInto(runner, { kind: 'grade', id: 'presentation-1' }),
		{ name: 'RangeError', message: /target kind is unsupported\./u },
	);
	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'not a stable id' }),
		{ name: 'TypeError', message: 'cube LUT target ID is invalid.' },
	);
	assert.deepEqual(runner.writes, []);
	assert.deepEqual(runner.commits, []);
});

test('a LUT body without a safe .cube file name refuses before it is read', async () => {
	const runner = harness();
	const rejected = async (file: Blob): Promise<void> => {
		await assert.rejects(
			importInto(runner, { kind: 'presentation', id: 'presentation-1' }, file),
			{ name: 'TypeError', message: /requires a safe \.cube file name\./u },
		);
	};

	await rejected(new Blob([LUT_BYTES], { type: 'text/plain' }));
	await rejected(cubeFile(LUT_TEXT, '.cube'));
	await rejected(cubeFile(LUT_TEXT, 'fixture.cub'));
	await rejected(cubeFile(LUT_TEXT, 'fix\u0000ture.cube'));
	await rejected(cubeFile(LUT_TEXT, `${'a'.repeat(512)}.cube`));
	assert.deepEqual(runner.writes, []);
});

test('a body that is not a pathless blob or is outside the byte bound refuses before parsing', async () => {
	const runner = harness();
	const oversized = cubeFile(LUT_TEXT, 'oversized.cube');
	Object.defineProperty(oversized, 'size', { value: VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes + 1 });

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, { name: 'fixture.cube' } as never),
		{ name: 'TypeError', message: /is not a pathless file body\./u },
	);
	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, new File([], 'empty.cube')),
		{ name: 'RangeError', message: /exceeds its 16 MiB byte limit\./u },
	);
	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, oversized),
		{ name: 'RangeError', message: /exceeds its 16 MiB byte limit\./u },
	);
	assert.deepEqual(runner.writes, []);
});

test('a body that is not strict UTF-8, carries a byte-order mark, or omits LUT_3D_SIZE refuses', async () => {
	const runner = harness();
	const invalid = new File([new Uint8Array([0xff, 0xfe])], 'invalid.cube');

	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, invalid),
		(error: unknown) => {
			assert.ok(error instanceof TypeError);
			assert.match(error.message, /must be strict UTF-8\./u);
			assert.ok(error.cause instanceof Error);
			return true;
		},
	);
	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, cubeFile(`\uFEFF${LUT_TEXT}`)),
		{ name: 'TypeError', message: /without a byte-order mark\./u },
	);
	await assert.rejects(
		importInto(runner, { kind: 'presentation', id: 'presentation-1' }, cubeFile('0.0 0.0 0.0\n')),
		{ name: 'TypeError', message: /requires LUT_3D_SIZE\./u },
	);
	assert.deepEqual(runner.writes, []);
});

function harness(options: HarnessOptions = {}): Harness {
	const projectValue = options.project ?? project();
	const commits: Json[] = [];
	const writes: WriteLog[] = [];
	const deletes: string[] = [];
	const actions = createFramescaperCubeLutActionsFinishing({
		owner: {
			project: projectValue,
			actions: { edit: { commit: (command: unknown) => {
				commits.push(command as Json);
				(options.commit ?? applyCommand)(command as Json, projectValue);
			} } },
		},
		store: {
			getMediaAssetMetadata: async () => {
				await options.onMetadata?.(projectValue);
				return options.metadata ?? null;
			},
			writeMediaAsset: async (key, body, metadata, writeOptions) => {
				writes.push({ key, body, metadata: metadata as Json, options: (writeOptions ?? {}) as Json });
				options.onWrite?.();
			},
			deleteMediaAsset: async (key) => {
				deletes.push(key);
				return options.onDelete?.();
			},
		},
	});
	return { actions, project: projectValue, commits, writes, deletes };
}

function importInto(
	runner: Harness,
	target: Readonly<{ kind: string; id: string }>,
	file: Blob = cubeFile(),
	signal?: AbortSignal,
): Promise<VideoCubeLutReferenceV1> {
	return runner.actions.importCubeLut({ target: target as never, file, ...(signal ? { signal } : {}) });
}

function applyCommand(command: Json, projectValue: Json): void {
	applyFramescaperOwnedFinishingCommandFinishing(projectValue, command as never);
}

function owner(): never {
	return { project: project(), actions: { edit: { commit: () => undefined } } } as never;
}

function store(): never {
	return {
		getMediaAssetMetadata: async () => null,
		writeMediaAsset: async () => undefined,
		deleteMediaAsset: async () => undefined,
	} as never;
}

function cubeFile(text: string = LUT_TEXT, name = 'fixture.cube'): File {
	return new File([UTF8.encode(text)], name, { type: 'text/plain' });
}

function project(overrides: Json = {}): Json {
	return {
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		videoVisualPresentations: [presentation()],
		videoFinishingPresets: [preset()],
		...overrides,
	};
}

/** Field order matches the normalizers, because staleness is checked by JSON text. */
function presentation(grade: unknown = null): Json {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'clip-1' },
		enabled: true, opacity: 1, blendMode: 'normal', grade,
		processorStackId: null, maskMatteIds: [],
	};
}

function preset(grade: unknown = null): Json {
	return {
		schemaVersion: 1, kind: 'video-finishing-preset', id: 'preset-1',
		name: 'Warm highlights', template: template(grade),
	};
}

function template(grade: unknown = null): Json {
	return { enabled: true, opacity: 1, blendMode: 'normal', grade };
}

function gradeWithLut(): Json {
	return {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1,
		lut: {
			storageKey: STORAGE_KEY, sha256: DIGEST, byteLength: LUT_BYTES.byteLength,
			size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
		},
	};
}
