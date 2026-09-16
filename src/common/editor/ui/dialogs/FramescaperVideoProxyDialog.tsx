import { usePresentationFeedback, feedbackFailure } from '../presentation-feedback.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_PROXY_ADDITIONAL_COPY } from '../../../i18n/editor-video-proxy-additional-copy.ts';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	framescaperVideoProxyActionRuntimeFor,
	type FramescaperVideoProxyOriginalRelinkCandidate,
	type FramescaperVideoProxyPreviewTrust,
	type FramescaperVideoProxyProgress,
} from '../../../../framescaper/editor-video-proxy-action-runtime.ts';
import {
	createFramescaperVideoProxyDialogModel,
} from '../framescaper-video-proxy-dialog-model.ts';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import type { FramescaperVideoProxyModeRetime } from '../../../../framescaper/editor-video-proxy-use-policy-retime.ts';

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
	const [mode, setMode] = useState<FramescaperVideoProxyModeRetime>('auto');
	const [pending, setPending] = useState<
		'generate' | 'attach' | 'regenerate' | 'detach' | 'relink' | null
	>(null);
	const [progress, setProgress] = useState<Readonly<FramescaperVideoProxyProgress> | null>(null);
	const [status, setStatus] = usePresentationFeedback(copy, VIDEO_PROXY_ADDITIONAL_COPY, 'videoProxy');
	const [error, setError] = usePresentationFeedback(copy, VIDEO_PROXY_ADDITIONAL_COPY, 'videoProxy');
	const [changedRelink, setChangedRelink] = useState<FramescaperVideoProxyOriginalRelinkCandidate | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const existingFileRef = useRef<HTMLInputElement | null>(null);
	const modeGenerationRef = useRef(0);
	const modeMutationRef = useRef<Promise<void>>(Promise.resolve());
	const selected = model.sources.find(({ id }) => id === selectedSourceId) ?? null;
	const previewTrust = selected && runtime ? runtime.previewTrust(selected.id) : 'unverified';

	useEffect(() => {
		if (!model.sources.some(({ id }) => id === selectedSourceId)) {
			setSelectedSourceId(model.selectedSourceId);
		}
	}, [model, selectedSourceId]);
	useEffect(() => {
		modeGenerationRef.current += 1;
		setMode(selectedSourceId && runtime ? runtime.mode(selectedSourceId) : 'auto');
		setChangedRelink(null);
	}, [runtime, selectedSourceId]);
	useEffect(() => () => {
		abortRef.current?.abort();
		modeGenerationRef.current += 1;
	}, []);

	const changeMode = (value: string): void => {
		const next = previewMode(value);
		setMode(next);
		if (!runtime || !selectedSourceId) return;
		const generation = ++modeGenerationRef.current;
		const sourceId = selectedSourceId;
		setStatus('');
		setError('');
		const mutation = modeMutationRef.current.then(() => (
			runAwaitedAudioEditorOperation(run, () => runtime.setMode(sourceId, next)).then(() => undefined)
		));
		modeMutationRef.current = mutation.catch(() => undefined);
		void mutation.then(() => {
			if (modeGenerationRef.current !== generation) return;
			setStatus({ key: 'videoProxyModeUpdated' });
		}, (operationError: unknown) => {
			if (modeGenerationRef.current !== generation) return;
			setMode(runtime.mode(sourceId));
			setError(feedbackFailure(operationError));
		});
	};

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
		void runAwaitedAudioEditorOperation(run, () => operation(abort?.signal)).then(() => {
			setStatus(kind === 'detach'
				? { key: 'videoProxyDetached' }
				: kind === 'attach'
					? { key: 'videoProxyExistingAttached' }
					: { key: 'videoProxyGenerated' });
		}, (operationError: unknown) => {
			if ((operationError as Error)?.name === 'AbortError') {
				setStatus({ key: 'videoProxyCancelled' });
				return;
			}
			setError(feedbackFailure(operationError));
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
		void runAwaitedAudioEditorOperation(run, async () => {
			const choice = relinkChoice(await fileService.chooseLinkedVideoOriginal!());
			if (!choice) return;
			const result = await runtime.relinkOriginal(selectedSourceId, choice);
			if (result === 'confirmation-required') {
				setChangedRelink(choice);
				return;
			}
			setStatus({ key: 'videoProxyOriginalRelinked' });
		}).catch((operationError: unknown) => {
			setError(feedbackFailure(operationError));
		}).finally(() => { setPending(null); });
	};
	const confirmChangedOriginal = (): void => {
		if (!runtime || !selectedSourceId || !changedRelink) return;
		const choice = changedRelink;
		setPending('relink');
		setError('');
		void runAwaitedAudioEditorOperation(run, () => runtime.relinkOriginal(
			selectedSourceId,
			choice,
			{ allowChangedContent: true },
		)).then(() => {
			setChangedRelink(null);
			setStatus({ key: 'videoProxyOriginalRelinkedChanged' });
		}, (operationError: unknown) => {
			setError(feedbackFailure(operationError));
		}).finally(() => { setPending(null); });
	};
	const mutationsDisabled = model.mutationsDisabled || !runtime || pending !== null || !selected;
	const attachExistingAvailable = !fileService.isDesktop || (
		typeof fileService.chooseFiles === 'function'
		&& typeof fileService.openReadDescriptor === 'function'
	);

	return <AudioEditorDialogShell
		title={label(copy, 'videoProxyTitle', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyTitle)}
		onClose={onClose}
		width={640}
		initialFocus="[data-video-proxy-source]"
		dataAttributes={{ 'data-video-proxy-dialog': 'true' }}
	>
		<div className="audio-editor-video-proxy">
			<p>{label(copy, 'videoProxyDescription',
				VIDEO_PROXY_ADDITIONAL_COPY.videoProxyDescription)}</p>
			<p data-video-proxy-selection-policy="strict">{label(copy, 'videoProxySelectionPolicy',
				VIDEO_PROXY_ADDITIONAL_COPY.videoProxySelectionPolicy)}</p>
			{!model.supported && <p role="status">{label(copy, 'videoProxyUnsupported',
				VIDEO_PROXY_ADDITIONAL_COPY.videoProxyUnsupported)}</p>}
			{model.supported && model.sources.length === 0 && <p role="status">{
				label(copy, 'videoProxyNoSources', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyNoSources)
			}</p>}
			{model.sources.length > 0 && <>
				<label><span>{label(copy, 'videoProxySource', VIDEO_PROXY_ADDITIONAL_COPY.videoProxySource)}</span>
					<select data-video-proxy-source value={selectedSourceId ?? ''}
						disabled={pending !== null}
						onChange={(event) => {
							modeGenerationRef.current += 1;
							setSelectedSourceId(event.currentTarget.value || null);
						}}>
						{model.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
					</select>
				</label>
				<label><span>{label(copy, 'videoProxyPreviewMode', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyPreviewMode)}</span>
					<select value={mode} data-video-proxy-preview-mode={mode}
						disabled={!runtime || pending !== null}
						onChange={(event) => changeMode(event.currentTarget.value)}>
						<option value="original">{label(copy, 'videoProxyModeOriginal', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyModeOriginal)}</option>
						<option value="proxy">{label(copy, 'videoProxyModeProxy', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyModeProxy)}</option>
						<option value="auto">{label(copy, 'videoProxyModeAuto', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyModeAuto)}</option>
					</select>
				</label>
				{selected && <section aria-label={label(copy, 'videoProxyStatus', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyStatus)}>
					<p role={previewTrust === 'stale' || previewTrust === 'unavailable' ? 'alert' : undefined}>{
						proxyTrustLabel(copy, selected.attachmentPresent, previewTrust)
					}</p>
					{!selected.originalAvailable && previewTrust === 'verified' && <p role="status">{
						label(copy, 'videoProxyOfflineEditing',
							VIDEO_PROXY_ADDITIONAL_COPY.videoProxyOfflineEditing)
					}</p>}
					<div>
						{!selected.attachmentPresent && <button type="button" data-video-proxy-generate
							disabled={mutationsDisabled || !selected.originalAvailable}
							onClick={() => { generate(false); }}>{label(copy, 'videoProxyGenerateAttach',
								VIDEO_PROXY_ADDITIONAL_COPY.videoProxyGenerateAttach)}</button>}
						{!selected.attachmentPresent && <button type="button" data-video-proxy-attach-existing
							disabled={mutationsDisabled || !selected.originalAvailable || !attachExistingAvailable}
							onClick={chooseExisting}>{label(copy, 'videoProxyAttachExisting',
								VIDEO_PROXY_ADDITIONAL_COPY.videoProxyAttachExisting)}</button>}
						<input ref={existingFileRef} type="file" accept="video/*" hidden
							data-video-proxy-existing-file
							onChange={(event) => {
								const candidate = event.currentTarget.files?.[0] ?? null;
								event.currentTarget.value = '';
								if (candidate) attachCandidate(candidate);
							}} />
						{selected.attachmentPresent && <button type="button" data-video-proxy-regenerate
							disabled={mutationsDisabled || !selected.originalAvailable}
							onClick={() => { generate(true); }}>{label(copy, 'videoProxyRegenerate', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyRegenerate)}</button>}
						{selected.attachmentPresent && <button type="button" data-video-proxy-detach
							disabled={mutationsDisabled} onClick={detach}>{label(copy, 'videoProxyDetach', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyDetach)}</button>}
						{fileService.linkedVideoOriginalsAvailable && selected.projectBinClipId && <button type="button"
							disabled={mutationsDisabled} onClick={chooseOriginal}>{label(copy, 'videoProxyRelinkOriginal',
								VIDEO_PROXY_ADDITIONAL_COPY.videoProxyRelinkOriginal)}</button>}
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
					VIDEO_PROXY_ADDITIONAL_COPY.videoProxyChangedOriginalWarning)}</p>
				<button type="button" disabled={pending !== null} onClick={confirmChangedOriginal}>{
					label(copy, 'videoProxyConfirmChangedOriginal', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyConfirmChangedOriginal)
				}</button>
				<button type="button" disabled={pending !== null} onClick={() => { setChangedRelink(null); }}>{
					label(copy, 'cancel', 'Cancel')
				}</button>
			</div>}
			<p>{label(copy, 'videoProxyDeliveryAuthority',
				VIDEO_PROXY_ADDITIONAL_COPY.videoProxyDeliveryAuthority)}</p>
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</div>
	</AudioEditorDialogShell>;
}

function previewMode(value: string): FramescaperVideoProxyModeRetime {
	return value === 'original' || value === 'proxy' ? value : 'auto';
}

function proxyTrustLabel(
	copy: Readonly<Record<string, string>>,
	attachmentPresent: boolean,
	trust: FramescaperVideoProxyPreviewTrust,
): string {
	if (!attachmentPresent) return label(copy, 'videoProxyNotAttached', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyNotAttached);
	if (trust === 'verified') {
		return label(copy, 'videoProxyVerified', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyVerified);
	}
	if (trust === 'stale') {
		return label(copy, 'videoProxyStale', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyStale);
	}
	if (trust === 'unavailable') {
		return label(copy, 'videoProxyUnavailable', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyUnavailable);
	}
	return label(copy, 'videoProxyUnverified', VIDEO_PROXY_ADDITIONAL_COPY.videoProxyUnverified);
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
	const key = `videoProxyPhase${phase[0]?.toUpperCase() ?? ''}${phase.slice(1)}`;
	const source: Readonly<Record<string, string>> = VIDEO_PROXY_ADDITIONAL_COPY;
	return label(copy, key, source[key] ?? phase);
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
	return copy[`ui.videoProxy.${key}`] || copy[key] || fallback;
}
