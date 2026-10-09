# Develop preset restore

The catalog archive V4 importer preserves the complete catalog-scoped Develop
preset row alongside the existing photo, stack and saved-query packs. The pack
descriptor and authenticated row must agree on revision and preset count.
V1–V3 archives and V4's explicit null descriptor restore physical absence; a
positive-revision empty row remains present. Photo, original, root, stack and
saved-definition schemas and archived revisions remain unchanged.

The existing File restore operation stages the row in the positively fresh
candidate media namespace. Closed header admission precedes resource creation.
The candidate registers its single pending operation before synchronously
normalizing the supplied row, so caller mutation and reflection reentry cannot
replace an admitted recipe. Native `add` preserves uniqueness, and completion
joins before the candidate accepts another packet. Malformed, duplicate or
failed writes retire mutation and readiness admission.

After delivery, the candidate retains only the row's revision/count and SHA-256
of its complete canonical contents. It authenticates physical absence or the
whole stored row before original custody promotion and again inside the final
settings-inclusive readiness transaction. Same-revision body drift refuses
readiness. These checks operate under the existing private namespace authority;
they do not promise protection against arbitrary raw writes after that authority
has completed. The row limit remains 10 MiB with at most 16 individual presets,
each within its existing 2 MiB contract. Serial normalization, canonical JSON
and UTF8 hashing can temporarily own multiple representations; these component
limits are not a measured total heap limit.

ZIP extraction, digest/length authentication and reader closure settle before
the importer calls provisional publication. Whole-library orchestration then
finishes the catalog and media audits before the existing journal and pointer
CAS. Failures retain the old pointer and join fresh-only rollback; fulfilled
pointer publication survives late cancellation and independent cleanup failure.
The selected Session reads presets from the selected media settings namespace,
so restoring the same catalog ID never substitutes its previous anchor row.

Focused tests use the actual importer, catalog/media stages, pointer protocol
and selected Session with instrumented IndexedDB. They preserve original bytes,
custody, archived revisions, absent/empty state, synchronous admission, held
request delivery, full-row drift, reopening and post-pointer ACK behavior.
Synthetic authenticated ZIP fixtures qualify codec behavior. Native browser
backup/restore qualification belongs to the integrated V4 export/import packet.

The production Session's V4 backup feeds this same private restore owner.
Session-level tests save full and partial recipes through the normal preset
writer, back up the selected library, restore its actual output, reopen it,
and authenticate a second backup. Catalog definitions and revisions, ordered
stacks, saved criteria, originals and preset bodies survive together. The
same-catalog-ID anchor row stays unchanged, including when the selected row is
absent or retains a positive empty revision.
