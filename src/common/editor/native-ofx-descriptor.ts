/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `OfxPluginDescriptorV1` — what a scan learned about one OpenFX plug-in.
 *
 * A descriptor is bound to a binary digest, not to a path or a plug-in id.
 * Vendors reuse ids across releases and users replace bundles in place, so
 * identifying a plug-in by anything softer than its bytes would let a different
 * binary inherit the consent, enablement, and project state of the one the user
 * actually approved.
 *
 * The descriptor is also the boundary where a hostile bundle is refused. It
 * arrives from a short-lived isolated scan process, so everything in it is
 * untrusted input: unknown contexts, oversized inventories, unrecognised pixel
 * depths, and missing mandatory suites are rejected here rather than carried
 * into the host.
 */

import { OFX_TARGET_ARCHITECTURE_DIRECTORIES } from './native-ofx-packaging.ts';
import { createNativeValidators } from './native-validation.ts';

export const OFX_CONTEXTS = Object.freeze([
	'generator', 'filter', 'transition', 'paint', 'retimer', 'general',
] as const);

export type OfxContext = (typeof OFX_CONTEXTS)[number];

/** How each OpenFX image-effect context binds to a Framescaper object. */
export const OFX_CONTEXT_BINDINGS: Readonly<Record<OfxContext, string>> = Object.freeze({
	generator: 'external-generator-source-with-explicit-raster-and-time',
	filter: 'video-clip-or-adjustment-layer-effect',
	transition: 'explicit-transition-object',
	paint: 'effect-with-explicit-source-and-mask-input',
	retimer: 'exact-retime-mapping',
	general: 'bounded-external-effect-source-with-named-inputs',
});

/** Contexts whose standard parameter the host, not the plug-in, supplies. */
export const OFX_CONTEXT_STANDARD_PARAMETERS: Readonly<Record<string, string>> = Object.freeze({
	transition: 'Transition',
	retimer: 'SourceTime',
});

export const OFX_PARAMETER_TYPES = Object.freeze([
	'integer', 'integer2d', 'integer3d',
	'double', 'double2d', 'double3d',
	'rgb', 'rgba', 'boolean', 'choice', 'string',
	'group', 'page', 'pushbutton', 'parametric', 'custom',
] as const);

export type OfxParameterType = (typeof OFX_PARAMETER_TYPES)[number];

export const OFX_PIXEL_DEPTHS = Object.freeze(['byte', 'short', 'float'] as const);

export type OfxPixelDepth = (typeof OFX_PIXEL_DEPTHS)[number];

export const OFX_COMPONENTS = Object.freeze(['RGBA', 'RGB', 'Alpha'] as const);

export type OfxComponent = (typeof OFX_COMPONENTS)[number];

export const OFX_THREADING_DECLARATIONS = Object.freeze([
	'unsafe', 'instance-safe', 'fully-safe',
] as const);

export type OfxThreadingDeclaration = (typeof OFX_THREADING_DECLARATIONS)[number];

/**
 * The OpenFX 1.5.1 host surface. Every suite here is implemented; a plug-in
 * that asks for one outside this list gets a refusal rather than a stub, since
 * a stub suite is how a plug-in ends up rendering something subtly wrong.
 */
export const OFX_HOST_SUITES: readonly string[] = Object.freeze([
	'OfxImageEffectSuite',
	'OfxPropertySuite',
	'OfxParameterSuite',
	'OfxMemorySuite',
	'OfxMultiThreadSuite',
	'OfxMessageSuite',
	'OfxProgressSuite',
	'OfxTimeLineSuite',
	'OfxDialogSuite',
	'OfxInteractSuite',
	'OfxDrawSuite',
	'OfxParametricParameterSuite',
]);

/** Suites a conforming plug-in may always assume are present. */
export const OFX_MANDATORY_SUITES: readonly string[] = Object.freeze([
	'OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite',
]);

