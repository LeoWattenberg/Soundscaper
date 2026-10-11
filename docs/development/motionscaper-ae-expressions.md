# Motionscaper AE scalar expression mapping

The pure translator admits scalar numeric expressions containing composition
`time`, pre-expression `value`, finite numeric constants, standard Math functions,
arithmetic, same-type comparisons/logical operators and conditionals. Motion
Math aliases become explicit `Math` calls; powers become `Math.pow`, so the
emitted syntax does not require the modern exponentiation operator. AE inputs
must already use explicit Math calls/constants and can end in one semicolon.

The unit boundary is explicit: for destination units per source unit `s`, source
`value` becomes `value / s` and the result is multiplied by `s`. Thus an AE
percentage opacity expression uses `s = 0.01` on import and `s = 100` on export,
while retaining its underlying keys and pre-expression value semantics.

Vector coercion, channel access, layer-local clocks, layer indexes, property
links, looping, random/noise/wiggle, audio queries, declarations, assignments and
arbitrary host objects require explicit sampling or complete rendering. Original
source remains in exchange/archive custody. Math-domain failures remain normal
actionable expression diagnostics rather than substituted values. Source,
node and nesting budgets are checked again after unit wrappers are emitted.

An independent ES3-compatible validator admits only the canonical fully
parenthesized scalar grammar. A package's `translated` disposition is not
authority to execute source. The installed-side validator rejects untrusted
members/calls, side effects, loose/coerced types, nonfinite literals and oversized
expressions before returning a source string.

**File → After Effects Bridge** offers separate import and export checkboxes,
both off initially. Changing an option retires the prepared report and its
acknowledgement. The project adapter currently maps scalar transform opacity;
vector expressions and scalar channels inside vector properties require fallback.
Import preserves admitted hold/linear keys and refuses expression activation
when the underlying interpolation is unsupported. Explicit AE frame samples
take priority over translation. Export retains the exact authored source in
`original.mscape`; import retains the exact original exchange alongside the
translated expression through Save and reopening. Installed-side application
integration and real AE qualification remain separate gates.

Focused tests compare Motion evaluation with standard JavaScript evaluation
across times, base values, percentage conversions and reverse transfers. They
also check refusal and both independent parser bounds. A Chromium menu workflow
compares half-second opacity pixels before export, after importing the reviewed
exchange and after Save/reopen, and verifies the original archive source. These
tests do not qualify an installed AE expression engine or AE-rendered pixels.

The semantics are based on Adobe's [expression language reference](https://helpx.adobe.com/after-effects/desktop/work-with-expressions/expression-language-reference/expression-language-reference.html)
and [expression-time description](https://helpx.adobe.com/after-effects/desktop/work-with-expressions/expression-basics/expression-language.html).
Actual AE export/reimport and reference-frame comparison remain open release
gates. This work does not change assistance runtime bytes or inventories and
does not require a manual **Update AI assets** run.
