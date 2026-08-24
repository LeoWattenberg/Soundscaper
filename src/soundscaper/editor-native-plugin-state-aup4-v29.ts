/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
} from '../common/editor/audacity-binary-xml.js'
import { digestScapeBytes } from '../common/editor/scape-archive-media.ts'
import {
	normalizeSoundscaperNativePluginStatesV29,
	SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29,
	type SoundscaperNativePluginStateBodyV29,
	type SoundscaperNativePluginStateV29,
} from './editor-native-plugin-state-v29.ts'
import {
	cloneSoundscaperProjectV29,
} from './editor-project-v29.ts'
import {
	validateSoundscaperProjectV29,
	type SoundscaperProjectV29,
} from './editor-project-v29-validation.ts'
import {
	SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX,
	SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX,
} from './editor-native-plugin-playback-v29.ts'
import { reconcileSoundscaperProjectFeatureRequirementsV29 } from './editor-project-feature-requirements-v29.ts'

export const SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE_V29 =
	'soundscaper-native-plugin-states-v1'
export const SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V29 = 128 * 1024 * 1024

export interface SoundscaperAup4NativePluginStateStoreV29 {
	loadNativePluginStateBody?(
		bodyId: string,
	): PromiseLike<Blob | Uint8Array | null> | Blob | Uint8Array | null
	persistNativePluginStateBody?(
		bytes: Uint8Array,
		expected: Readonly<SoundscaperNativePluginStateBodyV29>,
	): PromiseLike<Readonly<SoundscaperNativePluginStateBodyV29>> |
		Readonly<SoundscaperNativePluginStateBodyV29>
}

interface AudacityNode {
	readonly name: string
	readonly content: readonly AudacityContent[]
}

type AudacityContent =
	| Readonly<{ kind: 'attribute'; name: string; type: string; value: unknown }>
	| Readonly<{ kind: 'blob'; name: string; value: Uint8Array }>
	| Readonly<{ kind: 'node'; node: AudacityNode }>
	| Readonly<{ kind: string; [key: string]: unknown }>

const xmlAttribute = audacityXmlAttribute as unknown as (
	node: AudacityNode, name: string, fallback?: unknown,
) => unknown
const xmlAttributes = audacityXmlAttributes as unknown as (
	node: AudacityNode,
) => readonly Readonly<{ kind: 'attribute'; name: string; type: string; value: unknown }>[]
const xmlChildren = audacityXmlChildren as unknown as (
	node: AudacityNode, name: string,
) => AudacityNode[]

const ROOT_ATTRIBUTES = Object.freeze([
	'version', 'instance-count', 'body-count', 'total-body-bytes',
])
const BODY_ATTRIBUTES = Object.freeze(['sha256', 'byte-length'])
const INSTANCE_ATTRIBUTES = Object.freeze([
	'instance-id', 'format', 'stable-plugin-id', 'binary-sha256', 'state-sha256',
	'state-byte-length', 'enabled', 'bypassed', 'continuity', 'latency-samples',
])

