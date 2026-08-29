/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import { preProcessFile } from 'typescript';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	admitAudioEditorProjectValidationStructure,
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	resolveAudioEditorProjectValidationLimits,
} from '../src/common/editor/project-validation-budget.ts';

const NOW = '2026-07-30T12:00:00.000Z';
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const VALIDATOR_ENTRY = resolve(
	REPOSITORY_ROOT,
	'src/common/editor/project-hierarchy-document-validation.ts',
);

type MutableProject = Record<string, unknown>;
type ProjectMutation = (project: MutableProject) => void;

function populatedProject(): AudioEditorProjectCurrent {
	const source = createAudioSource({
		id: 'source-1', name: 'Source 1', storageKey: 'source-1',
		frameCount: 96_000, channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip-1', sourceId: source.id, title: 'Clip 1',
		durationFrames: 48_000, sourceDurationFrames: 48_000,
	});
	const track = createAudioTrack({
		id: 'track-1', name: 'Track 1', clipIds: [clip.id],
		effects: [{
			id: 'effect-1', type: 'highpass', enabled: true,
			params: { frequency: 120, q: 1 },
		}],
	});
	return createCurrentAudioEditorProject({
		id: 'project-1', title: 'Validator fixture', now: NOW,
		sources: [source], clips: [clip], tracks: [track],
	});
}

function mutableClone(project: AudioEditorProjectCurrent): MutableProject {
	return structuredClone(project) as unknown as MutableProject;
}

