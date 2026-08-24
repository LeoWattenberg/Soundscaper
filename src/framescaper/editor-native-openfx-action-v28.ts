/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-only selected-V28 authoring for pathless, main-enabled OpenFX effects. */

import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import {
	assertNativeMediaCapabilitySnapshotV1,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../common/editor/native-media-capability-snapshot.ts';
import {
	framescaperOpenFxPluginProjectionV1,
	type FramescaperOpenFxPluginProjectionV1,
} from '../common/editor/native-ofx-service-contract.ts';
import {
	applyFramescaperOpenFxInteractMutationsV1,
	framescaperOpenFxInteractRequestV1,
	framescaperOpenFxInteractResultV1,
	type FramescaperOpenFxInteractRequestV1,
	type FramescaperOpenFxInteractResultV1,
} from '../common/editor/native-ofx-interact-contract.ts';
import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	composeFramescaperNativeProjectActionRuntimes,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	type FramescaperNativeProjectActionRuntime,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import { attestFramescaperOpenFxEffectV26 } from './editor-native-openfx-authoring-v26.ts';
import {
	createFramescaperOpenFxAuthoringDraftV28,
	createFramescaperOpenFxAuthoringModelV28,
	type FramescaperOpenFxAuthoringDraftV28,
	type FramescaperOpenFxAuthoringModelV28,
	type FramescaperOpenFxAuthoringRequestV28,
} from './editor-native-openfx-authoring-model-v28.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

const SURFACES = Object.freeze(['ofx-add'] as const);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface OpenFxControllerV28 {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{
			commit(command: unknown): PromiseLike<unknown> | unknown;
			undo(): PromiseLike<unknown> | unknown;
		}>;
		readonly project: Readonly<{ save(): PromiseLike<unknown> | unknown }>;
	}>;
}

export type FramescaperNativeOpenFxActionBridgeV28 = Required<Pick<
	FramescaperNativeServicesBridge,
	'capabilities' | 'listOpenFxPlugins'
>>;

export interface BindFramescaperNativeOpenFxActionV28Options {
	readonly profile: unknown;
	readonly owner: OpenFxControllerV28;
	readonly bridge: FramescaperNativeOpenFxActionBridgeV28;
	readonly mintId?: () => string;
}

export interface FramescaperNativeOpenFxAuthoringRuntimeV28 {
	model(): Promise<FramescaperOpenFxAuthoringModelV28>;
	author(request: FramescaperOpenFxAuthoringRequestV28): Promise<void>;
	interactModel(): Promise<FramescaperOpenFxInteractAuthoringModelV28>;
	commitInteract(
		request: FramescaperOpenFxInteractRequestV1,
		result: FramescaperOpenFxInteractResultV1,
	): Promise<FramescaperOpenFxInteractInstanceV28>;
}

export interface FramescaperOpenFxInteractInstanceV28 {
	readonly project: Readonly<{ readonly id: string; readonly revision: number }>;
	readonly pluginHandle: string;
	readonly effect: OfxEffectStateV26;
	readonly label: string;
	readonly customParameterNames: readonly string[];
}

export interface FramescaperOpenFxInteractAuthoringModelV28 {
	readonly instances: readonly FramescaperOpenFxInteractInstanceV28[];
}

const AUTHORING_RUNTIMES = new WeakMap<object, FramescaperNativeOpenFxAuthoringRuntimeV28>();

export function framescaperNativeOpenFxActionBridgeAvailableV28(
	value: unknown,
): value is FramescaperNativeOpenFxActionBridgeV28 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return typeof bridge.capabilities === 'function' && typeof bridge.listOpenFxPlugins === 'function';
}