/** Add the exact opaque-state extension consumed by Audacity's binary XML. */
export async function embedSoundscaperNativePluginStatesInAup4V29(
	projectValue: SoundscaperProjectV29 | unknown,
	store: SoundscaperAup4NativePluginStateStoreV29,
): Promise<SoundscaperProjectV29> {
	validateSoundscaperProjectV29(projectValue)
	const project = projectValue as SoundscaperProjectV29
	const states = normalizeSoundscaperNativePluginStatesV29(project.nativePluginStates)
	const draft = cloneSoundscaperProjectV29(project) as unknown as Record<string, unknown>
	const extensions = dataRecord(draft.opaqueExtensions, 'project.opaqueExtensions')
	const existing = extensionEntries(extensions.aup4UnknownNodes)
	const retained = existing.filter((entry) => !isOwnedExtension(entry))
	if (states.length === 0) {
		draft.opaqueExtensions = { ...extensions, aup4UnknownNodes: retained }
		validateSoundscaperProjectV29(draft)
		return draft as unknown as SoundscaperProjectV29
	}
	if (typeof store?.loadNativePluginStateBody !== 'function') {
		throw new TypeError('AUP4 native plug-in-state export requires body read authority.')
	}
	const uniqueBodies = new Map<string, Readonly<SoundscaperNativePluginStateBodyV29>>()
	for (const state of states) uniqueBodies.set(state.stateBody.bodyId, state.stateBody)
	const bodies: Readonly<{ descriptor: Readonly<SoundscaperNativePluginStateBodyV29>; bytes: Uint8Array }>[] = []
	let totalBytes = 0
	for (const descriptor of uniqueBodies.values()) {
		const loaded = await store.loadNativePluginStateBody(descriptor.bodyId)
		if (loaded === null) throw new Error(`Native plug-in state ${descriptor.bodyId} is unavailable.`)
		const bytes = await exactBytes(loaded)
		if (bytes.byteLength !== descriptor.byteLength) {
			throw new Error(`Native plug-in state ${descriptor.bodyId} changed byte length.`)
		}
		if (digestScapeBytes(bytes) !== descriptor.sha256) {
			throw new Error(`Native plug-in state ${descriptor.bodyId} failed SHA-256 verification.`)
		}
		totalBytes += bytes.byteLength
		if (totalBytes > SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V29) {
			throw new RangeError('AUP4 native plug-in state exceeds its aggregate byte ceiling.')
		}
		bodies.push(Object.freeze({ descriptor, bytes }))
	}
	const node = createExtensionNode(states, bodies, totalBytes)
	draft.opaqueExtensions = {
		...extensions,
		aup4UnknownNodes: Object.freeze([...retained, Object.freeze({ kind: 'node', node })]),
	}
	validateSoundscaperProjectV29(draft)
	return draft as unknown as SoundscaperProjectV29
}

/** Recover and persist the extension; malformed custody fails closed. */
export async function recoverSoundscaperNativePluginStatesFromAup4V29(
	projectValue: SoundscaperProjectV29 | unknown,
	store: SoundscaperAup4NativePluginStateStoreV29,
): Promise<SoundscaperProjectV29> {
	const project = normalizeAup4CarrierProject(projectValue)
	const extensions = dataRecord(project.opaqueExtensions, 'project.opaqueExtensions')
	const candidates = extensionEntries(extensions.aup4UnknownNodes).filter(isOwnedExtension)
	if (candidates.length === 0) return cloneSoundscaperProjectV29(project)
	if (candidates.length !== 1) {
		throw new Error('AUP4 native plug-in-state custody is ambiguous.')
	}
	if (typeof store?.persistNativePluginStateBody !== 'function') {
		throw new TypeError('AUP4 native plug-in-state import requires body persistence authority.')
	}
	const parsed = parseExtensionNode(candidates[0]!.node)
	for (const body of parsed.bodies.values()) {
		const persisted = await store.persistNativePluginStateBody(Uint8Array.from(body.bytes), body.descriptor)
		if (persisted.bodyId !== body.descriptor.bodyId
			|| persisted.byteLength !== body.descriptor.byteLength
			|| persisted.sha256 !== body.descriptor.sha256) {
			throw new Error('AUP4 native plug-in state changed identity during persistence.')
		}
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>
	draft.nativePluginStates = parsed.states
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(
		draft,
		draft.featureRequirements as never,
	)
	validateSoundscaperProjectV29(draft)
	return draft as unknown as SoundscaperProjectV29
}

function normalizeAup4CarrierProject(value: unknown): SoundscaperProjectV29 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('AUP4 native state requires a project carrier.')
	}
	const draft = structuredClone(value) as Record<string, unknown>
	const manifest = dataRecord(draft.featureRequirements, 'project.featureRequirements')
	const requirements = Array.isArray(manifest.requirements) ? manifest.requirements.filter((candidate) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return true
		const row = candidate as Readonly<Record<string, unknown>>
		return !(typeof row.id === 'string' && row.id.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX))
			&& !(typeof row.featureId === 'string' && row.featureId.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX))
	}) : manifest.requirements
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(draft, {
		...manifest, requirements,
	} as never)
	validateSoundscaperProjectV29(draft)
	return draft as unknown as SoundscaperProjectV29
}

