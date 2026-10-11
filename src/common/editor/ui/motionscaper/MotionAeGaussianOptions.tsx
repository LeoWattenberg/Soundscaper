/* SPDX-License-Identifier: AGPL-3.0-only */
import { useId, useRef } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { parseMotionAeGaussianProfile, type MotionAeGaussianProfile } from '../../motion-ae-gaussian-profile.ts';
export default function MotionAeGaussianOptions({ copy, disabled, profile, onChange, run, mode }: Readonly<{
	copy: Readonly<Record<string, string>>; disabled: boolean; profile: MotionAeGaussianProfile | null;
	onChange: (value: MotionAeGaussianProfile | null) => void;
	run: (operation: (signal: AbortSignal) => Promise<void>) => Promise<void>; mode: 'import' | 'export';
}>) {
	const id = useId(), input = useRef<HTMLInputElement>(null);
	const select = (file: File | undefined) => {
		onChange(null);
		if (!file) return;
		void run(async signal => {
			if (file.size === 0 || file.size > 32768) throw new Error(copy.motionscaperAeGaussianLimit);
			const value = parseMotionAeGaussianProfile(await file.text()); signal.throwIfAborted(); onChange(value);
		});
	};
	return <fieldset disabled={disabled}><legend>{copy.motionscaperAeGaussianReview}</legend>
		<p>{copy.motionscaperAeGaussianHint}</p>
		<label htmlFor={id}>{mode === 'import' ? copy.motionscaperAeGaussianImportProfile : copy.motionscaperAeGaussianExportProfile}</label>
		<input ref={input} id={id} type="file" accept=".json,application/json" onChange={event => select(event.currentTarget.files?.[0])} />
		{profile && <><p role="status">{copy.motionscaperAeGaussianSelected}: {profile.host.version} / {profile.host.buildNumber} / {profile.host.locale}. {copy.motionscaperAeGaussianScale}: {profile.blurrinessPerSigma}.</p>
			<Button variant="secondary" onClick={() => { if (input.current) input.current.value = ''; onChange(null); }}>{copy.motionscaperAeGaussianRemove}</Button></>}
	</fieldset>;
}
