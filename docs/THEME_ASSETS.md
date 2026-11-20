# Official Theme Asset Provenance

**No artwork ships with this tree.** The themes that ship are token-only
palettes — 清白蓝 (`official-clear-blue`), Patina (`official-patina`) and 茶绿
(`official-tea-green`) — carrying colours and nothing else.

## The illustrated packs that were removed

An earlier revision shipped eight packs with generated backgrounds: Rose Dawn,
Fortune Forge, Crimson Horizon, Sage Breeze, Spark Notebook, Violet Starlight,
Cyan Stage and Noir Gold. Each was **original artwork produced procedurally**
from the scripts in `scripts/official-theme-art/` (numpy + Pillow, fixed seeds,
fully reproducible) — no pixels, layouts, text or logos were copied from the
MIT-licensed [Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin)
concept gallery that inspired the visual direction.

Those packs were removed from `internal/ext/theme/builtin/`. The generator
scripts and this record stay so the provenance of anything recovered from an
older build remains answerable.

## If such a pack is reintroduced

The rules that governed the originals still hold:

- Every background must be original generator output — never a screenshot of
  the app, and never a third party's image.
- Depicted people must be original fictional adults drawn by the generator.
- Backgrounds must contain no windows, sidebars, cards, buttons, inputs or
  readable text, and must be stripped of EXIF and author metadata.
- Artwork is released under the MIT License as part of the Reasonix repository,
  © Reasonix Contributors.
