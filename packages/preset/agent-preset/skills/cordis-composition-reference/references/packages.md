# Loadable Harness plugin packages

This file is GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand.

Every package below exports a Cordis plugin that a bundle patch can name in a Loader row. `Config` marks packages whose row accepts a `config` mapping; query `Config.listConfigs` through `cordis_inspect_query` (filter by `name`, then query the `entry` id) for the mounted schema. Packages under `experimental` are pre-stable.

## acp

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-acp` | yes | Automation-only Agent Client Protocol server for driving Huoli Core agents over JSON-RPC stdio |

## api

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-api-account-controller` | no | Expose safe account operations over authenticated Remote |
| `@huoli/huoli-api-gateway` | yes | Typert Remote Host dispatcher and Client API endpoint |
| `@huoli/huoli-api-job-controller` | yes | Job Remote observation stream and the reference-counted client job-output service |
| `@huoli/huoli-api-remote-access` | no | Method-level Remote access control for non-owner Peers and the per-Peer access snapshot |
| `@huoli/huoli-api-remotes` | no | Remote BFF assembly for application-selected Host capabilities |
| `@huoli/huoli-api-session-controller` | yes | Session Remote commands, cold reads, and live control transport |
| `@huoli/huoli-api-settings-controller` | yes | Remote owner for the configuration surfaces over the settings-domain seams |
| `@huoli/huoli-api-terminal-controller` | yes | Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control |
| `@huoli/huoli-api-workspace-controller` | yes | Workspace Remote commands and reconnect-safe state transport |
| `@huoli/huoli-api-workspace-files` | yes | Workspace file service and Client resource provider: bounded reads, directory listing, and live metadata over the workspaceFiles Remote namespace |

## attachment

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-attachment-local` | yes | Private content-addressed HUOLI_HOME attachment storage |

## boot

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-config-editor` | no | Persist plugin configuration through profile patches and Loader reconciliation |
| `@huoli/huoli-hmr` | yes | Coordinated module and profile configuration hot reload |
| `@huoli/huoli-plugin-manager` | yes | Current-profile plugin and bundle management shared by huoli CLI, Web and agent tools |
| `@huoli/huoli-plugin-market` | yes | Configured plugin market indexes for the Web Discover page and the plugin_market agent tool |

## browser-use

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-browser-use` | no | Exclusive named browser-use provider registration |

## bundle

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-acp-app` | no | The huoli ACP profile bundle: automation-only JSON-RPC stdio and process lifecycle over huoli-base |
| `@huoli/huoli-headless` | yes | The huoli one-shot bundle: a direct core Agent/Session runner over huoli-base with no Host, HTTP, or browser layer |
| `@huoli/huoli-sdk-app` | yes | The huoli SDK profile bundle: stdio JSON-RPC serving and process lifecycle over huoli-base |
| `@huoli/huoli-web-app` | yes | The huoli browser-surface bundle: the web patch layer over huoli-base plus the runtime glue plugin (frontend dist serving, bash runtime variables, URL line) |