function createExtensionNode(
	states: readonly Readonly<SoundscaperNativePluginStateV29>[],
	bodies: readonly Readonly<{
		descriptor: Readonly<SoundscaperNativePluginStateBodyV29>
		bytes: Uint8Array
	}>[],
	totalBytes: number,
): AudacityNode {
	const content: AudacityContent[] = []
	for (const { descriptor, bytes } of bodies) content.push({
		kind: 'node',
		node: createAudacityXmlNode('body', [
			attribute('sha256', 'string', descriptor.sha256),
			attribute('byte-length', 'long-long', descriptor.byteLength),
		], [{ kind: 'blob', name: 'state', value: bytes }]),
	})
	for (const state of states) content.push({
		kind: 'node',
		node: createAudacityXmlNode('instance', [
			attribute('instance-id', 'string', state.instanceId),
			attribute('format', 'string', state.format),
			attribute('stable-plugin-id', 'string', state.stablePluginId),
			attribute('binary-sha256', 'string', state.binarySha256),
			attribute('state-sha256', 'string', state.stateBody.sha256),
			attribute('state-byte-length', 'long-long', state.stateBody.byteLength),
			attribute('enabled', 'bool', state.enabled),
			attribute('bypassed', 'bool', state.bypassed),
			attribute('continuity', 'string', state.continuity),
			attribute('latency-samples', 'long-long', state.latencySamples),
		]),
	})
	return createAudacityXmlNode(SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE_V29, [
		attribute('version', 'int', 1),
		attribute('instance-count', 'int', states.length),
		attribute('body-count', 'int', bodies.length),
		attribute('total-body-bytes', 'long-long', totalBytes),
	], content) as AudacityNode
}

function parseExtensionNode(node: AudacityNode): Readonly<{
	states: readonly Readonly<SoundscaperNativePluginStateV29>[]
	bodies: ReadonlyMap<string, Readonly<{
		descriptor: Readonly<SoundscaperNativePluginStateBodyV29>
		bytes: Uint8Array
	}>>
}> {
	exactAttributes(node, ROOT_ATTRIBUTES, 'AUP4 native plug-in-state extension')
	if (xmlAttribute(node, 'version') !== 1) {
		throw new TypeError('The AUP4 native plug-in-state extension version is unsupported.')
	}
	const bodyNodes = xmlChildren(node, 'body')
	const instanceNodes = xmlChildren(node, 'instance')
	if (bodyNodes.length !== boundedCount(xmlAttribute(node, 'body-count'), 'body count')
		|| instanceNodes.length !== boundedCount(xmlAttribute(node, 'instance-count'), 'instance count')
		|| node.content.some((entry) => entry.kind === 'node'
			&& nodeEntry(entry).name !== 'body' && nodeEntry(entry).name !== 'instance')) {
		throw new TypeError('The AUP4 native plug-in-state extension inventory is malformed.')
	}
	const bodies = new Map<string, Readonly<{
		descriptor: Readonly<SoundscaperNativePluginStateBodyV29>
		bytes: Uint8Array
	}>>()
	let totalBytes = 0
	for (const bodyNode of bodyNodes) {
		exactAttributes(bodyNode, BODY_ATTRIBUTES, 'AUP4 native plug-in-state body')
		const sha256 = String(xmlAttribute(bodyNode, 'sha256', ''))
		const byteLength = boundedStateBytes(xmlAttribute(bodyNode, 'byte-length'))
		const blobs = bodyNode.content.filter((entry) => entry.kind === 'blob') as
			readonly Readonly<{ kind: 'blob'; name: string; value: Uint8Array }>[]
		if (blobs.length !== 1 || blobs[0]!.name !== 'state'
			|| bodyNode.content.some((entry) => entry.kind !== 'attribute' && entry.kind !== 'blob')) {
			throw new TypeError('An AUP4 native plug-in-state body payload is malformed.')
		}
		const bytes = ordinaryBytes(blobs[0]!.value)
		if (bytes.byteLength !== byteLength || digestScapeBytes(bytes) !== sha256) {
			throw new Error('An AUP4 native plug-in-state body failed SHA-256 or length verification.')
		}
		if (bodies.has(sha256)) throw new Error('An AUP4 native plug-in-state body is duplicated.')
		const descriptor = normalizeBody({ sha256, byteLength })
		bodies.set(sha256, Object.freeze({ descriptor, bytes }))
		totalBytes += bytes.byteLength
		if (totalBytes > SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V29) {
			throw new RangeError('AUP4 native plug-in state exceeds its aggregate byte ceiling.')
		}
	}
	if (totalBytes !== boundedAggregate(xmlAttribute(node, 'total-body-bytes'))) {
		throw new Error('The AUP4 native plug-in-state aggregate byte count changed.')
	}
	const states = normalizeSoundscaperNativePluginStatesV29(instanceNodes.map((instance) => {
		exactAttributes(instance, INSTANCE_ATTRIBUTES, 'AUP4 native plug-in-state instance')
		if (instance.content.some((entry) => entry.kind !== 'attribute')) {
			throw new TypeError('An AUP4 native plug-in-state instance has unsupported payload.')
		}
		const sha256 = String(xmlAttribute(instance, 'state-sha256', ''))
		const body = bodies.get(sha256)?.descriptor
		if (!body || body.byteLength !== boundedStateBytes(
			xmlAttribute(instance, 'state-byte-length'),
		)) throw new Error('An AUP4 native plug-in-state instance references a missing body.')
		return {
			instanceId: xmlAttribute(instance, 'instance-id'),
			format: xmlAttribute(instance, 'format'),
			stablePluginId: xmlAttribute(instance, 'stable-plugin-id'),
			binarySha256: xmlAttribute(instance, 'binary-sha256'),
			stateBody: body,
			enabled: xmlAttribute(instance, 'enabled'),
			bypassed: xmlAttribute(instance, 'bypassed'),
			continuity: xmlAttribute(instance, 'continuity'),
			latencySamples: xmlAttribute(instance, 'latency-samples'),
		}
	}))
	const referenced = new Set(states.map(({ stateBody }) => stateBody.sha256))
	if (referenced.size !== bodies.size) {
		throw new Error('The AUP4 native plug-in-state extension contains an unreferenced body.')
	}
	return Object.freeze({ states, bodies })
}

