/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	mediaHostUnifiedPlanGeneration,
} from './helpers/framescaper-media-host-unified-plan-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(repositoryRoot, 'native/framescaper-media-host/src');
const fixtureSource = join(
	repositoryRoot,
	'native/framescaper-media-host/tests/unified_plan_admission_fixture.cpp',
);
const SOURCE_SHA256 = 'ab'.repeat(32);
const TIMING_SHA256 = 'cd'.repeat(32);

test('native unified validators admit canonical V9-V12 plans without dispatch authority', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		for (const version of [9, 10, 11, 12]) {
			const valid = mediaHostUnifiedPlanGeneration(version, SOURCE_SHA256);
			const admitted = admit(fixture, valid);
			assert.equal(admitted.status, 0, `valid V${String(version)}: ${admitted.stderr}`);
			assert.equal(
				admitted.stdout,
				`${String(version)}|original-only|unified-exact-v${String(version)}-graph\n`,
			);
		}
		const repeated = repeatedGeneratorSource(
			structuredClone(mediaHostUnifiedPlanGeneration(10, SOURCE_SHA256)),
		);
		assert.equal(admit(fixture, repeated).status, 0, 'identical repeated generator source');
	} finally {
		fixture.cleanup();
	}
});

test('native unified validators reject every value outside the owning V9-V12 domain', (context) => {
	const fixture = buildFixture(context);
	if (fixture === null) return;
	try {
		for (const [version, label, hostile] of hostileCases()) {
			const valid = mediaHostUnifiedPlanGeneration(version, SOURCE_SHA256);
			const refused = admit(fixture, hostile(structuredClone(valid)));
			assert.equal(
				refused.status,
				65,
				`hostile V${String(version)} ${label}: ${refused.stderr}`,
			);
		}
	} finally {
		fixture.cleanup();
	}
});

function hostileCases() {
	return [
		[9, 'VFR duration', hostileV9Duration],
		[9, 'VFR timing bytes unavailable', validVfrTiming],
		[9, 'duplicate track order', duplicateTrackOrder],
		[9, 'unknown clip track', unknownClipTrack],
		[9, 'audio graph omission', includeAudio],
		[9, 'codec tuple', wrongCodecTuple],
		[9, 'odd canvas', oddCanvas],
		[9, 'oversized canvas', oversizedCanvas],
		[9, 'mapping source rate', mappingSourceRate],
		[9, 'transition map mismatch', transitionMapMismatch],
		[9, 'intent segment mismatch', intentSegmentMismatch],
		[9, 'wall-clock source time', wallClockSourceTimeMismatch],
		[9, 'wall-clock output boundary', wallClockOutputBoundaryMismatch],
		[9, 'curve clipped cell', curveClippedCellMismatch],
		[9, 'duplicate curve intersection', duplicateCurveIntersection],
		[9, 'global identity collision', globalIdentityCollision],
		[9, 'same-family node collision', sameNodeIdentity],
		[9, 'cross-clip effect collision', duplicateEffectIdentity],
		[9, 'transition curve endpoint', transitionCurveEndpoint],
		[9, 'transition Bezier span', transitionBezierSpan],
		[9, 'picture target order', pictureTargetOrder],
		[9, 'picture Bezier span', pictureBezierSpan],
		[9, 'picture crop aperture', pictureCropAperture],
		[10, 'generator reference', unresolvedExternalGenerator],
		[10, 'generator binding family', externalGeneratorBindingFamily],
		[10, 'generator input family', externalGeneratorInputFamily],
		[10, 'generator dependency cycle', cyclicExternalGenerator],
		[10, 'contradictory generator source', contradictoryGeneratorSource],
		[10, 'adjustment reference', unresolvedAdjustmentEffect],
		[10, 'adjustment effect family', adjustmentEffectFamily],
		[10, 'mask reference', unresolvedMaskInput],
		[10, 'mask input family', maskInputFamily],
		[10, 'visual placement track', unknownVisualTrack],
		[10, 'still external binding', stillExternalBindingMismatch],
		[10, 'alignment', hostileV10Alignment],
		[11, 'rotation', hostileV11Rotation],
		[11, 'duplicate professional source', duplicateProfessionalSource],
		[12, 'valueless keyframe', hostileV12ValuelessKeyframe],
		[12, 'OpenFX attachment family', openFxAttachmentFamily],
		[12, 'OpenFX input family', openFxInputFamily],
	];
}