## client

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-client-connection` | yes | Authenticated RPC transport and generation lifecycle |
| `@huoli/huoli-client-file-upload` | no | Agent-scoped browser file upload, streaming intake, and staged receipt service |
| `@huoli/huoli-client-hmr` | yes | Web client graph synchronization and rebuilt-bundle reload transport |
| `@huoli/huoli-client-locale` | no | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |
| `@huoli/huoli-client-modules` | no | Client module system, dual-face: node half composes the __HUOLI_BOOT__ entry graph (incremental huoli.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@huoli/huoli-client-product-analytics` | yes | Desktop product event collection and authenticated Host reporting |
| `@huoli/huoli-client-resources` | no | Unified client resource model: protocol-registered providers turn URL addresses into live values, consumed through the useResource global standard hook |
| `@huoli/huoli-client-shortcuts` | yes | Application keyboard command registry and physical-key routing |
| `@huoli/huoli-client-ui-agent-preset` | no | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@huoli/huoli-client-ui-approval` | no | Approval composer takeover over the scoped Remote Event waterfall |
| `@huoli/huoli-client-ui-attachment` | no | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |
| `@huoli/huoli-client-ui-brand-official` | no | Official Huoli Core brand occupants for the Web client's sidebar slots |
| `@huoli/huoli-client-ui-chat` | no | Chat Conversation target, node definitions, renderers, and details surface |
| `@huoli/huoli-client-ui-commands` | no | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@huoli/huoli-client-ui-context-menu` | no | Typed, plugin-extensible context menus with captured targets and shared Web presentation |
| `@huoli/huoli-client-ui-conversation` | no | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |
| `@huoli/huoli-client-ui-deliverables` | no | Changed-files card with per-file comparison tabs, delivery cards, and clickable final-response file references for Web |
| `@huoli/huoli-client-ui-directory-picker-browse` | no | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@huoli/huoli-client-ui-directory-picker-native` | no | Native directory-picker surface: the renderless workspace directory-flow occupant driving the local Desktop or Host OS chooser |
| `@huoli/huoli-client-ui-entry-customization` | no | Customize plugin entries in the left sidebar, conversation views, and right sidebar, and quickly create new plugins. |
| `@huoli/huoli-client-ui-file-actions` | no | Original-file saving and image clipboard actions for Web and Desktop |
| `@huoli/huoli-client-ui-file-drag` | no | Application-owned file drag transfers and localized failure feedback |
| `@huoli/huoli-client-ui-goal` | no | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@huoli/huoli-client-ui-input-trigger` | no | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@huoli/huoli-client-ui-jobs` | no | Session-header background-job list with on-demand streaming record panels |
| `@huoli/huoli-client-ui-layout` | no | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@huoli/huoli-client-ui-message-feedback` | no | The Web feedback surface: per-message Like/Dislike in the assistant-message action strip and the feedback dialog behind both ratings and /feedback, backed by the messageFeedback and sessionFeedback Host Remotes |
| `@huoli/huoli-client-ui-model-selection` | no | Model selection over the shared model catalog, Session projection, and session.selectModel |
| `@huoli/huoli-client-ui-open-in-app` | no | Web "Open In..." controls: the Session-header split button opening the workspace directory in an installed application, and the document preview's default-application controls for one file |
| `@huoli/huoli-client-ui-permission-presets` | no | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@huoli/huoli-client-ui-plan` | no | Plan mode controls, persistent transcript plan cards, and sidebar Markdown previews |
| `@huoli/huoli-client-ui-plugin-manager` | yes | Plugin management for the huoli web client: the sidebar Plugins panel installs, enables, disables, retries, and composes installed plugin packages |
| `@huoli/huoli-client-ui-plugin-market` | no | Discover tab of the huoli web Plugins page: browse configured plugin market indexes and install their bundles |
| `@huoli/huoli-client-ui-reference` | no | Unified Web @file and @session reference source |
| `@huoli/huoli-client-ui-renderer` | no | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@huoli/huoli-client-ui-schedule` | no | Host task management page and Session reminder catalog |
| `@huoli/huoli-client-ui-secret-mask` | no | Web display masking for recognized credentials in sent user text |
| `@huoli/huoli-client-ui-session` | no | Session Controller adapter for React and session-scoped slots |
| `@huoli/huoli-client-ui-settings` | no | Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract |
| `@huoli/huoli-client-ui-settings-account` | yes | Manage DeepSeek login and open Platform billing pages |
| `@huoli/huoli-client-ui-settings-agent-loop` | no | Settings page of the agent loop on the huoli web client's Plugins page: the parallel tool-call cap of the agent-loop namespace |
| `@huoli/huoli-client-ui-settings-general` | no | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@huoli/huoli-client-ui-settings-models` | yes | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@huoli/huoli-client-ui-settings-plugin-inventory` | no | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@huoli/huoli-client-ui-settings-plugins` | no | Built-in plugins settings section for the huoli web client: the Settings navigation entry and the tab chrome feature-owned tabs register into |
| `@huoli/huoli-client-ui-settings-session-log` | no | General settings control for Session-log upload with DeepSeek API requests |
| `@huoli/huoli-client-ui-settings-shell` | no | Settings page of the shell executor on the huoli web client's Plugins page: the command timeout and the per-stream output cap of the shell namespace |
| `@huoli/huoli-client-ui-settings-subagent` | no | Settings page of Subagent delegation on the huoli web client's Plugins page: recursion depth, parallel capacity, and the models agents may choose for subagents |
| `@huoli/huoli-client-ui-settings-web-search` | no | Settings page of the DeepSeek web-search provider on the huoli web client's Plugins page: its API key, endpoint, and per-request search budget |
| `@huoli/huoli-client-ui-shortcuts` | no | Keyboard shortcut reference, recording, and local preference editing |
| `@huoli/huoli-client-ui-sidebar` | no | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@huoli/huoli-client-ui-sidebar-browser` | no | Sandboxed Web browser tabs for the right Sidebar |
| `@huoli/huoli-client-ui-sidebar-documentpreview` | yes | Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text |
| `@huoli/huoli-client-ui-sidebar-files` | no | The workspace files page and one workspace directory tree per pane beside docked and floating file previews, listed lazily over the workspaceFiles Remote namespace |
| `@huoli/huoli-client-ui-sidebar-right` | no | Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it |
| `@huoli/huoli-client-ui-sidebar-terminal` | no | Interactive shell tabs for the right Sidebar |
| `@huoli/huoli-client-ui-skill` | no | Web skill references and the dedicated skill tool row |
| `@huoli/huoli-client-ui-subagent` | no | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@huoli/huoli-client-ui-theme` | yes | Theme plugin: Host bootstrap for the pre-plugin palette; ThemeRuntime for light/dark/system state and icon replacements; --dsw-* token styles and Appearance settings row |
| `@huoli/huoli-client-ui-tool` | no | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@huoli/huoli-client-ui-trajectory` | yes | Trajectory event ledger and timing overview with live tool-result inspection |
| `@huoli/huoli-client-ui-user-questions` | no | Web ask_user_question composer takeover and plan-review presentation UI |
| `@huoli/huoli-client-ui-workflow-run` | no | Durable workflow-run Conversation Node and nested member disclosure for huoli web |
| `@huoli/huoli-client-ui-workspace` | no | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |

## compaction

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-command-compact` | no | Human-facing slash command for explicit session compaction |
| `@huoli/huoli-compaction-basic` | yes | Token-meter-driven compaction policy and LLM summarization backend for the Huoli Core |
| `@huoli/huoli-compaction-image-offload` | no | Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry |
| `@huoli/huoli-compaction-tool-result-pruner` | yes | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |

## computer-use

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-computer-use` | no | Exclusive named computer-use provider registration |

## context

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-agent-instructions` | yes | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@huoli/huoli-file-reference-local` | yes | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@huoli/huoli-harness-dev-context` | no | Model context naming the Huoli Core checkout and Web GUI URL without letting either change the system prompt |
| `@huoli/huoli-session-reference` | yes | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@huoli/huoli-time-context` | yes | Durable per-step context with the current time and elapsed time |
| `@huoli/huoli-tmux-context` | yes | Opt-in durable per-step context with this agent's tmux pane and window location |

## core

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-agent` | no | Agent interface, registry, initiator scope, and event vocabulary for the Huoli Core |
| `@huoli/huoli-agent-default-model` | yes | Default model selection shared by Agent entry points |
| `@huoli/huoli-agent-loop` | yes | The concrete agent loop plugin for the Huoli Core |
| `@huoli/huoli-agent-tool-presentation` | yes | Deprecated tool presentation selector; use huoli-tool-executor-native or huoli-tool-executor-ptc directly |
| `@huoli/huoli-session` | no | Event-sourced session store for the Huoli Core |
| `@huoli/huoli-system-prompt` | yes | System prompt assembly registry for the Huoli Core |
| `@huoli/huoli-tool-executor-native` | no | Native tool execution plugin |
| `@huoli/huoli-tool-executor-ptc` | yes | PTC program execution, tool bindings, and generated SDK prompts |
| `@huoli/huoli-tools` | no | Tool registry and execution pipeline for the Huoli Core |

## credentials

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-authorization` | no | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@huoli/huoli-credentials-local` | yes | File-backed credentials provider ($HUOLI_HOME/.env under the live process environment) for the Huoli Core |
| `@huoli/huoli-deepseek-account-platform` | yes | Authorize DeepSeek accounts through browser PKCE |

## deliverables

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-deliverable-file-references` | no | Shared model guidance for file links and deliverables across Huoli Core hosts |
| `@huoli/huoli-tool-present` | yes | Explicit workspace file delivery declarations for the Huoli Core |
| `@huoli/huoli-workspace-changes` | yes | Per-turn workspace file changes recorded from git working-tree snapshots and whole-file captures, with per-file comparisons, for the Huoli Core |