/** Compose into Effect > Video Effects; this creates no always-visible UI. */
export function bindFramescaperNativeOpenFxActionV28(
	options: BindFramescaperNativeOpenFxActionV28Options,
): FramescaperNativeProjectActionRuntime {
	assertOptions(options);
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected V28 OpenFX authoring requires its existing native action runtime.');
	if (existing.surfaces.includes('ofx-add')) throw new Error('Selected V28 OpenFX authoring is already bound.');
	const mintId = options.mintId ?? (() => `ofx-${globalThis.crypto.randomUUID()}`);
	const author = serializeRequest((request: FramescaperOpenFxAuthoringRequestV28) => (
		authorEffect(options, mintId, request)
	));
	const authoring = Object.freeze({
		model: () => loadAuthoringModel(options),
		author,
		interactModel: () => loadInteractModel(options),
		commitInteract: serializeOperation((
			request: FramescaperOpenFxInteractRequestV1,
			result: FramescaperOpenFxInteractResultV1,
		) => (
			commitInteractResult(options, request, result)
		)),
	});
	const runtime = composeFramescaperNativeProjectActionRuntimes([
		existing,
		createFramescaperNativeProjectActionSubsetRuntime(SURFACES, {
			'ofx-add': serialize(() => addSelectedFilter(options, mintId)),
		}),
	]);
	bindFramescaperNativeProjectActionRuntime(options.owner, runtime);
	AUTHORING_RUNTIMES.set(options.owner, authoring);
	return runtime;
}

export function framescaperNativeOpenFxAuthoringRuntimeForV28(
	owner: unknown,
): FramescaperNativeOpenFxAuthoringRuntimeV28 | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? AUTHORING_RUNTIMES.get(owner as object) ?? null : null;
}

async function loadAuthoringModel(
	options: BindFramescaperNativeOpenFxActionV28Options,
): Promise<FramescaperOpenFxAuthoringModelV28> {
	const initial = cloneFramescaperProjectV28(options.profile, options.owner.project);
	const plugins = await enabledPlugins(options);
	assertCurrent(options, initial);
	return createFramescaperOpenFxAuthoringModelV28(initial, plugins);
}

async function loadInteractModel(
	options: BindFramescaperNativeOpenFxActionV28Options,
): Promise<FramescaperOpenFxInteractAuthoringModelV28> {
	const initial = cloneFramescaperProjectV28(options.profile, options.owner.project);
	const plugins = await enabledPlugins(options);
	assertCurrent(options, initial);
	return interactModel(initial, plugins);
}

async function addSelectedFilter(
	options: BindFramescaperNativeOpenFxActionV28Options,
	mintId: () => string,
): Promise<void> {
	const initial = cloneFramescaperProjectV28(options.profile, options.owner.project);
	const model = createFramescaperOpenFxAuthoringModelV28(initial, await enabledPlugins(options));
	assertCurrent(options, initial);
	const plugin = selectDefaultPlugin(model.plugins);
	const { clipId } = selectedVideoClip(initial);
	const targets = model.targets.filter(({ context, targetId }) => (
		context === 'filter' && targetId === clipId
	));
	if (targets.length !== 1) {
		throw new Error('Selected V28 OpenFX authoring requires exactly one selected video clip.');
	}
	await commitAuthoringRequest(options, mintId, initial, model, {
		pluginHandle: plugin.pluginHandle,
		context: 'filter',
		targetId: targets[0]!.targetId,
		inputs: targets[0]!.inputs,
		parameters: Object.freeze([]),
		customEncodings: Object.freeze({}),
	});
}

async function authorEffect(
	options: BindFramescaperNativeOpenFxActionV28Options,
	mintId: () => string,
	request: FramescaperOpenFxAuthoringRequestV28,
): Promise<void> {
	const initial = cloneFramescaperProjectV28(options.profile, options.owner.project);
	const model = createFramescaperOpenFxAuthoringModelV28(initial, await enabledPlugins(options));
	assertCurrent(options, initial);
	await commitAuthoringRequest(options, mintId, initial, model, request);
}

