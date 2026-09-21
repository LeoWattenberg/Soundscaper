/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict parameter RPC adapter loaded only with the menu-opened plug-in controls. */

import { requestNativePluginRuntimeControl } from '../../native-plugin-realtime-node.js';
import { NATIVE_PLUGIN_CONTROL } from '../../native-plugin-realtime-contract.ts';

export interface NativePluginParameterCapabilities {
	readonly parameterCount: number;
	readonly hasVendorUi: boolean;
}

export interface NativePluginParameterDescriptor {
	readonly index: number;
	readonly id: string;
	readonly name: string;
	readonly label: string;
	readonly defaultValue: number;
	readonly minimumValue: number;
	readonly maximumValue: number;
	readonly flags: number;
}

export interface NativePluginParameterRuntime {
	capabilities(instanceId: string): Promise<NativePluginParameterCapabilities>;
	describeParameters(instanceId: string): Promise<readonly NativePluginParameterDescriptor[]>;
	readParameter(instanceId: string, index: number): Promise<number>;
	writeParameter(instanceId: string, index: number, value: number): Promise<number>;
}

export async function nativePluginRuntimeCapabilities(
	instanceId: string,
): Promise<Readonly<NativePluginParameterCapabilities>> {
	const answer = record(await requestNativePluginRuntimeControl(
		instanceId, NATIVE_PLUGIN_CONTROL.capabilities,
	));
	if (!Number.isSafeInteger(answer.parameterCount) || Number(answer.parameterCount) < 0
		|| Number(answer.parameterCount) > 4_096 || typeof answer.hasVendorUi !== 'boolean') {
		throw new Error('The native plug-in returned malformed capabilities.');
	}
	return Object.freeze({
		parameterCount: Number(answer.parameterCount), hasVendorUi: answer.hasVendorUi,
	});
}

export async function describeNativePluginRuntimeParameters(
	instanceId: string,
): Promise<readonly Readonly<NativePluginParameterDescriptor>[]> {
	const answer = record(await requestNativePluginRuntimeControl(
		instanceId, NATIVE_PLUGIN_CONTROL.describeParameters,
	));
	const parameters = pluginParameters(answer.parameters);
	if (parameters === null) throw new Error('The native plug-in returned malformed parameters.');
	return parameters;
}

export async function readNativePluginRuntimeParameter(
	instanceId: string,
	index: number,
): Promise<number> {
	const admittedIndex = pluginParameterIndex(index);
	const answer = await requestNativePluginRuntimeControl(
		instanceId, NATIVE_PLUGIN_CONTROL.readParameter, { index: admittedIndex },
	);
	return pluginParameterAnswer(answer, admittedIndex);
}

export async function writeNativePluginRuntimeParameter(
	instanceId: string,
	index: number,
	value: number,
): Promise<number> {
	const admittedIndex = pluginParameterIndex(index);
	const admittedValue = normalizedPluginParameter(value);
	const answer = await requestNativePluginRuntimeControl(
		instanceId, NATIVE_PLUGIN_CONTROL.writeParameter,
		{ index: admittedIndex, value: admittedValue },
	);
	return pluginParameterAnswer(answer, admittedIndex);
}

function pluginParameterIndex(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 4_095) {
		throw new RangeError('The native plug-in parameter index is invalid.');
	}
	return Number(value);
}

function normalizedPluginParameter(value: unknown): number {
	if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 1) {
		throw new RangeError('A normalized native plug-in parameter value is required.');
	}
	return Number(value);
}

function pluginParameterAnswer(value: unknown, index: number): number {
	const answer = record(value);
	if (answer.index !== index) throw new Error('The native plug-in returned a mismatched parameter index.');
	return normalizedPluginParameter(answer.value);
}

function pluginParameters(value: unknown): readonly Readonly<NativePluginParameterDescriptor>[] | null {
	if (!Array.isArray(value) || value.length > 4_096) return null;
	const ids = new Set<string>();
	const parameters: NativePluginParameterDescriptor[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const parameter = record(value[index]);
		if (parameter.index !== index || !pluginParameterText(parameter.id, false)
			|| !pluginParameterText(parameter.name, false) || !pluginParameterText(parameter.label, true)
			|| !Number.isSafeInteger(parameter.flags) || Number(parameter.flags) < 0
			|| Number(parameter.flags) > 15 || ids.has(parameter.id)) return null;
		let minimumValue: number;
		let defaultValue: number;
		let maximumValue: number;
		try {
			minimumValue = normalizedPluginParameter(parameter.minimumValue);
			defaultValue = normalizedPluginParameter(parameter.defaultValue);
			maximumValue = normalizedPluginParameter(parameter.maximumValue);
		} catch { return null; }
		if (minimumValue > defaultValue || defaultValue > maximumValue) return null;
		ids.add(parameter.id);
		parameters.push(Object.freeze({
			index, id: parameter.id, name: parameter.name, label: parameter.label,
			defaultValue, minimumValue, maximumValue, flags: Number(parameter.flags),
		}));
	}
	return Object.freeze(parameters);
}

function pluginParameterText(value: unknown, allowEmpty: boolean): value is string {
	return typeof value === 'string' && (allowEmpty || value.length > 0)
		&& value.length <= 512 && !value.includes('\0');
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}
