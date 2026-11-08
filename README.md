# Home Style Cards

Small Home Assistant dashboard cards for a calm, home-app look inspired by Apple's design: grouped inset
lists, section headings, pill buttons, a Now playing row and a one-line volume control.

The same look can be built from native cards and UIX/card-mod styles, but those styles arrive 100 ms or
more after the card renders, so every page load shows plain cards first. These cards carry their own
CSS and render in their final shape on the first frame. They are built from Home Assistant's own pieces
(`hui-card`, `ha-control-slider`, `ha-icon`, `ha-state-icon`).

They pair with the [Home Style theme](https://github.com/falcon2k16/home-style-theme), which sets the
glass, colours and separators. Without it they fall back to Home Assistant's default card colours.

## Install

1. In Home Assistant, open **Settings → Marketplace** and add this repository's URL as a custom
   repository of the type **Dashboard** (this needs the Marketplace's GitHub connection).
2. Install **Home Style Cards**.
3. If the dashboard resource isn't listed under **Settings → Dashboards → Resources**, add
   `/local/community/home-style-cards/home-style-cards.js` as a JavaScript module.

Requires Home Assistant 2026.11 or newer.

## Cards

All cards take Home Assistant's usual `visibility` and `grid_options`.

### home-style-group

One inset card holding several cards as rows (the grouped list). Children lose their own background,
shadow and corners; hairlines are drawn between the visible rows. A row disappears with its hairline
when its `visibility` is false or when the card inside hides itself (for example a speaker that follows
another speaker's group).

```yaml
type: custom:home-style-group
dividers: { left: 64, right: 0 }   # hairline insets in px; omit for no hairlines
no_divider: [2]                    # rows (0-based) that never get a hairline above them
surface: false                     # optional: no card surface, rows only
sort: state                        # optional: rows by their entity's number, lowest first (state_desc: highest);
                                   # rows without a number go last; re-sorts as the values change
cards:
  - type: tile
    entity: cover.example_door
  - type: custom:home-style-now-playing
    entity: media_player.speaker_two
  - type: custom:home-style-volume
    entity: media_player.speaker_two
```

### home-style-heading

A grouped-list section header: capitals, 13 px, semibold, grey. A tap action adds a chevron.

```yaml
type: custom:home-style-heading
heading: Section
tap_action: { action: navigate, navigation_path: /dashboard-home/details }
```

### home-style-pills

Labelled capsule buttons, bold on a grey fill; a pill whose `active` condition holds turns blue with
white text and icon.

```yaml
type: custom:home-style-pills
layout: pairs          # row (one stretched row) | pairs (two per row; the last pill takes a full row)
size: 44               # 36 | 44
padding: 0 8px
gap_before_last: 12    # extra space above the last row
pills:
  - label: Speaker one
    icon: mdi:speaker
    active: { entity: media_player.speaker_one, attribute: group_members, includes: [media_player.speaker_one] }
    tap_action: { action: perform-action, perform_action: media_player.media_play_pause,
                  target: { entity_id: media_player.speaker_one } }
  - label: Speaker two
    rename: { when: { entity: binary_sensor.speaker_two_docked, state: "on" }, then: Speaker two (docked) }
```

Other options: `font_size`, `icon_color`.

### home-style-now-playing

One Now playing row: artwork (else an icon), the name, what is playing, play/pause and a smaller grey
next button.

```yaml
type: custom:home-style-now-playing
entity: media_player.speaker_one
name: Speaker one
size: small                     # small (36 px art) | large (64 px art)
lines: [media_title]            # any media_player attributes, joined with " · "
controls: [play_pause, next]
control_sizes: [30, 22]         # icon px
control_widths: [36, 28]        # tap target px
icon: mdi:speaker               # without artwork; default: the entity's own icon
coordinator_only: true          # hide while this speaker follows another speaker's group
with:                           # adds "· with Speaker two, Speaker three" when grouped
  names: { media_player.speaker_two: Speaker two, media_player.speaker_three: Speaker three }
idle: { name: Nothing playing } # one row for playing and idle
tap_action: { action: more-info }   # default
hold_action: { action: more-info }  # long press (500 ms)
double_tap_action: { action: none }
```

### home-style-volume

A one-line volume control: name, Home Assistant's slider, percentage.

```yaml
type: custom:home-style-volume
entity: media_player.speaker_one
name: Volume
margin: -9px 0 5px              # to tuck it under a Now playing row
divider: true                   # hairline above
name_width: 88                  # px; stacked rows get sliders of the same length, long names end in "…"
member_of: media_player.speaker_one   # only while grouped with that player
coordinator_only: true
tap_guard: true                 # under a row that opens something on tap: taps just beside the slider do nothing
```

### Conditions

`active` and `rename.when` take `{ entity, state }` or `{ entity, attribute, includes: [...] }`.

## Tap actions

`navigate` (a `#hash` opens a Bubble Card pop-up), `perform-action`, `toggle`, `more-info` and `none`,
with an optional `confirmation`. `home-style-now-playing` also takes `hold_action` (long press) and
`double_tap_action`; a moving finger (a scroll) never counts as a tap, and the play buttons keep their own taps.

## Compatibility

The cards use Home Assistant frontend internals that are not a public API (`hui-card`,
`ha-control-slider`, `ha-state-icon`). Check them after each Home Assistant release.

## License

MIT
