/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import {
	describeNativePluginRuntimeParameters,
	nativePluginRuntimeCapabilities,
	readNativePluginRuntimeParameter,
	writeNativePluginRuntimeParameter,
} from '../../native-plugin-realtime-node.js';

const BOOLEAN_PARAMETER_FLAG = 1;

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

export interface NativePluginParameterControlsCopy {
	readonly title: string;
	readonly loading: string;
	readonly unavailable: string;
}

export interface NativePluginParameterControlsProps {
	readonly instanceId: string;
	readonly disabled?: boolean;
	readonly runtime?: NativePluginParameterRuntime;
	readonly copy?: Partial<NativePluginParameterControlsCopy>;
}

interface ParameterSnapshot {
	readonly phase: 'loading' | 'ready' | 'failed';
	readonly parameters: readonly NativePluginParameterDescriptor[];
	readonly values: readonly number[];
	readonly error: string;
}

const DEFAULT_COPY = Object.freeze({
	title: 'Plug-in parameters',
	loading: 'Loading plug-in parameters…',
	unavailable: 'Plug-in parameters are unavailable.',
});

const DEFAULT_RUNTIME: NativePluginParameterRuntime = Object.freeze({
	capabilities: nativePluginRuntimeCapabilities,
	describeParameters: describeNativePluginRuntimeParameters,
	readParameter: readNativePluginRuntimeParameter,
	writeParameter: writeNativePluginRuntimeParameter,
});

/** Host-generated controls for native formats, including LADSPA plug-ins without vendor UI. */
export default function NativePluginParameterControls({
	instanceId,
	disabled = false,
	runtime = DEFAULT_RUNTIME,
	copy: copyValue,
}: NativePluginParameterControlsProps) {
	const copy = { ...DEFAULT_COPY, ...copyValue };
	const generation = useRef(0);
	const [snapshot, setSnapshot] = useState<ParameterSnapshot>(() => loadingSnapshot());
	const [pendingIndex, setPendingIndex] = useState<number | null>(null);

	useEffect(() => {
		const current = generation.current + 1;
		generation.current = current;
		setSnapshot(loadingSnapshot());
		setPendingIndex(null);
		void loadParameters(runtime, instanceId).then(
			(value) => { if (generation.current === current) setSnapshot(value); },
			(error: unknown) => { if (generation.current === current) setSnapshot(failedSnapshot(error)); },
		);
		return () => { if (generation.current === current) generation.current += 1; };
	}, [instanceId, runtime]);

	if (snapshot.phase === 'loading') return <p role="status">{copy.loading}</p>;
	if (snapshot.phase === 'failed') return <p role="alert">{snapshot.error || copy.unavailable}</p>;
	if (snapshot.parameters.length === 0) return null;

	const update = async (parameter: NativePluginParameterDescriptor, next: number) => {
		if (disabled || pendingIndex !== null || !normalizedValue(next)) return;
		const current = generation.current;
		setPendingIndex(parameter.index);
		try {
			const applied = await runtime.writeParameter(instanceId, parameter.index, next);
			if (generation.current !== current || !normalizedValue(applied)) return;
			setSnapshot((value) => Object.freeze({
				...value,
				values: Object.freeze(value.values.map((prior, index) => (
					index === parameter.index ? applied : prior
				))),
			}));
		} catch (error) {
			if (generation.current === current) setSnapshot(failedSnapshot(error));
		} finally {
			if (generation.current === current) setPendingIndex(null);
		}
	};

	return <fieldset data-native-plugin-parameter-controls disabled={disabled}>
		<legend>{copy.title}</legend>
		{snapshot.parameters.map((parameter) => {
			const value = snapshot.values[parameter.index] ?? parameter.defaultValue;
			const controlDisabled = disabled || pendingIndex !== null;
			const isBoolean = (parameter.flags & BOOLEAN_PARAMETER_FLAG) !== 0;
			return <label key={parameter.id}>
				<span>{parameter.name}</span>
				{isBoolean ? <input
					data-native-plugin-parameter={parameter.id}
					type="checkbox"
					checked={value >= (parameter.minimumValue + parameter.maximumValue) / 2}
					disabled={controlDisabled}
					onChange={(event) => { void update(parameter, event.currentTarget.checked
						? parameter.maximumValue : parameter.minimumValue); }}
				/> : <input
					data-native-plugin-parameter={parameter.id}
					type="range"
					min={parameter.minimumValue}
					max={parameter.maximumValue}
					step="any"
					value={value}
					disabled={controlDisabled}
					onChange={(event) => { void update(parameter, Number(event.currentTarget.value)); }}
				/>}
				{!isBoolean && <output>{formatValue(value, parameter.label)}</output>}
			</label>;
		})}
	</fieldset>;
}

async function loadParameters(
	runtime: NativePluginParameterRuntime,
	instanceId: string,
): Promise<ParameterSnapshot> {
	const [capabilities, parameters] = await Promise.all([
		runtime.capabilities(instanceId), runtime.describeParameters(instanceId),
	]);
	if (!Number.isSafeInteger(capabilities.parameterCount) || capabilities.parameterCount < 0
		|| capabilities.parameterCount > 4_096 || capabilities.parameterCount !== parameters.length) {
		throw new Error('The plug-in returned inconsistent parameter capabilities.');
	}
	const values = await Promise.all(parameters.map(async ({ index }) => (
		runtime.readParameter(instanceId, index)
	)));
	if (values.some((value) => !normalizedValue(value))) {
		throw new Error('The plug-in returned an invalid parameter value.');
	}
	return Object.freeze({
		phase: 'ready' as const, parameters: Object.freeze([...parameters]),
		values: Object.freeze(values), error: '',
	});
}

function loadingSnapshot(): ParameterSnapshot {
	return Object.freeze({ phase: 'loading', parameters: Object.freeze([]), values: Object.freeze([]), error: '' });
}

function failedSnapshot(error: unknown): ParameterSnapshot {
	return Object.freeze({
		phase: 'failed', parameters: Object.freeze([]), values: Object.freeze([]),
		error: error instanceof Error && error.message ? error.message : DEFAULT_COPY.unavailable,
	});
}

function normalizedValue(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}

function formatValue(value: number, label: string): string {
	return `${value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '')}${label ? ` ${label}` : ''}`;
}
