/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDefaultVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../src/common/editor/video-keyframe-curves.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	cloneFramescaperProjectV20,
	createFramescaperProjectV20,
	framescaperProjectV19FoundationV20,
	loadFramescaperProjectV20,
	normalizeFramescaperProjectClipKeyframesV20,
	validateFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V20 authenticates its exact authority before traversing hostile project input', () => {
	let traps = 0;
	const hostile = new Proxy({}, { get() { traps += 1; throw new Error('project trap'); } });
	for (const operation of [
		() => validateFramescaperProjectV20({}, hostile),
		() => createFramescaperProjectV20({}, hostile),
		() => cloneFramescaperProjectV20({}, hostile),
		() => loadFramescaperProjectV20({}, hostile),
		() => framescaperProjectV19FoundationV20({}, hostile),
	] as const) assert.throws(operation, /exact Framescaper V20 runtime profile/iu);
	assert.equal(traps, 0);
});

test('V20 creation owns one neutral detached keyframe collection per video occurrence', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const timeline = project.clips[0]!;
	const audio = project.clips[1]!;
	const bin = project.projectBin.clips[0]!;
	const contextualDefault = createDefaultVideoKeyframeCurves({ num: 10, den: 1 });
	assert.equal(project.schemaVersion, 20);
	assert.deepEqual(timeline.videoKeyframes, contextualDefault);
	assert.deepEqual(bin.videoKeyframes, contextualDefault);
	assert.notStrictEqual(timeline.videoKeyframes, contextualDefault);
	assert.notStrictEqual(timeline.videoKeyframes, bin.videoKeyframes);
	assert.equal(Object.isFrozen(timeline.videoKeyframes), true);
	assert.equal(Object.isFrozen(timeline.videoKeyframes.curves), true);
	assert.equal(Object.hasOwn(audio, 'videoKeyframes'), false);
	assert.equal(validateFramescaperProjectV20(PROFILE, project), true);
});

test('V20 clip ownership is closed, descriptor-safe, and bounded by each clip duration', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete timelineClip(missing).videoKeyframes;
	assert.throws(() => validateFramescaperProjectV20(PROFILE, missing), /videoKeyframes.*own enumerable/iu);

	const audio = structuredClone(project) as unknown as Record<string, unknown>;
	audioClip(audio).videoKeyframes = createDefaultVideoKeyframeCurves({ num: 10, den: 1 });
	assert.throws(() => validateFramescaperProjectV20(PROFILE, audio), /audio.*must not carry videoKeyframes/iu);

	const accessor = structuredClone(project) as unknown as Record<string, unknown>;
	Object.defineProperty(timelineClip(accessor), 'videoKeyframes', {
		enumerable: true,
		get() { throw new Error('getter must not run'); },
	});
	assert.throws(() => validateFramescaperProjectV20(PROFILE, accessor), /accessor|enumerable data/iu);

	const extra = structuredClone(project) as unknown as Record<string, unknown>;
	timelineClip(extra).videoKeyframes = { schemaVersion: 1, curves: [], extra: true };
	assert.throws(() => validateFramescaperProjectV20(PROFILE, extra), /unsupported field|closed|extra/iu);

	const outside = structuredClone(project) as unknown as Record<string, unknown>;
	const outsideKeyframes = opacityKeyframes(10);
	((outsideKeyframes.curves as Record<string, unknown>[])[0]!.curve as {
		anchors: Array<{ position: { num: number; den: number }; value: number }>;
	}).anchors[1]!.position.num = 11;
	timelineClip(outside).videoKeyframes = outsideKeyframes;
	assert.throws(() => validateFramescaperProjectV20(PROFILE, outside), /outside.*clip domain/iu);
});