async function commitAuthoringRequest(
	options: BindFramescaperNativeOpenFxActionV28Options,
	mintId: () => string,
	initial: FramescaperProjectV28,
	model: FramescaperOpenFxAuthoringModelV28,
	request: FramescaperOpenFxAuthoringRequestV28,
): Promise<void> {
	const plugin = model.plugins.find(({ pluginHandle }) => pluginHandle === request.pluginHandle);
	if (!plugin) throw new Error('The selected OpenFX plug-in is stale.');
	const authored = createFramescaperOpenFxAuthoringDraftV28(model, request, mintId);
	// The renderer projection omits the native descriptor fields needed for the
	// main's exact freshness digest. With no frozen fallback, conservative
	// renderer digests can only make future recovery bypass; main independently
	// derives exact freshness before every available plug-in execution.
	const effect = effectWithFreshness(initial, plugin, authored);
	assertCurrent(options, initial);
	await commitWithRollback(options.owner, Object.freeze({
		type: 'openfx-effect/set' as const,
		instanceId: effect.instanceId,
		expectedEffect: null,
		effect,
	}));
}

async function commitInteractResult(
	options: BindFramescaperNativeOpenFxActionV28Options,
	requestValue: FramescaperOpenFxInteractRequestV1,
	resultValue: FramescaperOpenFxInteractResultV1,
): Promise<FramescaperOpenFxInteractInstanceV28> {
	const request = framescaperOpenFxInteractRequestV1(requestValue);
	const result = framescaperOpenFxInteractResultV1(resultValue, request);
	const initial = cloneFramescaperProjectV28(options.profile, options.owner.project);
	assertInteractCurrent(initial, request);
	const plugins = await enabledPlugins(options);
	assertCurrent(options, initial);
	const model = interactModel(initial, plugins);
	const selected = model.instances.find(({ effect }) => effect.instanceId === request.effect.instanceId);
	if (!selected || selected.pluginHandle !== request.pluginHandle) {
		throw new Error('The selected V28 OpenFX Interact instance or plug-in identity is stale.');
	}
	if (result.parameterMutations.length === 0) return selected;
	const plugin = plugins.find(({ pluginHandle }) => pluginHandle === selected.pluginHandle)!;
	const mutated = applyFramescaperOpenFxInteractMutationsV1(request.effect, result.parameterMutations);
	const { freshness: unusedFreshness, frozenFallback: unusedFallback, ...authored } = mutated;
	void unusedFreshness; void unusedFallback;
	const effect = effectWithFreshness(initial, plugin, authored);
	assertCurrent(options, initial);
	await commitWithRollback(options.owner, Object.freeze({
		type: 'openfx-effect/set' as const, instanceId: effect.instanceId,
		expectedEffect: request.effect, effect,
	}));
	const committed = cloneFramescaperProjectV28(options.profile, options.owner.project);
	const instance = interactModel(committed, plugins).instances.find(({ effect: value }) => (
		value.instanceId === effect.instanceId
	));
	if (!instance) throw new Error('The committed V28 OpenFX Interact instance is unavailable.');
	return instance;
}

function interactModel(
	project: FramescaperProjectV28,
	plugins: readonly FramescaperOpenFxPluginProjectionV1[],
): FramescaperOpenFxInteractAuthoringModelV28 {
	const projectIdentity = exactProjectIdentity(project);
	const instances = project.ofxEffects.flatMap((effect) => {
		const plugin = plugins.find((candidate) => candidate.pluginId === effect.pluginId
			&& candidate.binarySha256 === effect.binarySha256
			&& candidate.supportedContexts.includes(effect.context)
			&& exactParameterProjection(candidate, effect));
		if (!plugin) return [];
		return [deepFreeze({
			project: projectIdentity,
			pluginHandle: plugin.pluginHandle,
			effect: structuredClone(effect),
			label: `${effect.pluginId} — ${effect.attachment.targetId} — ${effect.instanceId}`,
			customParameterNames: plugin.parameters
				.filter(({ type }) => type === 'custom').map(({ name }) => name),
		})];
	});
	return deepFreeze({ instances });
}

