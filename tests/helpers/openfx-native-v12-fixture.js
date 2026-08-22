/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createNativeMediaPlanEnvelopeV1 } from '../../src/common/editor/native-media-plan-envelope.ts';
import { createOfxHostInvocationV1 } from '../../src/common/editor/native-ofx-host-contract.ts';
import { fingerprintNativeMediaPlan } from '../../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnifiedExactRenderOfxRetimerSourceTime } from '../../src/common/editor/unified-exact-render-plan-consumers.ts';
import { createUnifiedExactRenderPlan } from '../../src/common/editor/unified-exact-render-plan.ts';
import {
	unifiedExactPlanFixture,
	unifiedExactTimingFixture,
} from './unified-exact-render-plan-fixture.ts';

let wireSequence = 0;
const PRIMARY = Buffer.from([
	9, 8, 7, 6, 20, 30, 40, 50, 255, 0, 1, 2, 170, 170, 170, 170,
	3, 4, 5, 6, 60, 70, 80, 90, 100, 110, 120, 130, 187, 187, 187, 187,
]);
const SECONDARY = Buffer.from([
	109, 108, 107, 106, 120, 130, 140, 150, 55, 200, 201, 202, 171, 171, 171, 171,
	103, 104, 105, 106, 160, 170, 180, 190, 200, 210, 220, 230, 188, 188, 188, 188,
]);

export function createV12WireFixture(build, context) {
	wireSequence += 1;
	const suffix = `${context}-${String(wireSequence)}`;
	const raw = structuredClone(unifiedExactPlanFixture(12));
	raw.output.canvas.width = 3;
	raw.output.canvas.height = 2;
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect) throw new Error('OpenFX fixture node is unavailable.');
	effect.state.pluginId = 'org.framescaper.conformance';
	effect.state.binarySha256 = build.sha256;
	effect.state.context = context;
	effect.state.attachment = {
		kind: context,
		targetId: context === 'transition' ? 'transition-1' : 'clip-out',
	};
	const inputNames = namesForContext(context);
	effect.state.inputs = inputNames.map((name) => ({ name, sourceRef: 'source-1' }));
	effect.state.parameters[0].keyframes.push({ frame: 9, value: 0.75 });
	const plan = createUnifiedExactRenderPlan(raw);
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	const planFingerprint = fingerprintNativeMediaPlan(plan);
	const outputOrdinal = context === 'transition' ? 6 : 4;
	const sourceTime = context === 'retimer'
		? createUnifiedExactRenderOfxRetimerSourceTime(
			plan, 'ofx-1', outputOrdinal, unifiedExactTimingFixture(),
		)
		: null;
	const planPath = join(build.directory, `plan-${suffix}.json`);
	const outputPath = join(build.directory, `output-${suffix}.rgba`);
	writeFileSync(planPath, planFingerprint.canonical, { flag: 'wx' });
	const inputs = inputNames.map((name, index) => inputGrant(
		build.directory, suffix, name, index, index === 0 ? PRIMARY : SECONDARY,
	));
	const invocation = createOfxHostInvocationV1({
		invocationId: `native-${suffix}`,
		unifiedPlanVersion: 12,
		unifiedPlanSha256: envelope.fingerprint,
		nodeId: 'openfx-node',
		instanceId: 'ofx-1',
		pluginId: 'org.framescaper.conformance',
		pluginBinarySha256: build.sha256,
		context,
		action: 'render',
		stateSha256: fingerprintNativeMediaPlan(effect.state).sha256,
		inputFrameStreamIds: inputs.map(({ streamId }) => streamId),
		outputFrameStreamId: '30'.repeat(20),
		outputOrdinal,
		requestedBackend: 'cpu',
		abortSignalId: `abort-${suffix}`,
		retimerSourceTime: sourceTime,
	});
	const outputBytes = expectedOutput(context);
	const grant = {
		schemaVersion: 1,
		pluginBinary: { path: build.plugin, sha256: build.sha256, pluginIndex: 0 },
		invocation,
		plan: {
			path: planPath, byteLength: envelope.canonicalByteLength, sha256: envelope.fingerprint,
		},
		inputs,
		output: {
			streamId: '30'.repeat(20), path: outputPath, pixelFormat: 'rgba8',
			width: 3, height: 2, rowBytes: 16, byteLength: outputBytes.byteLength,
		},
	};
	const admitted = writeGrant(build.directory, grant, `grant-${suffix}`);
	return {
		...admitted, directory: build.directory,
		cancellationFrame: `${JSON.stringify({
			schemaVersion: 1, type: 'cancel', invocationId: invocation.invocationId,
			abortSignalId: invocation.abortSignalId,
		})}\n`,
		outputPath, outputBytes, inputNames,
	};
}