test('V20 clone and normalization detach nested values and remain canonically idempotent', () => {
	const project = authoredProject();
	const normalizedOnce = structuredClone(project) as unknown as Record<string, unknown>;
	normalizeFramescaperProjectClipKeyframesV20(normalizedOnce);
	const firstValue = timelineClip(normalizedOnce).videoKeyframes;
	const firstSnapshot = structuredClone(normalizedOnce);
	normalizeFramescaperProjectClipKeyframesV20(normalizedOnce);
	assert.deepEqual(normalizedOnce, firstSnapshot);
	assert.notStrictEqual(timelineClip(normalizedOnce).videoKeyframes, firstValue);

	const clone = cloneFramescaperProjectV20(PROFILE, project);
	const cloneKeyframes = timelineClip(clone as unknown as Record<string, unknown>)
		.videoKeyframes as VideoKeyframeCurves;
	const projectKeyframes = timelineClip(project as unknown as Record<string, unknown>)
		.videoKeyframes as VideoKeyframeCurves;
	assert.deepEqual(clone, project);
	assert.notStrictEqual(cloneKeyframes, projectKeyframes);
	assert.notStrictEqual(
		cloneKeyframes.curves[0]?.curve,
		projectKeyframes.curves[0]?.curve,
	);
	assert.equal(Object.isFrozen(cloneKeyframes.curves[0]?.curve.anchors), true);

	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete timelineClip(missing).videoKeyframes;
	assert.throws(
		() => normalizeFramescaperProjectClipKeyframesV20(missing),
		/videoKeyframes.*own enumerable/iu,
		'exact V20 normalization must never invent a contextual default',
	);

	const transactional = structuredClone(project) as unknown as Record<string, unknown>;
	const timeline = timelineClip(transactional);
	const prior = timeline.videoKeyframes;
	delete binClip(transactional).videoKeyframes;
	assert.throws(
		() => normalizeFramescaperProjectClipKeyframesV20(transactional),
		/videoKeyframes.*own enumerable/iu,
	);
	assert.strictEqual(timeline.videoKeyframes, prior);
});

test('V20 persistence requires canonical target order', () => {
	const project = authoredProject();
	const clip = timelineClip(project as unknown as Record<string, unknown>);
	const keyframes = structuredClone(clip.videoKeyframes) as {
		curves: Array<Record<string, unknown>>;
	};
	const opacity = keyframes.curves[0]!;
	keyframes.curves = [
		opacity,
		{ ...structuredClone(opacity), target: { kind: 'composition', parameterId: 'crop.left' } },
	];
	clip.videoKeyframes = keyframes;
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	assert.throws(
		() => validateFramescaperProjectV20(PROFILE, project),
		/canonical target order/iu,
	);
});

test('V20 projection and clone preserve own prototype-named extension data', () => {
	const project = authoredProject() as unknown as Record<string, unknown>;
	const owners = [
		project,
		timelineClip(project),
		project.projectBin as Record<string, unknown>,
	];
	for (const [index, owner] of owners.entries()) Object.defineProperty(owner, '__proto__', {
		configurable: true,
		enumerable: true,
		value: `extension-${String(index)}`,
		writable: true,
	});
	assert.equal(validateFramescaperProjectV20(PROFILE, project), true);
	const clone = cloneFramescaperProjectV20(PROFILE, project);
	const clonedOwners = [
		clone as unknown as Record<string, unknown>,
		timelineClip(clone as unknown as Record<string, unknown>),
		clone.projectBin as unknown as Record<string, unknown>,
	];
	for (const [index, owner] of clonedOwners.entries()) {
		assert.equal(Object.hasOwn(owner, '__proto__'), true);
		assert.equal(owner['__proto__'], `extension-${String(index)}`);
	}
});

test('every V20 to V19 projection strips keyframes with no retention backdoor', () => {
	const project = authoredProject();
	const stripped = framescaperProjectV19FoundationV20(PROFILE, project);
	assert.equal(stripped.schemaVersion, 19);
	assert.equal(Object.hasOwn(timelineClip(stripped), 'videoKeyframes'), false);
	assert.equal(Object.hasOwn(binClip(stripped), 'videoKeyframes'), false);
	const attemptedRetention = (framescaperProjectV19FoundationV20 as (
		profile: unknown, project: unknown, options?: unknown,
	) => Record<string, unknown>)(PROFILE, project, { retainKeyframes: true });
	assert.equal(Object.hasOwn(timelineClip(attemptedRetention), 'videoKeyframes'), false);
	assert.equal(Object.hasOwn(binClip(attemptedRetention), 'videoKeyframes'), false);
});