function assertInteractCurrent(
	project: FramescaperProjectV28,
	request: FramescaperOpenFxInteractRequestV1,
): void {
	const identity = exactProjectIdentity(project);
	if (identity.id !== request.project.id || identity.revision !== request.project.revision) {
		throw new Error('The selected V28 project revision changed during OpenFX Interact.');
	}
	const matches = project.ofxEffects.filter(({ instanceId }) => instanceId === request.effect.instanceId);
	if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(request.effect)) {
		throw new Error('The selected V28 OpenFX Interact instance identity or state is stale.');
	}
}

function exactParameterProjection(
	plugin: FramescaperOpenFxPluginProjectionV1,
	effect: OfxEffectStateV26,
): boolean {
	return plugin.parameters.length === effect.parameters.length
		&& plugin.parameters.every((descriptor, index) => {
			const state = effect.parameters[index];
			return state?.name === descriptor.name && state.type === descriptor.type
				&& (descriptor.animates || state.keyframes.length === 0);
		});
}

function effectWithFreshness(
	project: FramescaperProjectV28,
	plugin: FramescaperOpenFxPluginProjectionV1,
	authored: FramescaperOpenFxAuthoringDraftV28,
): OfxEffectStateV26 {
	const identity = exactProjectIdentity(project);
	const freshness = Object.freeze({
		authoredStateSha256: digest(authored),
		inputIdentitiesSha256: digest({
			attachment: authored.attachment, inputs: authored.inputs, project,
		}),
		renderPlanFingerprintSha256: digest({
			projectId: identity.id, projectRevision: identity.revision, authored,
		}),
		nativeEffectFingerprintSha256: digest({ projection: plugin }),
	});
	return attestFramescaperOpenFxEffectV26(plugin, Object.freeze({
		...authored, freshness, frozenFallback: null,
	}));
}

function exactProjectIdentity(
	project: FramescaperProjectV28,
): Readonly<{ readonly id: string; readonly revision: number }> {
	const id = stableId(project.id, 'selected V28 project ID');
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new TypeError('The selected V28 project revision is invalid.');
	}
	return Object.freeze({ id, revision: Number(project.revision) });
}

async function enabledPlugins(
	options: BindFramescaperNativeOpenFxActionV28Options,
): Promise<readonly FramescaperOpenFxPluginProjectionV1[]> {
	const bridge = exactBridge(options.bridge);
	const snapshotValue = structuredClone(await bridge.capabilities.call(bridge));
	assertNativeMediaCapabilitySnapshotV1(snapshotValue);
	const capability = nativeMediaCapabilityEntry(
		snapshotValue, NATIVE_MEDIA_CAPABILITY_IDS.ofxHost.domain,
		NATIVE_MEDIA_CAPABILITY_IDS.ofxHost.id,
	);
	if (!isNativeMediaCapabilityUsable(capability)) {
		throw new Error('Selected V28 OpenFX authoring is unavailable in the exact native runtime.');
	}
	const value = await bridge.listOpenFxPlugins.call(bridge);
	if (!Array.isArray(value) || value.length > 1_024
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Selected V28 OpenFX inventory must be a bounded dense array.');
	}
	return Object.freeze(value.map(framescaperOpenFxPluginProjectionV1));
}

async function commitWithRollback(owner: OpenFxControllerV28, command: unknown): Promise<void> {
	let committed = false;
	try {
		await owner.actions.edit.commit(command); committed = true;
		await owner.actions.project.save();
	} catch (error) {
		if (!committed) throw error;
		try { await owner.actions.edit.undo(); }
		catch (undoError) {
			throw new AggregateError(
				[error, undoError], 'Selected V28 OpenFX save rollback failed.', { cause: error },
			);
		}
		throw error;
	}
}

