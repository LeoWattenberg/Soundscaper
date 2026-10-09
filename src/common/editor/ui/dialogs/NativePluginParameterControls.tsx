/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import {
	describeNativePluginRuntimeParameters,
	nativePluginRuntimeCapabilities,
	readNativePluginRuntimeParameter,
	type NativePluginParameterDescriptor,
	type NativePluginParameterRuntime,
	writeNativePluginRuntimeParameter,
} from './native-plugin-parameter-runtime.ts';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../../../i18n/editor-soundscaper-native-services-copy.ts';
import { trackNativePluginParameterWrites } from './native-plugin-parameter-write-drain.ts';

const BOOLEAN_PARAMETER_FLAG = 1;

export type {
	NativePluginParameterCapabilities,
	NativePluginParameterDescriptor,
	NativePluginParameterRuntime,
} from './native-plugin-parameter-runtime.ts';

export interface NativePluginParameterControlsCopy {
	readonly title: string;
	readonly loading: string;
	readonly unavailable: string;
}

export interface NativePluginParameterControlsProps {
	readonly instanceId: string;
	readonly stateGeneration?: number;
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

interface ParameterWriteSession {
	readonly generation: number;
	readonly pending: Map<number, number>;
	confirmed: number[];
	operation: Promise<void> | null;
}

const DEFAULT_COPY = Object.freeze({
	title: SOUNDSCAPER_NATIVE_SERVICES_COPY.pluginParametersTitle,
	loading: SOUNDSCAPER_NATIVE_SERVICES_COPY.pluginParametersLoading,
	unavailable: SOUNDSCAPER_NATIVE_SERVICES_COPY.pluginParametersUnavailable,
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
	stateGeneration = 0,
	disabled = false,
	runtime = DEFAULT_RUNTIME,
	copy: copyValue,
}: NativePluginParameterControlsProps) {
	const copy = { ...DEFAULT_COPY, ...copyValue };
	const generation = useRef(0);
	const writeSession = useRef<ParameterWriteSession | null>(null);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	const [snapshot, setSnapshot] = useState<ParameterSnapshot>(() => loadingSnapshot());

	useEffect(() => {
		const current = generation.current + 1;
		generation.current = current;
		const session: ParameterWriteSession = { generation: current, pending: new Map(), confirmed: [], operation: null };
		writeSession.current = session;
		setSnapshot(loadingSnapshot());
		void loadParameters(runtime, instanceId).then(
			(value) => {
				if (generation.current !== current) return;
				session.confirmed = [...value.values];
				setSnapshot(value);
			},
			(error: unknown) => { if (generation.current === current) setSnapshot(failedSnapshot(error)); },
		);
		return () => { if (generation.current === current) generation.current += 1; };
	}, [instanceId, runtime, stateGeneration]);
	useEffect(() => {
		if (!disabled || !writeSession.current) return;
		const session = writeSession.current;
		session.pending.clear();
		setSnapshot((value) => ({ ...value, values: [...session.confirmed] }));
	}, [disabled]);

	if (snapshot.phase === 'loading') return <p role="status">{copy.loading}</p>;
	if (snapshot.phase === 'failed') return <p role="alert">{snapshot.error || copy.unavailable}</p>;
	if (snapshot.parameters.length === 0) return null;

	const drain = async (session: ParameterWriteSession) => {
		try {
			while (generation.current === session.generation && !disabledRef.current && session.pending.size) {
				const [index, next] = session.pending.entries().next().value!;
				session.pending.delete(index);
				const applied = await runtime.writeParameter(instanceId, index, next);
				if (generation.current !== session.generation) return;
				if (normalizedValue(applied)) session.confirmed[index] = applied;
				if (!session.pending.has(index)) setSnapshot((value) => Object.freeze({
					...value,
					values: Object.freeze(value.values.map((prior, position) => (
						position === index ? session.confirmed[index] ?? prior : prior
					))),
				}));
			}
		} catch (error) {
			session.pending.clear();
			if (generation.current === session.generation) setSnapshot(failedSnapshot(error));
			throw error;
		} finally {
			session.operation = null;
		}
	};
	const update = (parameter: NativePluginParameterDescriptor, next: number) => {
		const session = writeSession.current;
		if (disabled || !session || !normalizedValue(next)) return;
		session.pending.set(parameter.index, next);
		setSnapshot((value) => ({ ...value, values: value.values.map((prior, index) => (
			index === parameter.index ? next : prior
		)) }));
		if (!session.operation) {
			const operation = drain(session);
			session.operation = operation;
			trackNativePluginParameterWrites(instanceId, operation);
			void operation.catch(() => undefined);
		}
	};

	return <fieldset data-native-plugin-parameter-controls disabled={disabled}>
		<legend>{copy.title}</legend>
		{snapshot.parameters.map((parameter) => {
			const value = snapshot.values[parameter.index] ?? parameter.defaultValue;
			const controlDisabled = disabled;
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
					onDoubleClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void update(parameter, parameter.defaultValue);
					}}
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
