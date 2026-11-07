# shadcn/ui source attribution

`src/components/ui/` is adapted from [shadcn-ui/ui](https://github.com/shadcn-ui/ui)
(`apps/v4/registry/new-york-v4/ui`), commit `42f3bb63b46a69e52a24bd005cdc9ec15ba7a7b9`,
licensed under the MIT License. The original license is preserved in [LICENSE](./LICENSE).

Belfry modifications: imports point to local modules (`src/lib/utils.ts`, sibling components),
lucide icons are imported by their base names, and the `"use client"` directives are removed.
Theme colors, radii and font sizes map to Belfry's own theme variables in `src/rooms/tailwind.css`;
Tailwind's global preflight is replaced by a reset scoped to the room view and shadcn components.
This notice does not relicense unrelated Belfry code.
