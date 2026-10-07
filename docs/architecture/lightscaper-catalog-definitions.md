<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Photo catalog definition commands

Budget recorded before implementation: a freshly loaded root is at most 2 MiB,
with at most 10,000 folders, 10,000 keywords and 10,000 collections. One call
applies one closed command. Definition projections return at most 64 scalar
rows, and their closed continuation is at most 1 KiB. Smart queries retain the
schema limits of 16 levels and 256 nodes. No photo bodies, binary sources or
catalog histories are loaded or retained by this module.

The caller supplies generated stable IDs and the expected root revision. Pure
commands validate the root, reject stale revisions, and return a proposed root
at its current revision. They also validate the next revision that durable
`saveCatalog` will publish, including serialized byte growth. The session owner
must load that root under its catalog write lease and publish through repository
CAS; a proposed root grants no storage authority or successful acknowledgement.

Folder and keyword commands create, rename, reparent or delete one empty node.
Deletion refuses children and smart-query references. Only the repository can
prove absence of photo memberships, so its atomic referenced-removal check is
required. Collection creation and update preserve manual or smart identity;
changing a collection's kind requires a separate future membership operation.

Hierarchy pages explicitly select one immediate parent, including `null` for
top-level nodes. They do not imply descendants or photo membership. Collections
project only scalar identity, name and kind; their smart query is not a row.
Rows use canonical ID order and a continuation binds catalog ID, root revision,
definition kind, exact parent and last ID. A changed root or different scope
requires a fresh first page. Root validation is bounded by the full root budget;
the 64-row limit describes returned projections, not a database index scan.

This packet has no UI entry point. The owning session and menu composition must
opt users into definition management before activating the feature. Original
files, photo documents, runtime capabilities and assistance assets are unchanged.
