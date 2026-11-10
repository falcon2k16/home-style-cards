# Changelog

## 0.3.0 (2026-11-10)

- `home-style-tile`: Home Assistant's tile card with the look built in (tabular digits, icon circles only on
  controls, a filled circle for a light that is on, a chevron on tiles that open a page, a marquee for long second
  lines) and expressions for the second line, the colour, a bar and a check mark, worked out in the browser.
- `home-style-text`: a line of text from an expression, for page subtitles.
- Expressions: JavaScript with small helpers (`state`, `num`, `attr`, `when`, `power`, …), run again only when a
  state they read changes. They replace Jinja in card styles, which the server renders late.

## 0.2.0 (2026-11-08)

- `home-style-now-playing`: `hold_action` (long press) and `double_tap_action` next to `tap_action`. A scroll never counts as a tap, the play buttons keep their own taps, and there is no text selection or callout under a long press on touch screens.
- `home-style-volume`: `tap_guard` takes stray taps just above and below the slider, for a volume line pulled up under a row that opens something on tap.
- `home-style-group`: `sort: state` (or `state_desc`) orders the rows by their entity's number and re-sorts as the values change; rows without a number go last, and the hairlines follow the sorted order.

## 0.1.1 (2026-11-06)

`home-style-volume`: `name_width` gives the name a fixed column, so the sliders of stacked rows line up; long names end in "…".

## 0.1.0 (2026-11-06)

First release: `home-style-group`, `home-style-volume`, `home-style-heading`, `home-style-pills`, `home-style-now-playing`.