## document

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-office-to-pdf` | yes | Shared Office-to-PDF conversion with bounded queues and caching |

## experimental

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-action-cards` | yes | Optional action cards below answers: one shared proposal tool, card state, user actions and status notices |
| `@huoli/huoli-client-ui-action-cards` | no | Action cards below completed answers: the shared card frame, kind bodies and the compact tool row |
| `@huoli/huoli-client-ui-creation-recommendations` | no | Body of the personalized page card: location choice, creation progress, Keep, Undo and Restore |
| `@huoli/huoli-client-ui-plugin-recommendations` | no | Official plugin card body with catalog text and enabling |
| `@huoli/huoli-creation-recommendations` | no | Create persistent removable interface plugins from explicit conversation needs |
| `@huoli/huoli-cua` | no | Shared Computer Use application objects, authorization, and logged tool execution |
| `@huoli/huoli-experimental-agent-team` | yes | Implicit-root Agent Teams roster, direct peer messaging, and shared task DAG |
| `@huoli/huoli-experimental-api-speech-to-text` | yes | Authenticated experimental speech transcription for browser clients |
| `@huoli/huoli-experimental-auto-review` | no | Per-tool LLM authorization review for the Huoli Core Auto permission preset |
| `@huoli/huoli-experimental-browser-use-chrome-devtools-mcp` | yes | Experimental per-Session Chromium browser tools through chrome-devtools-mcp |
| `@huoli/huoli-experimental-browser-use-playwright-mcp` | yes | Experimental per-Session Chromium browser tools through @playwright/mcp |
| `@huoli/huoli-experimental-browser-use-stagehand-native` | yes | Experimental Stagehand browser tools with separately configured native models |
| `@huoli/huoli-experimental-claude-code-mods` | yes | Experimental bridge: load Claude Code mods (hooks modules) and run their hook chains on Huoli Core extension points |
| `@huoli/huoli-experimental-client-ui-agent-team` | no | Web Agent Teams roster, task board, and teammate navigation |
| `@huoli/huoli-experimental-client-ui-claude-code-mods` | no | Web band above the prompt for Claude Code mods: draws each session's mod tree and sends button presses back to the bridge |
| `@huoli/huoli-experimental-client-ui-cot-translation` | yes | Optional machine translation of expanded reasoning, preserving original Session text |
| `@huoli/huoli-experimental-client-ui-forge` | yes | Sidebar panel for a Session's change requests, with a worktree option for new Sessions and its Host Remote |
| `@huoli/huoli-experimental-client-ui-stats` | no | Per-turn and per-step context, timing, cache, and tool-cost table contributed as an experimental conversation View |
| `@huoli/huoli-experimental-client-ui-voice-input` | no | Record speech and insert editable text into the conversation draft |
| `@huoli/huoli-experimental-computer-use-cua-driver-mcp` | yes | Experimental computer use through an installed Cua Driver MCP executable |
| `@huoli/huoli-experimental-computer-use-cua-driver-native` | no | Experimental computer-use provider embedding the Cua Driver native npm SDK |
| `@huoli/huoli-experimental-cua-macos` | yes | macOS native provider for shared Computer Use application and window objects |
| `@huoli/huoli-experimental-forge` | yes | Provider-neutral change request registry with shared status polling |
| `@huoli/huoli-experimental-forge-github` | yes | GitHub provider for the experimental forge registry, read through the GitHub CLI on the host |
| `@huoli/huoli-experimental-forge-session` | yes | Binds change requests to the Session that created, pushed, or tracked them |
| `@huoli/huoli-experimental-inspector` | yes | Experimental cross-realm CDP hub for Host debugging and Client Runtime inspection |
| `@huoli/huoli-experimental-ptc-runtime-python` | yes | CPython subprocess implementation of the Huoli Core PTC execution seam |
| `@huoli/huoli-experimental-session-inspector` | no | Experimental virtualized Session log and live Chat group/node inspectors |
| `@huoli/huoli-experimental-speech-to-text` | yes | Experimental speech recognition with independently selectable providers |
| `@huoli/huoli-experimental-speech-to-text-sensevoice` | yes | Local SenseVoice ONNX transcription with a managed sherpa-onnx process |
| `@huoli/huoli-experimental-subagent-oar` | yes | Experimental one-shot subagents through OAR runtimes |
| `@huoli/huoli-experimental-tool-agent-team` | yes | Scoped model-facing Agent Teams tools over ctx.agentTeams |
| `@huoli/huoli-experimental-tool-subagent-oar` | yes | Delegate standalone tasks to configured external subagent providers |
| `@huoli/huoli-experimental-tool-worktree` | no | Model tool that creates and enters a new Git worktree |
| `@huoli/huoli-experimental-translator` | yes | Machine translation with reusable Session results |
| `@huoli/huoli-experimental-worktree` | yes | Creates a named Git worktree and changes the calling Session working directory |
| `@huoli/huoli-hooks-claude-code` | yes | Bridge plugin: run a Claude Code hooks.json / settings hook config on the Huoli Core interception seams |
| `@huoli/huoli-hooks-codex` | yes | Bridge plugin: run a Codex hooks.json hook config on the Huoli Core interception seams |
| `@huoli/huoli-plugin-recommendations` | no | Official plugin suggestions with explicit user activation and persistent conversation decisions |
| `@huoli/huoli-session-title-all-prompts-llm` | yes | All-user-messages LLM provider plugin for Huoli Core session titles |
| `@huoli/huoli-skill-badge` | no | Bundled huoli badge skill provider for Huoli Core |
| `@huoli/huoli-tool-ralph` | yes | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| `@huoli/huoli-tool-session-query` | yes | Workspace-authorized model-facing session history search, trace, and event read tools |
| `@huoli/huoli-tool-terminal` | yes | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |
| `@huoli/huoli-webhook` | no | Fire-and-forget webhook rule runtime that creates Workspace-backed Huoli Core Sessions |
| `@huoli/huoli-webhook-github` | yes | Signed GitHub HTTP webhook adapter for the Huoli Core webhook runtime |

