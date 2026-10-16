/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { DialogFooter } from '@soundscaper/design-system/Footer'
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx'
import NativeProcessingTheme from '../dialogs/NativeProcessingTheme.tsx'
import { ProcessingButton as Button } from '../dialogs/ProcessingButton.tsx'
import '../dialogs/ProcessingDialogs.css'
import { resolveAudioEditorDesktopBridge } from '../../file-service.js'
import { createAraEditSession } from '../../controller/effects/ara-edit-session.ts'
import { resolveAraClipEditingRuntime, type AraClipEditingRuntime } from '../../ara-clip-editing-runtime.ts'
import type { AraBridge } from '../../ara-contract.ts'
import { ARA_COPY_BY_LOCALE } from '../../../i18n/editor-ara-copy.ts'
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts'
import { captureNativeProcessingReturnFocus } from './native-processing-return-focus.ts'
import type { NativePluginAvailability, NativePluginRegistryView, NativePluginConsentAction } from '../soundscaper-native-services-bridge.ts'

interface AraDesktopBridge {
	readonly ara: AraBridge
	nativePluginAvailability(): Promise<NativePluginAvailability>
	listNativePlugins(): Promise<NativePluginRegistryView>
	setNativePluginInstallationAllowed(request: { installationId: string; allowed: boolean }): Promise<unknown>
	selectNativePluginInstallation(request: { installationId: string }): Promise<unknown>
	applyNativeTierControl?(request: { action: string; enabled: boolean }): Promise<unknown>
	setNativePluginConsent?(request: { format: string; action: NativePluginConsentAction; rootId?: string }): Promise<unknown>
	scanNativePlugins?(request: { format: string; rootId: string }): Promise<unknown>
}

interface AraController {
	subscribe(listener: () => void): () => void
}

const activeSurfaces = new WeakMap<object, () => void>()

/** Nothing is mounted until the existing Effect menu explicitly opens this surface. */
export function openAraClipEditorSurface(options: Readonly<{
	controller: unknown
	copy?: Readonly<Record<string, string | undefined>>
}>): void {
	const runtime = resolveAraClipEditingRuntime(options.controller)
	const raw = resolveAudioEditorDesktopBridge() as unknown as Partial<AraDesktopBridge> | null
	if (!runtime || !raw?.ara || !['start', 'write', 'bind', 'openEditor', 'render', 'close']
		.every((key) => typeof (raw.ara as unknown as Record<string, unknown>)[key] === 'function')
		|| typeof raw.listNativePlugins !== 'function' || typeof raw.nativePluginAvailability !== 'function') {
		throw new Error(options.copy?.['ui.ara.unavailable'] ?? ARA_COPY_BY_LOCALE.en.unavailable)
	}
	const controller = options.controller as AraController
	activeSurfaces.get(controller)?.()
	const container = document.createElement('div')
	container.dataset.araSurface = 'true'
	const parent = document.querySelector('[data-audio-editor]') ?? document.body
	parent.append(container)
	const root = createRoot(container)
	const restoreFocus = captureNativeProcessingReturnFocus(document)
	let closed = false
	const onClose = (): void => {
		if (closed) return
		closed = true
		activeSurfaces.delete(controller)
		queueMicrotask(() => { root.unmount(); container.remove(); restoreFocus() })
	}
	activeSurfaces.set(controller, onClose)
	root.render(<NativeProcessingTheme><AraClipEditorDialog bridge={raw as AraDesktopBridge}
		clipEditing={runtime} controller={controller} copy={options.copy} onClose={onClose} /></NativeProcessingTheme>)
}

interface PluginOption { readonly installationId: string; readonly label: string }

