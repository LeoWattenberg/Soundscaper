/* SPDX-License-Identifier: AGPL-3.0-only */
import { isAbsolute, resolve } from 'node:path';

import type { FramescaperOpenFxRuntime } from './framescaper-openfx-runtime.ts';
import type { HelperExecutableGrant } from './helper-contract.ts';
import type { FramescaperOpenFxExecutionPlan } from './openfx-main-execution-request.ts';
import type { RegisteredOpenFxPluginV1 } from './openfx-main-registered-plugin.ts';
import {
	assertOfxPluginDescriptorV1,
	ofxPluginFingerprint,
	type OfxPluginDescriptorV1,
} from '../src/common/editor/native-ofx-descriptor.ts';
import type { recordOfxFailure } from '../src/common/editor/native-ofx-consent.ts';
import { framescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import type { UnifiedExactRenderOpenFxNode } from '../src/common/editor/unified-exact-render-plan.ts';
import type { OfxEffectStateV26 } from '../src/common/editor/native-ofx-state-v26.ts';

/** Map only closed per-plugin runtime faults; supervisor and host-control failures return null. */
export function framescaperOpenFxFailureKind(
	error: unknown,
): Parameters<typeof recordOfxFailure>[1] | null {
	if (error && typeof error === 'object' && 'cause_' in error) {
		const cause = (error as { cause_?: unknown }).cause_;
		if (cause === 'heartbeat' || cause === 'cancellation-timeout') return 'hang';
		if (cause === 'helper-exit') return 'crash';
		if (cause === 'resource-violation' || cause === 'malformed-message'
			|| cause === 'job-mismatch') return 'resource-violation';
		return null;
	}
	return 'render-error';
}

export function framescaperOpenFxEffectNode(
	plan: FramescaperOpenFxExecutionPlan,
	instanceId: string,
): UnifiedExactRenderOpenFxNode {
	const effect = plan.nodes.find((node): node is UnifiedExactRenderOpenFxNode => (
		node.kind === 'openfx' && node.state.instanceId === instanceId
	));
	if (!effect) throw new ReferenceError('The exact OpenFX instance is unavailable.');
	return effect;
}

export function assertFramescaperOpenFxEffectDescriptor(
	effect: UnifiedExactRenderOpenFxNode,
	descriptor: OfxPluginDescriptorV1,
): void {
	if (!descriptor.supportedContexts.includes(effect.state.context)
		|| !descriptor.components.includes('RGBA') || !descriptor.pixelDepths.includes('byte')) {
		throw new Error('The OpenFX node exceeds the scanned context or RGBA8 pixel contract.');
	}
	const parameters = new Map(descriptor.parameters.map((parameter) => [parameter.name, parameter]));
	for (const parameter of effect.state.parameters) {
		const declared = parameters.get(parameter.name);
		if (!declared || declared.type !== parameter.type
			|| (!declared.animates && parameter.keyframes.length !== 0)) {
			throw new Error('The OpenFX node exceeds the scanned parameter contract.');
		}
	}
}

export function assertFramescaperOpenFxInteractEffectDescriptor(
	effect: OfxEffectStateV26,
	descriptor: OfxPluginDescriptorV1,
): void {
	if (effect.pluginId !== descriptor.pluginId
		|| effect.binarySha256 !== descriptor.binarySha256
		|| !descriptor.supportedContexts.includes(effect.context)
		|| !descriptor.components.includes('RGBA') || !descriptor.pixelDepths.includes('byte')
		|| descriptor.parameters.length !== effect.parameters.length) {
		throw new Error('The authored OpenFX Interact instance exceeds its exact scanned descriptor.');
	}
	for (let index = 0; index < descriptor.parameters.length; index += 1) {
		const declared = descriptor.parameters[index]!;
		const state = effect.parameters[index];
		if (!state || state.name !== declared.name || state.type !== declared.type
			|| (!declared.animates && state.keyframes.length !== 0)) {
			throw new Error('The authored OpenFX Interact parameter state is incomplete or stale.');
		}
	}
}

export function availableFramescaperOpenFxHost(runtime: FramescaperOpenFxRuntime) {
	const availability = runtime.payloadAvailability;
	if (availability.status !== 'available') {
		throw new Error(runtime.reason ?? 'The authenticated OpenFX payload is unavailable.');
	}
	return availability.descriptor;
}

export function framescaperOpenFxScannedDescriptor(
	bytes: Uint8Array,
	binarySha256: string,
): OfxPluginDescriptorV1 {
	let value: unknown;
	try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; }
	catch { throw new TypeError('The isolated OpenFX scanner returned malformed JSON.'); }
	assertOfxPluginDescriptorV1(value);
	if (value.binarySha256 !== binarySha256) {
		throw new Error('The isolated OpenFX descriptor does not bind the selected binary bytes.');
	}
	return structuredClone(value);
}

export function framescaperOpenFxExecutableGrant(
	role: 'ofx-scanner' | 'ofx-host',
	value: Readonly<{ path: string; byteLength: number; sha256: string;
		identity: Readonly<{ dev: number; ino: number }> }>,
): HelperExecutableGrant {
	return Object.freeze({ role, path: value.path, bytes: value.byteLength,
		sha256: value.sha256, identity: value.identity });
}

export function framescaperOpenFxPluginProjection(
	runtime: FramescaperOpenFxRuntime,
	plugin: RegisteredOpenFxPluginV1,
) {
	const fingerprint = ofxPluginFingerprint(plugin.descriptor);
	const runtimeQuarantined = runtime.manager?.snapshot().runtimes.some((entry) => (
		entry.pluginFingerprint === fingerprint && entry.quarantined
	)) ?? false;
	return framescaperOpenFxPluginProjectionV1({
		pluginHandle: plugin.handle, pluginId: plugin.descriptor.pluginId,
		vendor: plugin.descriptor.vendor, version: plugin.descriptor.version,
		binarySha256: plugin.descriptor.binarySha256,
		supportedContexts: plugin.descriptor.supportedContexts,
		parameters: plugin.descriptor.parameters, components: plugin.descriptor.components,
		pixelDepths: plugin.descriptor.pixelDepths, threading: plugin.descriptor.threading,
		state: plugin.consent.state,
		quarantined: plugin.consent.state === 'quarantined' || runtimeQuarantined,
	});
}

export function framescaperOpenFxIdentity(value: Readonly<{ dev: number; ino: number }>) {
	return Object.freeze({ dev: value.dev, ino: value.ino });
}

export function absoluteFramescaperOpenFxPath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
		throw new TypeError(`The ${label} must be an absolute path.`);
	}
	const normalized = resolve(value);
	if (normalized !== value) throw new TypeError(`The ${label} must be normalized.`);
	return normalized;
}