## extensions

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-client-ui-cordis` | no | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@huoli/huoli-cordis-client-runner` | no | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@huoli/huoli-cordis-host-runner` | yes | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@huoli/huoli-tool-cordis` | no | Read-only runtime API inspection for Harness plugin development |

## feedback

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-command-feedback` | no | Log-only session feedback: the record event, the sessionFeedback Host Remote, and the human-facing slash command |
| `@huoli/huoli-message-feedback` | yes | Canonical Session-log ratings and notes for finalized assistant messages |

## fs

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-fs-local` | yes | Local-filesystem implementation of the Huoli Core filesystem seam (ctx.fs) |
| `@huoli/huoli-fs-observation-policy` | no | File-context policy plugin for the Huoli Core — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@huoli/huoli-fs-sandbox` | yes | Sandbox-enforcing implementation of the Huoli Core filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@huoli/huoli-tool-fs` | yes | Model-facing filesystem tools (read, write, edit) over the Huoli Core filesystem seam (ctx.fs) |
| `@huoli/huoli-tool-fs-search` | yes | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@huoli/huoli-tool-str-replace-editor` | yes | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |

## goal

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-command-goal` | no | Human-facing slash command for persisted same-session goals |
| `@huoli/huoli-goal` | yes | Event-sourced same-session goal state and lifecycle service for the Huoli Core |
| `@huoli/huoli-goal-round-driver` | no | Race-fenced same-session goal-round driver |
| `@huoli/huoli-tool-goal` | yes | Model-facing same-session goal tools with execution-time authority checks |

## guard

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-repeat-tool-reminder` | yes | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@huoli/huoli-tool-call-timeout-policy` | no | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |

## host

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-host-directory-picker-auto` | no | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the Huoli Core web GUI host |
| `@huoli/huoli-host-directory-picker-browse` | yes | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@huoli/huoli-host-directory-picker-native` | no | Native-OS-chooser backend of the directory-picker seam for the Huoli Core web GUI host |
| `@huoli/huoli-host-frontend-static` | yes | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@huoli/huoli-host-open-in-app` | yes | Host half of open-in-app: resolved application catalog, icons, and the launch endpoint as three webServer routes |
| `@huoli/huoli-host-plugin-inventory` | no | Read-only Remote projection of current Cordis Loader plugin state |
| `@huoli/huoli-host-product-telemetry-otel` | yes | Explicit product usage events exported through OpenTelemetry HTTP logs |
| `@huoli/huoli-host-webserver` | yes | Web route-registration plugin: HTTP and upgrade routes, per-Peer index transform taps, and static dist fallback |

## interaction

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-commands` | no | Plugin-owned human command registry for Huoli Core UIs |
| `@huoli/huoli-permission-presets` | yes | User-facing permission presets (ctx.permissionPresets) for the Huoli Core: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@huoli/huoli-tool-ask-user` | yes | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@huoli/huoli-user-approval` | yes | User-approval seam (ctx.approval) for the Huoli Core: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@huoli/huoli-user-questions` | no | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |

## jobs

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-jobs-local` | yes | Process-local implementation of the Huoli Core background job registry seam |
| `@huoli/huoli-tool-jobs` | yes | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |

## llm

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-deepseek-llm-api-extensions` | no | Additive request-field registry for the official DeepSeek LLM API adapter |
| `@huoli/huoli-llm` | no | Provider-neutral LLM service interface for the Huoli Core |
| `@huoli/huoli-llm-deepseek-account` | yes | DeepSeek account provider authentication and discovery |
| `@huoli/huoli-llm-deepseek-api-key` | yes | DeepSeek api-key provider authentication and discovery |
| `@huoli/huoli-llm-pi-ai` | yes | pi-ai-backed DeepSeek adapter for the Huoli Core LLM seam (design-verification twin of huoli-llm-deepseek) |
| `@huoli/huoli-llm-retry` | yes | Provider-routed LLM request retry policy for the Huoli Core |
| `@huoli/huoli-plugin-package-inventory-deepseek` | yes | Active Loader-backed plugin package inventory for official DeepSeek LLM API requests |
| `@huoli/huoli-token-meter` | yes | Replay-aware token measurement service (ctx.tokenMeter) for the Huoli Core |

## lsp

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-lsp` | no | Abstract LSP capability seam (ctx.lsp) for the Huoli Core — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@huoli/huoli-lsp-stdio` | yes | Generic stdio language-server provider for the Huoli Core LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@huoli/huoli-tool-lsp` | yes | Model-facing lsp tool over the Huoli Core LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |

## mcp

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-mcp-client` | yes | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@huoli/huoli-mcp-resources` | no | Scoped MCP resource discovery and reading through shared model tools |

## plan

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-plan-mode` | yes | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |

## preset

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-agent-preset` | yes | Declare an Agent capability composition in Cordis YAML |
| `@huoli/huoli-agent-preset-registry` | yes | Declarative Agent preset registry and profile-backed editing |
| `@huoli/huoli-persona` | yes | Composition-authored deployment persona section for the Huoli Core |

## ptc-runtime

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-ptc-runtime-node` | yes | Node PTC execution with async function, REPL and VM Script evaluators and optional retained state |

## qq

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-qq-attention` | yes | Attention state machine for one chat: read watermark, wait, mark read, close, wake config |
| `@huoli/huoli-qq-bundle` | yes | 把 QQ 机器人的各个零件装到一起 |
| `@huoli/huoli-qq-channel` | yes | 接 QQ：连上去、收消息、把要说的话发出去 |
| `@huoli/huoli-qq-continuity` | yes | 收尾与回想：这段收在哪、下次怎么接、事后想到什么 |
| `@huoli/huoli-qq-material` | yes | 素材：把群里在聊什么、在跟谁说话、心里惦记什么摊开给模型 |
| `@huoli/huoli-qq-memory` | yes | 记事情：四层记忆、会慢慢变淡、能按关键词找回来 |
| `@huoli/huoli-qq-pacing` | yes | 说话的规矩：一条拆几条、隔多久、今天还能说几句 |
| `@huoli/huoli-qq-proactive` | yes | 主动开口：攒理由、过闸门、先给你看，说不说由模型定 |
| `@huoli/huoli-qq-self` | yes | 自我层：一份独占目录、一段只读面板、两档账、两把钥匙 |
| `@huoli/huoli-qq-subject` | yes | 自己的状态：心情、精力、关系，写成一段话放进每轮提示词 |
| `@huoli/huoli-qq-vitals` | yes | 生命状态：一份身体状态、一条心跳、一段只给形容词的语气提示 |

