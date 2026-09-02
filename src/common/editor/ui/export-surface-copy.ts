/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the delivery surface is called in the running product.
 *
 * One dialog serves both products, and what it delivers differs: Soundscaper
 * exports a mixdown, while Framescaper's format list is led by MP4 and WebM.
 * Naming it "Export audio" in Framescaper described something the command does
 * not do, so the video product gets its own wording. Framescaper is not derived
 * from Audacity, so diverging from the upstream command name is deliberate — the
 * File menu entry pairs this with `preserveLabel` so the parity layer does not
 * canonicalize the name back.
 *
 * The menu entry and the dialog title are resolved from one place because they
 * name the same command; a user who picks "Export video" should not land in a
 * dialog titled "Export audio".
 */

const FRAMESCAPER = 'framescaper';

function text(value: unknown): string {
	return typeof value === 'string' && value ? value : '';
}

/** The File menu entry that opens the delivery surface. */
export function exportSurfaceMenuLabel(
	copy: Readonly<Record<string, unknown>>,
	productId: unknown,
): string {
	if (!copy || typeof copy !== 'object') throw new TypeError('Editor copy is required.');
	return productId === FRAMESCAPER
		? text(copy.exportVideo) || text(copy.exportAudio)
		: text(copy.exportAudio);
}

/** The title the delivery dialog carries once it is open. */
export function exportSurfaceDialogTitle(
	copy: Readonly<Record<string, unknown>>,
	productId: unknown,
): string {
	if (!copy || typeof copy !== 'object') throw new TypeError('Editor copy is required.');
	return productId === FRAMESCAPER
		? text(copy.exportVideo) || text(copy.exportDialog) || text(copy.export)
		: text(copy.exportDialog) || text(copy.export);
}
