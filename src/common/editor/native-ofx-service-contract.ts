/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless renderer contract for the main-owned OpenFX registry. */

import {
	OFX_COMPONENTS,
	OFX_CONTEXTS,
	OFX_PARAMETER_TYPES,
	OFX_PIXEL_DEPTHS,
	OFX_THREADING_DECLARATIONS,
	type OfxComponent,
	type OfxContext,
	type OfxParameterDescriptorV1,
	type OfxPixelDepth,
	type OfxPluginVersionV1,
	type OfxThreadingDeclaration,
} from './native-ofx-descriptor.ts';
import {
	OFX_CONSENT_STATES,
	type OfxConsentState,
} from './native-ofx-consent.ts';

export const FRAMESCAPER_OPENFX_PLUGIN_ACTIONS = Object.freeze([
	'enable', 'revoke', 'clear-quarantine',
] as const);
export type FramescaperOpenFxPluginAction =
	(typeof FRAMESCAPER_OPENFX_PLUGIN_ACTIONS)[number];

export interface FramescaperOpenFxPluginProjectionV1 {
	readonly pluginHandle: string;
	readonly pluginId: string;
	readonly vendor: string | null;
	readonly version: OfxPluginVersionV1;
	readonly binarySha256: string;
	readonly supportedContexts: readonly OfxContext[];
	readonly parameters: readonly OfxParameterDescriptorV1[];
	readonly components: readonly OfxComponent[];
	readonly pixelDepths: readonly OfxPixelDepth[];
	readonly threading: OfxThreadingDeclaration;
	readonly state: OfxConsentState;
	readonly quarantined: boolean;
}

export interface FramescaperOpenFxPluginControlRequestV1 {
	readonly pluginHandle: string;
	readonly action: FramescaperOpenFxPluginAction;
}

const PROJECTION_KEYS = Object.freeze([
	'pluginHandle', 'pluginId', 'vendor', 'version', 'binarySha256',
	'supportedContexts', 'parameters', 'components', 'pixelDepths',
	'threading', 'state', 'quarantined',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const HANDLE = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;

export function framescaperOpenFxPluginProjectionV1(
	value: unknown,
): FramescaperOpenFxPluginProjectionV1 {
	const record = exactRecord(value, PROJECTION_KEYS, 'OpenFX plug-in projection');
	const version = exactRecord(record.version, ['major', 'minor'], 'OpenFX plug-in version');
	if (typeof record.pluginHandle !== 'string' || !HANDLE.test(record.pluginHandle)
		|| typeof record.pluginId !== 'string' || !ID.test(record.pluginId)
		|| (record.vendor !== null && (typeof record.vendor !== 'string' || !ID.test(record.vendor)))
		|| typeof record.binarySha256 !== 'string' || !SHA256.test(record.binarySha256)
		|| !nonNegative(version.major) || !nonNegative(version.minor)
		|| typeof record.threading !== 'string'
		|| !(OFX_THREADING_DECLARATIONS as readonly string[]).includes(record.threading)
		|| typeof record.state !== 'string'
		|| !(OFX_CONSENT_STATES as readonly string[]).includes(record.state)
		|| typeof record.quarantined !== 'boolean') {
		throw new TypeError('A pathless OpenFX plug-in projection has invalid identity or state.');
	}
	const parameters = boundedArray(record.parameters, 4_096, 'OpenFX parameter projections')
		.map((value_) => {
			const parameter = exactRecord(value_, ['name', 'type', 'animates'], 'OpenFX parameter projection');
			if (typeof parameter.name !== 'string' || !NAME.test(parameter.name)
				|| typeof parameter.type !== 'string'
				|| !(OFX_PARAMETER_TYPES as readonly string[]).includes(parameter.type)
				|| typeof parameter.animates !== 'boolean') {
				throw new TypeError('A pathless OpenFX parameter projection is invalid.');
			}
			return Object.freeze({
				name: parameter.name as string,
				type: parameter.type as OfxParameterDescriptorV1['type'],
				animates: parameter.animates,
			});
		});
	return Object.freeze({
		pluginHandle: record.pluginHandle as string,
		pluginId: record.pluginId as string,
		vendor: record.vendor as string | null,
		version: Object.freeze({ major: Number(version.major), minor: Number(version.minor) }),
		binarySha256: record.binarySha256 as string,
		supportedContexts: enumArray(record.supportedContexts, OFX_CONTEXTS, 'OpenFX contexts'),
		parameters: Object.freeze(parameters),
		components: enumArray(record.components, OFX_COMPONENTS, 'OpenFX components'),
		pixelDepths: enumArray(record.pixelDepths, OFX_PIXEL_DEPTHS, 'OpenFX pixel depths'),
		threading: record.threading as OfxThreadingDeclaration,
		state: record.state as OfxConsentState,
		quarantined: record.quarantined,
	});
}

export function framescaperOpenFxPluginControlRequestV1(
	value: unknown,
): FramescaperOpenFxPluginControlRequestV1 {
	const record = exactRecord(value, ['pluginHandle', 'action'], 'OpenFX plug-in control request');
	if (typeof record.pluginHandle !== 'string' || !HANDLE.test(record.pluginHandle)
		|| typeof record.action !== 'string'
		|| !(FRAMESCAPER_OPENFX_PLUGIN_ACTIONS as readonly string[]).includes(record.action)) {
		throw new TypeError('A pathless OpenFX plug-in control request is invalid.');
	}
	return Object.freeze({
		pluginHandle: record.pluginHandle,
		action: record.action as FramescaperOpenFxPluginAction,
	});
}

function enumArray<const Value extends string>(
	value: unknown,
	allowed: readonly Value[],
	label: string,
): readonly Value[] {
	const result = boundedArray(value, 64, label);
	if (result.length === 0 || new Set(result).size !== result.length
		|| result.some((entry) => typeof entry !== 'string' || !allowed.includes(entry as Value))) {
		throw new TypeError(`A pathless ${label} inventory is invalid.`);
	}
	return Object.freeze(result as Value[]);
}

function boundedArray(value: unknown, maximum: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A pathless ${label} inventory must be a bounded dense array.`);
	}
	return value;
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A pathless ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some((key) => (
		typeof key !== 'string' || !fields.includes(key)
		|| !Object.getOwnPropertyDescriptor(record, key)?.enumerable
		|| !Object.hasOwn(Object.getOwnPropertyDescriptor(record, key)!, 'value')
	))) throw new TypeError(`A pathless ${label} has unsupported fields.`);
	return record;
}

function nonNegative(value: unknown): boolean {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