function record(value: unknown, name: string): MutableProject {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} fixture must be an object`);
	return value as MutableProject;
}

function array(value: unknown, name: string): unknown[] {
	assert.ok(Array.isArray(value), `${name} fixture must be an array`);
	return value;
}

function firstRecord(value: unknown, name: string): MutableProject {
	const first = array(value, name)[0];
	assert.notEqual(first, undefined, `${name} fixture must not be empty`);
	return record(first, `${name}[0]`);
}

const invalidMutations: readonly Readonly<{
	name: string;
	mutate: ProjectMutation;
}>[] = [
	{ name: 'created timestamp', mutate: (project) => { project.createdAt = 'tomorrow'; } },
	{ name: 'updated timestamp', mutate: (project) => { project.updatedAt = '2026-07-30 12:00:00'; } },
	{
		name: 'source',
		mutate: (project) => { firstRecord(project.sources, 'sources').sampleFormat = 'uint8'; },
	},
	{
		name: 'clip',
		mutate: (project) => { firstRecord(project.clips, 'clips').sourceId = 'missing-source'; },
	},
	{
		name: 'track',
		mutate: (project) => { firstRecord(project.tracks, 'tracks').height = 39; },
	},
	{
		name: 'effects',
		mutate: (project) => {
			const track = firstRecord(project.tracks, 'tracks');
			firstRecord(track.effects, 'track.effects').enabled = 'true';
		},
	},
	{
		name: 'tempo',
		mutate: (project) => {
			record(record(project.tempo, 'tempo').timeSignature, 'tempo.timeSignature').denominator = 3;
		},
	},
	{
		name: 'selection',
		mutate: (project) => { record(project.selection, 'selection').trackIds = ['missing-track']; },
	},
	{
		name: 'loop',
		mutate: (project) => {
			const loop = record(project.loop, 'loop');
			loop.enabled = true;
			loop.startFrame = 100;
			loop.endFrame = 100;
		},
	},
	{
		name: 'view',
		mutate: (project) => { record(project.view, 'view').pixelsPerSecond = 0; },
	},
	{
		name: 'master',
		mutate: (project) => { record(project.master, 'master').gain = 5; },
	},
	{
		name: 'mixer',
		mutate: (project) => {
			record(project.mixer, 'mixer').routes = {
				'missing-track': { groupId: null, sends: {} },
			};
		},
	},
];

test('strict current validation accepts generated exact documents without mutation', () => {
	for (const project of [
		createCurrentAudioEditorProject({ id: 'empty-project', now: NOW }),
		populatedProject(),
	]) {
		const original = structuredClone(project);
		assert.equal(validateCurrentAudioEditorProject(project), true);
		assert.deepEqual(project, original);

		const jsonRoundTrip = JSON.parse(JSON.stringify(project)) as unknown;
		const roundTripOriginal = structuredClone(jsonRoundTrip);
		assert.equal(validateCurrentAudioEditorProject(jsonRoundTrip), true);
		assert.deepEqual(jsonRoundTrip, roundTripOriginal);
	}
});

test('strict current validation rejects deterministic deep domain mutations', () => {
	const valid = populatedProject();
	for (const { name, mutate } of invalidMutations) {
		const invalid = mutableClone(valid);
		mutate(invalid);
		assert.throws(
			() => validateCurrentAudioEditorProject(invalid),
			`${name} mutation must fail strict validation`,
		);
	}
});

test('neutral validation budgets are lower-only and hard bounded', () => {
	assert.deepEqual(AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS, {
		maximumTraversalNodes: 100_000,
		maximumTraversalDepth: 128,
	});
	assert.equal(Object.isFrozen(AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS), true);
	const lowered = resolveAudioEditorProjectValidationLimits({
		maximumTraversalNodes: 80,
		maximumTraversalDepth: 4,
	});
	assert.deepEqual(lowered, { maximumTraversalNodes: 80, maximumTraversalDepth: 4 });
	assert.equal(Object.isFrozen(lowered), true);
	for (const limits of [
		null,
		[],
		'maximumTraversalNodes',
		{ maximumTraversalNodes: 0 },
		{ maximumTraversalDepth: 1.5 },
		{ maximumTraversalNodes: 100_001 },
		{ maximumTraversalDepth: 129 },
		{ unsupportedLimit: 1 },
	]) {
		assert.throws(
			() => resolveAudioEditorProjectValidationLimits(limits),
			(error: unknown) => error instanceof TypeError || error instanceof RangeError,
		);
	}
});

test('current validation admits inert structure before semantic traversal', () => {
	const wide = mutableClone(createCurrentAudioEditorProject({ id: 'wide-project', now: NOW }));
	record(record(wide.view, 'view').panelState, 'view.panelState').items = Array.from(
		{ length: 16 },
		(_, index) => index,
	);
	record(wide.tempo, 'tempo').bpm = 0;
	assert.throws(
		() => validateCurrentAudioEditorProject(wide, {
			limits: { maximumTraversalNodes: 80 },
		}),
		/validation.*structural.*node limit/iu,
	);

	const deep = mutableClone(createCurrentAudioEditorProject({ id: 'deep-project', now: NOW }));
	let nested: MutableProject = {};
	for (let depth = 0; depth < 6; depth += 1) nested = { nested };
	record(deep.view, 'view').panelState = nested;
	assert.throws(
		() => validateCurrentAudioEditorProject(deep, {
			limits: { maximumTraversalDepth: 4 },
		}),
		/validation.*structural.*depth limit/iu,
	);

	const cyclic = mutableClone(createCurrentAudioEditorProject({ id: 'cyclic-project', now: NOW }));
	const panelState = record(record(cyclic.view, 'view').panelState, 'view.panelState');
	panelState.self = panelState;
	assert.throws(() => validateCurrentAudioEditorProject(cyclic), /cyclic.*project/iu);

	const hidden = mutableClone(createCurrentAudioEditorProject({ id: 'hidden-project', now: NOW }));
	Object.defineProperty(record(hidden.metadata, 'metadata'), 'tags', {
		configurable: true,
		enumerable: false,
		value: { hidden: 'value' },
	});
	assert.throws(() => validateCurrentAudioEditorProject(hidden), /enumerable.*data propert/iu);

	const accessor = mutableClone(createCurrentAudioEditorProject({ id: 'accessor-project', now: NOW }));
	let activations = 0;
	Object.defineProperty(accessor, 'title', {
		configurable: true,
		get() {
			activations += 1;
			return 'Accessor project';
		},
	});
	assert.throws(() => validateCurrentAudioEditorProject(accessor), /enumerable.*data propert/iu);
	assert.equal(activations, 0);

	const arrayShadow = mutableClone(createCurrentAudioEditorProject({ id: 'array-shadow', now: NOW }));
	let arrayActivations = 0;
	const selectedTrackIds = array(
		record(arrayShadow.selection, 'selection').trackIds,
		'selection.trackIds',
	);
	selectedTrackIds.map = () => {
		arrayActivations += 1;
		return [];
	};
	assert.throws(() => validateCurrentAudioEditorProject(arrayShadow), /arrays cannot carry named/iu);
	assert.equal(arrayActivations, 0);

	const executable = mutableClone(createCurrentAudioEditorProject({ id: 'executable', now: NOW }));
	record(record(executable.view, 'view').panelState, 'view.panelState').callback = () => undefined;
	assert.throws(() => validateCurrentAudioEditorProject(executable), /JSON-serializable scalar/iu);
});

test('structural admission rejects forged binary intrinsic brands', () => {
	for (const [name, value] of [
		['Uint8Array', Object.create(Uint8Array.prototype)],
		['ArrayBuffer', Object.create(ArrayBuffer.prototype)],
	] as const) {
		assert.throws(
			() => admitAudioEditorProjectValidationStructure(
				{ opaque: value },
				AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
			),
			/invalid.*binary|binary.*invalid|supported binary/iu,
			`${name} prototype impostor must not pass structural admission`,
		);
	}
});

test('structural admission requires ordinary closed binary authority', () => {
	assert.doesNotThrow(() => admitAudioEditorProjectValidationStructure(
		{ bytes: new Uint8Array([1, 2]), buffer: new ArrayBuffer(2) },
		AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
	));

	const customUint8Array = new Uint8Array(1);
	Object.setPrototypeOf(customUint8Array, Object.create(Uint8Array.prototype));
	const customArrayBuffer = new ArrayBuffer(1);
	Object.setPrototypeOf(customArrayBuffer, Object.create(ArrayBuffer.prototype));
	for (const value of [customUint8Array, customArrayBuffer]) {
		assert.throws(
			() => admitAudioEditorProjectValidationStructure(
				{ opaque: value },
				AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
			),
			/ordinary.*binary prototype|custom prototype/iu,
		);
	}
	assert.throws(
		() => admitAudioEditorProjectValidationStructure(
			{ opaque: new Uint8Array(new SharedArrayBuffer(1)) },
			AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
		),
		/ordinary ArrayBuffer/iu,
	);

	const authoredBytes = new Uint8Array([1]);
	Object.defineProperty(authoredBytes, 'authored', {
		value: true,
		enumerable: true,
		configurable: true,
		writable: true,
	});
	const authoredBuffer = new ArrayBuffer(1);
	Object.defineProperty(authoredBuffer, 'authored', {
		value: true,
		enumerable: true,
		configurable: true,
		writable: true,
	});
	for (const value of [authoredBytes, authoredBuffer]) {
		assert.throws(
			() => admitAudioEditorProjectValidationStructure(
				{ opaque: value },
				AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
			),
			/binary.*extra propert/iu,
		);
	}
});

test('structural admission rejects detached and out-of-bounds binary authority', () => {
	const detachedBuffer = new ArrayBuffer(1);
	structuredClone(detachedBuffer, { transfer: [detachedBuffer] });

	const detachedBacking = new ArrayBuffer(1);
	const detachedView = new Uint8Array(detachedBacking);
	structuredClone(detachedBacking, { transfer: [detachedBacking] });

	const ResizableArrayBuffer = ArrayBuffer as unknown as new(
		byteLength: number,
		options: Readonly<{ maxByteLength: number }>,
	) => ArrayBuffer & { resize(byteLength: number): void };
	const resizable = new ResizableArrayBuffer(4, { maxByteLength: 8 });
	const outOfBounds = new Uint8Array(resizable, 2, 2);
	resizable.resize(1);

	for (const [name, value] of [
		['detached ArrayBuffer', detachedBuffer],
		['detached Uint8Array', detachedView],
		['out-of-bounds Uint8Array', outOfBounds],
	] as const) {
		assert.throws(
			() => admitAudioEditorProjectValidationStructure(
				{ opaque: value },
				AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
			),
			(error: unknown) => error instanceof TypeError
				&& /binary.*detached or out of bounds/iu.test(error.message),
			`${name} must fail structural admission`,
		);
	}
});

test('the neutral hierarchy validator closure excludes retired and executable runtimes', () => {
	const closure = validatorImportClosure(VALIDATOR_ENTRY);
	const relativeClosure = [...closure].map((path) => (
		path.startsWith('package:') ? path : relative(REPOSITORY_ROOT, path).split(sep).join('/')
	)).sort();

	assert.ok(relativeClosure.includes('src/common/editor/project-hierarchy-document-validation.ts'));
	assert.ok(relativeClosure.includes('src/common/editor/project-document-validation.ts'));
	assert.ok(relativeClosure.includes('src/common/editor/project-validation-budget.ts'));

	const forbidden = [
		{ name: 'generic project runtime', pattern: /^src\/common\/editor\/project\.js$/u },
		{ name: 'retired project module', pattern: /^src\/common\/editor\/project-v(?:[2-9]|1[0-6])(?:[.-])/u },
		{ name: 'executable effect registry', pattern: /^src\/common\/editor\/effects\.js$/u },
		{ name: 'Audacity effect runtime', pattern: /(?:^|\/)audacity-effects(?:\/|$)/u },
		{ name: 'PFFFT runtime', pattern: /pffft/iu },
		{ name: 'WebAssembly runtime', pattern: /wasm/iu },
		{ name: 'migration module', pattern: /migration/iu },
		{ name: 'worker module', pattern: /worker/iu },
	] as const;
	for (const dependency of relativeClosure) {
		for (const denied of forbidden) {
			assert.doesNotMatch(dependency, denied.pattern, `${denied.name} reached from ${dependency}`);
		}
	}
});

function validatorImportClosure(entry: string): ReadonlySet<string> {
	const visited = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		assert.ok(file);
		if (visited.has(file)) continue;
		visited.add(file);
		const imports = preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
		for (const imported of imports) {
			if (!imported.fileName.startsWith('.')) {
				visited.add(`package:${imported.fileName}`);
				continue;
			}
			const dependency = resolve(dirname(file), imported.fileName);
			assert.equal(existsSync(dependency), true, `Unresolved validator import: ${imported.fileName}`);
			queue.push(dependency);
		}
	}
	return visited;
}