test('V20 admits the complete raw document before keyframe semantics or projection traversal', () => {
	const neutral = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const authored = authoredProject();
	const neutralNodes = structuralNodeCount(neutral);
	assert.equal(validateFramescaperProjectV20(PROFILE, neutral, {
		limits: { maximumTraversalNodes: neutralNodes },
	}), true);
	assert.throws(() => validateFramescaperProjectV20(PROFILE, authored, {
		limits: { maximumTraversalNodes: neutralNodes },
	}), /structural traversal node limit/iu,
	'authored keyframe nodes participate in the aggregate project budget');

	const cyclic = structuredClone(neutral) as unknown as Record<string, unknown>;
	const cyclicKeyframes = timelineClip(cyclic).videoKeyframes as Record<string, unknown>;
	cyclicKeyframes.cycle = cyclicKeyframes;
	assert.throws(() => validateFramescaperProjectV20(PROFILE, cyclic), /cyclic/iu);

	const inherited = structuredClone(neutral) as unknown as Record<string, unknown>;
	Object.setPrototypeOf(timelineClip(inherited).videoKeyframes as object, { inherited: true });
	assert.throws(() => validateFramescaperProjectV20(PROFILE, inherited), /plain objects/iu);

	let getterCalls = 0;
	const accessor = structuredClone(neutral) as unknown as Record<string, unknown>;
	Object.defineProperty(timelineClip(accessor).videoKeyframes as object, 'curves', {
		enumerable: true,
		get() { getterCalls += 1; return []; },
	});
	assert.throws(() => validateFramescaperProjectV20(PROFILE, accessor), /accessor|enumerable data/iu);
	assert.equal(getterCalls, 0);
});

test('V20 exact loading rejects earlier schemas and snapshots future documents opaquely', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	assert.deepEqual(loadFramescaperProjectV20(PROFILE, project), {
		project,
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});
	assert.throws(() => loadFramescaperProjectV20(PROFILE, { schemaVersion: 19 }), /Unsupported.*19/iu);
	const future = { schemaVersion: 21, future: { retained: true } };
	const loaded = loadFramescaperProjectV20(PROFILE, future);
	assert.deepEqual(loaded, {
		project: future,
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	});
	assert.notStrictEqual(loaded.project, future);
	assert.notStrictEqual((loaded.project as typeof future).future, future.future);

	const hostile = { schemaVersion: 21 } as Record<string, unknown>;
	Object.defineProperty(hostile, 'future', { enumerable: true, get() { throw new Error('getter'); } });
	assert.throws(() => loadFramescaperProjectV20(PROFILE, hostile), /enumerable data propert/iu);

	const deepFuture: Record<string, unknown> = { schemaVersion: 21 };
	let cursor = deepFuture;
	for (let index = 0; index < 20_000; index += 1) {
		const next: Record<string, unknown> = {};
		cursor.next = next;
		cursor = next;
	}
	assert.throws(
		() => loadFramescaperProjectV20(PROFILE, deepFuture),
		/depth|structural traversal/iu,
	);
});

test('the detached V19 foundation cannot alias V20 state outside keyframes', () => {
	const project = authoredProject();
	const before = structuredClone(project);
	const foundation = framescaperProjectV19FoundationV20(PROFILE, project);
	(foundation.sources as Record<string, unknown>[])[0]!.name = 'mutated source';
	(foundation.tracks as Record<string, unknown>[])[0]!.name = 'mutated track';
	((foundation.sequences as Record<string, unknown>[])[0]!.rate as Record<string, unknown>).num = 99;
	assert.deepEqual(project, before);
});

function authoredProject() {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	assert.equal(validateFramescaperProjectV20(PROFILE, project), true);
	return project;
}

function timelineClip(project: Record<string, unknown>): Record<string, unknown> {
	return (project.clips as Record<string, unknown>[])[0]!;
}

function audioClip(project: Record<string, unknown>): Record<string, unknown> {
	return (project.clips as Record<string, unknown>[])[1]!;
}

function binClip(project: Record<string, unknown>): Record<string, unknown> {
	return ((project.projectBin as { clips: Record<string, unknown>[] }).clips)[0]!;
}

function structuralNodeCount(value: unknown): number {
	if (value === null || typeof value !== 'object') return 1;
	if (value instanceof Uint8Array || value instanceof ArrayBuffer) return 1;
	return 1 + (Array.isArray(value)
		? value.reduce((count, item) => count + structuralNodeCount(item), 0)
		: Object.values(value).reduce((count, item) => count + structuralNodeCount(item), 0));
}
