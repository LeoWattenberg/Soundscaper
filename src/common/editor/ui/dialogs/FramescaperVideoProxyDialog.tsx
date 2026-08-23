/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	framescaperVideoProxyActionRuntimeFor,
	type FramescaperVideoProxyOriginalRelinkCandidate,
	type FramescaperVideoProxyProgress,
} from '../../../../framescaper/editor-video-proxy-action-runtime-v20.ts';
import {
	createFramescaperVideoProxyDialogModel,
} from '../framescaper-video-proxy-dialog-model.ts';
import type { FramescaperVideoProxyModeV20 } from '../../../../framescaper/editor-video-proxy-use-policy-v20.ts';

interface ProxyFileService {
	readonly isDesktop?: boolean;
	readonly linkedVideoOriginalsAvailable?: boolean;
	chooseFiles?(request: Readonly<{ readonly purpose: 'video'; readonly multiple: false }>):
		PromiseLike<readonly unknown[]> | readonly unknown[];
	openReadDescriptor?(
		descriptor: unknown,
		request?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
	chooseLinkedVideoOriginal?(): PromiseLike<unknown> | unknown;
}

interface FramescaperVideoProxyDialogProps {
	readonly controller: object;
	readonly snapshot: Readonly<{
		readonly project?: unknown;
		readonly selectedClipId?: unknown;
		readonly missingSourceIds?: unknown;
		readonly readOnly?: unknown;
		readonly blocked?: unknown;
	}>;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly fileService: ProxyFileService;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function FramescaperVideoProxyDialog({
	controller, snapshot, editingBlocked, copy, fileService, run, onClose,
}: FramescaperVideoProxyDialogProps) {
	const runtime = framescaperVideoProxyActionRuntimeFor(controller);
	const model = useMemo(() => createFramescaperVideoProxyDialogModel({
		project: snapshot.project,
		selectedClipId: typeof snapshot.selectedClipId === 'string' ? snapshot.selectedClipId : null,
		missingSourceIds: Array.isArray(snapshot.missingSourceIds)
			? snapshot.missingSourceIds.filter((value): value is string => typeof value === 'string')
			: [],
		editingBlocked: editingBlocked || snapshot.blocked === true,
		readOnly: snapshot.readOnly === true,
	}), [editingBlocked, snapshot]);
	const [selectedSourceId, setSelectedSourceId] = useState<string | null>(model.selectedSourceId);
	const [mode, setMode] = useState<FramescaperVideoProxyModeV20>('auto');
	const [pending, setPending] = useState<
		'generate' | 'attach' | 'regenerate' | 'detach' | 'relink' | null
	>(null);
	const [progress, setProgress] = useState<Readonly<FramescaperVideoProxyProgress> | null>(null);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const [changedRelink, setChangedRelink] = useState<FramescaperVideoProxyOriginalRelinkCandidate | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const existingFileRef = useRef<HTMLInputElement | null>(null);
	const selected = model.sources.find(({ id }) => id === selectedSourceId) ?? null;

	useEffect(() => {
		if (!model.sources.some(({ id }) => id === selectedSourceId)) {
			setSelectedSourceId(model.selectedSourceId);
		}
	}, [model, selectedSourceId]);
	useEffect(() => {
		setMode(selectedSourceId && runtime ? runtime.mode(selectedSourceId) : 'auto');
		setChangedRelink(null);
	}, [runtime, selectedSourceId]);
	useEffect(() => () => { abortRef.current?.abort(); }, []);

	const perform = (
		kind: 'generate' | 'attach' | 'regenerate' | 'detach',
		operation: (signal?: AbortSignal) => Promise<void>,
	): void => {
		const abort = kind === 'detach' ? null : new AbortController();
		abortRef.current = abort;
		setPending(kind);
		setProgress(null);
		setStatus('');
		setError('');
		void Promise.resolve().then(() => run(() => operation(abort?.signal))).then(() => {
			setStatus(kind === 'detach'
				? label(copy, 'videoProxyDetached', 'Proxy detached. Undo remains available.')
				: kind === 'attach'
					? label(copy, 'videoProxyExistingAttached', 'Existing proxy validated and attached.')
					: label(copy, 'videoProxyGenerated', 'Proxy generated and attached.'));
		}, (operationError: unknown) => {
			if ((operationError as Error)?.name === 'AbortError') {
				setStatus(label(copy, 'videoProxyCancelled', 'Proxy work cancelled.'));
				return;
			}
			setError(operationError instanceof Error ? operationError.message : String(operationError));
		}).finally(() => {
			if (abortRef.current === abort) abortRef.current = null;
			setPending(null);
			setProgress(null);
		});
	};
	const generate = (regenerate: boolean): void => {
		if (!runtime || !selectedSourceId) return;
		perform(regenerate ? 'regenerate' : 'generate', (signal) => runtime[
			regenerate ? 'regenerate' : 'generate'
		](selectedSourceId, {
			...(signal ? { signal } : {}),
			onProgress: (next) => { setProgress(next); },
		}));
	};
	const detach = (): void => {
		if (!runtime || !selectedSourceId) return;
		perform('detach', () => runtime.detach(selectedSourceId));
	};
	const attachCandidate = (candidate: Blob): void => {
		if (!runtime || !selectedSourceId) return;
		perform('attach', (signal) => runtime.attachExisting(selectedSourceId, candidate, {
			...(signal ? { signal } : {}),
			onProgress: (next) => { setProgress(next); },
		}));
	};
	const chooseExisting = (): void => {
		if (!runtime || !selectedSourceId) return;
		if (fileService.isDesktop) {
			if (typeof fileService.chooseFiles !== 'function'
				|| typeof fileService.openReadDescriptor !== 'function') return;
			perform('attach', async (signal) => {
				const descriptors = await fileService.chooseFiles!({ purpose: 'video', multiple: false });
				throwIfAborted(signal);
				const descriptor = descriptors[0];
				if (descriptor === undefined) throw new DOMException('Proxy selection cancelled.', 'AbortError');
				const candidate = proxyCandidate(await fileService.openReadDescriptor!(
					descriptor,
					signal ? { signal } : {},
				));
				throwIfAborted(signal);
				await runtime.attachExisting(selectedSourceId, candidate, {
					...(signal ? { signal } : {}),
					onProgress: (next) => { setProgress(next); },
				});
			});
			return;
		}
		existingFileRef.current?.click();
	};
	const chooseOriginal = (): void => {
		if (!runtime || !selectedSourceId || typeof fileService.chooseLinkedVideoOriginal !== 'function') return;
		setPending('relink');
		setStatus('');
		setError('');
		void Promise.resolve(run(async () => {
			const choice = relinkChoice(await fileService.chooseLinkedVideoOriginal!());
			if (!choice) return;
			const result = await runtime.relinkOriginal(selectedSourceId, choice);
			if (result === 'confirmation-required') {
				setChangedRelink(choice);
				return;
			}
			setStatus(label(copy, 'videoProxyOriginalRelinked', 'Original video relinked.'));
		})).catch((operationError: unknown) => {
			setError(operationError instanceof Error ? operationError.message : String(operationError));
		}).finally(() => { setPending(null); });
	};
	const confirmChangedOriginal = (): void => {
		if (!runtime || !selectedSourceId || !changedRelink) return;
		const choice = changedRelink;
		setPending('relink');
		setError('');
		void Promise.resolve(run(() => runtime.relinkOriginal(
			selectedSourceId,
			choice,
			{ allowChangedContent: true },
		))).then(() => {
			setChangedRelink(null);
			setStatus(label(copy, 'videoProxyOriginalRelinkedChanged',
				'Changed original relinked. The stale proxy was detached; generate a new one.'));
		}, (operationError: unknown) => {
			setError(operationError instanceof Error ? operationError.message : String(operationError));
		}).finally(() => { setPending(null); });
	};
	const mutationsDisabled = model.mutationsDisabled || !runtime || pending !== null || !selected;
	const attachExistingAvailable = !fileService.isDesktop || (
		typeof fileService.chooseFiles === 'function'
		&& typeof fileService.openReadDescriptor === 'function'
	);

	return <AudioEditorDialogShell
		title={label(copy, 'videoProxyTitle', 'Video proxies')}
		onClose={onClose}
		width={640}
		initialFocus="[data-video-proxy-source]"
		dataAttributes={{ 'data-video-proxy-dialog': 'true' }}
	>
		<div className="audio-editor-video-proxy">
			<p>{label(copy, 'videoProxyDescription',
				'Generate lightweight preview pictures. Occurrence retime is applied after source selection; linked audio is never warped.')}</p>
			<p data-video-proxy-selection-policy="strict">{label(copy, 'videoProxySelectionPolicy',
				'Proxy mode refuses when a verified proxy is unavailable; Auto may fall back to the original.')}</p>
			{!model.supported && <p role="status">{label(copy, 'videoProxyUnsupported',
				'Video proxies are unavailable for this project version.')}</p>}
			{model.supported && model.sources.length === 0 && <p role="status">{
				label(copy, 'videoProxyNoSources', 'Import a video source before managing proxies.')
			}</p>}
			{model.sources.length > 0 && <>
				<label><span>{label(copy, 'videoProxySource', 'Video source')}</span>
					<select data-video-proxy-source value={selectedSourceId ?? ''}
						onChange={(event) => { setSelectedSourceId(event.currentTarget.value || null); }}>
						{model.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
					</select>
				</label>
				<label><span>{label(copy, 'videoProxyPreviewMode', 'Preview media')}</span>
					<select value={mode} disabled={!runtime || pending !== null}
							onChange={(event) => {
								const next = previewMode(event.currentTarget.value);
								if (runtime && selectedSourceId) {
									void Promise.resolve(run(() => runtime.setMode(selectedSourceId, next)))
										.catch((operationError: unknown) => {
											setError(operationError instanceof Error
												? operationError.message : String(operationError));
										});
								}
							setMode(next);
						}}>
						<option value="original">{label(copy, 'videoProxyModeOriginal', 'Original')}</option>
						<option value="proxy">{label(copy, 'videoProxyModeProxy', 'Proxy')}</option>
						<option value="auto">{label(copy, 'videoProxyModeAuto', 'Auto')}</option>
					</select>
				</label>
				{selected && <section aria-label={label(copy, 'videoProxyStatus', 'Proxy status')}>
					<p>{selected.attached
						? label(copy, 'videoProxyAttached', 'A verified proxy is attached.')
						: label(copy, 'videoProxyNotAttached', 'No proxy is attached.')}</p>
					{!selected.originalAvailable && selected.attached && <p role="status">{
						label(copy, 'videoProxyOfflineEditing',
							'The original is offline. Verified proxy pictures remain available for editing.')
					}</p>}
					<div>
						{!selected.attached && <button type="button" data-video-proxy-generate
							disabled={mutationsDisabled || !selected.originalAvailable}
							onClick={() => { generate(false); }}>{label(copy, 'videoProxyGenerateAttach',
								'Generate and attach')}</button>}
						{!selected.attached && <button type="button" data-video-proxy-attach-existing
							disabled={mutationsDisabled || !selected.originalAvailable || !attachExistingAvailable}
							onClick={chooseExisting}>{label(copy, 'videoProxyAttachExisting',
								'Attach existing…')}</button>}
						<input ref={existingFileRef} type="file" accept="video/*" hidden
							data-video-proxy-existing-file
							onChange={(event) => {
								const candidate = event.currentTarget.files?.[0] ?? null;
								event.currentTarget.value = '';
								if (candidate) attachCandidate(candidate);
							}} />
						{selected.attached && <button type="button" data-video-proxy-regenerate
							disabled={mutationsDisabled || !selected.originalAvailable}
							onClick={() => { generate(true); }}>{label(copy, 'videoProxyRegenerate', 'Regenerate')}</button>}
						{selected.attached && <button type="button" data-video-proxy-detach
							disabled={mutationsDisabled} onClick={detach}>{label(copy, 'videoProxyDetach', 'Detach')}</button>}
						{fileService.linkedVideoOriginalsAvailable && selected.projectBinClipId && <button type="button"
							disabled={mutationsDisabled} onClick={chooseOriginal}>{label(copy, 'videoProxyRelinkOriginal',
								'Relink original…')}</button>}
					</div>
				</section>}
			</>}
			{pending && progress && <div role="status" aria-live="polite">
				<progress value={progress.completed} max={progress.total} /> {phaseLabel(copy, progress.phase)}
			</div>}
			{pending && abortRef.current && <button type="button" data-video-proxy-cancel
				onClick={() => { abortRef.current?.abort(); }}>{label(copy, 'cancel', 'Cancel')}</button>}
			{changedRelink && <div role="alert">
				<p>{label(copy, 'videoProxyChangedOriginalWarning',
					'This file has different content. Relinking first detaches the stale proxy through project history.')}</p>
				<button type="button" disabled={pending !== null} onClick={confirmChangedOriginal}>{
					label(copy, 'videoProxyConfirmChangedOriginal', 'Relink changed original')
				}</button>
				<button type="button" disabled={pending !== null} onClick={() => { setChangedRelink(null); }}>{
					label(copy, 'cancel', 'Cancel')
				}</button>
			</div>}
			<p>{label(copy, 'videoProxyDeliveryAuthority',
				'Export and delivery always use the original. If it is offline, delivery refuses and asks you to relink it.')}</p>
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</div>
	</AudioEditorDialogShell>;
}

function previewMode(value: string): FramescaperVideoProxyModeV20 {
	return value === 'original' || value === 'proxy' ? value : 'auto';
}

function relinkChoice(value: unknown): FramescaperVideoProxyOriginalRelinkCandidate | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object') throw new TypeError('The selected linked original is invalid.');
	const choice = value as Readonly<Record<string, unknown>>;
	if (!(choice.file instanceof File) || typeof choice.locatorId !== 'string'
		|| typeof choice.locatorRevision !== 'string') {
		throw new TypeError('The selected linked original has no exact locator.');
	}
	return Object.freeze({
		file: choice.file,
		locator: Object.freeze({ locatorId: choice.locatorId, locatorRevision: choice.locatorRevision }),
	});
}

function phaseLabel(copy: Readonly<Record<string, string>>, phase: string): string {
	const fallbacks: Readonly<Record<string, string>> = {
		queued: 'Queued', generating: 'Generating proxy', validating: 'Validating proxy',
		publishing: 'Attaching proxy',
		cleaning: 'Cleaning up', complete: 'Complete',
	};
	return label(copy, `videoProxyPhase${phase[0]?.toUpperCase() ?? ''}${phase.slice(1)}`, fallbacks[phase] ?? phase);
}

function proxyCandidate(value: unknown): Blob {
	if (!(value instanceof Blob)) throw new TypeError('The selected proxy is not a pathless media body.');
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw signal.reason ?? new DOMException('Proxy attachment was cancelled.', 'AbortError');
	}
}

function label(copy: Readonly<Record<string, string>>, key: string, fallback: string): string {
	return copy[key] || fallback;
}
