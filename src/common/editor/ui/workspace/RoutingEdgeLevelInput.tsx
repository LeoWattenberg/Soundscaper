/* SPDX-License-Identifier: AGPL-3.0-only */

interface RoutingEdgeLevelInputProps {
	readonly label: string;
	readonly savedDb: number;
	readonly disabled: boolean;
	readonly onBegin: (value: number) => void;
	readonly onPreview: (value: number) => void;
	readonly onRelease: (value: number) => void;
	readonly onCancel: () => void;
	readonly hasActiveGesture: () => boolean;
}

export function routingLevelDraftValue(draft: string): number | null {
	if (draft.trim() === '') return null;
	const value = Number(draft);
	return Number.isFinite(value) ? value <= -60 ? 0 : Math.min(4, 10 ** (value / 20)) : null;
}

export default function RoutingEdgeLevelInput(props: RoutingEdgeLevelInputProps) {
	const { savedDb, onBegin, onPreview, onRelease, onCancel } = props;
	return <label>{props.label} <input
		name="levelDb" type="number" min={-60} max={12.04} step="0.01" required
		defaultValue={savedDb} disabled={props.disabled}
		onFocus={(event) => {
			const value = routingLevelDraftValue(event.currentTarget.value);
			if (value !== null) onBegin(value);
		}}
		onChange={(event) => {
			const value = routingLevelDraftValue(event.currentTarget.value);
			if (value !== null) onPreview(value);
		}}
		onBlur={(event) => {
			const value = routingLevelDraftValue(event.currentTarget.value);
			if (value !== null) onRelease(value);
			else {
				event.currentTarget.value = String(savedDb);
				onCancel();
			}
		}}
		onKeyDown={(event) => {
			if (event.key !== 'Escape' || !props.hasActiveGesture()) return;
			event.preventDefault();
			event.currentTarget.value = String(savedDb);
			onCancel();
			event.currentTarget.blur();
		}}
	/></label>;
}
