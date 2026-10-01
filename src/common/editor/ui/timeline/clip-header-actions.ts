/* SPDX-License-Identifier: AGPL-3.0-only */

export type ClipPropertiesFocus = 'pitch' | 'speed';

interface ClipHeaderActionOptions {
	readonly blocked: boolean;
	readonly copy?: Readonly<Record<string, string>>;
	readonly controller: Readonly<{ actions: Readonly<{
		timeline: Readonly<{ selectClip(id: string): unknown }>;
		clip: Readonly<{ setTimePitch(id: string, changes: Readonly<{
			pitchCents?: number;
			speedRatio?: number;
		}>): unknown }>;
	}> }>;
	run(action: () => unknown): void;
	onOpenClipProperties?(clipId: string, field?: ClipPropertiesFocus): void;
}

/** Keep badge edits on the same undoable action path as clip properties. */
export function clipHeaderActions({ controller, blocked, run, onOpenClipProperties, copy }: ClipHeaderActionOptions) {
	const open = (id: string | number, field: ClipPropertiesFocus) => run(() => {
		const clipId = String(id);
		controller.actions.timeline.selectClip(clipId);
		onOpenClipProperties?.(clipId, field);
	});
	return {
		clipPitchLabel: copy?.clipPitchIndicator,
		clipSpeedLabel: copy?.clipSpeedIndicator,
		onClipPitchClick: (id: string | number) => open(id, 'pitch'),
		onClipSpeedClick: (id: string | number) => open(id, 'speed'),
		onClipPitchReset: blocked ? undefined : (id: string | number) => run(() => (
			controller.actions.clip.setTimePitch(String(id), { pitchCents: 0 })
		)),
		onClipSpeedReset: blocked ? undefined : (id: string | number) => run(() => (
			controller.actions.clip.setTimePitch(String(id), { speedRatio: 1 })
		)),
	};
}
