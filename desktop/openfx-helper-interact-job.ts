/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated, control-only execution for one offscreen OpenFX Interact update. */

import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	framescaperOpenFxInteractEffectStateSha256V1,
	framescaperOpenFxInteractResultV1,
	OFX_INTERACT_SURFACE_BYTES_V1,
	type FramescaperOpenFxInteractResultV1,
} from '../src/common/editor/native-ofx-interact-contract.ts';
import { assertOfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';
import type {
	FramescaperOpenFxExecutableDescriptor,
	FramescaperOpenFxHostDescriptor,
} from './framescaper-openfx-host-payload.ts';
import type { HelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import { NativeMediaHelperFilesystem } from './native-media-helper-filesystem.ts';
import {
	stageOpenFxPluginBinary,
	type StagedOpenFxPlugin,
} from './openfx-helper-plugin-staging.ts';
import type {
	OpenFxHostProcessAuthority,
	OpenFxHostProcessHandle,
	OpenFxHostProcessInvoker,
	OpenFxHostProcessResult,
} from './openfx-host-process-contract.ts';

const MAXIMUM_CONTROL_BYTES = 16 * 1024 * 1024;
const HEX_BYTES = OFX_INTERACT_SURFACE_BYTES_V1 * 2;
const RESULT_KEYS = Object.freeze([
	'accepted', 'protocolVersion', 'width', 'height', 'rowBytes', 'target', 'parameterName',
	'project', 'instanceId', 'effectStateSha256', 'acceptedSequences', 'redrawRequested',
	'surfaceDisposition', 'parameterMutations', 'drawCalls', 'pixelsTouched', 'rgbaHex',
	'vendorTopLevelWindowCreated',
]);

export interface OpenFxInteractHelperJobOptionsV1 {
	readonly descriptor: FramescaperOpenFxHostDescriptor;
	readonly grant: HelperOfxInteractJobGrantV1;
	readonly signal: AbortSignal;
	readonly invokeHost: OpenFxHostProcessInvoker;
	readonly setProcess: (value: OpenFxHostProcessHandle) => void;
}

export async function runOpenFxInteractHelperJobV1(
	options: OpenFxInteractHelperJobOptionsV1,
): Promise<Readonly<{ interact: FramescaperOpenFxInteractResultV1 }>> {
	assertRuntimeGrant(options);
	const filesystem = new NativeMediaHelperFilesystem();
	let settled = false;
	try {
		await Promise.all([
			authenticateDescriptor(filesystem, options.descriptor.runtimeHost),
			authenticateDescriptor(filesystem, options.descriptor.scanner),
			authenticatePlugin(filesystem, options.grant),
			filesystem.authenticateDirectory({
				path: options.grant.scratch.rootPath,
				identity: options.grant.scratch.rootIdentity,
			}),
		]);
		options.signal.throwIfAborted();
		if (options.grant.pluginBinary.bytes + MAXIMUM_CONTROL_BYTES
			> options.grant.scratch.maximumBytes) {
			throw new Error('The OpenFX Interact inputs exceed their exact scratch grant.');
		}
		const reservation = join(
			options.grant.scratch.rootPath, options.grant.scratch.reservationId,
		);
		await filesystem.createReservation(reservation);
		const plugin = await stageOpenFxPluginBinary(
			filesystem, reservation, options.grant.pluginBinary, options.signal,
		);
		const pluginGrant = await filePathGrant(plugin.path);
		const pluginIndex = await scanPluginIndex(options, plugin, pluginGrant);
		const nativeGrant = JSON.stringify({
			schemaVersion: 1,
			pluginBinary: {
				path: plugin.path,
				sha256: options.grant.pluginBinary.sha256,
				pluginIndex,
				pluginId: options.grant.pluginId,
			},
			project: options.grant.interact.project,
			instanceId: options.grant.interact.effect.instanceId,
			effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(
				options.grant.interact.effect,
			),
			context: options.grant.interact.context,
			target: options.grant.interact.target,
			parameterName: options.grant.interact.parameterName,
			parameters: options.grant.interact.effect.parameters,
			events: options.grant.interact.events,
		});
		if (Buffer.byteLength(nativeGrant) > MAXIMUM_CONTROL_BYTES) {
			throw new Error('The canonical OpenFX Interact grant exceeds its control bound.');
		}
		const grantPath = join(reservation, 'interact-v1-grant.json');
		await writeFile(grantPath, nativeGrant, { flag: 'wx', mode: 0o600 });
		const grantSha256 = sha256(Buffer.from(nativeGrant));
		await filesystem.authenticateFile({
			path: grantPath, byteLength: Buffer.byteLength(nativeGrant), sha256: grantSha256,
		});
		const readOnlyGrant = await filePathGrant(grantPath);
		await filesystem.revalidate();
		options.signal.throwIfAborted();
		const process = options.invokeHost({
			executablePath: options.descriptor.runtimeHost.path,
			arguments: ['--interact-v1-grant', grantPath, '--grant-sha256', grantSha256],
		}, authority(pluginGrant, plugin, [readOnlyGrant]));
		options.setProcess(process);
		const processResult = await successfulResult(process.completion, 'runtime host');
		options.signal.throwIfAborted();
		const interact = parseNativeInteractResult(processResult.stdout, options.grant);
		await plugin.revalidate();
		await filesystem.revalidate();
		await filesystem.finish({ retainOutput: false });
		settled = true;
		return Object.freeze({ interact });
	} finally {
		if (!settled) await filesystem.abort();
	}
}

async function scanPluginIndex(
	options: OpenFxInteractHelperJobOptionsV1,
	plugin: StagedOpenFxPlugin,
	pluginGrant: NativePathGrant,
): Promise<number> {
	options.signal.throwIfAborted();
	const process = options.invokeHost({
		executablePath: options.descriptor.scanner.path,
		arguments: ['--scan', plugin.path, '--sha256', options.grant.pluginBinary.sha256],
	}, authority(pluginGrant, plugin));
	options.setProcess(process);
	const result = await successfulResult(process.completion, 'scanner');
	options.signal.throwIfAborted();
	let value: unknown;
	try { value = JSON.parse(result.stdout) as unknown; }
	catch { throw new Error('The OpenFX scanner returned an unauthenticated descriptor.'); }
	try { assertOfxPluginDescriptorV1(value); }
	catch { throw new Error('The OpenFX scanner returned an unauthenticated descriptor.'); }
	if (value.binarySha256 !== options.grant.pluginBinary.sha256
		|| value.pluginId !== options.grant.pluginId) {
		throw new Error('The OpenFX scanner did not identify the granted Interact plug-in.');
	}
	return 0;
}

function parseNativeInteractResult(
	stdout: string,
	grant: HelperOfxInteractJobGrantV1,
): FramescaperOpenFxInteractResultV1 {
	let value: unknown;
	try { value = JSON.parse(stdout) as unknown; }
	catch { throw new Error('The OpenFX Interact result is not JSON.'); }
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new Error('The OpenFX Interact result is not a record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== RESULT_KEYS.length || keys.some((key) => !RESULT_KEYS.includes(key))) {
		throw new Error('The OpenFX Interact result has unadmitted fields.');
	}
	if (record.accepted !== true || record.protocolVersion !== 1
		|| record.width !== 64 || record.height !== 64 || record.rowBytes !== 256
		|| record.target !== grant.interact.target
		|| record.parameterName !== grant.interact.parameterName
		|| record.vendorTopLevelWindowCreated !== false
		|| !Number.isSafeInteger(record.drawCalls) || Number(record.drawCalls) < 0
		|| !Number.isSafeInteger(record.pixelsTouched) || Number(record.pixelsTouched) < 0
		|| (record.surfaceDisposition === 'drawn'
			&& (Number(record.drawCalls) < 1 || Number(record.pixelsTouched) < 1))
		|| (record.surfaceDisposition === 'retained'
			&& (Number(record.drawCalls) !== 0 || Number(record.pixelsTouched) !== 0))
		|| typeof record.rgbaHex !== 'string' || record.rgbaHex.length !== HEX_BYTES
		|| !/^[a-f\d]+$/u.test(record.rgbaHex)) {
		throw new Error('The native OpenFX Interact result violated its offscreen surface contract.');
	}
	const rgba = Buffer.from(record.rgbaHex, 'hex');
	if (rgba.byteLength !== OFX_INTERACT_SURFACE_BYTES_V1
		|| rgba.toString('hex') !== record.rgbaHex) {
		throw new Error('The native OpenFX Interact result carries malformed RGBA pixels.');
	}
	const result = framescaperOpenFxInteractResultV1({
		protocolVersion: 1,
		project: record.project,
		instanceId: record.instanceId,
		effectStateSha256: record.effectStateSha256,
		width: 64,
		height: 64,
		rowBytes: 256,
		target: record.target,
		parameterName: record.parameterName,
		acceptedSequences: record.acceptedSequences,
		redrawRequested: record.redrawRequested,
		surfaceDisposition: record.surfaceDisposition,
		parameterMutations: record.parameterMutations,
		rgba: new Uint8Array(rgba),
	}, grant.interact);
	return result;
}

function assertRuntimeGrant(options: OpenFxInteractHelperJobOptionsV1): void {
	const { executable } = options.grant;
	const runtime = options.descriptor.runtimeHost;
	if (executable.path !== runtime.path || executable.bytes !== runtime.byteLength
		|| executable.sha256 !== runtime.sha256 || executable.identity.dev !== runtime.identity.dev
		|| executable.identity.ino !== runtime.identity.ino
		|| options.grant.pluginFingerprint
			!== `${options.grant.pluginId}@${options.grant.pluginBinary.sha256}`) {
		throw new Error('The OpenFX Interact grant changed its authenticated runtime identity.');
	}
}

async function authenticateDescriptor(
	filesystem: NativeMediaHelperFilesystem,
	descriptor: FramescaperOpenFxExecutableDescriptor,
): Promise<void> {
	await filesystem.authenticateFile({
		path: descriptor.path, byteLength: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	});
}

async function authenticatePlugin(
	filesystem: NativeMediaHelperFilesystem,
	grant: HelperOfxInteractJobGrantV1,
): Promise<void> {
	await filesystem.authenticateFile({
		path: grant.pluginBinary.path, byteLength: grant.pluginBinary.bytes,
		sha256: grant.pluginBinary.sha256, identity: grant.pluginBinary.identity,
	});
}

async function successfulResult(
	completion: Promise<OpenFxHostProcessResult>,
	label: string,
): Promise<OpenFxHostProcessResult> {
	const result = await completion;
	if (Buffer.byteLength(result.stdout) > MAXIMUM_CONTROL_BYTES
		|| Buffer.byteLength(result.stderr) > MAXIMUM_CONTROL_BYTES) {
		throw new Error('The OpenFX host exceeded its 16 MiB control-output bound.');
	}
	if (result.exitCode !== 0) {
		throw new Error(`The OpenFX ${label} process failed with code ${String(result.exitCode)}.`);
	}
	return result;
}

interface NativePathGrant {
	readonly path: string;
	readonly kind: 'file';
	readonly identity: Readonly<{ dev: number; ino: number }>;
}

async function filePathGrant(path: string): Promise<NativePathGrant> {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink()
		|| !Number.isSafeInteger(details.dev) || details.dev < 0
		|| !Number.isSafeInteger(details.ino) || details.ino < 0) {
		throw new Error('An OpenFX Interact child grant is not one exact regular file.');
	}
	return Object.freeze({
		path, kind: 'file',
		identity: Object.freeze({ dev: details.dev, ino: details.ino }),
	});
}

function authority(
	plugin: NativePathGrant,
	staged: StagedOpenFxPlugin,
	readOnly: readonly NativePathGrant[] = [],
): OpenFxHostProcessAuthority {
	return Object.freeze({
		plugin,
		pluginResources: staged.resources,
		pluginRuntime: staged.runtimeClosure,
		readOnly: Object.freeze([...readOnly]),
		writeOnly: Object.freeze([]),
	});
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