function hostileV9Duration(plan) {
	plan.sources[0].timing = {
		kind: 'vfr',
		reference: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${TIMING_SHA256}`,
			sha256: TIMING_SHA256,
			sourceSha256: SOURCE_SHA256,
			byteLength: 192,
			frameCount: 20,
			timescale: 1,
			finalFrameDurationTicks: '9999999999999999999',
		},
	};
	return plan;
}

function validVfrTiming(plan) {
	plan.sources[0].timing = {
		kind: 'vfr',
		reference: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${TIMING_SHA256}`,
			sha256: TIMING_SHA256,
			sourceSha256: SOURCE_SHA256,
			byteLength: 192,
			frameCount: 20,
			timescale: 1,
			finalFrameDurationTicks: '1',
		},
	};
	return plan;
}

function duplicateTrackOrder(plan) {
	plan.tracks.push({ ...plan.tracks[0], trackId: 'track-2' });
	return plan;
}

function unknownClipTrack(plan) {
	plan.nodes.find(({ kind }) => kind === 'clip').trackId = 'missing-track';
	return plan;
}

function includeAudio(plan) {
	plan.codecs.audio = 'aac';
	plan.codecs.audioEncoder = 'aac';
	plan.output.includeAudio = true;
	plan.output.audioLayout = 'stereo';
	return plan;
}

function wrongCodecTuple(plan) {
	plan.codecs.video = 'vp9';
	plan.codecs.videoEncoder = 'libvpx-vp9';
	return plan;
}

function oddCanvas(plan) {
	plan.output.canvas.width = 1;
	plan.output.canvas.height = 1;
	return plan;
}

function oversizedCanvas(plan) {
	plan.output.canvas.width = 65_536;
	plan.output.canvas.height = 65_536;
	return plan;
}

function mappingSourceRate(plan) {
	plan.nodes.find(({ kind }) => kind === 'clip').sourceTimeMapping.sourceRate = { num: 2, den: 1 };
	return plan;
}

function transitionMapMismatch(plan) {
	const transition = plan.nodes.find(({ kind }) => kind === 'transition');
	transition.edges.outgoing.retimeMap.points[1].sourceFrame = { num: 2, den: 1 };
	return plan;
}

function intentSegmentMismatch(plan) {
	const clip = plan.nodes.find(({ kind }) => kind === 'clip');
	clip.sourceTimeMapping.intent.intersections[0].sourceEnd = {
		numerator: '2', denominator: '1',
	};
	return plan;
}

function wallClockSourceTimeMismatch(plan) {
	const clip = plan.nodes.find(({ kind, sourceTimeMapping }) => (
		kind === 'clip' && sourceTimeMapping.retimeMap === null
	));
	clip.sourceTimeMapping.intent.intersections[0].clippedSourceStartTime = {
		numerator: '8', denominator: '1',
	};
	return plan;
}

function wallClockOutputBoundaryMismatch(plan) {
	const clip = plan.nodes.find(({ kind, sourceTimeMapping }) => (
		kind === 'clip' && sourceTimeMapping.retimeMap === null
	));
	clip.sourceTimeMapping.intent.intersections[0].endOutputFrame += 1;
	return plan;
}

function curveClippedCellMismatch(plan) {
	const clip = plan.nodes.find(({ kind, sourceTimeMapping }) => (
		kind === 'clip' && sourceTimeMapping.retimeMap !== null
	));
	clip.sourceTimeMapping.intent.intersections[0].startOuterCell += 1;
	return plan;
}

function duplicateCurveIntersection(plan) {
	const clip = plan.nodes.find(({ kind, sourceTimeMapping }) => (
		kind === 'clip' && sourceTimeMapping.retimeMap !== null
	));
	const intent = clip.sourceTimeMapping.intent;
	const duplicate = structuredClone(intent.intersections.at(-1));
	duplicate.index = intent.intersections.length;
	intent.intersections.push(duplicate);
	intent.limits.serializedIntersectionCount = intent.intersections.length;
	return plan;
}

function globalIdentityCollision(plan) {
	plan.nodes.find(({ kind }) => kind === 'transition').nodeId = 'source-1';
	return plan;
}

function sameNodeIdentity(plan) {
	const clips = plan.nodes.filter(({ kind }) => kind === 'clip');
	clips[1].nodeId = clips[0].nodeId;
	return plan;
}

function duplicateEffectIdentity(plan) {
	const clips = plan.nodes.filter(({ kind }) => kind === 'clip');
	for (const clip of clips.slice(0, 2)) clip.pictureState.videoEffects = [{
		id: 'shared-effect', type: 'color-adjust', enabled: true,
		params: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
	}];
	return plan;
}

function transitionCurveEndpoint(plan) {
	plan.nodes.find(({ kind }) => kind === 'transition').transition.curve.anchors[0].value = 0.25;
	return plan;
}

