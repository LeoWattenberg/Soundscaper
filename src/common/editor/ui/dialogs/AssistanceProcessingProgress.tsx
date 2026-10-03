/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native startup has no byte denominator; report measured progress when one arrives. */
export default function AssistanceProcessingProgress({ label, progress }: {
	readonly label: string;
	readonly progress: Readonly<{ completed: number | null; total: number | null }> | null;
}) {
	const measured = progress?.completed !== null && progress?.completed !== undefined
		&& progress.total !== null && progress.total > 0;
	return <div className="kw-assistance-loading">
		<progress aria-label={label} value={measured ? progress.completed! : undefined}
			max={measured ? progress.total! : undefined} />
	</div>;
}