## sandbox

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-sandbox-local` | yes | Local process-sandbox backends for the Huoli Core sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@huoli/huoli-sandbox-policy` | yes | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |

## schedule

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-schedule` | yes | Host-wide durable reminders with shared management and delivery to existing or new Sessions |
| `@huoli/huoli-tool-schedule` | no | Model-facing scheduled task tools (schedule_create, schedule_list, schedule_view, schedule_edit) over the Host ctx.schedule service |

## sdk

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-sdk-jsonrpc-server` | yes | Stdio JSON-RPC server plugin for out-of-process Huoli Core SDK clients |

## session

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-message-quotes` | no | Selected-text quotation and Markdown blockquote presentation |
| `@huoli/huoli-session-checkpoint-policy` | no | Semantic session durability checkpoints before model requests and tool side effects |
| `@huoli/huoli-session-log-deepseek` | yes | Incremental lossless session-log request extension for the official DeepSeek LLM API |
| `@huoli/huoli-session-persistence-jsonl` | yes | JSONL durable session persistence backend for the Huoli Core |
| `@huoli/huoli-session-projection` | no | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@huoli/huoli-session-projection-cache` | yes | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |
| `@huoli/huoli-session-stats` | no | Whole-log conversation counts and wall times projection (sessionStats) for the Huoli Core |
| `@huoli/huoli-session-telemetry-otel` | yes | Feedback-authorized Session logs over byte-bounded OpenTelemetry HTTP requests |
| `@huoli/huoli-session-title` | yes | Log-backed session title service and provider registry for the Huoli Core |
| `@huoli/huoli-session-title-first-prompt-llm` | yes | First-message LLM provider plugin for Huoli Core session titles |
| `@huoli/huoli-session-turn-outline` | no | Whole-log turn outline projection (turnOutline) for the Huoli Core |
| `@huoli/huoli-tool-working-directory` | no | Read and change the active Session working directory |
| `@huoli/huoli-working-directory` | yes | Session working directories with durable changes and model context |

## session-query

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-session-log-export` | yes | Web Session-log ZIP export and Session Markdown copy |
| `@huoli/huoli-session-query-sqlite` | yes | Concrete ctx.sessionQuery backend with SQLite FTS5 search |

## settings

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-settings` | no | Abstract user-settings seam (ctx.settings) for the Huoli Core |

## shell

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-bash-local` | yes | Local-subprocess implementation of the Huoli Core bash executor seam |
| `@huoli/huoli-bash-sandbox` | yes | Sandbox-consuming implementation of the Huoli Core bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@huoli/huoli-pwsh-local` | yes | Local PowerShell implementation of the Huoli Core bash executor seam |
| `@huoli/huoli-pwsh-sandbox` | yes | Sandbox-consuming implementation of the Huoli Core PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@huoli/huoli-shell-env` | yes | Tool-independent managed HUOLI_* shell environment registry |
| `@huoli/huoli-tool-bash` | yes | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@huoli/huoli-tool-bash-persistent` | yes | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@huoli/huoli-tool-pwsh` | yes | Model-facing pwsh tool over the bash executor seam |
| `@huoli/huoli-tool-pwsh-persistent` | yes | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |

## skill

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-skill` | yes | Agent skill provider registry for the Huoli Core |
| `@huoli/huoli-skill-filesystem` | yes | Local filesystem skill provider for the Huoli Core |
| `@huoli/huoli-skill-office` | yes | Bundled Word, PowerPoint, and Excel workflows and LibreOffice Kit operations |
| `@huoli/huoli-tool-skill` | yes | Model-facing skill loading tool for the Huoli Core |
| `@huoli/huoli-tool-workspace-dependencies` | yes | The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload |

## spill

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-spill-local` | yes | Local-filesystem implementation of the Huoli Core spill storage seam (private session-scoped files) |
| `@huoli/huoli-spill-policy` | yes | Token-budgeted tool-result retention with recoverable text and image paths |

## ssh

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-fs-ssh` | no | Filesystem provider over the shared POSIX SSH helper |
| `@huoli/huoli-sandbox-ssh` | no | Remote POSIX sandbox argv provider over the shared SSH helper |
| `@huoli/huoli-ssh` | yes | Shared OpenSSH connection and versioned POSIX remote helper |
| `@huoli/huoli-subprocess-ssh` | no | Subprocess and terminal provider over the shared POSIX SSH helper |

## storage

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-storage` | no | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the Huoli Core |
| `@huoli/huoli-storage-domain` | yes | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the Huoli Core |
| `@huoli/huoli-storage-json` | yes | JSON file KV storage backend for the Huoli Core storage hub |
| `@huoli/huoli-storage-sqlite` | yes | SQLite storage backend (kv facet) for the Huoli Core storage hub |

## subagent

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-subagent` | yes | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@huoli/huoli-subagent-acp` | yes | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client Protocol |
| `@huoli/huoli-subagent-claude-code` | yes | One-shot Claude Code subagent provider over the official Agent SDK |
| `@huoli/huoli-subagent-codex` | yes | One-shot Codex subagent provider over the official app-server protocol |
| `@huoli/huoli-subagent-fork-in-process` | yes | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@huoli/huoli-subagent-huoli-sdk` | yes | Out-of-process SDK subagent backend: drives a child Huoli Core runtime subprocess over stdio JSON-RPC through the TypeScript SDK client |
| `@huoli/huoli-subagent-spawn-in-process` | yes | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@huoli/huoli-tool-subagent` | yes | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@huoli/huoli-tool-subagent-control` | no | Shared messaging, interruption, and child discovery tools for subagents |

## subprocess

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-subprocess-local` | no | Local-subprocess implementation of the Huoli Core subprocess seam |

## telemetry

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-otel` | no | Cordis service for independent ordinary-event and byte-bounded Session-log OTLP channels |

## terminal

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-terminal` | no | Persistent PTY session seam for the Huoli Core — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@huoli/huoli-terminal-bash` | yes | Persistent shell PTY backend over the Huoli Core subprocess terminal primitive |

## test-support

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-llm-replay` | yes | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |

## todo

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-tool-todo` | yes | Model-facing todo_write tool over the Huoli Core event-sourced session log |

## typert

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-typert-loader` | yes | Loader integration for generated Typert package contributions |

## web

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-tool-web` | yes | Model-facing web tools (web_search, web_fetch) over the Huoli Core web capability seam (ctx.web) |
| `@huoli/huoli-web` | yes | Abstract web access capability seam (ctx.web) for the Huoli Core — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@huoli/huoli-web-deepseek-api` | yes | DeepSeek Search and Fetch API providers for the Huoli Core web capability seam (ctx.web) |
| `@huoli/huoli-web-fetch-http` | yes | Anonymous HTTP(S) fetch provider for the Huoli Core web capability seam (ctx.web) |
| `@huoli/huoli-web-search-deepseek` | yes | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the Huoli Core web capability seam (ctx.web) |
| `@huoli/huoli-web-search-exa` | yes | Exa-backed search provider for the Huoli Core web capability seam (ctx.web) |
| `@huoli/huoli-web-search-perplexity` | yes | Perplexity-backed search provider for the Huoli Core web capability seam (ctx.web) |

## workflow

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-tool-workflow` | yes | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@huoli/huoli-workflow-ptc` | yes | Workflow orchestration in the shared sandboxed Node PTC runtime |

## workspace

| Package | Config | Description |
|---|---|---|
| `@huoli/huoli-workspace` | no | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the Huoli Core |
