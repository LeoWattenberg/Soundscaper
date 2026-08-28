/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lazy, menu-owned authoring surface for every baseline OpenFX context. */

import React, { useEffect, useMemo, useState } from 'react';

import type { OfxParameterStateV1 } from '../../native-ofx-binding.ts';
import type { OfxParameterDescriptorV1 } from '../../native-ofx-descriptor.ts';
import { framescaperOpenFxPluginProjectionV1 } from '../../native-ofx-service-contract.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_COPY,
	type FramescaperNativeServicesCopy,
} from '../framescaper-native-services-copy.ts';
import type { FramescaperNativeOpenFxAuthoringRuntimeNativeMedia } from '../../../../framescaper/editor-native-openfx-action.ts';
import {
	createFramescaperOpenFxAuthoringDraftNativeMedia,
	defaultFramescaperOpenFxParameterStateNativeMedia,
	type FramescaperOpenFxAuthoringModelNativeMedia,
	type FramescaperOpenFxAuthoringRequestNativeMedia,
} from '../../../../framescaper/editor-native-openfx-authoring-model.ts';

export interface FramescaperOpenFxFormState {
	readonly pluginHandle: string;
	readonly context: FramescaperOpenFxAuthoringRequestNativeMedia['context'];
	readonly targetId: string;
	readonly values: Readonly<Record<string, string | boolean>>;
	readonly keyframes: Readonly<Record<string, string>>;
	readonly customEncodings: Readonly<Record<string, string>>;
}

export default function FramescaperOpenFxAddPanel({ runtime, copy }: Readonly<{
	runtime: FramescaperNativeOpenFxAuthoringRuntimeNativeMedia;
	copy: FramescaperNativeServicesCopy;
}>) {
	const [model, setModel] = useState<FramescaperOpenFxAuthoringModelNativeMedia | null>(null);
	const [error, setError] = useState('');
	useEffect(() => {
		let live = true;
		void runtime.model().then(
			(value) => { if (live) setModel(value); },
			(failure: unknown) => { if (live) setError(message(failure)); },
		);
		return () => { live = false; };
	}, [runtime]);
	if (error) return <p role="alert">{error}</p>;
	if (model === null) return <p role="status" aria-live="polite">{copy.ofxLoading}</p>;
	if (model.plugins.length === 0 || model.targets.length === 0) {
		return <p role="status">{copy.ofxNoCompatibleTarget}</p>;
	}
	return <FramescaperOpenFxAddForm model={model} copy={copy}
		onAuthor={(request) => runtime.author(request)} />;
}

