<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Disposable photo preview preparation

Budget recorded before implementation: original browse previews admit only the
current tightly packed straight-alpha unorm8/sRGB pixel profile. The source has
at most 8192 pixels per side, 16,777,216 pixels and 64 MiB of RGBA. The thumbnail
tier fits within 512×512 (at most 1 MiB); the fit-screen tier fits within
2048×2048 (at most 16 MiB). Neither tier upscales. One source and one output are
processed at a time; source, writable output and immutable output Blob together
account for at most 96 MiB. The source snapshot is owned before task yields;
decoder and caller-owned borrowed buffers are separate budgets.

The shared deterministic nearest-neighbour kernel retains Framescaper's existing
sampling convention. Its photo preparation route yields browser tasks every
16 output rows and checks cancellation before allocation, around each task,
and before publication. A later background owner must bound its queue to
64 photo IDs and consume/persist one result before requesting the next.

Each closed version-1 plan binds catalog/photo IDs, the immutable original ID,
storage key, SHA-256, original byte length and oriented source dimensions to a
declared tier and maintained recipe. Preparation accepts an already oriented
authenticated source frame; callers must authenticate the retained original or
transient decoded artifact before giving the frame to this pure boundary.
The output body contains only tightly packed RGBA pixels. Its separate descriptor
declares the sample/color profile and its SHA-256 authenticates exactly those
output bytes; no original bytes, authored metadata or timeline are embedded.

These are original browse previews. Develop rendering and preview/export parity
belong to the shared develop renderer and a different recipe. Decoder orientation
comes from immutable original facts, independent of authored metadata overrides.
No preview body is a retained original or a catalog-history snapshot.

This packet owns plans and prepared bodies only. Durable cache publication,
regeneration, compare-and-delete eviction, interrupted-build recovery and menu
reachability require a later composition packet. That owner should reuse the
shared eviction planner with a photo-specific 128 MiB/1024-entry cache budget,
bounded inventories and current-original checks at publication. Existing video
poster/timestamp authority remains with the video derivative repository.