export const OFX_MAXIMUM_PARAMETERS = 4_096;

export interface OfxPluginVersionV1 {
	readonly major: number;
	readonly minor: number;
}

export interface OfxParameterDescriptorV1 {
	readonly name: string;
	readonly type: OfxParameterType;
	readonly animates: boolean;
}

export interface OfxPluginDescriptorV1 {
	readonly pluginId: string;
	readonly vendor: string | null;
	readonly version: OfxPluginVersionV1;
	readonly bundleIdentity: string;
	readonly binarySha256: string;
	readonly architectureDirectory: string;
	readonly supportedContexts: readonly OfxContext[];
	readonly parameters: readonly OfxParameterDescriptorV1[];
	readonly components: readonly OfxComponent[];
	readonly pixelDepths: readonly OfxPixelDepth[];
	readonly threading: OfxThreadingDeclaration;
	readonly requestedSuites: readonly string[];
}

export class OfxDescriptorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OfxDescriptorError';
	}
}

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:|._/\\-]{0,255}$/u;
// The packaging module owns the OpenFX directory names, several of which are
// hyphenated, so membership there is the test rather than a name shape here.
const ARCHITECTURE_DIRECTORIES: ReadonlySet<string> = new Set(
	Object.values(OFX_TARGET_ARCHITECTURE_DIRECTORIES),
);
const DESCRIPTOR_KEYS = Object.freeze([
	'pluginId', 'vendor', 'version', 'bundleIdentity', 'binarySha256',
	'architectureDirectory', 'supportedContexts', 'parameters', 'components',
	'pixelDepths', 'threading', 'requestedSuites',
]);

const { digest, exactKeys, pattern, plainRecord: record } = createNativeValidators({
	subject: 'An OFX descriptor',
	article: 'An',
	raise: (message: string): never => {
		throw new OfxDescriptorError(message);
	},
});

/** Admit one descriptor produced by an isolated scan process. */
export function assertOfxPluginDescriptorV1(
	value: unknown,
): asserts value is OfxPluginDescriptorV1 {
	const descriptor = record(value, 'OFX plug-in descriptor');
	exactKeys(descriptor, DESCRIPTOR_KEYS, 'OFX plug-in descriptor');
	pattern(descriptor.pluginId, PLUGIN_ID_PATTERN, 'pluginId');
	if (descriptor.vendor !== null) pattern(descriptor.vendor, PLUGIN_ID_PATTERN, 'vendor');
	version(descriptor.version);
	pattern(descriptor.bundleIdentity, IDENTITY_PATTERN, 'bundleIdentity');
	digest(descriptor.binarySha256, 'binarySha256');
	architectureDirectory(descriptor.architectureDirectory);
	uniqueMembers(descriptor.supportedContexts, OFX_CONTEXTS, 'supportedContexts', true);
	uniqueMembers(descriptor.components, OFX_COMPONENTS, 'components', true);
	uniqueMembers(descriptor.pixelDepths, OFX_PIXEL_DEPTHS, 'pixelDepths', true);
	if (typeof descriptor.threading !== 'string'
		|| !(OFX_THREADING_DECLARATIONS as readonly string[]).includes(descriptor.threading)) {
		throw new OfxDescriptorError('An OFX descriptor must declare a known threading safety level.');
	}
	parameters(descriptor.parameters);
	requestedSuites(descriptor.requestedSuites);
}

/**
 * The identity a consent, enablement, or project binding is attached to.
 *
 * Both the plug-in id and the exact binary digest are part of it: the id alone
 * lets a replaced bundle inherit approval, and the digest alone would treat two
 * unrelated plug-ins shipped in one build as interchangeable.
 */
export function ofxPluginFingerprint(descriptor: OfxPluginDescriptorV1): string {
	return `${descriptor.pluginId}@${descriptor.binarySha256}`;
}

