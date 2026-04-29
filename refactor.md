# Ritor Refactor Plan

## Goal
Make the editor code easy to understand, safe to change, and predictable across browser input and cursor scenarios.

## Refactor Status (Completed In This Pass)
- Completed structural extraction of delta internals from DocumentManager:
  - src/model/delta/OpUtils.ts
  - src/model/delta/DeltaIterator.ts
  - src/model/delta/AttributeComposer.ts
- Updated src/DocumentManager.ts to orchestrate through extracted utilities instead of embedding helper classes.
- Kept existing editor behavior intact, including the consecutive-enter guard in insertBlockBreak.
- Improved type clarity in src/EventEmitter.ts with a typed callback alias.
- Clarified module option contract in src/types.ts by adding target and targetOutputSelector fields.
- Removed one unused helper from src/Cursor.ts and one unused import from src/Ritor.ts.
- Verified successful production build after refactor.

## Refactor Status (Completed In This Pass - Wave 2)
- Added centralized input pipeline service:
  - src/core/InputController.ts
  - DomEvents now delegates beforeinput, keydown, and paste to InputController
  - Ritor wiring updated to initialize and pass InputController into DomEvents
- Normalized document model invariants:
  - Delta.length now counts paragraphBreak marker operations
  - Document default state uses paragraphBreak marker instead of newline string
- Added test infrastructure and baseline behavior tests:
  - vitest.config.ts
  - src/Document.test.ts
  - src/DocumentManager.test.ts
  - package.json scripts updated with test and test:watch
  - test dependencies installed and lockfile updated
- Verification completed:
  - npm run test passes
  - npm run build passes

## Refactor Status (Completed In This Pass - Wave 3)
- Extracted selection mapping into dedicated service:
  - src/selection/SelectionMapper.ts
  - src/Cursor.ts is now a thin wrapper over browser Selection plus SelectionMapper
- Extracted HTML export logic into dedicated service:
  - src/render/HtmlExporter.ts
  - src/Renderer.ts static deltaToHtml now delegates to HtmlExporter
- Full verification completed after extraction:
  - npm run test passes
  - npm run build passes

## Final Completion
All planned structural refactors in this document have now been implemented in the current codebase scope:
- Delta utility extraction
- Input pipeline centralization
- Model invariant normalization
- Selection mapper extraction
- HTML export extraction
- Baseline tests and verification pipeline

## Security Audit Status
- Audit remediation completed for fixable issues using safe and targeted dependency updates.
- Upgraded test toolchain to remove vulnerable vite/esbuild chain:
  - vitest upgraded to 4.1.5
- Production dependency audit is clean:
  - `npm audit --omit=dev` returns 0 vulnerabilities
- Remaining known issues are dev-only and transitive via webpack-dev-server:
  - `sockjs -> uuid` (moderate)
  - npm audit currently has no safe non-breaking fix path for this chain.

## Current Architecture Summary
- Core runtime is centralized in Ritor and currently mixes editor lifecycle, input orchestration, module runtime, and command entry points.
- Document editing logic is in DocumentManager, but it also embeds low-level delta infrastructure in the same file.
- Cursor contains complex DOM to model mapping logic and currently acts as a critical bridge between rendering and editing.
- Renderer maps model operations to DOM and also has separate HTML export logic with similar formatting behavior.
- Modules are simple and functional, but the module API and shortcut conventions are inconsistent.

## Key Problems To Address

### 1) High coupling in core flow
Files: src/Ritor.ts, src/DomEvents.ts, src/DocumentManager.ts, src/Cursor.ts
- Event flow is spread across multiple classes and event names.
- Enter and text editing behavior depend on tight sequencing between beforeinput, keydown, model mutation, render, and cursor updates.
- This increases regression risk for simple behavior changes.

### 2) Very large and multi-purpose DocumentManager
File: src/DocumentManager.ts
- Contains orchestration methods and embedded low-level classes (OpUtils, DeltaIterator, OpAttributeComposer).
- Hard to test in isolation.
- Hard to reason about compose edge cases.

### 3) Model representation inconsistencies
Files: src/Document.ts, src/DocumentManager.ts, src/Renderer.ts
- Document constructor default uses newline string while editor flow uses paragraphBreak marker object.
- Delta.length does not explicitly count paragraphBreak marker insertions.
- This can create hidden assumptions and index inconsistencies.

### 4) Cursor mapping complexity and fragility
File: src/Cursor.ts
- Custom conversion logic is long and sensitive to placeholder DOM structures.
- Some utilities are now unused and increase cognitive load.
- Selection correctness is critical, but there are no direct tests for mapping invariants.

### 5) Typing and API contracts are too loose
Files: src/EventEmitter.ts, src/types.ts
- EventEmitter uses Function and any data payloads.
- Module options use broad index signature with few enforced contracts.
- Weak typing makes refactor safety lower.

