/* SPDX-License-Identifier: AGPL-3.0-only */
/** Main-owned picker, registry, scan, and exact V12/V14 OpenFX execution authority. */
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FramescaperOpenFxRuntime } from './framescaper-openfx-runtime.ts';
import { receiveHelperDataPlaneReservedFile, type HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import { HELPER_DATA_CHUNK_MAXIMUM_BYTES, HELPER_DATA_PLANE_VERSION } from './helper-data-plane.ts';
import type { HelperDataPlaneOutputReservation } from './helper-data-plane-output-reservation.ts';
import type { HelperDataPlaneTransferPort } from './helper-data-plane-transfer.ts';
import { validateHelperJobGrant, type HelperOfxScanJobGrant } from './helper-contract.ts';
import type { HelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import { executeUnifiedExactOfxNodeV1,
	type OfxUnifiedNodeExecutionResultV1 } from './openfx-unified-render-execution.ts';
import { prepareOpenFxMainAttemptV1,
	type PreparedOpenFxMainAttemptV1 } from './openfx-main-attempt.ts';
import { authenticateOpenFxScanDescriptor } from './openfx-scan-authentication.ts';
import {
	framescaperOpenFxExecutionRequestV1,
	type FramescaperOpenFxExecutionPlan,
	type FramescaperOpenFxExecutionRequestV1,
} from './openfx-main-execution-request.ts';
import type { RegisteredOpenFxPluginV1 as RegisteredPlugin } from './openfx-main-registered-plugin.ts';
import {
	absoluteFramescaperOpenFxPath,
	assertFramescaperOpenFxEffectDescriptor,
	assertFramescaperOpenFxInteractEffectDescriptor,
	availableFramescaperOpenFxHost,
	framescaperOpenFxEffectNode,
	framescaperOpenFxExecutableGrant,
	framescaperOpenFxFailureKind,
	framescaperOpenFxIdentity,
	framescaperOpenFxPluginProjection,
	framescaperOpenFxScannedDescriptor,
} from './openfx-main-service-authority.ts';
import type { NativePlanVideoTimingAssetBytes } from './native-services-video-timing-staging.ts';
import {
	reauthenticateFramescaperOpenFxPluginSnapshot,
	sameFramescaperOpenFxPluginSnapshot,
	snapshotFramescaperOpenFxPluginCandidate,
} from './openfx-plugin-bundle-custody.ts';
import {
	ofxPluginFingerprint,
} from '../src/common/editor/native-ofx-descriptor.ts';
import {
	framescaperOpenFxInteractRequestV1,
	framescaperOpenFxInteractResultV1,
	type FramescaperOpenFxInteractRequestV1,
	type FramescaperOpenFxInteractResultV1,
} from '../src/common/editor/native-ofx-interact-contract.ts';
import {
	clearOfxQuarantine,
	enableOfxPlugin,
	grantOfxScanConsent,
	recordOfxFailure,
	reconcileOfxConsent,
	revokeOfxPlugin,
} from '../src/common/editor/native-ofx-consent.ts';
import { deriveUnifiedExactOfxFreshnessV26 } from '../src/common/editor/native-ofx-freshness-authority.ts';
import {
	framescaperOpenFxPluginControlRequestV1,
	type FramescaperOpenFxPluginProjectionV1,
} from '../src/common/editor/native-ofx-service-contract.ts';
const SCAN_DESCRIPTOR_MAXIMUM_BYTES = 4 * 1024 * 1024;
const HANDLE = /^[a-f\d]{40}$/u;
const MAXIMUM_REGISTERED_PLUGINS = 1_024;
export interface FramescaperOpenFxMainServiceMessageChannel {
	readonly hostPort: HelperDataPlaneIoPort;
	readonly helperPort: HelperDataPlaneTransferPort;
}
export interface FramescaperOpenFxMainServiceOptions {
	readonly runtime: FramescaperOpenFxRuntime;
	readonly scratchRoot: string;
	readonly preferences: () => Readonly<{
		readonly nativeMediaEnabled: boolean;
		readonly ofxConsentEnabled: boolean;
	}>;
	readonly selectPluginBinary: () => Promise<string | null>;
	readonly createMessageChannel: () => FramescaperOpenFxMainServiceMessageChannel;
	readonly currentProject: (
		project: FramescaperOpenFxExecutionPlan['project'],
		effect?: FramescaperOpenFxInteractRequestV1['effect'],
	) => boolean | Promise<boolean>;
	readonly videoTimingAssets: (
		plan: FramescaperOpenFxExecutionPlan,
	) => Promise<readonly NativePlanVideoTimingAssetBytes[]>;
	readonly mintOpaqueId?: () => string;
	readonly now?: () => number;
}
export type FramescaperOpenFxExecutionResultV1 =
	| (Extract<OfxUnifiedNodeExecutionResultV1, { readonly mode: 'render' }>
		& Readonly<{ readonly rgba: Uint8Array }>)
	| Exclude<OfxUnifiedNodeExecutionResultV1, { readonly mode: 'render' }>;
export class FramescaperOpenFxMainService {
	readonly #options: FramescaperOpenFxMainServiceOptions;
	readonly #scratchRoot: string;
	readonly #plugins = new Map<string, RegisteredPlugin>();
	readonly #scanQuarantinedBinarySha256 = new Set<string>();
	#disposed = false;
	#scanActive = false;
	#authorityEpoch = 0;
	#scanAbort: AbortController | null = null;

	constructor(options: FramescaperOpenFxMainServiceOptions) {
		if (!options || !options.runtime || typeof options.runtime.available !== 'function'
			|| typeof options.preferences !== 'function'
			|| typeof options.selectPluginBinary !== 'function'
			|| typeof options.createMessageChannel !== 'function'
			|| typeof options.currentProject !== 'function'
			|| typeof options.videoTimingAssets !== 'function') {
			throw new TypeError('The main-owned OpenFX service requires exact runtime and authority ports.');
		}
		this.#scratchRoot = absoluteFramescaperOpenFxPath(options.scratchRoot, 'OpenFX scratch root');
		this.#options = options;
	}

	async scan(): Promise<FramescaperOpenFxPluginProjectionV1 | null> {
		const manager = this.#admitOperation();
		if (this.#scanActive) throw new Error('An OpenFX scan is already active.');
		this.#scanActive = true;
		const abort = new AbortController();
		this.#scanAbort = abort;
		const epoch = this.#authorityEpoch;
		try { return await this.#scan(manager, abort, epoch); }
		finally {
			if (this.#scanAbort === abort) this.#scanAbort = null;
			this.#scanActive = false;
		}
	}

	async #scan(
		manager: NonNullable<FramescaperOpenFxRuntime['manager']>,
		abort: AbortController,
		epoch: number,
	): Promise<FramescaperOpenFxPluginProjectionV1 | null> {
		const path = await this.#options.selectPluginBinary();
		if (path === null) return null;
		abort.signal.throwIfAborted();
		const host = availableFramescaperOpenFxHost(this.#options.runtime);
		const custody = await snapshotFramescaperOpenFxPluginCandidate(path, host.target);
		const pluginBinary = custody.executable;
		abort.signal.throwIfAborted();
		if (this.#scanQuarantinedBinarySha256.has(pluginBinary.sha256)) {
			throw new Error('This OpenFX binary is quarantined after a failed isolated scan.');
		}
		let base: string | null = null;
		let receiving: Promise<Readonly<{ byteLength: number; sha256: string }>> | null = null;
		let retained = false;
		try {
			base = await this.#temporaryRoot('scan');
			abort.signal.throwIfAborted();
			const helperRoot = join(base, 'helper');
			const hostRoot = join(base, 'host');
			await Promise.all([mkdir(helperRoot, { mode: 0o700 }), mkdir(hostRoot, { mode: 0o700 })]);
			abort.signal.throwIfAborted();
			const streamId = opaqueId();
			const reservation: HelperDataPlaneOutputReservation = Object.freeze({
				dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
				transport: 'message-port', streamId, direction: 'helper-to-host',
				exactByteLength: null, maximumByteLength: SCAN_DESCRIPTOR_MAXIMUM_BYTES,
				maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
			});
			const helperDetails = await stat(helperRoot);
			abort.signal.throwIfAborted();
			const channel = this.#options.createMessageChannel();
			const descriptorPath = join(hostRoot, 'descriptor.json');
			receiving = receiveHelperDataPlaneReservedFile({
				reservation, port: channel.hostPort, path: descriptorPath, signal: abort.signal,
			});
			const grant = validateHelperJobGrant('ofx-scan', {
				executable: framescaperOpenFxExecutableGrant('ofx-scanner', host.scanner), pluginBinary,
				descriptor: reservation,
				scratch: { rootPath: helperRoot, rootIdentity: framescaperOpenFxIdentity(helperDetails),
					reservationId: opaqueId(), maximumBytes:
						pluginBinary.bytes + SCAN_DESCRIPTOR_MAXIMUM_BYTES },
			}) as HelperOfxScanJobGrant;
			const descriptor = await authenticateOpenFxScanDescriptor({
				scanning: manager.scan({
					kind: 'ofx-scan', grant, signal: abort.signal,
					dataPlaneTransfers: Object.freeze([Object.freeze({
						streamId, port: channel.helperPort,
					})]),
				}),
				receiving,
				readDescriptor: async () => new Uint8Array(await readFile(descriptorPath)),
				parseDescriptor: (bytes) => framescaperOpenFxScannedDescriptor(bytes, pluginBinary.sha256),
				quarantine: () => {
					if (!abort.signal.aborted && epoch === this.#authorityEpoch) {
						this.#scanQuarantinedBinarySha256.add(pluginBinary.sha256);
					}
				},
			});
			this.#admitOperation();
			if (abort.signal.aborted || epoch !== this.#authorityEpoch) {
				throw new Error('OpenFX scan authority changed before registration.');
			}
			const existing = [...this.#plugins.values()].find((plugin) => !plugin.identityChanged
				&& plugin.consent.state !== 'revoked'
				&& sameFramescaperOpenFxPluginSnapshot(plugin.custody, custody)
				&& ofxPluginFingerprint(plugin.descriptor) === ofxPluginFingerprint(descriptor));
			if (existing) {
				this.#synchronizeRuntimeQuarantine(existing);
				if (existing.consent.state === 'discovered') {
					existing.consent = grantOfxScanConsent(existing.consent);
				}
				return this.#projection(existing);
			}
			if (this.#plugins.size >= MAXIMUM_REGISTERED_PLUGINS) {
				throw new Error('The session OpenFX registry is full.');
			}
			const handle = this.#mintHandle();
			const consent = grantOfxScanConsent(reconcileOfxConsent(null, descriptor));
			this.#plugins.set(handle, {
				handle, descriptor, executable: pluginBinary, custody,
				consent, identityChanged: false, epoch: 0, activeExecutions: new Set(),
			});
			retained = true;
			return this.#projection(this.#plugins.get(handle)!);
		} catch (error) {
			abort.abort();
			await receiving?.catch(() => undefined);
			throw error;
		} finally {
			if (base !== null) await rm(base, { recursive: true, force: true });
			if (!retained) await custody.dispose();
		}
	}

	inventory(): readonly FramescaperOpenFxPluginProjectionV1[] {
		this.#assertActive();
		return Object.freeze([...this.#plugins.values()]
			.sort((left, right) => left.handle.localeCompare(right.handle))
			.map((plugin) => this.#projection(plugin)));
	}

	supportedGpuBackends() {
		const availability = this.#options.runtime.payloadAvailability;
		return availability.status === 'available'
			? availability.descriptor.supportedGpuBackends
			: Object.freeze([]);
	}

	async control(value: unknown): Promise<FramescaperOpenFxPluginProjectionV1> {
		this.#assertActive();
		const request = framescaperOpenFxPluginControlRequestV1(value);
		const plugin = this.#plugin(request.pluginHandle);
		this.#synchronizeRuntimeQuarantine(plugin);
		if (request.action === 'revoke') {
			plugin.consent = revokeOfxPlugin(plugin.consent);
			this.#invalidatePlugin(plugin);
			this.#options.runtime.manager?.release(ofxPluginFingerprint(plugin.descriptor));
			await plugin.custody.dispose();
			return this.#projection(plugin);
		}
		this.#admitOperation();
		await this.#reauthenticate(plugin);
		if (plugin.identityChanged || plugin.consent.state === 'revoked') {
			throw new Error('A changed or revoked OpenFX binary cannot inherit approval.');
		}
		if (request.action === 'enable') {
			plugin.consent = enableOfxPlugin(plugin.consent);
			plugin.epoch += 1;
		}
		else {
			plugin.consent = clearOfxQuarantine(plugin.consent);
			plugin.epoch += 1;
			this.#options.runtime.manager!.clearQuarantine(ofxPluginFingerprint(plugin.descriptor));
		}
		return this.#projection(plugin);
	}

	async interact(value: unknown): Promise<FramescaperOpenFxInteractResultV1> {
		const manager = this.#admitOperation();
		const request = framescaperOpenFxInteractRequestV1(value);
		const plugin = this.#plugin(request.pluginHandle);
		await this.#reauthenticate(plugin);
		this.#synchronizeRuntimeQuarantine(plugin);
		if (plugin.identityChanged || plugin.consent.state !== 'enabled') {
			throw new Error('An OpenFX Interact requires one unchanged enabled plug-in.');
		}
		if (!plugin.descriptor.supportedContexts.includes(request.context)) {
			throw new Error('The OpenFX Interact context was not declared by the plug-in.');
		}
		assertFramescaperOpenFxInteractEffectDescriptor(request.effect, plugin.descriptor);
		if (!plugin.descriptor.requestedSuites.includes('OfxInteractSuite')
			|| !plugin.descriptor.requestedSuites.includes('OfxDrawSuite')) {
			throw new Error('The OpenFX plug-in did not declare the Interact and Draw suites.');
		}
		if (request.target === 'custom-parameter'
			&& !plugin.descriptor.parameters.some(({ name, type }) => (
				name === request.parameterName && type === 'custom'
			))) {
			throw new Error('The OpenFX custom Interact parameter was not declared by the plug-in.');
		}
		const host = availableFramescaperOpenFxHost(this.#options.runtime), fingerprint = ofxPluginFingerprint(plugin.descriptor), epoch = plugin.epoch;
		const abort = new AbortController(); plugin.activeExecutions.add(abort);
		let base: string | null = null;
		try {
			await this.#assertInteractAuthority(plugin, epoch, manager, request);
			base = await this.#temporaryRoot('interact'); const helperRoot = join(base, 'helper'); await mkdir(helperRoot, { mode: 0o700 });
			const details = await stat(helperRoot); abort.signal.throwIfAborted();
			const grant = validateHelperJobGrant('ofx-host', {
				executable: framescaperOpenFxExecutableGrant('ofx-host', host.runtimeHost),
				pluginBinary: plugin.executable,
				pluginFingerprint: fingerprint,
				pluginId: plugin.descriptor.pluginId,
				interact: request,
				scratch: {
					rootPath: helperRoot,
					rootIdentity: framescaperOpenFxIdentity(details),
					reservationId: opaqueId(),
					maximumBytes: plugin.executable.bytes + 16 * 1024 * 1024,
				},
			}) as HelperOfxInteractJobGrantV1;
			await this.#assertInteractAuthority(plugin, epoch, manager, request);
			const result = await manager.interact(fingerprint, Object.freeze({
				kind: 'ofx-host' as const, grant, signal: abort.signal,
				dataPlaneTransfers: Object.freeze([]),
			}), (error) => {
				if (!abort.signal.aborted) this.#recordRuntimeFailure(plugin, error);
			});
			await this.#assertInteractAuthority(plugin, epoch, manager, request);
			try { return framescaperOpenFxInteractResultV1(result.interact, request); }
			catch (error) {
				if (!abort.signal.aborted) this.#recordRuntimeFailure(plugin, error); throw error;
			}
		} finally {
			plugin.activeExecutions.delete(abort);
			if (base !== null) await rm(base, { recursive: true, force: true });
		}
	}
	async execute(value: FramescaperOpenFxExecutionRequestV1): Promise<FramescaperOpenFxExecutionResultV1> {
		const manager = this.#admitOperation();
		const request = framescaperOpenFxExecutionRequestV1(value);
		const effect = framescaperOpenFxEffectNode(request.plan, request.instanceId);
		if (!await this.#options.currentProject(request.plan.project, effect.state)) {
			throw new Error('The OpenFX plan does not name the exact current project revision.');
		}
		const plugin = this.#plugin(request.pluginHandle);
		await this.#reauthenticate(plugin);
		if (effect.state.pluginId !== plugin.descriptor.pluginId
			|| effect.state.binarySha256 !== plugin.descriptor.binarySha256) {
			throw new Error('The OpenFX handle does not match the exact effect fingerprint.');
		}
		assertFramescaperOpenFxEffectDescriptor(effect, plugin.descriptor);
		const observedFreshness = deriveUnifiedExactOfxFreshnessV26(
			request.plan, request.instanceId, plugin.descriptor,
		);
		const fingerprint = ofxPluginFingerprint(plugin.descriptor);
		this.#synchronizeRuntimeQuarantine(plugin);
		const runtimeQuarantined = manager.snapshot().runtimes.some((entry) => (
			entry.pluginFingerprint === fingerprint && entry.quarantined
		));
		const availability = plugin.consent.state === 'revoked' ? 'revoked' as const
			: plugin.identityChanged ? 'fingerprint-changed' as const
			: runtimeQuarantined || plugin.consent.state === 'quarantined' ? 'quarantined' as const
				: 'available' as const;
		if (availability !== 'available') {
			const unavailable = await executeUnifiedExactOfxNodeV1(manager, {
				plan: request.plan, instanceId: request.instanceId,
				runtime: { availability, pluginId: null, binarySha256: null,
					freshness: observedFreshness },
				requestedBackend: request.requestedBackend,
				executionMode: 'verified-result',
				createAttemptResources: () => { throw new Error('Unavailable OpenFX state cannot stage resources.'); },
			});
			if (unavailable.mode === 'render') throw new Error('Unavailable OpenFX execution rendered unexpectedly.');
			return unavailable;
		}
		const videoTimingAssets = await this.#options.videoTimingAssets(request.plan);
		const epoch = plugin.epoch;
		const abort = new AbortController();
		const forwardAbort = (): void => abort.abort();
		if (request.signal?.aborted) abort.abort();
		else request.signal?.addEventListener('abort', forwardAbort, { once: true });
		plugin.activeExecutions.add(abort);
		const executionRequest = Object.freeze({ ...request, signal: abort.signal });
		let primary: PreparedOpenFxMainAttemptV1 | null = null;
		let cpu: PreparedOpenFxMainAttemptV1 | null = null;
		try {
			await this.#assertExecutionAuthority(
				plugin, epoch, executionRequest.plan.project, effect.state, manager,
			);
			primary = await this.#prepareAttempt(
				executionRequest, plugin, executionRequest.requestedBackend, videoTimingAssets,
			);
			await this.#assertExecutionAuthority(
				plugin, epoch, executionRequest.plan.project, effect.state, manager,
			);
			cpu = request.requestedBackend === 'cpu' ? null
				: await this.#prepareAttempt(executionRequest, plugin, 'cpu', videoTimingAssets);
			await this.#assertExecutionAuthority(
				plugin, epoch, executionRequest.plan.project, effect.state, manager,
			);
			const result = await executeUnifiedExactOfxNodeV1(manager, {
				plan: executionRequest.plan, instanceId: executionRequest.instanceId,
				runtime: { availability: 'available', pluginId: plugin.descriptor.pluginId,
					binarySha256: plugin.descriptor.binarySha256, freshness: observedFreshness },
				requestedBackend: executionRequest.requestedBackend,
				executionMode: 'verified-result', signal: executionRequest.signal,
				onHostFailure: (error) => this.#recordRuntimeFailure(plugin, error),
				createAttemptResources: (backend) => backend === executionRequest.requestedBackend
					? primary!.resources : cpu!.resources,
			});
			if (result.mode === 'render') {
				await this.#assertExecutionAuthority(
					plugin, epoch, executionRequest.plan.project, effect.state, manager,
				);
			}
			const selected = result.mode === 'render' && result.retriedOnCpu ? cpu : primary;
			const rgba = await selected!.finish(result.mode === 'render' ? result.output : null);
			await (selected === primary ? cpu : primary)?.finish(null);
			return result.mode === 'render'
				? Object.freeze({ ...result, rgba: rgba! })
				: result;
		} catch (error) {
			await Promise.all([primary?.finish(null), cpu?.finish(null)]);
			throw error;
		} finally {
			plugin.activeExecutions.delete(abort);
			request.signal?.removeEventListener('abort', forwardAbort);
		}
	}

	async disable(): Promise<void> {
		this.#assertActive();
		this.#authorityEpoch += 1;
		this.#scanAbort?.abort();
		const disposals: Promise<void>[] = [];
		for (const plugin of this.#plugins.values()) {
			plugin.consent = revokeOfxPlugin(plugin.consent);
			this.#invalidatePlugin(plugin);
			this.#options.runtime.manager?.release(ofxPluginFingerprint(plugin.descriptor));
			disposals.push(plugin.custody.dispose());
		}
		await Promise.all(disposals);
		this.#plugins.clear();
	}

	async dispose(): Promise<void> {
		if (!this.#disposed) {
			this.#disposed = true;
			this.#authorityEpoch += 1;
			this.#scanAbort?.abort();
			for (const plugin of this.#plugins.values()) this.#invalidatePlugin(plugin);
		}
		await Promise.all([...this.#plugins.values()].map((plugin) => plugin.custody.dispose()));
		this.#plugins.clear();
	}

	async #assertExecutionAuthority(
		plugin: RegisteredPlugin,
		epoch: number,
		project: FramescaperOpenFxExecutionPlan['project'],
		effect: FramescaperOpenFxInteractRequestV1['effect'],
		manager: NonNullable<FramescaperOpenFxRuntime['manager']>,
	): Promise<void> {
		if (this.#admitOperation() !== manager || plugin.epoch !== epoch
			|| plugin.identityChanged || plugin.consent.state !== 'enabled') {
			throw new Error('OpenFX execution authority changed before dispatch.');
		}
		if (!await this.#options.currentProject(project, effect)) {
			throw new Error('The OpenFX plan became stale before dispatch.');
		}
		if (this.#admitOperation() !== manager || plugin.epoch !== epoch
			|| plugin.identityChanged || plugin.consent.state !== 'enabled') {
			throw new Error('OpenFX execution authority changed before dispatch.');
		}
	}

	async #assertInteractAuthority(
		plugin: RegisteredPlugin,
		epoch: number,
		manager: NonNullable<FramescaperOpenFxRuntime['manager']>,
		request: FramescaperOpenFxInteractRequestV1,
	): Promise<void> {
		if (this.#admitOperation() !== manager || plugin.epoch !== epoch
			|| plugin.identityChanged || plugin.consent.state !== 'enabled') {
			throw new Error('OpenFX Interact authority changed before completion.');
		}
		if (!await this.#options.currentProject(request.project, request.effect)) {
			throw new Error('The authored OpenFX Interact project revision or instance became stale.');
		}
		await this.#reauthenticate(plugin);
		if (this.#admitOperation() !== manager || plugin.epoch !== epoch
			|| plugin.identityChanged || plugin.consent.state !== 'enabled') {
			throw new Error('OpenFX Interact authority changed before completion.');
		}
	}

	#invalidatePlugin(plugin: RegisteredPlugin): void {
		plugin.epoch += 1;
		for (const abort of plugin.activeExecutions) abort.abort();
	}

	#recordRuntimeFailure(plugin: RegisteredPlugin, error: unknown): void {
		const kind = framescaperOpenFxFailureKind(error);
		if (kind === null) return;
		plugin.consent = recordOfxFailure(plugin.consent, kind, this.#options.now?.() ?? Date.now());
		if (plugin.consent.state !== 'quarantined') return;
		this.#invalidatePlugin(plugin);
		this.#options.runtime.manager?.release(ofxPluginFingerprint(plugin.descriptor));
	}

	#synchronizeRuntimeQuarantine(plugin: RegisteredPlugin): void {
		if (plugin.consent.state === 'quarantined') return;
		const fingerprint = ofxPluginFingerprint(plugin.descriptor);
		const runtimeQuarantined = this.#options.runtime.manager?.snapshot().runtimes.some((entry) => (
			entry.pluginFingerprint === fingerprint && entry.quarantined
		)) ?? false;
		if (!runtimeQuarantined) return;
		plugin.consent = recordOfxFailure(
			plugin.consent, 'runtime-quarantine', this.#options.now?.() ?? Date.now(),
		);
		this.#invalidatePlugin(plugin);
	}

	async #prepareAttempt(
		request: ReturnType<typeof framescaperOpenFxExecutionRequestV1>,
		plugin: RegisteredPlugin,
		_backend: Parameters<typeof executeUnifiedExactOfxNodeV1>[1]['requestedBackend'],
		videoTimingAssets: readonly NativePlanVideoTimingAssetBytes[],
	): Promise<PreparedOpenFxMainAttemptV1> {
		const host = availableFramescaperOpenFxHost(this.#options.runtime);
		request.signal?.throwIfAborted();
		const base = await this.#temporaryRoot('execute');
		return prepareOpenFxMainAttemptV1({
			request, pluginBinary: plugin.executable, runtimeHost: host.runtimeHost,
			base, createMessageChannel: this.#options.createMessageChannel, videoTimingAssets,
		});
	}

	async #reauthenticate(plugin: RegisteredPlugin): Promise<void> {
		if (plugin.identityChanged) return;
		try {
			await reauthenticateFramescaperOpenFxPluginSnapshot(plugin.custody);
		} catch {
			plugin.identityChanged = true;
			plugin.consent = revokeOfxPlugin(plugin.consent);
			this.#invalidatePlugin(plugin);
			this.#options.runtime.manager?.release(ofxPluginFingerprint(plugin.descriptor));
		}
	}

	#projection(plugin: RegisteredPlugin): FramescaperOpenFxPluginProjectionV1 {
		this.#synchronizeRuntimeQuarantine(plugin);
		return framescaperOpenFxPluginProjection(this.#options.runtime, plugin);
	}

	#admitOperation() {
		this.#assertActive();
		const preferences = this.#options.preferences();
		if (preferences.nativeMediaEnabled !== true) throw new Error('Native media is off.');
		if (preferences.ofxConsentEnabled !== true) throw new Error('OpenFX consent is off.');
		if (!this.#options.runtime.available() || this.#options.runtime.manager === null) {
			throw new Error(this.#options.runtime.reason ?? 'The authenticated OpenFX payload runtime is unavailable.');
		}
		availableFramescaperOpenFxHost(this.#options.runtime);
		return this.#options.runtime.manager;
	}

	#plugin(handleValue: unknown): RegisteredPlugin {
		if (typeof handleValue !== 'string' || !HANDLE.test(handleValue)) {
			throw new TypeError('An OpenFX plug-in handle is invalid.');
		}
		const plugin = this.#plugins.get(handleValue);
		if (!plugin) throw new ReferenceError('The OpenFX plug-in handle is unavailable.');
		return plugin;
	}

	async #temporaryRoot(label: string): Promise<string> {
		await mkdir(this.#scratchRoot, { recursive: true, mode: 0o700 });
		const root = await lstat(this.#scratchRoot);
		if (!root.isDirectory() || root.isSymbolicLink()) {
			throw new Error('The OpenFX scratch authority is not one canonical directory.');
		}
		return mkdtemp(join(this.#scratchRoot, `ofx-${label}-`));
	}

	#mintHandle(): string {
		const value = this.#options.mintOpaqueId?.() ?? opaqueId();
		if (!HANDLE.test(value) || this.#plugins.has(value)) {
			throw new Error('The OpenFX opaque handle mint returned an invalid or repeated identity.');
		}
		return value;
	}

	#assertActive(): void {
		if (this.#disposed) throw new Error('The main-owned OpenFX service is disposed.');
	}
}

function opaqueId(): string { return randomBytes(20).toString('hex'); }