export function ofxDescriptorsShareFingerprint(
	left: OfxPluginDescriptorV1,
	right: OfxPluginDescriptorV1,
): boolean {
	return ofxPluginFingerprint(left) === ofxPluginFingerprint(right);
}

/** The standard parameter the host supplies for a context, if it has one. */
export function ofxStandardParameterForContext(context: OfxContext): string | null {
	return OFX_CONTEXT_STANDARD_PARAMETERS[context] ?? null;
}

function architectureDirectory(value: unknown): void {
	if (typeof value !== 'string' || !ARCHITECTURE_DIRECTORIES.has(value)) {
		throw new OfxDescriptorError(
			'An OFX descriptor architectureDirectory is not one this host packages.',
		);
	}
}

function version(value: unknown): void {
	const parsed = record(value, 'OFX plug-in version');
	exactKeys(parsed, ['major', 'minor'], 'OFX plug-in version');
	for (const key of ['major', 'minor'] as const) {
		if (!Number.isSafeInteger(parsed[key]) || (parsed[key] as number) < 0) {
			throw new OfxDescriptorError('An OFX plug-in version must carry non-negative integers.');
		}
	}
}

function parameters(value: unknown): void {
	if (!Array.isArray(value)) {
		throw new OfxDescriptorError('An OFX descriptor must list its parameters.');
	}
	if (value.length > OFX_MAXIMUM_PARAMETERS) {
		throw new OfxDescriptorError('An OFX descriptor exceeds its parameter ceiling.');
	}
	const names = new Set<string>();
	for (const entry of value as readonly unknown[]) {
		const parameter = record(entry, 'OFX parameter descriptor');
		exactKeys(parameter, ['name', 'type', 'animates'], 'OFX parameter descriptor');
		const name = pattern(parameter.name, NAME_PATTERN, 'parameter name');
		if (names.has(name)) {
			throw new OfxDescriptorError('An OFX descriptor names the same parameter twice.');
		}
		names.add(name);
		if (typeof parameter.type !== 'string'
			|| !(OFX_PARAMETER_TYPES as readonly string[]).includes(parameter.type)) {
			throw new OfxDescriptorError('An OFX parameter must declare a known OpenFX type.');
		}
		if (typeof parameter.animates !== 'boolean') {
			throw new OfxDescriptorError('An OFX parameter must state whether it animates.');
		}
	}
}

function requestedSuites(value: unknown): void {
	if (!Array.isArray(value) || value.length === 0) {
		throw new OfxDescriptorError('An OFX descriptor must list the suites it requests.');
	}
	const requested = new Set<string>();
	for (const entry of value as readonly unknown[]) {
		if (typeof entry !== 'string' || !OFX_HOST_SUITES.includes(entry)) {
			throw new OfxDescriptorError('An OFX descriptor requests a suite this host does not implement.');
		}
		if (requested.has(entry)) {
			throw new OfxDescriptorError('An OFX descriptor requests the same suite twice.');
		}
		requested.add(entry);
	}
	for (const suite of OFX_MANDATORY_SUITES) {
		if (!requested.has(suite)) {
			throw new OfxDescriptorError(`An OFX descriptor must request the mandatory suite ${suite}.`);
		}
	}
}

function uniqueMembers(
	value: unknown,
	members: readonly string[],
	label: string,
	required: boolean,
): void {
	if (!Array.isArray(value) || (required && value.length === 0)) {
		throw new OfxDescriptorError(`An OFX descriptor must declare its ${label}.`);
	}
	const seen = new Set<string>();
	for (const entry of value as readonly unknown[]) {
		if (typeof entry !== 'string' || !members.includes(entry)) {
			throw new OfxDescriptorError(`An OFX descriptor ${label} entry is not a known OpenFX value.`);
		}
		if (seen.has(entry)) {
			throw new OfxDescriptorError(`An OFX descriptor repeats a ${label} entry.`);
		}
		seen.add(entry);
	}
}