function normalizeBody(value: Readonly<{ sha256: string; byteLength: number }>){
	return normalizeSoundscaperNativePluginStatesV29([{
		instanceId: 'body-validation', format: 'clap', stablePluginId: 'body-validation',
		binarySha256: '00'.repeat(32),
		stateBody: {
			kind: 'native-plugin-state', bodyId: `native-plugin-state:${value.sha256}`,
			byteLength: value.byteLength, sha256: value.sha256,
		},
		enabled: false, bypassed: false, continuity: 'frozen', latencySamples: 0,
	}])[0]!.stateBody
}

function exactAttributes(node: AudacityNode, names: readonly string[], label: string): void {
	const attributes = xmlAttributes(node)
	if (attributes.length !== names.length || attributes.some(
		(attributeValue, index) => attributeValue.name !== names[index],
	)) throw new TypeError(`${label} attributes are malformed.`)
}

function extensionEntries(value: unknown): readonly Readonly<{ kind: 'node'; node: AudacityNode }>[] {
	if (value === undefined) return Object.freeze([])
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('AUP4 unknown-node custody must be a plain array.')
	}
	return value.filter((entry): entry is Readonly<{ kind: 'node'; node: AudacityNode }> => (
		Boolean(entry) && typeof entry === 'object'
		&& (entry as { kind?: unknown }).kind === 'node'
		&& Boolean((entry as { node?: unknown }).node)
	))
}

function isOwnedExtension(entry: Readonly<{ kind: 'node'; node: AudacityNode }>): boolean {
	return entry.node.name === SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE_V29
}

function nodeEntry(value: AudacityContent): AudacityNode {
	return (value as Readonly<{ kind: 'node'; node: AudacityNode }>).node
}

function attribute(name: string, type: string, value: unknown) {
	return { kind: 'attribute' as const, name, type, value }
}

async function exactBytes(value: Blob | Uint8Array): Promise<Uint8Array> {
	if (value instanceof Blob) return ordinaryBytes(new Uint8Array(await value.arrayBuffer()))
	return ordinaryBytes(value)
}

function ordinaryBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer) {
		throw new TypeError('AUP4 native plug-in-state storage returned non-ordinary bytes.')
	}
	return Uint8Array.from(value)
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`)
	}
	return value as Record<string, unknown>
}

function boundedCount(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0
		|| Number(value) > SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29.maximumEntries) {
		throw new RangeError(`The AUP4 native plug-in-state ${label} is invalid.`)
	}
	return Number(value)
}

function boundedStateBytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0
		|| Number(value) > SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29.maximumStateBytes) {
		throw new RangeError('An AUP4 native plug-in-state byte length is invalid.')
	}
	return Number(value)
}

function boundedAggregate(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0
		|| Number(value) > SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V29) {
		throw new RangeError('The AUP4 native plug-in-state aggregate byte count is invalid.')
	}
	return Number(value)
}