export function AraClipEditorDialog({ bridge, clipEditing, controller, copy: hostCopy, onClose }: Readonly<{
	bridge: AraDesktopBridge
	clipEditing: AraClipEditingRuntime
	controller: AraController
	copy?: Readonly<Record<string, string | undefined>>
	onClose(): void
}>) {
	const copy = useMemo(() => resolveEditorCopyScope('ara', ARA_COPY_BY_LOCALE.en, hostCopy), [hostCopy])
	const session = useMemo(() => createAraEditSession({ bridge: bridge.ara, clipEditing }), [bridge, clipEditing])
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
	const [plugins, setPlugins] = useState<readonly PluginOption[]>([])
	const [installationId, setInstallationId] = useState('')
	const [discoveryBusy, setDiscoveryBusy] = useState(false)
	const [error, setError] = useState('')
	const [availability, setAvailability] = useState<NativePluginAvailability | null>(null)
	const refresh = async (): Promise<void> => {
		const [payload, registry] = await Promise.all([bridge.nativePluginAvailability(), bridge.listNativePlugins()])
		setAvailability(payload)
		setPlugins(registry.entries.filter((entry) => entry.format.toLowerCase() === 'vst3')
			.flatMap((entry) => entry.installations.filter((installation) => !installation.quarantined)
				.map((installation) => ({ installationId: installation.installationId,
					label: `${entry.name} ${installation.version} — ${entry.vendor}` }))))
	}
	useEffect(() => {
		let active = true
		void Promise.all([bridge.nativePluginAvailability(), bridge.listNativePlugins()]).then(([payload, registry]) => {
			if (!active) return
			setAvailability(payload)
			setPlugins(registry.entries.filter((entry) => entry.format.toLowerCase() === 'vst3')
				.flatMap((entry) => entry.installations.filter((installation) => !installation.quarantined)
					.map((installation) => ({ installationId: installation.installationId,
						label: `${entry.name} ${installation.version} — ${entry.vendor}` }))))
		}).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : String(error)) })
		return () => { active = false }
	}, [bridge])
	useEffect(() => {
		const unsubscribe = controller.subscribe(() => { void session.reconcile() })
		return () => { unsubscribe(); void session.dispose().catch(() => undefined) }
	}, [controller, session])
	useEffect(() => { if (state.phase === 'applied') onClose() }, [state.phase, onClose])
	const busy = discoveryBusy || state.phase === 'opening' || state.phase === 'rendering'
	const editing = state.phase === 'editing'
	const perform = (operation: () => Promise<void>): void => {
		setError('')
		setDiscoveryBusy(true)
		void operation().catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)))
			.finally(() => setDiscoveryBusy(false))
	}
	const scan = async (custom: boolean): Promise<void> => {
		if (!bridge.applyNativeTierControl || !bridge.setNativePluginConsent || !bridge.scanNativePlugins) {
			throw new Error(copy.unavailable)
		}
		await bridge.applyNativeTierControl({ action: 'set-native-effect-discovery-enabled', enabled: true })
		await bridge.setNativePluginConsent({ format: 'vst3', action: 'grant' })
		if (custom) await bridge.setNativePluginConsent({ format: 'vst3', action: 'add-custom-root' })
		const payload = await bridge.nativePluginAvailability()
		const format = payload.consent.formats.find((format) => format.format.toLowerCase() === 'vst3')
		for (const root of format?.roots ?? []) {
			if (!root.admitted && !custom) await bridge.setNativePluginConsent({ format: 'vst3', action: 'add-standard-root', rootId: root.rootId })
			if (root.admitted || !custom) await bridge.scanNativePlugins({ format: 'vst3', rootId: root.rootId })
		}
		await refresh()
	}
	const close = (): void => { void session.dispose().catch(() => undefined); onClose() }
	return <AudioEditorDialogShell title={copy.title} onClose={close} width={680}
		dataAttributes={{ 'data-ara-clip-editor': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button onClick={close}>{copy.cancel}</Button>
			<Button variant="primary" disabled={!editing || busy} onClick={() => { void session.apply() }}>{copy.render}</Button>
		</>} />}>
		<p>{copy.description}</p>
		<div className="audio-editor-soundscaper-native-services">
			<label>{copy.plugin} <select aria-label={copy.plugin} value={installationId} disabled={busy || editing}
				onChange={(event) => setInstallationId(event.target.value)}>
				<option value="">{copy.choosePlugin}</option>
				{plugins.map((plugin) => <option key={plugin.installationId} value={plugin.installationId}>{plugin.label}</option>)}
			</select></label>
			<p role="status" aria-live="polite">{error || state.message || (state.phase === 'opening' ? copy.opening
				: state.phase === 'rendering' ? copy.rendering : editing ? copy.editing
					: plugins.length === 0 ? availability?.payload.status === 'unavailable' ? copy.unavailable : copy.noPlugins : '')}</p>
			{busy && <progress max={1} value={state.progress} aria-label={state.phase === 'rendering' ? copy.rendering : copy.opening} />}
			<div className="audio-editor-dialog-buttons">
				<Button disabled={busy || editing} onClick={() => perform(refresh)}>{copy.refresh}</Button>
				<Button disabled={busy || editing} onClick={() => perform(() => scan(false))}>{copy.scan}</Button>
				<Button disabled={busy || editing} onClick={() => perform(() => scan(true))}>{copy.customFolder}…</Button>
				<Button disabled={busy || editing || !installationId} onClick={() => perform(async () => {
					await bridge.setNativePluginInstallationAllowed({ installationId, allowed: true })
					await bridge.selectNativePluginInstallation({ installationId })
					await session.open(installationId)
				})}>{copy.openClip}</Button>
				<Button disabled={!editing || busy} onClick={() => { void session.openEditor() }}>{copy.openEditor}</Button>
			</div>
		</div>
	</AudioEditorDialogShell>
}