function transitionBezierSpan(plan) {
	const transition = plan.nodes.find(({ kind }) => kind === 'transition').transition;
	transition.curve.segments[0] = {
		kind: 'bezier',
		control1: { position: { num: 3, den: 1 }, value: 0.25 },
		control2: { position: { num: 3, den: 1 }, value: 0.75 },
	};
	return plan;
}

function pictureTargetOrder(plan) {
	const clip = plan.nodes.find(({ kind }) => kind === 'clip');
	clip.pictureState.videoKeyframes.curves = [
		pictureCurve('opacity', 1),
		pictureCurve('crop.left', 0.1),
	];
	return plan;
}

function pictureBezierSpan(plan) {
	const clip = plan.nodes.find(({ kind }) => kind === 'clip');
	const curve = pictureCurve('opacity', 1);
	curve.curve.segments[0] = {
		kind: 'bezier',
		control1: { position: { num: 8, den: 1 }, value: 1 },
		control2: { position: { num: 8, den: 1 }, value: 1 },
	};
	clip.pictureState.videoKeyframes.curves = [curve];
	return plan;
}

function pictureCropAperture(plan) {
	const clip = plan.nodes.find(({ kind }) => kind === 'clip');
	clip.pictureState.videoKeyframes.curves = [
		pictureCurve('crop.left', 0.6),
		pictureCurve('crop.right', 0.5),
	];
	return plan;
}

function pictureCurve(parameterId, value) {
	return {
		target: { kind: 'composition', parameterId },
		curve: {
			anchors: [
				{ position: { num: 0, den: 1 }, value },
				{ position: { num: 7, den: 1 }, value },
			],
			segments: [{ kind: 'linear' }],
		},
	};
}

function unresolvedExternalGenerator(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'external-generator';
	visual.authoredState.source.generator = {
		kind: 'external-generator', bindingId: 'missing-binding',
		inputs: [{ name: 'Source', sourceRef: 'missing-source' }],
	};
	clearVisualFallback(visual);
	return plan;
}

function externalGeneratorBindingFamily(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'external-generator';
	visual.authoredState.source.generator = {
		kind: 'external-generator', bindingId: 'project-1',
		inputs: [{ name: 'Source', sourceRef: 'source-1' }],
	};
	clearVisualFallback(visual);
	return plan;
}

function externalGeneratorInputFamily(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'external-generator';
	visual.authoredState.source.generator = {
		kind: 'external-generator', bindingId: 'source-1',
		inputs: [{ name: 'Source', sourceRef: 'track-1' }],
	};
	clearVisualFallback(visual);
	return plan;
}

function cyclicExternalGenerator(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'external-generator';
	visual.authoredState.source.generator = {
		kind: 'external-generator', bindingId: 'source-1',
		inputs: [{ name: 'Source', sourceRef: visual.authoredState.source.id }],
	};
	clearVisualFallback(visual);
	return plan;
}

function repeatedGeneratorSource(plan) {
	const original = plan.nodes.find(({ kind }) => kind === 'visual');
	const repeated = structuredClone(original);
	repeated.nodeId = 'visual-node-2';
	repeated.modelId = 'generator-clip-2';
	repeated.authoredState.clip.id = 'generator-clip-2';
	clearVisualFallback(repeated);
	plan.nodes.push(repeated);
	return plan;
}

function contradictoryGeneratorSource(plan) {
	repeatedGeneratorSource(plan);
	plan.nodes.at(-1).authoredState.source.generator.color = '#ffffffff';
	return plan;
}

function unresolvedAdjustmentEffect(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'adjustment-layer';
	visual.modelId = 'adjustment-1';
	visual.authoredState = {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment-1',
		sequenceId: 'sequence-1', sequenceStartFrame: 0, sequenceFrameCount: 10,
		targetTrackIds: ['track-1'], effectIds: ['missing-effect'],
	};
	visual.placement = null;
	clearVisualFallback(visual);
	return plan;
}

function adjustmentEffectFamily(plan) {
	const visual = unresolvedAdjustmentEffect(plan).nodes.find(({ kind }) => kind === 'visual');
	visual.authoredState.effectIds = ['source-1'];
	return plan;
}

function unresolvedMaskInput(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'mask-matte';
	visual.modelId = 'mask-1';
	visual.authoredState = {
		schemaVersion: 1, id: 'mask-1', kind: 'mask',
		inputs: [{ name: 'Source', sourceRef: 'missing-source', kind: 'alpha' }],
		nodes: [{ id: 'alpha-1', kind: 'alpha', inputName: 'Source' }],
		outputNodeId: 'alpha-1',
	};
	visual.placement = null;
	clearVisualFallback(visual);
	return plan;
}

