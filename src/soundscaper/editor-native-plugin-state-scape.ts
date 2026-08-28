/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeAssetDescriptor, ScapeManifest } from '../common/editor/scape-archive-envelope.ts'
import {
	digestScapeBytes,
	verifyScapeExtractedAsset,
} from '../common/editor/scape-archive-media.ts'
import { extractScapeVideo, SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES } from '../common/editor/scape-archive-video.ts'
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts'
import type {
	ScapeProjectAssetExtension,
	ScapeProjectAssetExtensionExportRequest,
	ScapeProjectAssetExtensionImportRequest,
} from '../common/editor/scape-project-asset-extension.ts'
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts'
import {
	SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS,
	type SoundscaperNativePluginStateBody,
} from './editor-native-plugin-state.ts'
import { validateSoundscaperProject, type SoundscaperProject } from './editor-project-validation.ts'

export const SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND = 'native-plugin-state'
export const SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_ENCODING = 'opaque-bytes-v1'
export const SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME =
	'application/vnd.soundscaper.native-plugin-state'

export interface SoundscaperScapeNativePluginStateStore {
	getNativePluginStateBodyMetadata?(bodyId: string): PromiseLike<Readonly<{
		byteLength: number
		sha256: string
	}> | null> | Readonly<{ byteLength: number; sha256: string }> | null
	loadNativePluginStateBody?(
		bodyId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Blob | Uint8Array | null> | Blob | Uint8Array | null
	persistNativePluginStateBody?(
		bytes: Uint8Array,
		expected: Readonly<SoundscaperNativePluginStateBody>,
	): PromiseLike<Readonly<SoundscaperNativePluginStateBody>> |
		Readonly<SoundscaperNativePluginStateBody>
}

interface NativeStateValidation {
	readonly descriptors: readonly ScapeAssetDescriptor[]
}

/** Portable opaque-state ownership for exact baseline `.scape` archives. */
export function createSoundscaperNativePluginStateScapeExtension():
	Readonly<ScapeProjectAssetExtension> {
	const extension: ScapeProjectAssetExtension = {
		assetKinds: Object.freeze([SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND]),
		// The shared extension contract requires one owned source kind. baseline stores
		// these references at the document root, so none is added to project.sources.
		sourceKinds: Object.freeze([SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND]),
		planExportAssets: async ({ project, store, signal }: ScapeProjectAssetExtensionExportRequest) => {
			validateSoundscaperProject(project)
			const bodies = uniqueProjectBodies(project)
			if (bodies.length && typeof (store as SoundscaperScapeNativePluginStateStore)
				.getNativePluginStateBodyMetadata !== 'function') {
				throw new TypeError('Native plug-in state export requires body metadata authority.')
			}
			const assets: PlannedScapeExportAsset[] = []
			for (const body of bodies) {
				throwIfScapeAborted(signal)
				const metadata = await (store as SoundscaperScapeNativePluginStateStore)
					.getNativePluginStateBodyMetadata!(body.bodyId)
				if (!metadata || metadata.byteLength !== body.byteLength || metadata.sha256 !== body.sha256) {
					throw new Error(`Native plug-in state ${body.bodyId} is unavailable or changed.`)
				}
				assets.push(exportAsset(body))
			}
			return Object.freeze(assets)
		},
		validateExportAssetBody: async (asset: PlannedScapeExportAsset, body: Blob, signal?: AbortSignal) => {
			throwIfScapeAborted(signal)
			if (!(body instanceof Blob) || body.size !== asset.size) {
				throw new Error('A native plug-in state export body changed size.')
			}
			const sha256 = digestScapeBytes(new Uint8Array(await body.arrayBuffer()))
			if (sha256 !== asset.expectedSha256) {
				throw new Error('A native plug-in state export body failed its SHA-256.')
			}
		},
		validateImportAssets: (project: unknown, manifest: ScapeManifest) => validateImportAssets(project, manifest),
		stageImportAssets: (request: ScapeProjectAssetExtensionImportRequest) => stageImportAssets(request),
		validateReboundProject: (project: unknown) => { validateSoundscaperProject(project) },
		sourceStorageRole: () => 'none',
	}
	return Object.freeze(extension)
}

/** Make root-owned state bodies readable through the common media export loop. */
export function adaptSoundscaperScapeNativePluginStateStore<Store extends object>(
	store: Store & SoundscaperScapeNativePluginStateStore,
): Store {
	if (!store || typeof store !== 'object') throw new TypeError('A `.scape` project store is required.')
	return new Proxy(store, {
		get(target, property, receiver) {
			if (property === 'loadMediaAsset') {
				return async (storageKey: string, options?: Readonly<{ signal?: AbortSignal }>) => {
					if (isNativeBodyId(storageKey)) {
						if (typeof target.loadNativePluginStateBody !== 'function') {
							throw new TypeError('Native plug-in state export requires body read authority.')
						}
						const body = await target.loadNativePluginStateBody(storageKey, options)
						if (body === null) return null
						return body instanceof Blob ? body : new Blob([ordinaryBytes(body).slice().buffer])
					}
					const loader = Reflect.get(target, property, receiver) as
						((key: string, value?: unknown) => unknown) | undefined
					return typeof loader === 'function' ? Reflect.apply(loader, target, [storageKey, options]) : null
				}
			}
			const value = Reflect.get(target, property, receiver)
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
}

function exportAsset(body: Readonly<SoundscaperNativePluginStateBody>): PlannedScapeExportAsset {
	const source = Object.freeze({
		kind: SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND,
		id: body.bodyId,
		storageKey: body.bodyId,
		name: 'Native plug-in state',
		mimeType: SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME,
	})
	return Object.freeze({
		source,
		sourceId: body.bodyId,
		storageKey: body.bodyId,
		kind: SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND,
		entry: `native-plugin-state/${body.sha256}.bin`,
		encoding: SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_ENCODING,
		mimeType: SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME,
		size: body.byteLength,
		expectedSha256: body.sha256,
	})
}

function validateImportAssets(project: unknown, manifest: ScapeManifest): NativeStateValidation {
	validateSoundscaperProject(project)
	const expected = new Map(uniqueProjectBodies(project).map((body) => [body.bodyId, body]))
	const descriptors = manifest.assets.filter(
		({ kind }) => kind === SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND,
	)
	if (descriptors.length !== expected.size) {
		throw new Error('The `.scape` archive native plug-in state inventory is incomplete or unreferenced.')
	}
	for (const descriptor of descriptors) {
		const body = expected.get(descriptor.sourceId)
		if (!body
			|| descriptor.entry !== `native-plugin-state/${body.sha256}.bin`
			|| descriptor.encoding !== SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_ENCODING
			|| descriptor.mimeType !== SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME
			|| descriptor.size !== body.byteLength
			|| descriptor.sha256 !== body.sha256) {
			throw new Error('A `.scape` native plug-in state descriptor does not match its project reference.')
		}
	}
	return Object.freeze({ descriptors: Object.freeze(descriptors) })
}

async function stageImportAssets(request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<void> {
	const validation = request.validation as NativeStateValidation
	if (!validation?.descriptors || !Array.isArray(validation.descriptors)) {
		throw new TypeError('Native plug-in state import validation is required.')
	}
	if (validation.descriptors.length === 0) return
	const store = request.store as typeof request.store & SoundscaperScapeNativePluginStateStore
	if (typeof store.persistNativePluginStateBody !== 'function') {
		throw new TypeError('Native plug-in state import requires body persistence authority.')
	}
	const bodies = new Map(uniqueProjectBodies(request.project).map((body) => [body.bodyId, body]))
	for (const descriptor of validation.descriptors) {
		throwIfScapeAborted(request.signal)
		const expected = bodies.get(descriptor.sourceId)
		const entry = request.entryByName.get(descriptor.entry)
		if (!expected || !entry) throw new Error('A native plug-in state archive entry is missing.')
		const chunks: Uint8Array[] = []
		let size = 0
		const extracted = await extractScapeVideo(entry, {
			maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
			get bytesWritten() { return size },
			write: (chunk) => {
				if (chunk.byteLength > expected.byteLength - size) {
					throw new RangeError('Native plug-in state exceeded its admitted size.')
				}
				chunks.push(Uint8Array.from(chunk))
				size += chunk.byteLength
				return Promise.resolve()
			},
			commit: () => Promise.resolve({}),
			abort: () => Promise.resolve(),
		}, request.signal, request.expandedByteBudget)
		verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, expected.bodyId)
		const bytes = joinChunks(chunks, expected.byteLength)
		const persisted = await store.persistNativePluginStateBody(bytes, expected)
		if (persisted.bodyId !== expected.bodyId || persisted.sha256 !== expected.sha256
			|| persisted.byteLength !== expected.byteLength) {
			throw new Error('The imported native plug-in state body changed during persistence.')
		}
	}
}

function uniqueProjectBodies(project: SoundscaperProject | unknown):
	readonly Readonly<SoundscaperNativePluginStateBody>[] {
	validateSoundscaperProject(project)
	const exactProject = project as SoundscaperProject
	const unique = new Map<string, Readonly<SoundscaperNativePluginStateBody>>()
	for (const state of exactProject.nativePluginStates) unique.set(state.stateBody.bodyId, state.stateBody)
	return Object.freeze([...unique.values()])
}

function joinChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	if (byteLength > SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS.maximumStateBytes) {
		throw new RangeError('Native plug-in state exceeds the baseline byte ceiling.')
	}
	const result = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		if (chunk.byteLength > result.byteLength - offset) throw new RangeError('Native state chunk overflow.')
		result.set(chunk, offset)
		offset += chunk.byteLength
	}
	if (offset !== result.byteLength) throw new Error('Native plug-in state ended before its admitted size.')
	return result
}

function ordinaryBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer) {
		throw new TypeError('Native plug-in state storage returned non-ordinary bytes.')
	}
	return Uint8Array.from(value)
}

function isNativeBodyId(value: unknown): value is string {
	return typeof value === 'string' && /^native-plugin-state:[a-f0-9]{64}$/u.test(value)
}
