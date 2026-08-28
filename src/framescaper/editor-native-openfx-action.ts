/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-only selected-baseline authoring for pathless, main-enabled OpenFX effects. */

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
	adoptFramescaperNativeOpenFxAuthoringRuntimeNativeMedia as adoptRegisteredOpenFxRuntime,
	bindFramescaperNativeOpenFxAuthoringRuntimeNativeMedia as bindRegisteredOpenFxRuntime,
	framescaperNativeOpenFxAuthoringRuntimeForNativeMedia as registeredOpenFxRuntimeFor,
} from '../common/editor/framescaper-native-openfx-authoring-runtime-registry.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	composeFramescaperNativeProjectActionRuntimes,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	type FramescaperNativeProjectActionRuntime,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import { attestFramescaperOpenFxEffectOpenFx } from './editor-native-openfx-authoring.ts';
import {
	createFramescaperOpenFxAuthoringDraftNativeMedia,
	createFramescaperOpenFxAuthoringModelNativeMedia,
	type FramescaperOpenFxAuthoringDraftNativeMedia,
	type FramescaperOpenFxAuthoringModelNativeMedia,
	type FramescaperOpenFxAuthoringRequestNativeMedia,
} from './editor-native-openfx-authoring-model.ts';
import { cloneFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

const SURFACES = Object.freeze(['ofx-add'] as const);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface OpenFxControllerNativeMedia {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{
			commit(command: unknown): PromiseLike<unknown> | unknown;
			undo(): PromiseLike<unknown> | unknown;
		}>;
		readonly project: Readonly<{ save(): PromiseLike<unknown> | unknown }>;
	}>;
}

export type FramescaperNativeOpenFxActionBridgeNativeMedia = Required<Pick<
	FramescaperNativeServicesBridge,
	'capabilities' | 'listOpenFxPlugins'
>>;

export interface BindFramescaperNativeOpenFxActionNativeMediaOptions {
	readonly profile: unknown;
	readonly owner: OpenFxControllerNativeMedia;
	readonly bridge: FramescaperNativeOpenFxActionBridgeNativeMedia;
	readonly mintId?: () => string;
}

export interface FramescaperNativeOpenFxAuthoringRuntimeNativeMedia {
	model(): Promise<FramescaperOpenFxAuthoringModelNativeMedia>;
	author(request: FramescaperOpenFxAuthoringRequestNativeMedia): Promise<void>;
	interactModel(): Promise<FramescaperOpenFxInteractAuthoringModelNativeMedia>;
	commitInteract(
		request: FramescaperOpenFxInteractRequestV1,
		result: FramescaperOpenFxInteractResultV1,
	): Promise<FramescaperOpenFxInteractInstanceNativeMedia>;
}

export interface FramescaperOpenFxInteractInstanceNativeMedia {
	readonly project: Readonly<{
		readonly schemaFamily: 'framescaper';
		readonly schemaVersion: 1;
		readonly id: string;
		readonly revision: number;
	}>;
	readonly pluginHandle: string;
	readonly effect: OfxEffectStateV26;
	readonly label: string;
	readonly customParameterNames: readonly string[];
}

export interface FramescaperOpenFxInteractAuthoringModelNativeMedia {
	readonly instances: readonly FramescaperOpenFxInteractInstanceNativeMedia[];
}

export interface FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia {
	readonly actionRuntime: FramescaperNativeProjectActionRuntime;
	readonly authoringRuntime: FramescaperNativeOpenFxAuthoringRuntimeNativeMedia;
}

export function framescaperNativeOpenFxActionBridgeAvailableNativeMedia(
	value: unknown,
): value is FramescaperNativeOpenFxActionBridgeNativeMedia {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return typeof bridge.capabilities === 'function' && typeof bridge.listOpenFxPlugins === 'function';
}

/** Compose into Effect > Video Effects; this creates no always-visible UI. */
export function bindFramescaperNativeOpenFxActionNativeMedia(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
): FramescaperNativeProjectActionRuntime {
	assertOptions(options);
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected nativeMedia OpenFX authoring requires its existing native action runtime.');
	if (existing.surfaces.includes('ofx-add')) throw new Error('Selected nativeMedia OpenFX authoring is already bound.');
	const created = createOpenFxActionRuntimeComposition(options);
	const runtime = composeFramescaperNativeProjectActionRuntimes([
		existing, created.actionRuntime,
	]);
	bindFramescaperNativeProjectActionRuntime(options.owner, runtime);
	bindRegisteredOpenFxRuntime(options.owner, created.authoringRuntime);
	return runtime;
}

/** Create the exact unbound action and authoring slices used by selected assistance. */
export function createFramescaperNativeOpenFxActionRuntimeNativeMedia(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
): FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia {
	assertOptions(options);
	return createOpenFxActionRuntimeComposition(options);
}

