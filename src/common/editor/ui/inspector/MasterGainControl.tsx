/* SPDX-License-Identifier: AGPL-3.0-only */

import { SteppedSlider } from './inspector-controls.jsx';
import { formatDb, linearToDb } from './inspector-helpers.ts';
import { useMixerParameterGestures, type MixerParameterActions } from '../useMixerParameterGestures.ts';

const ADDRESS = { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' } as const;
const fromDb = (db: number) => db <= -60 ? 0 : 10 ** (db / 20);

export default function MasterGainControl({ actions, projectId, gain, label, disabled, onError }: Readonly<{
	actions: MixerParameterActions;
	projectId: string | null;
	gain: number;
	label: string;
	disabled: boolean;
	onError: (error: unknown) => void;
}>) {
	const gesture = useMixerParameterGestures(actions, projectId, onError);
	const db = Math.round(linearToDb(gesture.value(ADDRESS, gain)) * 10) / 10;
	const text = db <= -60 ? '−∞ dB' : formatDb(db, 'dB');
	return <div className="audio-editor-master-gain" data-master-gain>
		<span>{label}</span>
		<SteppedSlider value={db} defaultValue={0} min={-60} max={12} step={0.1}
			ariaLabel={label} valueText={text} disabled={disabled}
			onGestureStart={() => gesture.begin(ADDRESS)}
			onChange={(value: number) => gesture.preview(ADDRESS, fromDb(value))}
			onGestureEnd={(value: number) => gesture.release(ADDRESS, fromDb(value))}
			onGestureCancel={() => gesture.cancel(ADDRESS)} />
		<output data-master-gain-value>{text}</output>
	</div>;
}