export function FramescaperOpenFxAddForm({ model, onAuthor,
	copy = FRAMESCAPER_NATIVE_SERVICES_COPY }: Readonly<{
	model: FramescaperOpenFxAuthoringModelNativeMedia;
	onAuthor: (request: FramescaperOpenFxAuthoringRequestNativeMedia) => PromiseLike<void> | void;
	copy?: FramescaperNativeServicesCopy;
}>) {
	const initial = useMemo(() => createFramescaperOpenFxFormState(model), [model]);
	const [state, setState] = useState(initial);
	const [status, setStatus] = useState<'ready' | 'working' | 'complete'>('ready');
	const [error, setError] = useState('');
	const plugin = pluginFor(model, state.pluginHandle);
	const contexts = plugin.supportedContexts.filter((context) => (
		model.targets.some((target) => target.context === context)
	));
	const targets = model.targets.filter(({ context }) => context === state.context);
	const target = targets.find(({ targetId }) => targetId === state.targetId) ?? null;
	const selectPlugin = (pluginHandle: string): void => {
		setState(stateForPlugin(model, pluginHandle));
		setStatus('ready'); setError('');
	};
	const selectContext = (contextValue: string): void => {
		const context = plugin.supportedContexts.find((candidate) => candidate === contextValue);
		const nextTarget = context === undefined ? undefined
			: model.targets.find((candidate) => candidate.context === context);
		if (!context || !nextTarget) return;
		setState((current) => ({ ...current, context, targetId: nextTarget.targetId }));
	};
	const submit = (event: React.FormEvent): void => {
		event.preventDefault(); setStatus('working'); setError('');
		let request: FramescaperOpenFxAuthoringRequestNativeMedia;
		try { request = buildFramescaperOpenFxAuthoringRequestNativeMedia(model, state); }
		catch (failure) { setStatus('ready'); setError(message(failure)); return; }
		void Promise.resolve(onAuthor(request)).then(
			() => setStatus('complete'),
			(failure: unknown) => { setStatus('ready'); setError(message(failure)); },
		);
	};
	return <form onSubmit={submit} data-framescaper-openfx-add-form="true">
		<p role={error ? 'alert' : 'status'} aria-live="polite">{error || (status === 'working'
			? copy.ofxAuthoring : status === 'complete' ? copy.ofxAdded : '')}</p>
		<label>{copy.ofxPlugin}
			<select value={state.pluginHandle} disabled={status === 'working'}
				onChange={(event) => selectPlugin(event.currentTarget.value)}>
				{model.plugins.map((candidate) => <option key={candidate.pluginHandle}
					value={candidate.pluginHandle}>{pluginLabel(candidate)}</option>)}
			</select>
		</label>
		<label>{copy.ofxContext}
			<select value={state.context} disabled={status === 'working'}
				onChange={(event) => selectContext(event.currentTarget.value)}>
				{contexts.map((context) => <option key={context} value={context}>{context}</option>)}
			</select>
		</label>
		<label>{copy.ofxProjectTarget}
			<select value={state.targetId} disabled={status === 'working'}
				onChange={(event) => setState((current) => ({
					...current, targetId: event.currentTarget.value,
				}))}>
				{targets.map((candidate) => <option key={candidate.targetId}
					value={candidate.targetId}>{candidate.label}</option>)}
			</select>
		</label>
		{target !== null && <fieldset><legend>{copy.ofxNamedInputs}</legend><dl>
			{target.inputs.map((input) => <React.Fragment key={input.name}>
				<dt>{input.name}</dt><dd><code>{input.sourceRef}</code></dd>
			</React.Fragment>)}
		</dl></fieldset>}
		<fieldset disabled={status === 'working'}><legend>{copy.ofxParameters}</legend>
			{plugin.parameters.map((parameter) => <ParameterControl key={parameter.name}
				parameter={parameter}
				value={state.values[parameter.name] ?? ''}
				keyframes={state.keyframes[parameter.name] ?? '[]'}
				customEncoding={state.customEncodings[parameter.name] ?? ''}
				copy={copy}
				onValue={(value) => setState((current) => ({
					...current, values: { ...current.values, [parameter.name]: value },
				}))}
				onKeyframes={(value) => setState((current) => ({
					...current, keyframes: { ...current.keyframes, [parameter.name]: value },
				}))}
				onCustomEncoding={(value) => setState((current) => ({
					...current, customEncodings: {
						...current.customEncodings, [parameter.name]: value,
					},
				}))}
			/>)}
		</fieldset>
		<p><button type="submit" disabled={status === 'working'}
			data-framescaper-openfx-author="true">{copy.ofxAuthor}</button></p>
	</form>;
}

function ParameterControl({
	parameter, value, keyframes, customEncoding, onValue, onKeyframes, onCustomEncoding, copy,
}: Readonly<{
	parameter: OfxParameterDescriptorV1;
	value: string | boolean;
	keyframes: string;
	customEncoding: string;
	onValue: (value: string | boolean) => void;
	onKeyframes: (value: string) => void;
	onCustomEncoding: (value: string) => void;
	copy: FramescaperNativeServicesCopy;
}>) {
	const valueless = parameter.type === 'group' || parameter.type === 'page';
	return <div data-openfx-parameter-type={parameter.type}>
		{valueless ? <p>{template(copy.ofxParameterKind, parameter)}</p>
			: parameter.type === 'pushbutton' ? <button type="button">{parameter.name}</button>
				: parameter.type === 'boolean' ? <label>
					<input type="checkbox" checked={value === true}
						onChange={(event) => onValue(event.currentTarget.checked)} /> {parameter.name}
				</label>
					: textParameter(parameter.type) ? <label>{parameter.name}
						<input type="text" value={String(value)}
							onChange={(event) => onValue(event.currentTarget.value)} />
					</label>
						: <label>{template(copy.ofxParameterJson, parameter)}
							<textarea value={String(value)}
								onChange={(event) => onValue(event.currentTarget.value)} />
						</label>}
		{parameter.animates && <label>{template(copy.ofxKeyframesJson, parameter)}
			<textarea value={keyframes} onChange={(event) => onKeyframes(event.currentTarget.value)} />
		</label>}
		{parameter.type === 'custom' && <label>{template(copy.ofxCustomEncoding, parameter)}
			<textarea value={customEncoding}
				onChange={(event) => onCustomEncoding(event.currentTarget.value)} />
		</label>}
	</div>;
}

export function createFramescaperOpenFxFormState(
	model: FramescaperOpenFxAuthoringModelNativeMedia,
): FramescaperOpenFxFormState {
	if (model.plugins.length === 0) throw new Error('No enabled OpenFX plug-in is available.');
	return stateForPlugin(model, model.plugins[0]!.pluginHandle);
}

