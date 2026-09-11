---
title: Local processing, models, and plugins
description: Find local assistance by task and manage models and plugins in the desktop editors.
---

Local assistance runs on your device in the Soundscaper and Framescaper desktop
editors. Select media, then choose the task from its menu. The dialog shows the
selection, the task settings, and whether its models are installed.

Desktop packages include the native processing engines for the published local
models. Install the model weights through Model Manager, then run the task on
your selected media. See each model's [guide](/reference/local-models/) for its
supported platforms, menu entry, and requirements.

## Find a task {#find-a-task}

| Menu | Tasks |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue, Reduce Reverb, Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions, Identify Speakers, Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search, Index Transcript, Index Video |

Video tasks belong to Framescaper. Available commands depend on the desktop
runtime and product capabilities. Soundscaper's alphabetical effect-menu option
also sorts local processing effects by name.

Choose **Run locally** to start processing and respond to the local consent
prompt. You can cancel while processing. Choose **Review result**, select the
results you want, and choose **Apply selected**. Accepted project edits can be
undone. Closing a task does not apply its proposals.

**Tools → Advanced Local Processing** retains the individual operation and model
pickers. Technical details in task dialogs show the underlying steps and exact
settings when needed.

## Manage models {#manage-models}

Open **Tools → Model Manager**, or use **Manage Models** inside a task. The task
link filters the list to compatible model identities; **Show all models** clears
that restriction. Search by name or task and filter by installation status.

Install models explicitly. Downloads show progress and can be cancelled. Returning
to a task preserves its settings and refreshes model availability; it does not
start processing. Expand **Storage and verification** for repair, cleanup,
storage relocation, license notices, and offline installation from a folder.

See the [individual model guides](/reference/local-models/) for each published
model's purpose, menu entry, download size, requirements, limitations, and the
real inference checks performed by the nightly-with-tests desktop package.

## Manage plugins and devices {#manage-plugins-and-devices}

**Effect → Plugin Manager** lists audio plugins in Soundscaper and OpenFX plugins
in Framescaper. Search or filter the list, then select a plugin for its version,
permission, and recovery controls. **Scanning & Settings** contains discovery
settings. Management remains reachable when processing is disabled.

Use audio plugins through **Effect → Audio Plugins**. Framescaper's Add/Edit video
effect commands remain under **Effect → Video effects**.

Open **Edit → Preferences → Audio settings** for native audio devices and helper
controls. **Media** holds native media settings; **Effects** links to Plugin
Manager and contains the plugin-discovery switch. Plugin permissions and
quarantine recovery still require explicit actions.