function maskInputFamily(plan) {
	const visual = unresolvedMaskInput(plan).nodes.find(({ kind }) => kind === 'visual');
	visual.authoredState.inputs[0].sourceRef = 'track-1';
	return plan;
}

function unknownVisualTrack(plan) {
	plan.nodes.find(({ kind }) => kind === 'visual').placement.trackId = 'missing-track';
	return plan;
}

function stillExternalBindingMismatch(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'still';
	visual.modelId = 'still-clip-1';
	visual.authoredState = {
		source: {
			schemaVersion: 1, kind: 'still', id: 'source-1', name: 'Plate.png',
			mimeType: 'image/png', storageKey: 'wrong-storage-key',
			contentSha256: SOURCE_SHA256, width: 1_280, height: 720, hasAlpha: true,
		},
		clip: {
			schemaVersion: 1, kind: 'still', id: 'still-clip-1', sourceId: 'source-1',
			sequenceId: 'sequence-1', sequenceStartFrame: 0, sequenceFrameCount: 10,
		},
	};
	clearVisualFallback(visual);
	return plan;
}

function clearVisualFallback(visual) {
	visual.freshness = null;
	visual.authoredFallback = null;
	visual.fallbackDisposition = null;
	visual.frozenFallback = null;
}

function hostileV10Alignment(plan) {
	const visual = plan.nodes.find(({ kind }) => kind === 'visual');
	visual.modelKind = 'title';
	visual.authoredState.source.generator = {
		kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 32,
		color: '#ffffffff', horizontalAlign: 'sideways', verticalAlign: 'middle',
	};
	visual.freshness.authoredStateSha256 = digest(JSON.stringify(visual.authoredState));
	visual.authoredFallback = null;
	visual.fallbackDisposition = null;
	visual.frozenFallback = null;
	return plan;
}

function hostileV11Rotation(plan) {
	const professional = plan.nodes.find(({ kind }) => kind === 'professional-media');
	professional.characteristics.rotationDegrees = 45;
	professional.imageSequence.characteristics.rotationDegrees = 45;
	return plan;
}

function duplicateProfessionalSource(plan) {
	const professional = plan.nodes.find(({ kind }) => kind === 'professional-media');
	const repeated = structuredClone(professional);
	repeated.nodeId = 'professional-node-2';
	plan.nodes.push(repeated);
	return plan;
}

function hostileV12ValuelessKeyframe(plan) {
	const openFx = plan.nodes.find(({ kind }) => kind === 'openfx');
	openFx.state.parameters[0].type = 'group';
	openFx.state.parameters[0].value = null;
	return plan;
}

function openFxAttachmentFamily(plan) {
	plan.nodes.find(({ kind }) => kind === 'openfx').state.attachment.targetId = 'source-1';
	return plan;
}

function openFxInputFamily(plan) {
	plan.nodes.find(({ kind }) => kind === 'openfx').state.inputs[0].sourceRef = 'track-1';
	return plan;
}

function buildFixture(context) {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return null;
	}
	const boostRoot = process.env.FRAMESCAPER_BOOST_192_SOURCE_ROOT;
	const boostArguments = boostRoot ? ['-I', boostRoot] : [];
	const boost = spawnSync('c++', ['-std=c++20', ...boostArguments, '-fsyntax-only', '-x', 'c++', '-'], {
		encoding: 'utf8', input: '#include <boost/multiprecision/cpp_int.hpp>\n',
	});
	if (boost.status !== 0) {
		context.skip('The pinned Boost closure is not provisioned on this source-audit host.');
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-unified-validator-'));
	const executable = join(directory, 'unified-plan-admission');
	const files = [
		'media_plan.cpp', 'legacy_plan_semantics.cpp', 'legacy_plan_v8_filter_semantics.cpp',
		'media_file_grants.cpp', 'sha256.cpp', 'strict_json.cpp',
	].map((file) => join(sourceRoot, file));
	const built = spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		...boostArguments, '-I', sourceRoot, fixtureSource, ...files, '-o', executable,
	], { encoding: 'utf8' });
	assert.equal(built.status, 0, built.stderr);
	return {
		directory,
		executable,
		plan: join(directory, 'plan.json'),
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	};
}

function admit(fixture, plan) {
	const bytes = JSON.stringify(plan);
	writeFileSync(fixture.plan, bytes);
	return spawnSync(fixture.executable, [fixture.plan, digest(bytes)], { encoding: 'utf8' });
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