export function createV12PlanVariant(wire, mutateState) {
	const grant = structuredClone(wire.grant);
	const plan = JSON.parse(readFileSync(grant.plan.path, 'utf8'));
	const effect = plan.nodes.find((node) => node.kind === 'openfx');
	if (!effect) throw new Error('OpenFX fixture node is unavailable.');
	mutateState(effect.state);
	const planFingerprint = fingerprintNativeMediaPlan(plan);
	const token = Math.random().toString(16).slice(2);
	const planPath = join(wire.directory, `plan-variant-${token}.json`);
	writeFileSync(planPath, planFingerprint.canonical, { flag: 'wx' });
	grant.plan = {
		path: planPath, byteLength: planFingerprint.byteLength, sha256: planFingerprint.sha256,
	};
	grant.invocation.unifiedPlanSha256 = planFingerprint.sha256;
	grant.invocation.stateSha256 = fingerprintNativeMediaPlan(effect.state).sha256;
	const admitted = writeGrant(wire.directory, grant, `grant-variant-${token}`);
	return { ...admitted, directory: wire.directory, cancellationFrame: wire.cancellationFrame };
}

export function invokeV12PlanVariant(runtime, wire, mutateState) {
	const variant = createV12PlanVariant(wire, mutateState);
	return invokeWire(runtime, variant);
}

export function invokeV12Grant(runtime, directory, grant) {
	return invokeWire(runtime, writeGrant(
		directory, grant, `candidate-${Math.random().toString(16).slice(2)}`,
	));
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function inputGrant(directory, suffix, name, index, bytes) {
	const path = join(directory, `input-${suffix}-${String(index)}.rgba`);
	writeFileSync(path, bytes, { flag: 'wx' });
	return {
		name, sourceRef: 'source-1', streamId: `${String(20 + index).padStart(2, '0')}`.repeat(20),
		path, pixelFormat: 'rgba8', width: 3, height: 2, rowBytes: 16,
		byteLength: bytes.byteLength, sha256: sha256(bytes),
	};
}

function namesForContext(context) {
	if (context === 'generator') return [];
	if (context === 'transition') return ['SourceFrom', 'SourceTo'];
	if (context === 'paint') return ['Source', 'Mask'];
	if (context === 'general') return ['InputA', 'InputB'];
	return ['Source'];
}

function expectedOutput(context) {
	if (context === 'generator') return pixels(() => [17, 34, 51, 255]);
	if (context === 'transition' || context === 'general') {
		return pixels((offset) => [0, 1, 2, 3].map((channel) => Math.round(
			(PRIMARY[offset + channel] + SECONDARY[offset + channel]) / 2,
		)));
	}
	if (context === 'paint') return pixels((offset) => [
		PRIMARY[offset], PRIMARY[offset + 1], PRIMARY[offset + 2], SECONDARY[offset + 3],
	]);
	return Buffer.from([
		9, 8, 7, 138, 20, 30, 40, 138, 255, 0, 1, 138, 0, 0, 0, 0,
		3, 4, 5, 138, 60, 70, 80, 138, 100, 110, 120, 138, 0, 0, 0, 0,
	]);
}

function pixels(pixel) {
	const output = Buffer.alloc(PRIMARY.byteLength);
	for (const offset of [0, 4, 8, 16, 20, 24]) output.set(pixel(offset), offset);
	return output;
}

function writeGrant(directory, grant, name) {
	const bytes = Buffer.from(JSON.stringify(grant));
	const grantPath = join(directory, `${name}.json`);
	writeFileSync(grantPath, bytes, { flag: 'wx' });
	return { grant, grantPath, grantSha256: sha256(bytes) };
}

function invokeWire(runtime, wire) {
	return spawnSync(runtime, [
		'--invoke-v12-grant', wire.grantPath, '--grant-sha256', wire.grantSha256,
	], { encoding: 'utf8' });
}
