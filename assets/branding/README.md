# ScreenFry logo

`screenfry-source.png` is the melting clock/monitor artwork supplied by Sam for ScreenFry on November 7, 2026. Its PNG pixels and transparency are preserved; embedded EXIF was removed. It replaces the earlier round-clock logo.

Run `npm run icons` to regenerate every color extension icon, favicon, UI logo, macOS AppIcon and native Dock/setup fallback. The generator centers the solid mark in a square and trims the faint outer glow; it does not redraw the supplied artwork. `apps/extension/public/icons/logo.svg` embeds the PNG so it remains self-contained.

The toolbar uses a matching monochrome outline drawn in `scripts/generate-icons.mjs`, exported to SVG and PNG. Safari tints toolbar icons from their alpha channel, so the color artwork's glow would become a broad silhouette. The outline retains the monitor, clock hands and melting drips at small sizes.

Do not regenerate the old clock mark or replace the supplied artwork with an AI approximation.
