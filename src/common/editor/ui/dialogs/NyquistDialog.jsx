import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import { getNyquistPlugin, loadNyquistPluginSource } from '../../nyquist/plugin-registry.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export default function NyquistDialog({ controller, snapshot, copy, target, run, onClose }) {
	const plugin = target?.pluginId ? getNyquistPlugin(target.pluginId) : null;
	const prompt = !plugin;
	const targetIdentity = plugin?.id || 'prompt';
	const submissionRef = useRef(null);
	const targetIdentityRef = useRef(targetIdentity);
	const [source, setSource] = useState(() => loadNyquistPromptSource(copy.nyquistPromptDefault));
	const [language, setLanguage] = useState('lisp');
	const [debug, setDebug] = useState(false);
	const [controls, setControls] = useState(() => nyquistControlDefaults(plugin));
	const [output, setOutput] = useState('');
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (targetIdentityRef.current !== targetIdentity) {
			targetIdentityRef.current = targetIdentity;
			if (submissionRef.current) {
				submissionRef.current.abort();
				submissionRef.current = null;
				controller.actions.nyquist.cancel();
				setBusy(false);
			}
		}
		setControls(nyquistControlDefaults(plugin));
		setOutput('');
		setDebug(Boolean(plugin?.debugEnabled));
		if (prompt) setSource(loadNyquistPromptSource(copy.nyquistPromptDefault));
	}, [controller, copy.nyquistPromptDefault, plugin, prompt, targetIdentity]);
	useEffect(() => {
		if (prompt) storeNyquistPromptSource(source);
	}, [prompt, source]);
	const cancelAndClose = useCallback(() => {
		submissionRef.current?.abort();
		submissionRef.current = null;
		onClose();
	}, [onClose]);

	useEffect(() => () => {
		submissionRef.current?.abort();
		submissionRef.current = null;
	}, []);

	const reset = () => {
		submissionRef.current?.abort();
		submissionRef.current = null;
		controller.actions.nyquist.cancel();
		setControls(nyquistControlDefaults(plugin));
		setOutput('');
		setDebug(Boolean(plugin?.debugEnabled));
		if (prompt) {
			setLanguage('lisp');
			setSource(copy.nyquistPromptDefault);
			storeNyquistPromptSource(copy.nyquistPromptDefault);
		}
	};
	const submit = async (preview = false) => {
		if (busy) return;
		const submission = new AbortController();
		submissionRef.current?.abort();
		submissionRef.current = submission;
		setBusy(true);
		setOutput('');
		try {
			const promise = run(async () => {
				try {
					const evaluationSource = prompt
						? source
						: await loadNyquistPluginSource(plugin, { signal: submission.signal });
					if (submission.signal.aborted) return null;
					if (prompt) storeNyquistPromptSource(source);
					const request = {
						source: evaluationSource,
						language: prompt ? language : 'lisp',
						role: plugin?.role || 'prompt',
						pluginType: plugin?.type,
						controls,
						debug,
						name: plugin?.name || copy.nyquistPrompt,
					};
					return preview
						? controller.actions.nyquist.preview(request)
						: controller.actions.nyquist.evaluate(request);
				} catch (error) {
					if (submission.signal.aborted || error?.name === 'AbortError') return null;
					throw error;
				}
			});
			const result = promise ? await promise : null;
			if (result && !submission.signal.aborted) setOutput(formatNyquistDialogResult(result));
		} catch {
			// The workspace's shared runner publishes the localized error.
		} finally {
			if (submissionRef.current === submission) {
				submissionRef.current = null;
				setBusy(false);
			}
		}
	};
	const processing = busy || snapshot.nyquist?.processing;
	const previewing = Boolean(snapshot.effects?.previewing);
	const canPreview = !plugin || plugin.role !== 'analyze';
	const title = plugin?.name || copy.nyquistPrompt;

	return (
		<AudioEditorDialogShell
			title={title}
			onClose={cancelAndClose}
			width={720}
			className="kw-audio-editor-dialog--nyquist"
			bodyClassName="kw-audio-editor-dialog__body"
			dataAttributes={{ 'data-nyquist-plugin': plugin?.id || 'prompt' }}
		>
					<p className="kw-audio-editor__nyquist-sandbox">{copy.nyquistSandboxNotice}</p>
					{prompt && <>
						<label className="kw-audio-editor-dialog__field">
							<span>{copy.nyquistLanguage}</span>
							<select value={language} disabled={processing} onChange={(event) => setLanguage(event.currentTarget.value)}>
								<option value="lisp">{copy.nyquistLanguageLisp}</option>
								<option value="sal">{copy.nyquistLanguageSal}</option>
							</select>
						</label>
						<label className="kw-audio-editor-dialog__field kw-audio-editor-dialog__field--source">
							<span>{copy.nyquistSource}</span>
							<textarea rows={12} spellCheck="false" value={source} disabled={processing} onChange={(event) => setSource(event.currentTarget.value)} />
						</label>
					</>}
					{plugin?.controls?.length > 0 && <fieldset className="kw-audio-editor__nyquist-controls">
						<legend>{copy.nyquistControls}</legend>
						{plugin.controls.map((control, index) => <NyquistControl
							key={control.variable || `text-${index}`}
							control={control}
							value={control.variable ? controls[control.variable] : null}
							disabled={processing}
							onChange={(value) => control.variable && setControls((current) => ({ ...current, [control.variable]: value }))}
						/>)}
					</fieldset>}
					<label className="kw-audio-editor__nyquist-debug">
						<input type="checkbox" checked={debug} disabled={processing} onChange={(event) => setDebug(event.currentTarget.checked)} />
						<span>{copy.nyquistDebug}</span>
					</label>
					{output && <section className="kw-audio-editor__nyquist-output" aria-live="polite">
						<strong>{copy.nyquistOutput}</strong>
						<pre>{output}</pre>
					</section>}
					<div className="kw-audio-editor-dialog__actions">
						<Button variant="secondary" onClick={cancelAndClose}>{copy.cancel}</Button>
						<Button variant="secondary" disabled={processing} onClick={reset}>{copy.nyquistReset}</Button>
						{canPreview && <Button variant="secondary" disabled={processing || (!plugin && !source.trim())} onClick={() => previewing ? controller.actions.nyquist.cancel() : submit(true)}>{previewing ? copy.stopPreview : copy.previewEffect}</Button>}
						<Button disabled={processing || snapshot.readOnly || (!plugin && !source.trim())} onClick={() => submit(false)}>{prompt ? copy.nyquistRun : copy.nyquistApply}</Button>
					</div>
		</AudioEditorDialogShell>
	);
}