function createOpenFxActionRuntimeComposition(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
): FramescaperNativeOpenFxActionRuntimeCompositionNativeMedia {
	const mintId = options.mintId ?? (() => `ofx-${globalThis.crypto.randomUUID()}`);
	const author = serializeRequest((request: FramescaperOpenFxAuthoringRequestNativeMedia) => (
		authorEffect(options, mintId, request)
	));
	const authoringRuntime: FramescaperNativeOpenFxAuthoringRuntimeNativeMedia = Object.freeze({
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
	const actionRuntime = createFramescaperNativeProjectActionSubsetRuntime(SURFACES, {
		'ofx-add': serialize(() => addSelectedFilter(options, mintId)),
	});
	return Object.freeze({ actionRuntime, authoringRuntime });
}

export function framescaperNativeOpenFxAuthoringRuntimeForNativeMedia(
	owner: unknown,
): FramescaperNativeOpenFxAuthoringRuntimeNativeMedia | null {
	return registeredOpenFxRuntimeFor(owner) as FramescaperNativeOpenFxAuthoringRuntimeNativeMedia | null;
}

/** Rebind inherited authoring after a product-version controller projection. */
export function adoptFramescaperNativeOpenFxAuthoringRuntimeNativeMedia(
	from: object,
	to: object,
): void {
	adoptRegisteredOpenFxRuntime(from, to);
}

async function loadAuthoringModel(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
): Promise<FramescaperOpenFxAuthoringModelNativeMedia> {
	const initial = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	const plugins = await enabledPlugins(options);
	assertCurrent(options, initial);
	return createFramescaperOpenFxAuthoringModelNativeMedia(initial, plugins);
}

async function loadInteractModel(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
): Promise<FramescaperOpenFxInteractAuthoringModelNativeMedia> {
	const initial = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	const plugins = await enabledPlugins(options);
	assertCurrent(options, initial);
	return interactModel(initial, plugins);
}

async function addSelectedFilter(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	mintId: () => string,
): Promise<void> {
	const initial = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	const model = createFramescaperOpenFxAuthoringModelNativeMedia(initial, await enabledPlugins(options));
	assertCurrent(options, initial);
	const plugin = selectDefaultPlugin(model.plugins);
	const { clipId } = selectedVideoClip(initial);
	const targets = model.targets.filter(({ context, targetId }) => (
		context === 'filter' && targetId === clipId
	));
	if (targets.length !== 1) {
		throw new Error('Selected nativeMedia OpenFX authoring requires exactly one selected video clip.');
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
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	mintId: () => string,
	request: FramescaperOpenFxAuthoringRequestNativeMedia,
): Promise<void> {
	const initial = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	const model = createFramescaperOpenFxAuthoringModelNativeMedia(initial, await enabledPlugins(options));
	assertCurrent(options, initial);
	await commitAuthoringRequest(options, mintId, initial, model, request);
}

async function commitAuthoringRequest(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	mintId: () => string,
	initial: FramescaperProjectNativeMedia,
	model: FramescaperOpenFxAuthoringModelNativeMedia,
	request: FramescaperOpenFxAuthoringRequestNativeMedia,
): Promise<void> {
	const plugin = model.plugins.find(({ pluginHandle }) => pluginHandle === request.pluginHandle);
	if (!plugin) throw new Error('The selected OpenFX plug-in is stale.');
	const authored = createFramescaperOpenFxAuthoringDraftNativeMedia(model, request, mintId);
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
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	requestValue: FramescaperOpenFxInteractRequestV1,
	resultValue: FramescaperOpenFxInteractResultV1,
): Promise<FramescaperOpenFxInteractInstanceNativeMedia> {
	const request = framescaperOpenFxInteractRequestV1(requestValue);
	const result = framescaperOpenFxInteractResultV1(resultValue, request);
	const initial = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	assertInteractCurrent(initial, request);
	const plugins = await enabledPlugins(options);
	assertCurrent(options, initial);
	const model = interactModel(initial, plugins);
	const selected = model.instances.find(({ effect }) => effect.instanceId === request.effect.instanceId);
	if (!selected || selected.pluginHandle !== request.pluginHandle) {
		throw new Error('The selected nativeMedia OpenFX Interact instance or plug-in identity is stale.');
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
	const committed = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	const instance = interactModel(committed, plugins).instances.find(({ effect: value }) => (
		value.instanceId === effect.instanceId
	));
	if (!instance) throw new Error('The committed nativeMedia OpenFX Interact instance is unavailable.');
	return instance;
}

function interactModel(
	project: FramescaperProjectNativeMedia,
	plugins: readonly FramescaperOpenFxPluginProjectionV1[],
): FramescaperOpenFxInteractAuthoringModelNativeMedia {
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
	project: FramescaperProjectNativeMedia,
	request: FramescaperOpenFxInteractRequestV1,
): void {
	const identity = exactProjectIdentity(project);
	if (identity.id !== request.project.id || identity.revision !== request.project.revision) {
		throw new Error('The selected nativeMedia project revision changed during OpenFX Interact.');
	}
	const matches = project.ofxEffects.filter(({ instanceId }) => instanceId === request.effect.instanceId);
	if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(request.effect)) {
		throw new Error('The selected nativeMedia OpenFX Interact instance identity or state is stale.');
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
	project: FramescaperProjectNativeMedia,
	plugin: FramescaperOpenFxPluginProjectionV1,
	authored: FramescaperOpenFxAuthoringDraftNativeMedia,
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
	return attestFramescaperOpenFxEffectOpenFx(plugin, Object.freeze({
		...authored, freshness, frozenFallback: null,
	}));
}

function exactProjectIdentity(
	project: FramescaperProjectNativeMedia,
): FramescaperOpenFxInteractInstanceNativeMedia['project'] {
	const id = stableId(project.id, 'selected nativeMedia project ID');
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new TypeError('The selected nativeMedia project revision is invalid.');
	}
	return Object.freeze({
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		id,
		revision: Number(project.revision),
	});
}

async function enabledPlugins(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
): Promise<readonly FramescaperOpenFxPluginProjectionV1[]> {
	const bridge = exactBridge(options.bridge);
	const snapshotValue = structuredClone(await bridge.capabilities.call(bridge));
	assertNativeMediaCapabilitySnapshotV1(snapshotValue);
	const capability = nativeMediaCapabilityEntry(
		snapshotValue, NATIVE_MEDIA_CAPABILITY_IDS.ofxHost.domain,
		NATIVE_MEDIA_CAPABILITY_IDS.ofxHost.id,
	);
	if (!isNativeMediaCapabilityUsable(capability)) {
		throw new Error('Selected nativeMedia OpenFX authoring is unavailable in the exact native runtime.');
	}
	const value = await bridge.listOpenFxPlugins.call(bridge);
	if (!Array.isArray(value) || value.length > 1_024
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Selected nativeMedia OpenFX inventory must be a bounded dense array.');
	}
	return Object.freeze(value.map(framescaperOpenFxPluginProjectionV1));
}

async function commitWithRollback(owner: OpenFxControllerNativeMedia, command: unknown): Promise<void> {
	let committed = false;
	try {
		await owner.actions.edit.commit(command); committed = true;
		await owner.actions.project.save();
	} catch (error) {
		if (!committed) throw error;
		try { await owner.actions.edit.undo(); }
		catch (undoError) {
			throw new AggregateError(
				[error, undoError], 'Selected nativeMedia OpenFX save rollback failed.', { cause: error },
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
		throw new Error('Selected nativeMedia OpenFX authoring requires exactly one unambiguous parameterless RGBA8 filter.');
	}
	return eligible[0]!;
}

function selectedVideoClip(project: FramescaperProjectNativeMedia): Readonly<{
	readonly clipId: string; readonly sourceId: string; readonly source: unknown;
}> {
	const selection = record(project.selection, 'selected nativeMedia selection');
	const clipIds = selection.clipIds;
	if (!Array.isArray(clipIds) || clipIds.length !== 1) {
		throw new Error('Selected nativeMedia OpenFX authoring requires exactly one selected video clip.');
	}
	const clipId = stableId(clipIds[0], 'selected video clip ID');
	const clip = records(project.clips, 'selected nativeMedia clips').find(({ id }) => id === clipId);
	if (!clip || clip.kind !== 'video') {
		throw new Error('Selected nativeMedia OpenFX authoring requires exactly one selected video clip.');
	}
	const sourceId = stableId(clip.sourceId, 'selected video source ID');
	const source = project.sources.find(({ id }) => id === sourceId);
	if (!source || source.kind !== 'video') throw new Error('The selected OpenFX video source is unavailable.');
	return Object.freeze({ clipId, sourceId, source: structuredClone(source) });
}

function assertCurrent(
	options: BindFramescaperNativeOpenFxActionNativeMediaOptions,
	expected: FramescaperProjectNativeMedia,
): void {
	const current = cloneFramescaperProjectNativeMedia(options.profile, options.owner.project);
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new Error('The selected nativeMedia project changed during OpenFX authoring.');
	}
}

function exactBridge(value: unknown): FramescaperNativeOpenFxActionBridgeNativeMedia {
	if (!framescaperNativeOpenFxActionBridgeAvailableNativeMedia(value)) {
		throw new Error('Selected nativeMedia OpenFX authoring requires the authenticated desktop bridge.');
	}
	return value;
}

function assertOptions(options: BindFramescaperNativeOpenFxActionNativeMediaOptions): void {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| !options.owner || typeof options.owner !== 'object'
		|| !options.owner.actions || typeof options.owner.actions.edit?.commit !== 'function'
		|| typeof options.owner.actions.edit.undo !== 'function'
		|| typeof options.owner.actions.project?.save !== 'function'
		|| !framescaperNativeOpenFxActionBridgeAvailableNativeMedia(options.bridge)
		|| (options.mintId !== undefined && typeof options.mintId !== 'function')) {
		throw new TypeError('Selected nativeMedia OpenFX authoring requires exact controller and desktop ports.');
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
