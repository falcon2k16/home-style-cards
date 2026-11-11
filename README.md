# Home Style Cards

Small Home Assistant dashboard cards for a calm, home-app look inspired by Apple's design: grouped inset
lists, section headings, pill buttons and selectors, a Now playing row, a one-line volume control, a styled
tile, a line of live text and a picture that follows a state.

The same look can be built from native cards and UIX/card-mod styles, but those styles arrive 100 ms or
more after the card renders, so every page load shows plain cards first. These cards carry their own
CSS and render in their final shape on the first frame. They are built from Home Assistant's own pieces
(`hui-card`, `hui-tile-card`, `ha-control-slider`, `ha-icon`, `ha-state-icon`).

Text that changes with states (a tile's second line, its colour, a bar) is worked out in the browser from short
JavaScript expressions. Jinja templates in card styles are rendered by the server one by one and arrive late,
most visibly when a phone app comes back from the background.

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

Labelled capsule buttons and selectors, bold on a grey fill; a pill whose `active` condition holds fills
with its colour (blue by default) and turns its text and icon white.

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

A selector in one row: icon pills, the chosen one grows to show its name in its own colour, the others'
icons are grey.

```yaml
type: custom:home-style-pills
layout: row            # or scroll: one row you swipe, fading at the edges where there is more
compact: true          # only the active pill shows its label; the others are icon pills
icon_width: 44
icon_color: "rgb(var(--rgb-disabled, 189, 189, 189))"   # icons of pills that are not active
pills:
  - label: Off
    icon: mdi:power
    active: "is('climate.living_room', 'off')"          # an expression (see below) or a condition
    color: var(--red-color)                              # this pill's fill while active
    tap_action: { action: perform-action, perform_action: climate.set_hvac_mode,
                  target: { entity_id: climate.living_room }, data: { hvac_mode: "off" } }
  - label: Heat
    icon: mdi:fire
    active: "is('climate.living_room', 'heat')"
    color: var(--orange-color)
    tap_action: { action: perform-action, perform_action: climate.set_hvac_mode,
                  target: { entity_id: climate.living_room }, data: { hvac_mode: heat } }
```

Other options: `font_size`, `gap` (px between pills), `pill_padding`, `fill` and `ink` (an active pill's
background and its text and icon colour); per pill `visible` (an expression), `space_before` (px) and
`icon_color`.

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

A one-line volume control: name, Home Assistant's slider, percentage. The thin line takes touches in a 32 px band.

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

### home-style-tile

Home Assistant's own tile card (every tile option works) with the look built in: tabular digits, an icon circle
only where tapping the icon switches something (a light that is on fills it, with a white symbol), and a light
grey chevron on tiles that open a page. The second line, the colour, a bar and a check mark can come from
expressions.

```yaml
type: custom:home-style-tile
entity: sensor.phone_battery
tap_action: { action: navigate, navigation_path: /dashboard-home/batteries }   # → chevron
secondary: "isnum(entity) ? fixed(num(entity)) + '% · Bedroom' : '—'"   # replaces the state
tint: "num(entity, 0) < 20 ? 'var(--red-color)' : null"                 # the tile colour; null keeps `color`
bar: { value: "num(entity, 0)", color: "'var(--green-color)'", place: right }   # 0–100, null hides it
marquee: true             # a second line too long for the row slides sideways instead of ending in "…"
chevron: false            # (default: shown when the tap navigates and no bar or check mark sits there)
icon_circle: false        # (default: only when the icon toggles or performs an action)
check: "is(entity, 'on')" # a round mark on the right: blue with a tick, or an empty ring
vars: { level: "fixed(num(entity, 0)) + '%'" }    # --hs-level on the card, for your own UIX rule
flags: { low: "num(entity, 0) < 20" }             # an hs-low attribute while true: :host([hs-low]) ...
```

`bar.place: bottom` (the default) draws an 8 px bar across the row under the text; `right` an 80 × 6 px bar at the
right end of a normal row.

### home-style-text

A line of text from an expression, for the grey line under a page title or any text that follows states.

```yaml
type: custom:home-style-text
content: "fixed(num('sensor.solar_energy_today', 0), 1) + ' kWh solar today'"
style: subtitle           # grey, 4 px under the title (default); plain: the text colour
entity: sensor.anything   # optional: `entity` and `self` in the expression
```

A caption under a picture (in a `home-style-group`), and a line with an icon that slides when it is too long:

```yaml
type: custom:home-style-text
style: caption            # a bold title over a grey 13 px line, inset like a tile
title: Front door
content: "on('binary_sensor.front_door_person') ? 'Person now' : 'Motion · ' + when(since('binary_sensor.front_door_motion'))"
tap_action: { action: more-info, entity: camera.front_door }
```

```yaml
type: custom:home-style-text
icon: "is('media_player.tv', 'off') ? 'mdi:television-off' : 'mdi:television'"
content: "attr('media_player.tv', 'media_title') || 'TV'"
marquee: true             # one line; when too long, the text slides to its end and back (the icon stays)
margin_top: 0             # px from the card above (subtitle default -4)
padding: 0 16px
```

### home-style-picture

A picture that follows a state: a room photo that greys while the room is empty, or a person's round picture
with a badge while they are home.

```yaml
type: custom:home-style-picture
image: /local/living-room.jpg      # or entity: person.someone (its picture)
dim: "is('input_select.living_room_presence', 'Empty')"   # greyed and darker while true
grid_options: { columns: 12, rows: 3 }                     # fills the rows; or aspect: "16 / 9"
```

```yaml
type: custom:home-style-picture
entity: person.someone
avatar: 44                         # round, this many px, at the card's right edge
badge: { icon: mdi:home, color: var(--green-color), visible: "is(entity, 'home')" }
tap_action: { action: navigate, navigation_path: /dashboard/people }
```

### Expressions

JavaScript, run whenever a state the expression read changes (and every 30 s when it uses the time). Helpers:

| Helper | Gives |
|---|---|
| `state(id)`, `num(id, fallback)`, `isnum(id)`, `attr(id, name)`, `label(id)` | the state, as a number, whether it is one, an attribute, the translated state |
| `is(id, ...states)`, `on(id)`, `has(id)` | state tests (`has`: not unknown or unavailable) |
| `since(id)`, `time(x)`, `now()` | dates: the last change, from an ISO string or epoch seconds, now |
| `fmt(t, "%a %H:%M")`, `hm(t)`, `when(t)` | strftime codes; "11:36"; "11:36" today, "Fri 09:47" this week, else "3 Nov" |
| `fixed(x, digits)`, `clamp(x, lo, hi)`, `power(w)`, `cap(text)` | rounding; limits; "850 W" / "2.6 kW"; first letter capital |
| `list(items)` | the non-empty, unique items joined with " · " |
| `entity`, `self`, `user`, `hass` | the card's entity id and state object, the viewer's name, everything |

### Conditions

`active` and `rename.when` take `{ entity, state }` or `{ entity, attribute, includes: [...] }`.

## Tap actions

`navigate` (a `#hash` opens a Bubble Card pop-up), `perform-action`, `toggle`, `more-info` and `none`,
with an optional `confirmation`. `home-style-now-playing` also takes `hold_action` (long press) and
`double_tap_action`; a moving finger (a scroll) never counts as a tap, and the play buttons keep their own taps.

## Compatibility

The cards use Home Assistant frontend internals that are not a public API (`hui-card`, `hui-tile-card`
and its `ha-tile-icon`/`ha-tile-info` parts, `window.loadCardHelpers`, `ha-control-slider`, `ha-state-icon`).
Check them after each Home Assistant release.

## License

MIT