function NyquistControl({ control, value, disabled, onChange }) {
	if (control.kind === 'text') return <p className="kw-audio-editor__nyquist-control-note">{control.label}</p>;
	if (control.kind === 'choice') return (
		<label className="kw-audio-editor-dialog__field">
			<span>{control.label}</span>
			<select value={String(value ?? control.defaultValue ?? 0)} disabled={disabled} onChange={(event) => onChange(Number(event.currentTarget.value))}>
				{control.options.map((option) => <option key={`${option.value}-${option.symbol || option.label}`} value={option.value}>{option.label}</option>)}
			</select>
		</label>
	);
	if (control.kind === 'string') return (
		<label className="kw-audio-editor-dialog__field">
			<span>{control.label}</span>
			<input type="text" value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} />
		</label>
	);
	const integer = control.type === 'int' || control.type === 'int-text';
	return (
		<label className="kw-audio-editor-dialog__field">
			<span>{control.label}{control.unit ? ` — ${control.unit}` : ''}</span>
			<input
				type="number"
				value={String(value ?? control.defaultValue ?? 0)}
				disabled={disabled}
				min={Number.isFinite(control.min) ? control.min : undefined}
				max={Number.isFinite(control.max) ? control.max : undefined}
				step={integer ? 1 : 'any'}
				onChange={(event) => onChange(integer ? Math.round(Number(event.currentTarget.value)) : Number(event.currentTarget.value))}
			/>
		</label>
	);
}

function nyquistControlDefaults(plugin) {
	return Object.fromEntries((plugin?.controls || [])
		.filter((control) => control.variable)
		.map((control) => [control.variable, control.defaultValue]));
}

function formatNyquistDialogResult(result) {
	if (!result) return '';
	if (result.type === 'multiple') return result.results.map(formatNyquistDialogResult).filter(Boolean).join('\n');
	const output = String(result.output || '').trim();
	let summary = '';
	if (result.type === 'message') summary = String(result.message || '');
	else if (result.type === 'number') summary = String(result.value);
	else if (result.type === 'labels') summary = `${result.labels?.length || 0} label(s)`;
	else if (result.type === 'audio') summary = `${result.frameCount || result.channels?.[0]?.length || 0} frames, ${result.channelCount || result.channels?.length || 0} channel(s)`;
	return [summary, output && output !== summary ? output : ''].filter(Boolean).join('\n');
}

const NYQUIST_PROMPT_STORAGE_KEY = 'soundscaper-nyquist-prompt-v1';

function loadNyquistPromptSource(fallback) {
	try { return globalThis.localStorage?.getItem(NYQUIST_PROMPT_STORAGE_KEY) || fallback; }
	catch { return fallback; }
}

function storeNyquistPromptSource(source) {
	try { globalThis.localStorage?.setItem(NYQUIST_PROMPT_STORAGE_KEY, String(source)); }
	catch { /* Local persistence can be unavailable in privacy modes. */ }
}