### 6) Module system ergonomics
Files: src/modules/BaseModule.ts, src/modules/*.ts, src/defaultModules.ts
- Shortcut key formats vary and normalization rules are implicit.
- Module lifecycle and cleanup are duplicated in places.
- UI query scope is global querySelector instead of editor-scoped resolution.

### 7) Tooling and quality gates are minimal
Files: package.json, tsconfig.json
- No test framework configured.
- No lint or formatting pipeline.
- No CI-like gates for behavior-sensitive code.

## Refactor Principles
- Keep behavior stable while changing structure.
- Prefer small, test-backed moves over one big rewrite.
- Make data model invariants explicit and centrally validated.
- Isolate browser DOM concerns from model mutation logic.
- Use strict typing to communicate intent.

## Target Architecture

### Core layers
1. Editor shell
- Owns lifecycle and dependency wiring only.
- No editing logic.

2. Input controller
- Converts browser events into semantic editor commands.
- Single source of truth for Enter, delete, insert, paste.

3. Command service
- Applies mutations to model using clear command methods.
- Returns next selection.

4. Document model package
- Delta primitives and compose logic in dedicated files.
- Explicit invariants and validation helpers.

5. Selection mapper
- Dedicated mapping between model indices and DOM points.
- Isolated and unit tested.

6. Renderer
- Pure model to DOM rendering.
- Shared formatting helpers reused by HTML export.

## Phased Plan

## Phase 0: Safety Net First
Estimated: 1-2 days
- Add test stack (Vitest or Jest + jsdom).
- Add initial tests for current critical behaviors:
  - Enter behavior
  - Backspace and delete behavior
  - Selection mapping round trips
  - Format toggles with collapsed and ranged selections
- Add npm scripts for test and test:watch.

Definition of done
- Basic tests run in CI-like local command.
- At least 12-20 tests around critical editor behavior.

## Phase 1: Clarify Domain Model Contracts
Estimated: 1-2 days
- Unify block break representation strategy.
- Make Delta.length semantics explicit for all op variants.
- Add model invariant checks (development mode assertion helper).

Definition of done
- Single documented rule for paragraph separators.
- No mixed fallback assumptions between newline and paragraphBreak marker.

## Phase 2: Split DocumentManager by Responsibility
Estimated: 2-4 days
- Extract into new internal modules:
  - src/model/delta/OpUtils.ts
  - src/model/delta/DeltaIterator.ts
  - src/model/delta/AttributeComposer.ts
  - src/model/commands/TextCommands.ts
  - src/model/commands/BlockCommands.ts
- Keep existing public behavior via a thin facade.

Definition of done
- src/DocumentManager.ts becomes orchestrator only.
- Compose logic covered by direct unit tests.

## Phase 3: Refactor Cursor into SelectionMapper
Estimated: 2-3 days
- Extract DOM mapping logic from Cursor into SelectionMapper service.
- Remove dead helpers and consolidate point conversion utilities.
- Add deterministic tests for:
  - Empty block placeholders
  - Multiple paragraph separators
  - Start/end of block and document boundaries

Definition of done
- Cursor becomes a thin selection access wrapper.
- Mapping logic is tested without requiring full editor boot.

## Phase 4: Normalize Input Pipeline
Estimated: 2 days
- Create InputController to centralize beforeinput and keydown fallback behavior.
- Define clear precedence and de-duplication rules.
- Keep DomEvents as a lightweight browser event adapter.

Definition of done
- One clear command path per user action.
- No duplicate Enter handling risk.

## Phase 5: Module API Cleanup
Estimated: 1-2 days
- Define stronger module interfaces:
  - init
  - destroy
  - optional onSelectionChange
- Normalize shortcut representation and parsing.
- Scope toolbar querying to editor root or configured toolbar root.

Definition of done
- Module behavior is explicit and consistent.
- Reduced duplication in module constructors.

## Phase 6: Renderer and Export Consolidation
Estimated: 1-2 days
- Consolidate inline formatting helper usage between live rendering and deltaToHtml.
- Remove duplicate branches where possible.
- Add export snapshot tests for representative deltas.

Definition of done
- Rendering and export logic share core formatting rules.
- Fewer edge-case mismatches.

## Phase 7: Developer Experience and Documentation
Estimated: 1 day
- Add linting and formatting scripts.
- Add architecture docs:
  - editing flow
  - data model invariants
  - module author guide
- Simplify demo bootstrap in src/index.ts to minimal setup and move debug wiring behind flag.

Definition of done
- New contributors can follow a short architecture map.
- Consistent local workflow for build, lint, test.

## Recommended File and Folder Direction
- src/core/Editor.ts
- src/core/InputController.ts
- src/core/EventBus.ts
- src/model/DocumentModel.ts
- src/model/delta/*
- src/model/commands/*
- src/selection/SelectionMapper.ts
- src/render/Renderer.ts
- src/render/HtmlExporter.ts
- src/modules/*
- src/demo/*

## Priority Order For Immediate Work
1. Add tests and baseline assertions.
2. Unify block break model semantics.
3. Split DocumentManager internals.
4. Extract and test selection mapping.

## Risks and Mitigation
- Risk: behavior drift in Enter and selection.
  - Mitigation: freeze current behavior with tests before extraction.
- Risk: breaking module compatibility.
  - Mitigation: keep adapter layer for old module options during transition.
- Risk: long-running refactor branch.
  - Mitigation: ship in small PR-sized phases.

## Success Metrics
- 30-50 percent reduction in average file size for core files.
- 70 percent plus coverage on model and selection subsystems.
- Fewer bug regressions in Enter/selection formatting flows.
- Faster onboarding: developer can explain flow in under 10 minutes.

## Suggested Execution Timeline
- Week 1: Phase 0 and Phase 1
- Week 2: Phase 2
- Week 3: Phase 3 and Phase 4
- Week 4: Phase 5, Phase 6, and docs cleanup
