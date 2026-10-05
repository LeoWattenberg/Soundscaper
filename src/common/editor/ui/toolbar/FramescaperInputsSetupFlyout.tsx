/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentProps } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import './framescaper-inputs-setup.css';
import { FRAMESCAPER_INPUTS_COPY } from '../../../i18n/editor-framescaper-inputs-copy.ts';
import { capturePhaseIsSourceLocked } from '../framescaper-capture-ui-model.ts';
import RecordingSetupPanel from '../workspace/RecordingSetupPanel.tsx';

type CaptureSetupProps = ComponentProps<typeof RecordingSetupPanel>;
type InputsSetupProps = Omit<CaptureSetupProps, 'locale' | 'controller' | 'snapshot'> & Readonly<{
	controller: CaptureSetupProps['controller'] & Readonly<{
		actions: Readonly<{ audioDevices?: Readonly<{
			setOutput?(deviceId: string): unknown;
			refresh?(options: Readonly<{ probe: false }>): unknown;
		}> }>;
	}>;
	snapshot: CaptureSetupProps['snapshot'] & Readonly<{
		audioDevices?: Readonly<{
			outputs?: readonly Readonly<{ deviceId: string; label: string }>[];
			preferredOutputDeviceId?: string;
			outputSupported?: boolean;
			outputStatus?: string;
		}>;
	}>;
}>;

/** Uses the same capture session as Recording setup, including combined A/V. */
export default function FramescaperInputsSetupFlyout({ controller, snapshot, copy, run, blocked }: InputsSetupProps) {
	const devices = snapshot.audioDevices;
	const outputs = devices?.outputs ?? [];
	const preferred = devices?.preferredOutputDeviceId ?? '';
	const outputMessage = devices?.outputStatus === 'unavailable' ? copy.audioDeviceOutputUnavailable
		: devices?.outputStatus === 'denied' ? copy.audioDeviceOutputDenied
			: !devices?.outputSupported ? copy.audioDeviceOutputUnsupported : '';
	const refreshBlocked = Boolean(blocked || snapshot.webVcr?.modeActive
		|| capturePhaseIsSourceLocked(snapshot.capture?.phase ?? 'inactive') || snapshot.capture?.phase === 'permission-pending');
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
		{outputMessage && <p className="kw-audio-editor__audio-devices-note" role="status">{outputMessage}</p>}
		<Button variant="secondary" disabled={refreshBlocked || !controller.actions.audioDevices?.refresh}
			onClick={() => { void run(() => controller.actions.audioDevices?.refresh?.({ probe: false })); }}>
			{copy.audioDeviceRefresh}
		</Button>
	</div>;
}