function stateForPlugin(
	model: FramescaperOpenFxAuthoringModelNativeMedia,
	pluginHandle: string,
): FramescaperOpenFxFormState {
	const plugin = pluginFor(model, pluginHandle);
	const target = model.targets.find(({ context }) => plugin.supportedContexts.includes(context));
	if (!target) throw new Error('The selected OpenFX plug-in has no compatible project target.');
	const defaults = defaultFramescaperOpenFxParameterStateNativeMedia(plugin);
	return Object.freeze({
		pluginHandle: plugin.pluginHandle, context: target.context, targetId: target.targetId,
		values: Object.freeze(Object.fromEntries(defaults.map(({ name, value }) => [
			name, typeof value === 'boolean' ? value
				: typeof value === 'string' ? value : JSON.stringify(value),
		]))),
		keyframes: Object.freeze(Object.fromEntries(defaults.map(({ name, keyframes }) => [
			name, JSON.stringify(keyframes),
		]))),
		customEncodings: Object.freeze(Object.fromEntries(defaults
			.filter(({ type }) => type === 'custom').map(({ name, value }) => [name, String(value)]))),
	});
}

export function buildFramescaperOpenFxAuthoringRequestNativeMedia(
	model: FramescaperOpenFxAuthoringModelNativeMedia,
	state: FramescaperOpenFxFormState,
): FramescaperOpenFxAuthoringRequestNativeMedia {
	const plugin = pluginFor(model, state.pluginHandle);
	if (!plugin.supportedContexts.includes(state.context)) {
		throw new Error('The selected OpenFX context is stale.');
	}
	const targets = model.targets.filter(({ context, targetId }) => (
		context === state.context && targetId === state.targetId
	));
	if (targets.length !== 1) throw new Error('The selected OpenFX target is stale or ambiguous.');
	const parameters = plugin.parameters.map((descriptor): OfxParameterStateV1 => Object.freeze({
		name: descriptor.name,
		type: descriptor.type,
		value: parseValue(descriptor, state.values[descriptor.name]),
		keyframes: parseKeyframes(descriptor, state.keyframes[descriptor.name]),
	}));
	const customEncodings = Object.freeze(Object.fromEntries(plugin.parameters
		.filter(({ type }) => type === 'custom')
		.map(({ name }) => [name, requiredText(state.customEncodings[name], `${name} custom encoding`)])));
	const request = Object.freeze({
		pluginHandle: plugin.pluginHandle,
		context: state.context,
		targetId: state.targetId,
		inputs: targets[0]!.inputs,
		parameters: Object.freeze(parameters),
		customEncodings,
	});
	createFramescaperOpenFxAuthoringDraftNativeMedia(model, request, () => 'preview-request');
	return request;
}

function pluginFor(model: FramescaperOpenFxAuthoringModelNativeMedia, handle: string) {
	const plugin = model.plugins.find(({ pluginHandle }) => pluginHandle === handle);
	if (!plugin) throw new Error('The selected OpenFX plug-in is stale.');
	return framescaperOpenFxPluginProjectionV1(plugin);
}

function parseValue(parameter: OfxParameterDescriptorV1, value: string | boolean | undefined): unknown {
	if (parameter.type === 'group' || parameter.type === 'page' || parameter.type === 'pushbutton') return null;
	if (parameter.type === 'boolean') {
		if (typeof value !== 'boolean') throw new TypeError(`${parameter.name} must be boolean.`);
		return value;
	}
	if (parameter.type === 'string' || parameter.type === 'custom') {
		return requiredText(value, `${parameter.name} value`);
	}
	if (parameter.type === 'integer' || parameter.type === 'choice') {
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed)) throw new TypeError(`${parameter.name} must be an integer.`);
		return parsed;
	}
	return parseJson(requiredText(value, `${parameter.name} parameter`), `${parameter.name} parameter`);
}

function parseKeyframes(
	parameter: OfxParameterDescriptorV1,
	value: string | undefined,
): readonly Readonly<{ frame: number; value: number }>[] {
	if (!parameter.animates) return Object.freeze([]);
	const parsed = parseJson(requiredText(value, `${parameter.name} keyframes`), `${parameter.name} keyframes`);
	if (!Array.isArray(parsed)) throw new TypeError(`${parameter.name} keyframes must be a JSON array.`);
	return parsed as readonly Readonly<{ frame: number; value: number }>[];
}

function requiredText(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be text.`);
	return value;
}

function parseJson(value: string, name: string): unknown {
	try { return JSON.parse(value) as unknown; }
	catch (cause) { throw new TypeError(`${name} must be valid JSON.`, { cause }); }
}

function textParameter(type: OfxParameterDescriptorV1['type']): boolean {
	return type === 'integer' || type === 'choice' || type === 'string' || type === 'custom';
}

function pluginLabel(plugin: ReturnType<typeof framescaperOpenFxPluginProjectionV1>): string {
	return `${plugin.pluginId} ${String(plugin.version.major)}.${String(plugin.version.minor)}`;
}

function template(value: string, parameter: OfxParameterDescriptorV1): string {
	return value.replace('{name}', parameter.name).replace('{type}', parameter.type);
}

function message(value: unknown): string { return value instanceof Error ? value.message : String(value); }
