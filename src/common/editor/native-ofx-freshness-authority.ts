/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independently derive V26 frozen-effect freshness from canonical render authority. */

import {
	fingerprintNativeMediaPlan,
} from './native-media-plan-canonical-form.ts';
import {
	assertOfxPluginDescriptorV1,
	type OfxPluginDescriptorV1,
} from './native-ofx-descriptor.ts';
import type {
	OfxEffectFreshnessV26,
	OfxEffectStateV26,
} from './native-ofx-state-v26.ts';
import {
	assertUnifiedExactRenderPlanWithDeferredTimingReferences,
	type UnifiedExactRenderOpenFxNode,
	type UnifiedExactRenderPlanV12,
} from './unified-exact-render-plan.ts';

export function deriveUnifiedExactOfxFreshnessV26(
	planValue: unknown,
	instanceId: string,
	descriptorValue: unknown,
): OfxEffectFreshnessV26 {
	assertDeferredV12Plan(planValue);
	assertOfxPluginDescriptorV1(descriptorValue);
	const plan = planValue;
	const descriptor = descriptorValue;
	const effect = effectNode(plan, instanceId);
	if (descriptor.pluginId !== effect.state.pluginId
		|| descriptor.binarySha256 !== effect.state.binarySha256) {
		throw new Error('OpenFX freshness requires the exact scanned binary descriptor.');
	}
	return Object.freeze({
		authoredStateSha256: digest(authoredState(effect.state)),
		inputIdentitiesSha256: digest({
			inputs: effect.state.inputs,
			sources: plan.sources,
		}),
		renderPlanFingerprintSha256: digest(renderIntent(plan)),
		nativeEffectFingerprintSha256: digest(nativeEffect(descriptor)),
	});
}

function assertDeferredV12Plan(value: unknown): asserts value is UnifiedExactRenderPlanV12 {
	assertUnifiedExactRenderPlanWithDeferredTimingReferences(value);
	if (value.version !== 12) throw new RangeError('OpenFX freshness requires exact render plan V12.');
}

function effectNode(
	plan: UnifiedExactRenderPlanV12,
	instanceId: string,
): UnifiedExactRenderOpenFxNode {
	const matches = plan.nodes.filter((node): node is UnifiedExactRenderOpenFxNode => (
		node.kind === 'openfx' && node.state.instanceId === instanceId
	));
	if (matches.length !== 1) throw new ReferenceError('OpenFX freshness requires one exact V12 instance.');
	return matches[0]!;
}

function authoredState(state: OfxEffectStateV26): Readonly<Record<string, unknown>> {
	return Object.freeze({
		schemaVersion: state.schemaVersion,
		instanceId: state.instanceId,
		pluginId: state.pluginId,
		binarySha256: state.binarySha256,
		context: state.context,
		attachment: state.attachment,
		inputs: state.inputs,
		parameters: state.parameters,
		customEncodings: state.customEncodings,
		enabled: state.enabled,
	});
}

function renderIntent(plan: UnifiedExactRenderPlanV12): Readonly<Record<string, unknown>> {
	return Object.freeze({
		version: plan.version,
		strategy: plan.strategy,
		project: plan.project,
		format: plan.format,
		codecs: plan.codecs,
		timebase: plan.timebase,
		output: plan.output,
		tracks: plan.tracks,
		sources: plan.sources,
		nodes: plan.nodes.map((node) => node.kind === 'openfx'
			? Object.freeze({ kind: node.kind, nodeId: node.nodeId, state: authoredState(node.state) })
			: node),
	});
}

function nativeEffect(descriptor: OfxPluginDescriptorV1): Readonly<Record<string, unknown>> {
	return Object.freeze({
		pluginId: descriptor.pluginId,
		binarySha256: descriptor.binarySha256,
		bundleIdentity: descriptor.bundleIdentity,
		architectureDirectory: descriptor.architectureDirectory,
		supportedContexts: descriptor.supportedContexts,
		parameters: descriptor.parameters,
		components: descriptor.components,
		pixelDepths: descriptor.pixelDepths,
		threading: descriptor.threading,
		requestedSuites: descriptor.requestedSuites,
	});
}

function digest(value: unknown): string {
	return fingerprintNativeMediaPlan(value).sha256;
}