function selectDefaultPlugin(
	value: readonly FramescaperOpenFxPluginProjectionV1[],
): FramescaperOpenFxPluginProjectionV1 {
	const eligible = value.filter((plugin) => (
		plugin.state === 'enabled' && !plugin.quarantined
		&& plugin.supportedContexts.includes('filter')
		&& plugin.components.includes('RGBA') && plugin.pixelDepths.includes('byte')
		&& plugin.parameters.length === 0
	));
	if (eligible.length !== 1) {
		throw new Error('Selected V28 OpenFX authoring requires exactly one unambiguous parameterless RGBA8 filter.');
	}
	return eligible[0]!;
}

function selectedVideoClip(project: FramescaperProjectV28): Readonly<{
	readonly clipId: string; readonly sourceId: string; readonly source: unknown;
}> {
	const selection = record(project.selection, 'selected V28 selection');
	const clipIds = selection.clipIds;
	if (!Array.isArray(clipIds) || clipIds.length !== 1) {
		throw new Error('Selected V28 OpenFX authoring requires exactly one selected video clip.');
	}
	const clipId = stableId(clipIds[0], 'selected video clip ID');
	const clip = records(project.clips, 'selected V28 clips').find(({ id }) => id === clipId);
	if (!clip || clip.kind !== 'video') {
		throw new Error('Selected V28 OpenFX authoring requires exactly one selected video clip.');
	}
	const sourceId = stableId(clip.sourceId, 'selected video source ID');
	const source = project.sources.find(({ id }) => id === sourceId);
	if (!source || source.kind !== 'video') throw new Error('The selected OpenFX video source is unavailable.');
	return Object.freeze({ clipId, sourceId, source: structuredClone(source) });
}

function assertCurrent(
	options: BindFramescaperNativeOpenFxActionV28Options,
	expected: FramescaperProjectV28,
): void {
	const current = cloneFramescaperProjectV28(options.profile, options.owner.project);
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new Error('The selected V28 project changed during OpenFX authoring.');
	}
}

function exactBridge(value: unknown): FramescaperNativeOpenFxActionBridgeV28 {
	if (!framescaperNativeOpenFxActionBridgeAvailableV28(value)) {
		throw new Error('Selected V28 OpenFX authoring requires the authenticated desktop bridge.');
	}
	return value;
}

function assertOptions(options: BindFramescaperNativeOpenFxActionV28Options): void {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| !options.owner || typeof options.owner !== 'object'
		|| !options.owner.actions || typeof options.owner.actions.edit?.commit !== 'function'
		|| typeof options.owner.actions.edit.undo !== 'function'
		|| typeof options.owner.actions.project?.save !== 'function'
		|| !framescaperNativeOpenFxActionBridgeAvailableV28(options.bridge)
		|| (options.mintId !== undefined && typeof options.mintId !== 'function')) {
		throw new TypeError('Selected V28 OpenFX authoring requires exact controller and desktop ports.');
	}
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${label} is invalid.`);
	return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	return value.map((entry, index) => record(entry, `${label}[${String(index)}]`));
}

function digest(value: unknown): string { return fingerprintNativeMediaPlan(value).sha256; }

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function serialize(operation: () => Promise<void>): () => Promise<void> {
	let tail = Promise.resolve();
	return () => {
		const current = tail.then(operation, operation);
		tail = current.then(() => undefined, () => undefined);
		return current;
	};
}

function serializeRequest<Request>(
	operation: (request: Request) => Promise<void>,
): (request: Request) => Promise<void> {
	let tail = Promise.resolve();
	return (request) => {
		const current = tail.then(() => operation(request), () => operation(request));
		tail = current.then(() => undefined, () => undefined);
		return current;
	};
}

function serializeOperation<Request, Result>(
	operation: (request: Request, result: FramescaperOpenFxInteractResultV1) => Promise<Result>,
): (request: Request, result: FramescaperOpenFxInteractResultV1) => Promise<Result> {
	let tail = Promise.resolve();
	return (request, result) => {
		const current = tail.then(
			() => operation(request, result), () => operation(request, result),
		);
		tail = current.then(() => undefined, () => undefined);
		return current;
	};
}
