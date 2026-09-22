/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { useEffect, useRef, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type {
	TextToSpeechPort, TextToSpeechRequest, TextToSpeechReviewed, TextToSpeechVoice,
} from '../text-to-speech-port.ts';
import type { LocalModelManagerBridge } from '../local-model-manager-bridge.ts';
import LocalModelManagerDialog from './LocalModelManagerDialog.tsx';
import './ProcessingDialogs.css';
import './TextToSpeechDialog.css';

type Copy = Readonly<Record<string, string | undefined>>;
type Phase = 'loading' | 'ready' | 'generating' | 'preview' | 'accepting' | 'accepted' | 'error';

export const TEXT_TO_SPEECH_MAXIMUM_SCRIPT_CODE_UNITS = 10_000;

export interface TextToSpeechDialogState {
	readonly phase: Phase;
	readonly installed: boolean;
	readonly voices: readonly TextToSpeechVoice[];
	readonly text: string;
	readonly language: string;
	readonly voiceId: string;
	readonly speed: number;
	readonly placement: 'new-track' | 'regenerate-selected';
	readonly reviewed: TextToSpeechReviewed | null;
	readonly error: string | null;
}

const INITIAL_STATE: TextToSpeechDialogState = Object.freeze({
	phase: 'loading', installed: false, voices: Object.freeze([]), text: '', language: 'a',
	voiceId: '', speed: 1, placement: 'new-track', reviewed: null, error: null,
});

export interface TextToSpeechDialogProps {
	readonly port: TextToSpeechPort | null;
	readonly modelBridge: LocalModelManagerBridge | null;
	readonly copy: Copy;
	readonly locale: string;
	readonly onClose: () => void;
}

export default function TextToSpeechDialog({
	port, modelBridge, copy, locale, onClose,
}: TextToSpeechDialogProps) {
	const [state, setState] = useState<TextToSpeechDialogState>(INITIAL_STATE);
	const [managingModels, setManagingModels] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const loadedOnce = useRef(false);
	const generation = useRef<AbortController | null>(null);
	const acceptancePending = useRef(false);

	useEffect(() => {
		if (managingModels) return undefined;
		if (port === null) {
			setState((current) => ({ ...current, phase: 'error', error: text(copy,
				'unavailable', 'Text to Speech is unavailable in this desktop build.') }));
			return undefined;
		}
		let live = true;
		void port.load().then((loaded) => {
			if (!live) return;
			setState((current) => {
				const draft = loadedOnce.current ? current : loaded.initial ?? current;
				const language = loaded.voices.some(({ language: candidate }) => candidate === draft.language)
					? draft.language : loaded.voices[0]?.language ?? draft.language;
				const matching = loaded.voices.filter((voice) => voice.language === language);
				const voiceId = matching.some(({ id }) => id === draft.voiceId)
					? draft.voiceId : matching[0]?.id ?? '';
				loadedOnce.current = true;
				return { ...current, phase: 'ready', installed: loaded.installed,
					voices: loaded.voices, text: draft.text, language, voiceId,
					speed: draft.speed, placement: loaded.placement,
					reviewed: null, error: null };
			});
		}).catch((failure: unknown) => {
			if (live) setState((current) => ({ ...current, phase: 'error', error: failureMessage(failure) }));
		});
		return () => { live = false; };
	}, [copy, managingModels, port]);

	useEffect(() => {
		const body = state.reviewed?.audio;
		if (!body) { setPreviewUrl(null); return undefined; }
		const url = URL.createObjectURL(body);
		setPreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [state.reviewed]);

	useEffect(() => () => { generation.current?.abort(); }, []);

	const edit = (change: Partial<TextToSpeechDialogState>): void => {
		setState((current) => ({ ...current, ...change, phase: 'ready', reviewed: null, error: null }));
	};
	const close = (): void => {
		if (state.phase === 'accepting') return;
		generation.current?.abort();
		onClose();
	};
	const generate = async (): Promise<void> => {
		if (!port || !canGenerate(state)) return;
		const request: TextToSpeechRequest = {
			text: state.text, language: state.language, voiceId: state.voiceId, speed: state.speed,
		};
		const controller = new AbortController();
		generation.current = controller;
		setState((current) => ({ ...current, phase: 'generating', reviewed: null, error: null }));
		try {
			const reviewed = await port.generate(request, controller.signal);
			if (!controller.signal.aborted) setState((current) => ({ ...current,
				phase: 'preview', reviewed, error: null }));
		} catch (failure) {
			if (!controller.signal.aborted) setState((current) => ({ ...current,
				phase: 'error', reviewed: null, error: failureMessage(failure) }));
		} finally {
			if (generation.current === controller) generation.current = null;
		}
	};
	const cancel = (): void => {
		generation.current?.abort();
		generation.current = null;
		setState((current) => ({ ...current, phase: 'ready', reviewed: null, error: null }));
	};
	const accept = async (): Promise<void> => {
		if (!port || state.phase !== 'preview' || !state.reviewed || acceptancePending.current) return;
		acceptancePending.current = true;
		const reviewed = state.reviewed;
		setState((current) => ({ ...current, phase: 'accepting', error: null }));
		try {
			await port.accept(reviewed);
			setState((current) => ({ ...current, phase: 'accepted', reviewed: null, error: null }));
		} catch (failure) {
			setState((current) => ({ ...current, phase: 'preview', error: failureMessage(failure) }));
		} finally {
			acceptancePending.current = false;
		}
	};

	if (managingModels) return <LocalModelManagerDialog
		bridge={modelBridge} copy={copy} locale={locale}
		modelFilter={(model) => model.task === 'text-to-speech'}
		onClose={() => setManagingModels(false)} />;
	return <TextToSpeechDialogView copy={copy} state={state} previewUrl={previewUrl}
		onClose={close} onManageModels={() => setManagingModels(true)}
		onTextChange={(value) => edit({ text: value })}
		onLanguageChange={(language) => {
			const voiceId = state.voices.find((voice) => voice.language === language)?.id ?? '';
			edit({ language, voiceId });
		}}
		onVoiceChange={(voiceId) => edit({ voiceId })}
		onSpeedChange={(speed) => edit({ speed })}
		onGenerate={() => { void generate(); }} onCancel={cancel}
		onAccept={() => { void accept(); }} />;
}

export interface TextToSpeechDialogViewProps {
	readonly copy: Copy;
	readonly state: TextToSpeechDialogState;
	readonly previewUrl: string | null;
	readonly onClose: () => void;
	readonly onManageModels: () => void;
	readonly onTextChange: (value: string) => void;
	readonly onLanguageChange: (value: string) => void;
	readonly onVoiceChange: (value: string) => void;
	readonly onSpeedChange: (value: number) => void;
	readonly onGenerate: () => void;
	readonly onCancel: () => void;
	readonly onAccept: () => void;
}

/** Static view kept separate from the session so menu and state coverage can render it directly. */
export function TextToSpeechDialogView({
	copy, state, previewUrl, onClose, onManageModels, onTextChange, onLanguageChange,
	onVoiceChange, onSpeedChange, onGenerate, onCancel, onAccept,
}: TextToSpeechDialogViewProps) {
	const locked = state.phase === 'generating' || state.phase === 'accepting'
		|| state.phase === 'loading' || state.phase === 'accepted';
	const languages = [...new Set(state.voices.map(({ language }) => language))];
	const voiceOptions = state.voices.filter(({ language }) => language === state.language);
	const previewReady = state.phase === 'preview' && state.reviewed !== null;
	return <AudioEditorDialogShell
		title={text(copy, 'title', 'Text to Speech')}
		onClose={onClose} width={680} initialFocus="textarea"
		className="kw-text-to-speech"
		dataAttributes={{ 'data-text-to-speech': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={state.phase === 'accepting'} onClick={onClose}>
				{text(copy, 'close', 'Close')}
			</Button>
			{state.phase === 'generating' ? <Button variant="primary" onClick={onCancel}>
				{text(copy, 'cancel', 'Cancel generation')}
			</Button> : previewReady ? <Button variant="primary" onClick={onAccept}>
				{state.placement === 'regenerate-selected'
					? text(copy, 'replace', 'Replace selected speech clip')
					: text(copy, 'accept', 'Add as new track at playhead')}
			</Button> : state.phase === 'accepted' ? null : <Button variant="primary"
				disabled={!canGenerate(state)} onClick={onGenerate}>
				{text(copy, 'generate', 'Generate preview')}
			</Button>}
		</>} />}
	>
		<p>{state.placement === 'regenerate-selected'
			? text(copy, 'regenerateDescription',
				'Edit the selected generated speech, listen to a preview, then replace that clip’s audio without moving it.')
			: text(copy, 'description',
				'Create speech locally, listen to it, then add it on a new track at the playhead.')}</p>
		{state.phase === 'loading' && <p role="status">{text(copy,
			'loading', 'Loading speech voices.')}</p>}
		{(!state.installed || state.voices.length === 0) && state.phase !== 'loading' && <p role="status">{text(copy,
			'install', 'Install a speech model to generate audio locally.')}</p>}
		{(!state.installed || state.voices.length === 0) && <Button variant="secondary" disabled={locked} onClick={onManageModels}>
			{text(copy, 'assistanceManageModels', 'Manage Models')}
		</Button>}
		<div className="kw-text-to-speech__fields">
			<label>{text(copy, 'script', 'Script')}
				<textarea value={state.text} maxLength={TEXT_TO_SPEECH_MAXIMUM_SCRIPT_CODE_UNITS}
					disabled={locked} rows={7} onChange={(event) => onTextChange(event.currentTarget.value)} />
			</label>
			<label>{text(copy, 'language', 'Language')}
				<select value={state.language} disabled={locked || languages.length === 0}
					onChange={(event) => onLanguageChange(event.currentTarget.value)}>
					{languages.map((language) => <option key={language} value={language}>
						{languageLabel(language, copy)}
					</option>)}
				</select>
			</label>
			<label>{text(copy, 'voice', 'Voice')}
				<select value={state.voiceId} disabled={locked || voiceOptions.length === 0}
					onChange={(event) => onVoiceChange(event.currentTarget.value)}>
					{voiceOptions.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
				</select>
			</label>
			<label>{text(copy, 'speed', 'Speed')}
				<input type="number" min="0.5" max="2" step="0.05" value={state.speed}
					disabled={locked} onChange={(event) => onSpeedChange(Number(event.currentTarget.value))} />
			</label>
		</div>
		{state.error && <p role="alert">{state.error}</p>}
		{state.phase === 'generating' && <p role="status" aria-live="polite">{text(copy,
			'generating', 'Generating speech locally.')}</p>}
		{previewReady && <section className="kw-text-to-speech__preview"
			aria-label={text(copy, 'preview', 'Speech preview')}>
			<p>{state.placement === 'regenerate-selected'
				? text(copy, 'replaceReview', 'Listen before replacing the selected clip’s audio.')
				: text(copy, 'review',
					'Listen before adding this audio on a new track at the playhead.')}</p>
			{previewUrl && <audio controls preload="metadata" src={previewUrl} />}
		</section>}
		{state.phase === 'accepting' && <p role="status" aria-live="polite">{
			state.placement === 'regenerate-selected'
				? text(copy, 'replacing', 'Replacing selected speech clip.')
				: text(copy, 'accepting', 'Adding speech on a new track.')
		}</p>}
		{state.phase === 'accepted' && <p role="status">{
			state.placement === 'regenerate-selected'
				? text(copy, 'replaced', 'Selected speech clip replaced.')
				: text(copy, 'accepted', 'Speech added on a new track.')
		}</p>}
	</AudioEditorDialogShell>;
}

function canGenerate(state: TextToSpeechDialogState): boolean {
	return (state.phase === 'ready' || state.phase === 'error') && state.installed
		&& state.voices.some(({ id, language }) => id === state.voiceId && language === state.language)
		&& state.text.trim().length > 0 && state.text.length <= TEXT_TO_SPEECH_MAXIMUM_SCRIPT_CODE_UNITS
		&& Number.isFinite(state.speed) && state.speed >= 0.5 && state.speed <= 2;
}

function languageLabel(language: string, copy: Copy): string {
	const labels: Readonly<Record<string, readonly [string, string]>> = {
		a: ['americanEnglish', 'American English'],
		b: ['britishEnglish', 'British English'],
		e: ['spanish', 'Spanish'],
		f: ['french', 'French'],
		h: ['hindi', 'Hindi'],
		i: ['italian', 'Italian'],
		j: ['japanese', 'Japanese'],
		p: ['portuguese', 'Brazilian Portuguese'],
		z: ['chinese', 'Mandarin Chinese'],
	};
	const label = labels[language];
	return label ? text(copy, label[0], label[1]) : language;
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[`ui.textToSpeech.${key}`] || fallback;
}

function failureMessage(value: unknown): string {
	return value instanceof Error && value.message ? value.message : 'Text to Speech could not finish.';
}
