---
name: omni-ui-ux
description: Design or change any user-visible Omni CRM feature, page, component, control, or workflow. Use for every frontend feature in this repository so additions reuse existing surfaces, reduce clutter, and improve the light, dark, desktop, and narrow-sidebar experience.
---

# Omni UI and UX

Improve the interface as part of every user-visible change. A feature is incomplete if it technically works but adds clutter, duplicates an existing control, weakens hierarchy, or lacks a clear state.

## Before editing

- Inspect the surrounding screen and the component that owns it.
- Find existing menus, filters, settings, panels, icons, and interaction patterns that can host the feature.
- Prefer extending an existing surface over adding a new persistent button, row, card, or modal.
- Preserve the user’s current workflow and data. Do not redesign unrelated areas.

## Interface rules

- Keep the inbox header reserved for primary navigation and primary actions. Put secondary filters and operational controls inside the existing funnel, Omni menu, More menu, Settings, or contextual action menu.
- Do not create a new visible row for one or two secondary controls. Group related controls in the nearest existing popover or panel.
- Use the existing Tailwind tokens, themeable `accent` colors, dark surfaces, icon components in `src/components/icons.tsx`, and Motion dependency. Do not add a new design system or icon library.
- Match nearby spacing, type scale, radius, and interaction density. Avoid arbitrary pixel values and decorative effects that do not communicate hierarchy.
- Every interactive control needs a clear label or accessible name, hover and pressed feedback, a visible focus state, and an honest disabled/loading state.
- Use inline or popover disclosure for simple settings. Reserve dialogs for workflows that need focused, multi-step input.
- Show active filter counts on the existing filter trigger. Keep defaults visually quiet and make non-default state obvious.
- Write direct labels that describe the user outcome. Avoid vague names and unexplained icons.
- Support light and dark mode and the narrow inbox sidebar without truncating the action’s meaning.
- Include useful empty, loading, error, progress, and success states when the feature can enter them.

## Review gate

Before finishing:

1. Confirm the feature cannot fit more cleanly in an existing surface.
2. Check hierarchy and density at the actual inbox width, not only a wide desktop layout.
3. Exercise the interaction in the running app, including its non-default state.
4. Verify keyboard labeling and focus behavior.
5. Run `npx tsc --noEmit` and `git diff --check`.

If the new feature makes the screen busier without removing or consolidating something else, revise the design before handing it off.
