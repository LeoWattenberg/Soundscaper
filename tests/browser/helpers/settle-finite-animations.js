/* SPDX-License-Identifier: AGPL-3.0-only */

export async function settleFiniteAnimations(page) {
	// Computed colours sampled mid-transition do not describe a state users see.
	// Bound the wait so an intentionally indefinite animation cannot hang a test.
	await page.evaluate(async () => {
		const finite = document.getAnimations().filter((animation) => (
			animation.effect?.getComputedTiming?.().iterations !== Infinity
		));
		await Promise.race([
			Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
			new Promise((resolve) => { setTimeout(resolve, 1_000); }),
		]);
	});
}
