/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentProps } from 'react';
import { FRAMESCAPER_INPUTS_COPY } from '../../../i18n/editor-framescaper-inputs-copy.ts';
import RecordingSetupPanel from '../workspace/RecordingSetupPanel.tsx';

type CaptureSetupProps = ComponentProps<typeof RecordingSetupPanel>;
type InputsSetupProps = Omit<CaptureSetupProps, 'locale' | 'controller' | 'snapshot'> & Readonly<{
	controller: CaptureSetupProps['controller'] & Readonly<{
		actions: Readonly<{ audioDevices?: Readonly<{ setOutput?(deviceId: string): unknown }> }>;
	}>;
	snapshot: CaptureSetupProps['snapshot'] & Readonly<{
		audioDevices?: Readonly<{
			outputs?: readonly Readonly<{ deviceId: string; label: string }>[];
			preferredOutputDeviceId?: string;
			outputSupported?: boolean;
		}>;
	}>;
}>;

/** Uses the same capture session as Recording setup, including combined A/V. */
export default function FramescaperInputsSetupFlyout({ controller, snapshot, copy, run, blocked }: InputsSetupProps) {
	const devices = snapshot.audioDevices;
	const outputs = devices?.outputs ?? [];
	const preferred = devices?.preferredOutputDeviceId ?? '';
	return <div className="kw-audio-editor__audio-devices-content" data-inputs-setup-flyout>
		<strong>{copy['ui.framescaperInputs.title'] ?? FRAMESCAPER_INPUTS_COPY.title}</strong>
		<RecordingSetupPanel controller={controller} snapshot={snapshot} copy={copy} run={run}
			blocked={blocked} locale={typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en'}
			idPrefix="framescaper-inputs" />
		<label>
			<span>{copy.audioOutputDevice}</span>
			<select aria-label={copy.audioOutputDevice} value={preferred}
				disabled={!devices?.outputSupported || !controller.actions.audioDevices?.setOutput}
				onChange={(event) => { void run(() => controller.actions.audioDevices?.setOutput?.(event.currentTarget.value)); }}>
				<option value="">{copy.audioDeviceSystemDefault}</option>
				{preferred && !outputs.some(({ deviceId }) => deviceId === preferred)
					&& <option value={preferred}>{copy.audioDevicePreferredUnavailable}</option>}
				{outputs.map(({ deviceId, label }) => <option key={deviceId} value={deviceId}>{label}</option>)}
			</select>
		</label>
	</div>;
}
