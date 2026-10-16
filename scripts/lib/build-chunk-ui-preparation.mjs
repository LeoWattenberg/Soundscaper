/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * UI preparation shared with its existing optional consumer.
 *
 * The broad editor-shell pattern would otherwise claim these flat/workspace
 * leaves and statically load the optional parameter/routing owner they read.
 * The Vamp lookup stays with its strict-initialized dialog owner to avoid an
 * owner/entry initialization cycle. Other dialog leaves and the shared hook keep
 * existing reachability placement: owning that composite hook with the lazy
 * parameter editor would make the preset bar import the parameter surface.
 */
const preparationTests = Object.freeze({
	'editor-vamp-analyzer': /src[\\/]common[\\/]editor[\\/]ui[\\/]dialogs[\\/]useAnalyzerLookup\.ts$/,
	'editor-effect-parameter-surfaces': /src[\\/]common[\\/]editor[\\/]ui[\\/](?:useCompressionCurve|useLegacyEffectGraphPresentation)\.ts$/,
	'editor-optional-surfaces': /src[\\/]common[\\/]editor[\\/]ui[\\/]workspace[\\/](?:RoutingGraphWires\.tsx|(?:routing-graph-presentation|routing-edge-handle-position|useRoutingHoverFrame)\.ts)$/,
});

/**
 * @param {'editor-vamp-analyzer' | 'editor-effect-parameter-surfaces' | 'editor-optional-surfaces'} owner
 * @param {RegExp} existingTest
 * @returns {RegExp}
 */
export function withUiPreparationChunkTest(owner, existingTest) {
	return new RegExp(`(?:${existingTest.source})|(?:${preparationTests[owner].source})`, existingTest.flags);
}
