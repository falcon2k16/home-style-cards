// Home Style cards: a dashboard's repeated patterns as small cards that carry their own CSS, so the first
// frame is already right (UIX styles land 100 ms+ later per nested element and showed HA's plain cards
// first). They compose HA's own pieces (hui-card, ha-control-slider, ha-icon) and read the theme's
// variables; one-off styling stays in UIX.
//
// Install through the Home Assistant Marketplace (custom repository, type Dashboard); see README.md.
// The cards read the Home Style theme's variables and fall back to Home Assistant's defaults without it.
//
// HA internals used (not public API; check after HA upgrades): hui-card (card wrapper with visibility), hui-tile-card
// (extended by home-style-tile), window.loadCardHelpers,
// ha-control-slider (value-changed event, `pressed`), ha-icon, ha-state-icon, the hass-more-info and
// location-changed events.
//
// Cards: home-style-group, home-style-volume, home-style-heading, home-style-pills, home-style-now-playing,
// home-style-tile, home-style-text, home-style-picture.

const VERSION = "0.3.1";
console.info(`%c HOME-STYLE-CARDS %c ${VERSION} `, "color: #fff; background: #007aff; font-weight: 600",
  "color: #007aff; background: #fff");

// ---------------------------------------------------------------------------------------------- helpers

function navigate(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

// Supported tap actions: navigate (a #hash opens a pop-up), perform-action, more-info, toggle, none;
// an optional confirmation.
function runAction(el, hass, action, entity) {
  if (!action || action.action === "none") return;
  if (action.confirmation && !window.confirm(action.confirmation.text || "Are you sure?")) return;
  switch (action.action) {
    case "navigate":
      if (action.navigation_path?.startsWith("#")) {
        location.hash = action.navigation_path;  // pop-up cards open on the hash
        window.dispatchEvent(new CustomEvent("location-changed"));
      } else navigate(action.navigation_path);
      break;
    case "perform-action": case "call-service": {
      const [domain, service] = (action.perform_action || action.service).split(".");
      hass.callService(domain, service, action.data || action.service_data || {}, action.target);
      break;
    }
    case "toggle":
      hass.callService("homeassistant", "toggle", { entity_id: action.entity || entity });
      break;
    case "more-info":
      el.dispatchEvent(new CustomEvent("hass-more-info",
        { bubbles: true, composed: true, detail: { entityId: action.entity || entity } }));
      break;
  }
}

// Tap, long press (500 ms) and double tap on one element, like HA's own cards: tap_action, hold_action,
// double_tap_action. A finger that moves (a scroll) cancels; taps on buttons inside are left to the buttons.
// Double tap only waits for a second tap when a double_tap_action is set, so a plain tap stays instant.
function bindActions(card, el, defaultTap = { action: "more-info" }) {
  let timer = null, held = false, start = null, last = 0, single = null;
  const cfg = () => card._config;
  const run = (key, fallback) => runAction(card, card._hass, cfg()[key] ?? fallback, cfg().entity);
  const onButton = (ev) => ev.composedPath().some((n) => n.tagName === "BUTTON" || n.tagName === "HA-CONTROL-SLIDER");
  // No text selection or callout menu under a long press on touch screens.
  el.style.webkitTouchCallout = "none"; el.style.webkitUserSelect = "none"; el.style.userSelect = "none";
  el.addEventListener("pointerdown", (ev) => {
    if (onButton(ev)) return;
    held = false; start = [ev.clientX, ev.clientY];
    clearTimeout(timer);
    if (cfg().hold_action) timer = setTimeout(() => { held = true; run("hold_action"); }, 500);
  });
  el.addEventListener("pointermove", (ev) => {
    if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 10) { clearTimeout(timer); start = null; }
  });
  el.addEventListener("pointercancel", () => { clearTimeout(timer); start = null; });
  el.addEventListener("click", (ev) => {
    clearTimeout(timer);
    if (onButton(ev) || held || !start) { held = false; return; }
    start = null;
    if (!cfg().double_tap_action) { run("tap_action", defaultTap); return; }
    const now = Date.now();
    if (now - last < 250) { clearTimeout(single); last = 0; run("double_tap_action"); return; }
    last = now;
    single = setTimeout(() => run("tap_action", defaultTap), 250);
  });
  el.addEventListener("contextmenu", (ev) => { if (cfg().hold_action) ev.preventDefault(); });
}

// `when` conditions the cards understand: { entity, state } or { entity, attribute, includes: [...] }.
function holds(hass, when) {
  if (!when) return false;
  const st = hass.states[when.entity];
  if (!st) return false;
  if (when.includes) {
    const v = (when.attribute ? st.attributes[when.attribute] : st.state) || [];
    return when.includes.every((x) => v.includes(x));
  }
  return (when.attribute ? st.attributes[when.attribute] : st.state) === when.state;
}

// A name that changes with a state: { name, when: { entity, state }, then: "other name" }.
const pickName = (hass, base, alt) => (alt && holds(hass, alt.when) ? alt.then : base);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class HomeStyleBase extends HTMLElement {
  setConfig(config) {
    this._config = config;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" }).innerHTML = `<style>${this.constructor.css}</style><div class="root"></div>`;
    this._configured();
    if (this._hass) this._render();
  }
  set hass(hass) { this._hass = hass; this._render(); }
  get $() { return this.shadowRoot.querySelector(".root"); }
  // Cards that hide themselves (a grouped speaker) tell their home-style-group, which drops the row and its hairline.
  _setHidden(hide) {
    if (this.hidden === hide) return;
    this.hidden = hide;
    this.dispatchEvent(new CustomEvent("home-style-visibility", { bubbles: true, composed: true }));
  }
  _configured() {}
  _render() {}
  getCardSize() { return 1; }
  getGridOptions() { return { columns: 12, rows: "auto" }; }
}

// ---------------------------------------------------------------------------------------------- home-style-group

// One inset glass card holding several cards (the grouped list). It draws the surface itself and flattens
// its children with inherited CSS variables; each child sits in HA's own card wrapper, so `visibility`,
// UIX on the child and sizing keep working. Hairlines between the visible rows are drawn here too.
//
// { type: custom:home-style-group, cards: [...],
//   dividers: { left: 64, right: 0 },   hairline above every visible row after the first (inset px)
//   no_divider: [2, 4],                 rows (0-based) that never get one (a volume line under its player)
//   surface: false,                     no card surface, just the rows (inside a pop-up)
//   sort: "state" | "state_desc",       order the rows by their entity's number (lowest first, or highest);
//                                       rows without a number go last; re-sorts as values change
//   stack_uix: {...} }                  legacy: render through a vertical-stack with these UIX styles
class HomeStyleGroup extends HomeStyleBase {
  static css = `
    :host {
      display: block; position: relative; isolation: isolate; overflow: hidden;
      border-radius: var(--ha-card-border-radius, 20px);
      background: var(--ha-card-glass-tint, var(--ha-card-background, var(--card-background-color)));
      box-shadow: var(--ha-card-box-shadow, none);
      -webkit-backdrop-filter: var(--ha-card-backdrop-filter, none);
      backdrop-filter: var(--ha-card-backdrop-filter, none);
    }
    /* Everything inside is part of this one surface: no glass, shadow, blur or corners of its own. */
    .root {
      --ha-card-background: transparent; --ha-card-glass-tint: transparent; --ha-card-box-shadow: none;
      --ha-card-backdrop-filter: none; --ha-card-border-radius: 0px; --ha-card-border-width: 0px;
      --frosted-glass-card-layer-content: none; --vertical-stack-card-gap: 0px; --stack-card-gap: 0px;
    }
    :host([plain]) { background: none; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none;
                     border-radius: 0; overflow: visible; }
    .item { position: relative; }
    /* Sorted rows: every visible row draws its hairline and the list moves up under the clipped top edge,
       because the "after the first row" rule follows the document order, not the sorted one. */
    .root.sorted { display: flex; flex-direction: column; margin-top: -1px; }
    .lines.sorted .item:not(.nodiv):not(.gone):not(:has(> hui-card[hidden]))::before {
      content: ""; position: absolute; top: 0; left: var(--line-left); right: var(--line-right);
      z-index: 1; pointer-events: none;
      border-top: 0.5px solid var(--home-style-separator, rgba(60, 60, 67, 0.18));
    }
    .item > hui-card { display: block; }
    /* A row is hidden when HA's wrapper is (visibility) or the card inside hides itself (a grouped speaker). */
    .item.gone, .item:has(> hui-card[hidden]) { display: none; }
    .lines .item:not(.gone):not(:has(> hui-card[hidden]))
      ~ .item:not(.nodiv):not(.gone):not(:has(> hui-card[hidden]))::before {
      content: ""; position: absolute; top: 0; left: var(--line-left); right: var(--line-right);
      z-index: 1; pointer-events: none;
      border-top: 0.5px solid var(--home-style-separator, rgba(60, 60, 67, 0.18));
    }
  `;

  async _configured() {
    const c = this._config;
    if (!Array.isArray(c.cards)) throw new Error("home-style-group needs cards");
    this.toggleAttribute("plain", c.surface === false);
    if (!this._listening) {
      this.shadowRoot.addEventListener("home-style-visibility", (ev) => {
        const item = ev.composedPath().find((n) => n.classList?.contains("item"));
        item?.classList.toggle("gone", ev.composedPath()[0].hidden);
        ev.stopPropagation();
      });
      this._listening = true;
    }
    await customElements.whenDefined("hui-card");
    const root = this.$;
    root.classList.toggle("lines", !!c.dividers);
    root.classList.toggle("sorted", !!c.sort);
    if (c.dividers) {
      root.style.setProperty("--line-left", `${c.dividers.left ?? 16}px`);
      root.style.setProperty("--line-right", `${c.dividers.right ?? 0}px`);
    }
    const make = (conf) => {
      const card = document.createElement("hui-card");
      card.preview = false;
      if (this._hass) card.hass = this._hass;
      card.config = conf;
      return card;
    };
    this._cards = [];
    if (c.stack_uix) {
      this._cards.push(make({ type: "vertical-stack", cards: c.cards, uix: c.stack_uix }));
      root.replaceChildren(...this._cards);
      return;
    }
    const noDiv = new Set(c.no_divider || []);
    root.replaceChildren(...c.cards.map((conf, i) => {
      const item = document.createElement("div");
      item.className = noDiv.has(i) ? "item nodiv" : "item";
      const card = make(conf);
      this._cards.push(card);
      item.appendChild(card);
      return item;
    }));
  }

  _render() {
    const sort = this._config?.sort, dir = sort === "state_desc" ? -1 : 1;
    (this._config?.cards || []).forEach((conf, i) => {
      const item = this._cards?.[i]?.parentElement;
      if (!sort || !item) return;
      const v = parseFloat(this._hass.states[conf.entity]?.state);
      item.style.order = isNaN(v) ? 99999 : Math.round(v * dir);
    });
    for (const card of this._cards || []) {
      card.hass = this._hass;
      // Also catch a card that hid itself before it was attached (its event went nowhere).
      const inner = [...card.children, ...(card.shadowRoot?.children || [])].find((k) => k.tagName?.startsWith("HOME-STYLE-"));
      if (inner) card.parentElement?.classList.toggle("gone", inner.hidden);
    }
  }

  getCardSize() { return this._config?.cards?.length || 1; }
}

// ---------------------------------------------------------------------------------------------- home-style-volume

// The one-line volume control ("Volume ▬▬▬ 35%") with HA's own slider.
// { type: custom:home-style-volume, entity, name: "Volume",
//   margin: "-14px 0 3px"            (default: tucked under a large player; under a small one -9px 0 5px),
//   divider: true                    (hairline above, 16 px in on both sides),
//   name_width: 88                   (px; a fixed name column so stacked rows' sliders line up, long names end in "…"),
//   member_of: media_player.x        (only while grouped with that player),
//   coordinator_only: true           (hidden while the speaker follows another group),
//   rename: { when: {entity, state}, then: "Other name" },
//   tap_guard: true                  (an empty band 14 px up and 8 px down behind the slider takes stray taps,
//                                     for a line pulled up under a player row that opens something on tap) }
class HomeStyleVolume extends HomeStyleBase {
  static css = `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .root { position: relative; display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 16px;
            font-size: 13px; color: var(--secondary-text-color); }
    .root.divider::before { content: ""; position: absolute; top: 0; left: 16px; right: 16px;
            border-top: 0.5px solid var(--home-style-separator, rgba(60, 60, 67, 0.18)); }
    .name { flex: 0 0 var(--name-width, auto); min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    ha-control-slider { flex: 1 1 auto; height: 8px; --control-slider-thickness: 8px; --control-slider-border-radius: 4px;
      --control-slider-color: var(--state-media_player-active-color, #8e8e93);
      --control-slider-background: var(--state-media_player-active-color, #8e8e93);
      --control-slider-background-opacity: 0.2; }
    .pct { flex: 0 0 auto; min-width: 32px; text-align: right; }
    :host([guard]) { position: relative; z-index: 1; }
    :host([guard]) .root { z-index: 0; }
    :host([guard]) .root::after { content: ""; position: absolute; left: 0; right: 0; top: -14px; bottom: -8px; z-index: -1; }
  `;

  _configured() {
    const c = this._config;
    if (!c.entity) throw new Error("home-style-volume needs an entity");
    if (!this._built) {
      this.$.innerHTML = `<span class="name"></span><ha-control-slider min="0" max="100" step="1" mode="start" show-handle>`
        + `</ha-control-slider><span class="pct"></span>`;
      this.$.querySelector("ha-control-slider").addEventListener("value-changed", (ev) => {
        this._hass?.callService("media_player", "volume_set",
          { entity_id: this._config.entity, volume_level: ev.detail.value / 100 });
      });
      this._built = true;
    }
    this.style.margin = c.margin ?? "-14px 0 3px";
    this.toggleAttribute("guard", !!c.tap_guard);
    this.$.classList.toggle("divider", !!c.divider);
    if (c.name_width != null) this.$.style.setProperty("--name-width", typeof c.name_width === "number" ? `${c.name_width}px` : c.name_width);
    else this.$.style.removeProperty("--name-width");
  }

  _render() {
    const c = this._config, hass = this._hass, st = hass.states[c.entity];
    let hide = false;
    if (c.member_of) hide = !(hass.states[c.member_of]?.attributes?.group_members || []).includes(c.entity);
    if (c.coordinator_only) hide = (st?.attributes?.group_members || [c.entity])[0] !== c.entity;
    this._setHidden(hide);
    this.$.querySelector(".name").textContent = pickName(hass, c.name ?? "Volume", c.rename);
    const pct = Math.round((st?.attributes?.volume_level ?? 0) * 100);
    this.$.querySelector(".pct").textContent = `${pct}%`;
    const slider = this.$.querySelector("ha-control-slider");
    if (!slider.pressed) slider.value = pct;  // don't fight the finger while dragging
  }
}

// ---------------------------------------------------------------------------------------------- home-style-heading

// Grouped-list section header: capitals, 13 px, 600, grey, 8 px above. A tap action adds a chevron.
// { type: custom:home-style-heading, heading: "Section", tap_action: {...} }
class HomeStyleHeading extends HomeStyleBase {
  static css = `
    :host { display: block; }
    .root { display: flex; align-items: center; gap: 2px; height: 24px; box-sizing: border-box; padding: 8px 4px 0;
            font-size: 13px; font-weight: 600; letter-spacing: 0.4px; line-height: 15.6px; text-transform: uppercase;
            color: var(--secondary-text-color); }
    .root.link { cursor: pointer; }
    ha-icon { --mdc-icon-size: 16px; }
  `;
  _configured() {
    const c = this._config, link = c.tap_action && c.tap_action.action !== "none";
    this.$.classList.toggle("link", !!link);
    this.$.innerHTML = `<span>${esc(c.heading)}</span>${link ? '<ha-icon icon="mdi:chevron-right"></ha-icon>' : ""}`;
    this.$.onclick = link ? () => runAction(this, this._hass, c.tap_action) : null;
  }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

// ---------------------------------------------------------------------------------------------- home-style-pills

// A swiped row fades only where there is more to see: right at the start, both sides in the middle, left at the end.
const FADE_R = "linear-gradient(90deg, #000 85%, transparent)";
const FADE_B = "linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)";
const FADE_L = "linear-gradient(90deg, transparent, #000 15%)";

// Labelled capsule buttons (actions, favourites, choices): bold, grey fill; a selected pill fills with its
// colour (blue by default) and turns its icon and label white.
// { type: custom:home-style-pills,
//   pills: [{ label, icon, tap_action,
//             active: <when> | "expression",       a condition object or an expression (see home-style-tile)
//             color: "var(--orange-color)",         this pill's fill while active (default: fill)
//             icon_color,                          this pill's icon colour while not active
//             visible: "expression",               hidden while false
//             space_before: 8,                     extra px before this pill
//             rename: { when, then } }],
//   layout: "row" (one stretched row) | "pairs" (two per row; the last pill takes a full row, a lone
//           pill before it sits centred at half width) | "scroll" (one row you swipe; it fades at the
//           edges where there is more), gap_before_last: 12 (extra px above the last row in pairs),
//   compact: true,              only the active pill shows its label; the others are icon pills of
//                               icon_width px (default: size + 8)
//   size: 36 | 44, gap: 8, font_size: "10.8px", pill_padding: "0 8px", padding: "0 12px 12px",
//   icon_color: "var(--secondary-text-color)"     (icons of pills that are not active),
//   fill: "var(--primary-color)", ink: "#fff"     (an active pill's background, and its icon and label) }
class HomeStylePills extends HomeStyleBase {
  static css = `
    :host { display: block; }
    .root { display: flex; flex-wrap: wrap; gap: var(--gap); justify-content: center; box-sizing: border-box; }
    .pill { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; box-sizing: border-box;
            height: var(--pill-h); border-radius: calc(var(--pill-h) / 2); padding: var(--pill-pad);
            background: var(--home-style-fill, rgba(120, 120, 128, 0.12)); color: var(--primary-text-color);
            font-size: var(--pill-font); font-weight: 600; cursor: pointer; user-select: none;
            -webkit-tap-highlight-color: transparent; }
    .pill[hidden] { display: none; }
    .pill span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill span:empty { display: none; }
    .pill ha-icon { --mdc-icon-size: 20px; color: var(--icon, var(--pill-icon)); flex: 0 0 auto; }
    .pill.on { background: var(--on-fill, var(--fill)); color: var(--ink); }
    .pill.on ha-icon { color: var(--ink); }
    .pill:active { opacity: 0.6; }
    .row .pill { flex: 1 1 0; }
    .pairs .pill { flex: 0 0 calc((100% - var(--gap)) / 2); }
    .pairs .pill:last-child { flex: 0 0 100%; margin-top: var(--last-gap); }
    .scroll { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; scrollbar-width: none;
              -webkit-mask-image: ${FADE_R}; mask-image: ${FADE_R};
              animation: hs-edges linear both; animation-timeline: scroll(self inline); }
    .scroll::-webkit-scrollbar { display: none; }
    .scroll .pill { flex: 0 0 auto; }
    .compact .pill:not(.on) { flex: 0 0 var(--icon-w); padding: 0; }
    .compact .pill:not(.on) span { display: none; }
    .compact.row .pill.on { flex: 1 1 auto; }
    @keyframes hs-edges { 0% { -webkit-mask-image: ${FADE_R}; mask-image: ${FADE_R}; }
      2%, 98% { -webkit-mask-image: ${FADE_B}; mask-image: ${FADE_B}; }
      100% { -webkit-mask-image: ${FADE_L}; mask-image: ${FADE_L}; } }
  `;
  _configured() {
    const c = this._config;
    const h = c.size ?? 36;
    const s = this.$.style;
    s.setProperty("--pill-h", `${h}px`);
    s.setProperty("--pill-pad", c.pill_padding ?? (h >= 44 ? "0 16px" : "0 8px"));
    s.setProperty("--pill-font", c.font_size ?? (h >= 44 ? "15px" : "10.8px"));
    s.setProperty("--pill-icon", c.icon_color ?? "var(--primary-text-color)");
    s.setProperty("--last-gap", `${c.gap_before_last ?? 0}px`);
    s.setProperty("--gap", `${c.gap ?? 8}px`);
    s.setProperty("--icon-w", `${c.icon_width ?? h + 8}px`);
    s.setProperty("--fill", c.fill ?? "var(--primary-color)");
    s.setProperty("--ink", c.ink ?? "#fff");
    s.padding = c.padding ?? "0 12px 12px";
    const layout = ["pairs", "scroll"].includes(c.layout) ? c.layout : "row";
    this.$.className = `root ${layout}${c.compact ? " compact" : ""}`;
    this._pills = (c.pills || []).map((p) => ({
      p,
      active: typeof p.active === "string" ? compileExpr(p.active, "home-style-pills") : null,
      visible: compileExpr(p.visible, "home-style-pills"),
    }));
    this.$.replaceChildren(...this._pills.map(({ p }) => {
      const el = document.createElement("div");
      el.className = "pill";
      el.innerHTML = `${p.icon ? `<ha-icon icon="${esc(p.icon)}"></ha-icon>` : ""}<span></span>`;
      if (p.color) el.style.setProperty("--on-fill", p.color);
      if (p.icon_color) el.style.setProperty("--icon", p.icon_color);
      if (p.space_before) el.style.marginLeft = `${p.space_before}px`;
      el.onclick = () => runAction(this, this._hass, p.tap_action);
      return el;
    }));
  }
  _render() {
    const hass = this._hass;
    const run = (fn) => {
      try { return fn(...scope(this, hass, { ids: new Set(), time: false, all: false })); }
      catch (err) { console.warn(`home-style-pills: ${err.message}`); return null; }
    };
    [...this.$.children].forEach((el, i) => {
      const { p, active, visible } = this._pills[i];
      el.classList.toggle("on", !!(active ? run(active) : holds(hass, p.active)));
      el.hidden = visible ? !run(visible) : false;
      el.querySelector("span").textContent = pickName(hass, p.label ?? "", p.rename);
    });
  }
}

// ---------------------------------------------------------------------------------------------- home-style-now-playing

// One Now playing row: artwork (or an icon), a name, what's on, play/pause and a smaller grey next.
// { type: custom:home-style-now-playing, entity, name,
//   size: "small" (36 px art, compact lists) | "large" (64 px art, a player on its own),
//   lines: ["media_title"] | ["media_title", "media_artist"] | ["media_title", "app_name"] | ["source"],
//   controls: ["play_pause", "next"], control_sizes: [30, 22], control_widths: [36, 28] (tap targets),
//   icon: "mdi:speaker" (without artwork; default: the entity's own icon), tap_action: {...},
//   with: { names: { media_player.x: "Speaker X", ... }, rename: { media_player.y: { when, then } } },
//   coordinator_only: true,            (hidden while the speaker follows another group)
//   idle: { name: "Nothing playing", states: ["playing", "paused", "buffering"] } (one row for playing and idle) }
class HomeStyleNowPlaying extends HomeStyleBase {
  static css = `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .root { display: flex; align-items: center; box-sizing: border-box; cursor: pointer;
            -webkit-tap-highlight-color: transparent; }
    .small { height: 56px; padding: 0 12px 0 10px; gap: 10px; }
    .large { height: 96px; padding: 0 18px 0 16px; gap: 10px; }
    .art { flex: 0 0 auto; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center;
           background: var(--home-style-fill, rgba(120, 120, 128, 0.12)); color: var(--state-icon-color); }
    .small .art { width: 36px; height: 36px; --mdc-icon-size: 24px; }
    .large .art { width: 64px; height: 64px; --mdc-icon-size: 32px; color: #fff;
                  background: linear-gradient(160deg, #3a4a66, #1c2333); }
    .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .name { font-size: 14px; font-weight: 500; line-height: 22.4px; letter-spacing: 0.1px; color: var(--primary-text-color);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: 12px; font-weight: 400; line-height: 14.4px; letter-spacing: 0.4px; color: var(--primary-text-color);
           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .controls { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; }
    .controls button { all: unset; display: flex; align-items: center; justify-content: center; height: 44px; cursor: pointer;
                       -webkit-tap-highlight-color: transparent; }
    .controls button:active { opacity: 0.5; }
    .controls .main { width: 36px; color: var(--primary-text-color); }
    .controls .next { width: 28px; color: var(--secondary-text-color); }
  `;

  _configured() {
    const c = this._config;
    if (!c.entity) throw new Error("home-style-now-playing needs an entity");
    const [big, small] = c.control_sizes ?? [30, 22];
    const [wide, narrow] = c.control_widths ?? [36, 28];
    const ctl = c.controls ?? ["play_pause", "next"];
    this.$.className = `root ${c.size === "large" ? "large" : "small"}`;
    this.$.innerHTML = `<div class="art"></div><div class="text"><div class="name"></div><div class="sub"></div></div>`
      + `<div class="controls">`
      + (ctl.includes("play_pause") ? `<button class="main" style="--mdc-icon-size:${big}px;width:${wide}px"><ha-icon></ha-icon></button>` : "")
      + (ctl.includes("next") ? `<button class="next" style="--mdc-icon-size:${small}px;width:${narrow}px"><ha-icon icon="mdi:skip-next"></ha-icon></button>` : "")
      + `</div>`;
    if (!this._bound) { bindActions(this, this.$); this._bound = true; }
    const call = (svc) => (ev) => { ev.stopPropagation(); this._hass.callService("media_player", svc, { entity_id: c.entity }); };
    this.$.querySelector(".main")?.addEventListener("click", call("media_play_pause"));
    this.$.querySelector(".next")?.addEventListener("click", call("media_next_track"));
    this._pic = undefined;
  }

  _render() {
    const c = this._config, hass = this._hass, st = hass.states[c.entity];
    const a = st?.attributes || {};
    const members = a.group_members || [c.entity];
    this._setHidden(!!c.coordinator_only && members[0] !== c.entity);
    const idle = c.idle && !(c.idle.states || ["playing", "paused", "buffering"]).includes(st?.state);
    // what's on
    let sub = idle ? hass.formatEntityState?.(st) ?? st?.state ?? ""
                   : (c.lines ?? ["media_title"]).map((k) => (k === "source" ? a.source : a[k])).filter(Boolean).join(" · ");
    if (!idle && c.with) {
      const names = members.filter((m) => m !== c.entity)
        .map((m) => pickName(hass, c.with.names?.[m] ?? m, c.with.rename?.[m]));
      if (names.length) sub += ` · with ${names.join(", ")}`;
    }
    this.$.querySelector(".name").textContent = idle ? c.idle.name ?? "Nothing playing" : (c.name ?? a.friendly_name ?? "");
    this.$.querySelector(".sub").textContent = sub;
    // artwork, else the icon
    const pic = !idle && a.entity_picture ? a.entity_picture : null;
    if (pic !== this._pic) {
      this._pic = pic;
      this.$.querySelector(".art").innerHTML = pic ? `<img src="${esc(pic)}" alt="">`
        : c.icon ? `<ha-icon icon="${esc(c.icon)}"></ha-icon>`
        : "<ha-state-icon></ha-state-icon>";  // the entity's own icon, as a tile shows it
    }
    const own = this.$.querySelector(".art ha-state-icon");
    if (own) { own.hass = hass; own.stateObj = st; }
    const main = this.$.querySelector(".main ha-icon");
    if (main) main.icon = st?.state === "playing" ? "mdi:pause" : "mdi:play";
  }
}

// ---------------------------------------------------------------------------------------------- home-style-tile

// HA's own tile card with the Home Style look built in, so the first frame is already right and nothing waits for
// the server: tabular digits, an icon circle only where the icon switches something (a light that is on fills
// it), a chevron on tiles that open a page, and a second line, colour, bar or check mark worked out in the
// browser. Jinja in a UIX style is rendered by the server and lands late, worst when a phone app comes back from
// the background; these expressions run on the states the browser already has.
//
// { type: custom:home-style-tile, ...every tile option,
//   secondary: "expr",                 the second line, replacing the state (null shows the state again)
//   tint: "expr",                      the tile colour from an expression (any CSS colour): symbol, filled circle,
//                                      bar; the tile's own color option still works for a fixed colour
//   bar: { value: "expr", color: "expr", place: "bottom" | "right" },
//                                      0–100, null for no bar. bottom: an 8 px bar under the text across the
//                                      row; right: an 80 × 6 px bar at the right end of a normal row
//   check: "expr",                     a round mark on the right: blue with a tick when true, an empty ring when false
//   chevron: false,                    (default: a chevron when the tap opens a page and the right end is free)
//   marquee: true,                     a second line too long for the row slides sideways instead of ending in "…"
//   icon_circle: true | false,         (default: a circle only when tapping the icon switches something)
//   vars: { name: "expr" },            --hs-<name> on the card, for a one-off UIX rule
//   flags: { name: "expr" } }          an hs-<name> attribute on the card while true, for a one-off UIX rule
//
// Expressions are JavaScript. They see:
//   state(id)  num(id, fallback)  isnum(id)  attr(id, name)  is(id, ...states)  on(id)  has(id)  label(id)
//   since(id) (last change, a Date)  time(x) (a Date from an ISO string or epoch seconds)  now()
//   fmt(t, "%a %H:%M")  hm(t)  when(t) ("11:36" today, "Fri 09:47" this week, else "3 Nov")
//   fixed(x, digits)  clamp(x, lo, hi)  power(watts) ("850 W" / "2.6 kW")  list(items) (non-empty, unique, " · ")
//   cap(text) (first letter capital, the rest lower)
//   entity (this tile's), self (its state object), user (the viewer's name), hass
// A tile runs them again when an entity they read changes, and every 30 s when they use the time.
//
// HA internals used: the hui-tile-card class (extended), ha-tile-icon's --tile-icon-opacity, ha-tile-info's slots.

const CONTROL_DOMAINS = ["light", "switch", "fan", "cover", "lock", "valve", "climate", "media_player", "input_boolean",
  "humidifier", "vacuum", "lawn_mower", "water_heater", "siren", "button", "input_button", "script", "scene",
  "automation", "remote"];
const SWITCHING = ["toggle", "perform-action", "call-service"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const NAMES = ["state", "num", "isnum", "attr", "is", "on", "has", "label", "since", "time", "now", "fmt", "hm", "when",
  "fixed", "clamp", "power", "list", "cap", "entity", "self", "user", "hass"];

function toDate(x) {
  if (x == null || x === "" || x === "unknown" || x === "unavailable") return null;
  const d = x instanceof Date ? x : new Date(typeof x === "number" ? x * 1000 : x);
  return isNaN(d) ? null : d;
}

// strftime for the codes a dashboard needs: %H %M %S %d %-d %m %-m %Y %a %A %b %B %%.
function fmt(t, pattern) {
  const d = toDate(t);
  if (!d) return "";
  const map = { H: pad(d.getHours()), M: pad(d.getMinutes()), S: pad(d.getSeconds()), d: pad(d.getDate()),
    "-d": d.getDate(), m: pad(d.getMonth() + 1), "-m": d.getMonth() + 1, Y: d.getFullYear(),
    a: DAYS[d.getDay()].slice(0, 3), A: DAYS[d.getDay()], b: MONTHS[d.getMonth()].slice(0, 3), B: MONTHS[d.getMonth()],
    "%": "%" };
  return pattern.replace(/%(-?[a-zA-Z%])/g, (m, k) => (k in map ? map[k] : m));
}

function when(t) {
  const d = toDate(t);
  if (!d) return "";
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(new Date()) - day(d)) / 86400000);
  return days === 0 ? fmt(d, "%H:%M") : days < 7 ? fmt(d, "%a %H:%M") : fmt(d, "%-d %b");
}

// The helpers for one run, in NAMES order. They record what the expression read, so the tile knows when to run
// it again.
function scope(card, hass, seen) {
  const get = (id) => { seen.ids.add(id); return hass.states[id]; };
  const state = (id) => get(id)?.state ?? "unknown";
  return [
    state,
    (id, fallback = NaN) => { const v = parseFloat(state(id)); return isNaN(v) ? fallback : v; },
    (id) => state(id) !== "" && !isNaN(Number(state(id))),
    (id, name) => get(id)?.attributes?.[name] ?? null,
    (id, ...states) => states.includes(state(id)),
    (id) => state(id) === "on",
    (id) => !!get(id) && !["unknown", "unavailable"].includes(state(id)),
    (id) => { const st = get(id); return st ? hass.formatEntityState?.(st) ?? st.state : ""; },
    (id) => toDate(get(id)?.last_changed),
    toDate,
    () => { seen.time = true; return new Date(); },
    fmt,
    (t) => fmt(t, "%H:%M"),
    (t) => { seen.time = true; return when(t); },
    (x, digits = 0) => Number(x).toFixed(digits),
    (x, lo = 0, hi = 100) => Math.min(Math.max(Number(x) || 0, lo), hi),
    (w) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`),
    (items) => [...new Set(items.filter((x) => x != null && x !== "" && x !== false))].join(" · "),
    (text) => { const t = String(text ?? ""); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); },
    card._config.entity,
    get(card._config.entity),
    hass.user?.name ?? "",
    new Proxy(hass, { get: (o, k) => { seen.all = true; return o[k]; } }),
  ];
}

// An expression as a function of the helpers; a broken one logs and yields null.
function compileExpr(expr, who) {
  if (expr == null) return null;
  try { return new Function(...NAMES, `return (${expr});`); }
  catch (err) { console.warn(`${who}: ${err.message} in ${expr}`); return () => null; }
}

// A CSS string for content: (quotes and backslashes escaped, line breaks as \A).
const cssString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`;

const TILE_CSS = `
  ha-card { font-variant-numeric: tabular-nums; }
  /* Icon circles only where the icon switches something; a light that is on fills its circle, white symbol. */
  :host(:not([hs-circle])) ha-tile-icon { --tile-icon-opacity: 0; --tile-icon-hover-opacity: 0; }
  :host([hs-fill]) ha-tile-icon { --tile-icon-opacity: 1; --tile-icon-hover-opacity: 1; }
  :host([hs-fill]) ha-tile-icon ha-state-icon { color: #fff; }
  :host([hs-color]) ha-card { --tile-color: var(--hs-color) !important; }
  :host([hs-chevron]) ha-card, :host([hs-bar]) ha-card, :host([hs-check]) ha-card { position: relative; }
  /* A tile that opens a page: a light grey chevron on the right, as in settings lists. */
  :host([hs-chevron]) ha-tile-info { padding-right: 18px; }
  :host([hs-chevron]) ha-card::after {
    content: ""; position: absolute; right: 20px; top: 28px; width: 7px; height: 7px; margin-top: -5px;
    border-top: 2px solid var(--secondary-text-color); border-right: 2px solid var(--secondary-text-color);
    transform: rotate(45deg); opacity: 0.45; pointer-events: none;
  }
  /* The second line from the expression; the tile's own state stays hidden. */
  :host([hs-secondary]) ha-tile-info span[slot=secondary] state-display { display: none; }
  :host([hs-secondary]) ha-tile-info span[slot=secondary]::after { content: var(--hs-secondary); }
  /* Marquee: ha-tile-info is the size container (Safari resolves the ::after's cqw against the viewport when the
     span is). Waits 3 s, slides until the end shows, waits, slides back; a line that fits stays still. */
  :host([hs-marquee]) ha-tile-info { container-type: inline-size; }
  :host([hs-marquee]) ha-tile-info span[slot=secondary] { display: block; overflow: hidden; }
  :host([hs-marquee]) ha-tile-info span[slot=secondary]::after {
    display: inline-block; white-space: nowrap; animation: hs-marquee 14s ease-in-out 3s infinite;
  }
  @keyframes hs-marquee { 0%, 20% { transform: translateX(0); }
    60%, 85% { transform: translateX(min(0px, calc(100cqw - 100%))); } 100% { transform: translateX(0); } }
  @media (prefers-reduced-motion: reduce) {
    :host([hs-marquee]) ha-tile-info span[slot=secondary]::after { animation: none; }
  }
  /* Bars: filled to --hs-bar in --hs-bar-color (else the tile colour) on the grey fill. */
  :host([hs-bar]) ha-card::after {
    content: ""; position: absolute; pointer-events: none;
    background: linear-gradient(to right, var(--hs-bar-color, var(--tile-color)) var(--hs-bar, 0%),
                var(--home-style-fill, rgba(120, 120, 128, 0.24)) 0);
  }
  :host([hs-bar=bottom]) ha-card { padding-bottom: 20px !important; }
  :host([hs-bar=bottom]) ha-card::after { left: 16px; right: 16px; bottom: 14px; height: 8px; border-radius: 4px; }
  :host([hs-bar=right]) ha-tile-info { padding-right: 96px; }
  :host([hs-bar=right]) ha-card::after { right: 16px; top: 50%; width: 80px; height: 6px; margin-top: -3px; border-radius: 3px; }
  /* Pick lists: an empty ring, or a blue disc with a white tick. */
  :host([hs-check]) ha-card::after {
    content: ""; position: absolute; right: 16px; top: 50%; width: 22px; height: 22px; margin-top: -11px;
    border-radius: 50%; box-sizing: border-box; pointer-events: none;
    border: 1.5px solid var(--secondary-text-color); opacity: 0.45;
  }
  :host([hs-check][hs-checked]) ha-card::after {
    opacity: 1; border: none; background: var(--primary-color) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'%3E%3Cpath d='M6.5 11.5l3 3 6-6.5' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 22px no-repeat;
  }
`;

function defineTile(Tile) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(TILE_CSS);

  class HomeStyleTile extends Tile {
    static get styles() { return [...[super.styles].flat(), sheet]; }

    setConfig(config) {
      super.setConfig(config);
      const c = config, domain = c.entity.split(".")[0];
      const compile = (expr) => compileExpr(expr, `home-style-tile ${c.entity}`);
      this._hs = {
        secondary: compile(c.secondary), tint: compile(c.tint), check: compile(c.check),
        bar: c.bar ? { value: compile(c.bar.value), color: compile(c.bar.color) } : null,
        vars: Object.entries(c.vars || {}).map(([k, v]) => [k, compile(v)]),
        flags: Object.entries(c.flags || {}).map(([k, v]) => [k, compile(v)]),
        seen: null, states: null, read: null,
      };
      const opens = c.tap_action?.action === "navigate" && c.features_position !== "inline";
      const circle = c.icon_circle ?? (CONTROL_DOMAINS.includes(domain)
        && SWITCHING.includes(c.icon_tap_action?.action ?? "toggle"));
      this.toggleAttribute("hs-circle", circle);
      this.toggleAttribute("hs-chevron", (c.chevron ?? opens) && !c.bar && c.check == null);
      this.toggleAttribute("hs-marquee", !!c.marquee);
      this.toggleAttribute("hs-check", c.check != null);
      this._hsBarPlace = c.bar ? (c.bar.place === "right" ? "right" : "bottom") : null;
      if (!c.bar) this.removeAttribute("hs-bar");
      this._hsLight = circle && domain === "light";
      if (this.hass) this._hsRun(true);
    }

    willUpdate(changed) {
      super.willUpdate?.(changed);
      if (changed.has("hass") && this.hass) this._hsRun(false);
    }

    connectedCallback() {
      super.connectedCallback();
      if (this._hs?.seen?.time) this._hsTick();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      clearInterval(this._hsTimer);
      this._hsTimer = null;
    }

    _hsTick() {
      if (!this._hsTimer && this.isConnected) this._hsTimer = setInterval(() => this._hsRun(true), 30000);
    }

    _hsRun(force) {
      const hs = this._hs, hass = this.hass;
      if (!hs || !hass) return;
      this.toggleAttribute("hs-fill", this._hsLight && hass.states[this._config.entity]?.state === "on");
      // Run again only when a state an expression read has changed (HA replaces a state object on change).
      if (!force && hs.seen && !hs.seen.all
          && (hs.states === hass.states || [...hs.seen.ids].every((id) => hass.states[id] === hs.read[id]))) {
        hs.states = hass.states;
        return;
      }
      const seen = { ids: new Set(), time: false, all: false };
      const args = scope(this, hass, seen);
      const run = (fn) => {
        if (!fn) return null;
        try { return fn(...args); }
        catch (err) { console.warn(`home-style-tile ${this._config.entity}: ${err.message}`); return null; }
      };
      const set = (name, value) => (value == null || value === "" ? this.style.removeProperty(name)
                                                                    : this.style.setProperty(name, value));
      const text = run(hs.secondary);
      this.toggleAttribute("hs-secondary", text != null);
      set("--hs-secondary", text == null ? null : cssString(text));
      const color = run(hs.tint);
      this.toggleAttribute("hs-color", !!color);
      set("--hs-color", color || null);
      if (hs.bar) {
        const value = run(hs.bar.value);
        if (value == null) this.removeAttribute("hs-bar");
        else this.setAttribute("hs-bar", this._hsBarPlace);
        set("--hs-bar", `${Math.round(Math.min(Math.max(Number(value) || 0, 0), 100))}%`);
        set("--hs-bar-color", run(hs.bar.color));
      }
      if (hs.check) this.toggleAttribute("hs-checked", !!run(hs.check));
      for (const [k, fn] of hs.vars) set(`--hs-${k}`, run(fn));
      for (const [k, fn] of hs.flags) this.toggleAttribute(`hs-${k}`, !!run(fn));
      hs.seen = seen;
      hs.states = hass.states;
      hs.read = Object.fromEntries([...seen.ids].map((id) => [id, hass.states[id]]));
      if (seen.time) this._hsTick();
    }
  }
  customElements.define("home-style-tile", HomeStyleTile);
}

// HA loads its tile card on first use: make one so it loads, then extend it.
(async () => {
  if (!customElements.get("hui-tile-card")) {
    (await window.loadCardHelpers?.())?.createCardElement({ type: "tile", entity: "sun.sun" });
  }
  defineTile(await customElements.whenDefined("hui-tile-card"));
})();


// ---------------------------------------------------------------------------------------------- home-style-text

// A line of text worked out in the browser (the page subtitle under a large title, "Today 12.9 kWh used"), in
// place of a markdown card whose template the server renders and sends late. Same expressions as home-style-tile.
// { type: custom:home-style-text, content: "expr", entity: (optional, for `entity` and `self`),
//   style: "subtitle" (grey 15/20 px, 4 px under the title; the default) | "plain" (the text colour)
//          | "caption" (a bold title over a grey 13 px line, inset like a tile; under a picture in a group),
//   title: "Front door",           a bold line above (the caption style),
//   icon: "expr",                  an icon before the text that stays put (an expression giving its name),
//   marquee: true,                 one line; when too long it slides to its end and back,
//   padding: "0 4px", margin_top: -4,   the line's inset and its distance from the card above,
//   tap_action: {...} }
class HomeStyleText extends HomeStyleBase {
  static css = `
    :host { display: block; }
    .root { padding: 0 4px; font-size: 15px; line-height: 20px; white-space: pre-line;
            font-variant-numeric: tabular-nums; color: var(--primary-text-color); }
    .root.subtitle { margin-top: -4px; color: var(--secondary-text-color); }
    .root.caption { padding: 12px 16px 14px; font-size: 13px; line-height: 18px; color: var(--secondary-text-color); }
    .root.link { cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .title { font-size: 16px; font-weight: 600; line-height: 20px; margin-bottom: 2px; color: var(--primary-text-color); }
    .title:empty { display: none; }
    .line { display: flex; align-items: center; }
    .line ha-icon { --mdc-icon-size: 18px; flex: 0 0 auto; margin-right: 12px; }
    .line ha-icon:not([icon]) { display: none; }
    .text { flex: 1 1 auto; min-width: 0; }
    .marquee .text { overflow: hidden; white-space: nowrap; container-type: inline-size; }
    .marquee .text span { display: inline-block; animation: hs-marquee 14s ease-in-out 3s infinite; }
    @keyframes hs-marquee { 0%, 20% { transform: translateX(0); }
      60%, 85% { transform: translateX(min(0px, calc(100cqw - 100%))); } 100% { transform: translateX(0); } }
    @media (prefers-reduced-motion: reduce) { .marquee .text span { animation: none; } }
  `;

  _configured() {
    const c = this._config;
    this._fn = compileExpr(c.content, "home-style-text");
    this._icon = compileExpr(c.icon, "home-style-text");
    const style = ["plain", "caption"].includes(c.style) ? c.style : "subtitle";
    const link = c.tap_action && c.tap_action.action !== "none";
    this.$.className = `root ${style}${c.marquee ? " marquee" : ""}${link ? " link" : ""}`;
    this.$.style.padding = c.padding ?? "";
    this.$.style.marginTop = c.margin_top != null ? `${c.margin_top}px` : "";
    this.$.innerHTML = '<div class="title"></div><div class="line"><ha-icon></ha-icon><div class="text"><span></span></div></div>';
    this.$.querySelector(".title").textContent = c.title ?? "";
    if (link && !this._bound) { bindActions(this, this.$, { action: "none" }); this._bound = true; }
    this._read = null;
  }

  _render() {
    const hass = this._hass;
    // Again only when a state it read has changed (or every 30 s when it uses the time).
    if (this._read && !this._read.all && !this._read.force
        && [...this._read.ids].every((id) => hass.states[id] === this._read.states[id])) return;
    const seen = { ids: new Set(), time: false, all: false };
    let text = null, icon = null;
    try {
      const args = scope(this, hass, seen);
      text = this._fn?.(...args);
      icon = this._icon?.(...args);
    } catch (err) { console.warn(`home-style-text: ${err.message}`); }
    this.$.querySelector(".text span").textContent = text ?? "";
    const el = this.$.querySelector("ha-icon");
    if (icon) el.setAttribute("icon", icon); else el.removeAttribute("icon");
    this._read = { ...seen, states: Object.fromEntries([...seen.ids].map((id) => [id, hass.states[id]])) };
    if (seen.time && !this._timer) {
      this._timer = setInterval(() => { if (this._read) this._read.force = true; this._render(); }, 30000);
    }
  }

  connectedCallback() {
    if (this._read?.time && !this._timer && this._hass) this._render();
  }

  disconnectedCallback() { clearInterval(this._timer); this._timer = null; }

  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

// ---------------------------------------------------------------------------------------------- home-style-picture

// A photo that follows a state without a server template: a room's picture that greys while the room is empty,
// or a person's round picture with a badge while they are home.
// { type: custom:home-style-picture,
//   image: "/local/room.jpg" | entity: person.x (its entity_picture),
//   dim: "expression",             greyed and darker while true (fades),
//   aspect: "16 / 9",              a fixed shape; without it the picture fills the card's grid rows,
//   avatar: 44,                    a round picture this many px wide, at the card's right edge,
//   badge: { icon, color, visible: "expression" }   (with avatar: a small round badge at its top right),
//   tap_action: {...} }
class HomeStylePicture extends HomeStyleBase {
  static css = `
    :host { display: block; height: 100%; }
    .root { position: relative; height: 100%; overflow: hidden; border-radius: var(--ha-card-border-radius, 20px); }
    .root.aspect { height: auto; }
    img { display: block; width: 100%; height: 100%; object-fit: cover; transition: filter .3s; }
    .aspect img { height: auto; aspect-ratio: var(--aspect); }
    .dim img { filter: saturate(.2) brightness(.8); }
    .root.avatar { overflow: visible; border-radius: 0; display: flex; justify-content: flex-end; align-items: center; }
    .avatar .pic { position: relative; width: var(--size); height: var(--size); }
    .avatar img { border-radius: 50%; }
    .badge { position: absolute; top: -3px; right: -3px; width: 18px; height: 18px; border-radius: 50%;
             display: flex; align-items: center; justify-content: center; background: var(--badge); color: #fff; }
    .badge ha-icon { --mdc-icon-size: 12px; display: flex; }
    .badge[hidden] { display: none; }
    .link { cursor: pointer; -webkit-tap-highlight-color: transparent; }
  `;

  _configured() {
    const c = this._config;
    this._dim = compileExpr(c.dim, "home-style-picture");
    this._badge = compileExpr(c.badge?.visible, "home-style-picture");
    const link = c.tap_action && c.tap_action.action !== "none";
    this.$.className = `root${c.aspect ? " aspect" : ""}${c.avatar ? " avatar" : ""}${link ? " link" : ""}`;
    if (c.aspect) this.$.style.setProperty("--aspect", c.aspect);
    if (c.avatar) this.$.style.setProperty("--size", `${c.avatar}px`);
    this.$.innerHTML = `<div class="pic" style="width:100%;height:100%"><img alt="">${c.badge
      ? `<div class="badge" style="--badge:${esc(c.badge.color ?? "var(--green-color, #34c759)")}"><ha-icon icon="${esc(c.badge.icon ?? "mdi:home")}"></ha-icon></div>`
      : ""}</div>`;
    if (c.avatar) this.$.querySelector(".pic").removeAttribute("style");
    if (c.image) this.$.querySelector("img").src = c.image;
    if (link && !this._bound) { bindActions(this, this.$, { action: "none" }); this._bound = true; }
  }

  _render() {
    const c = this._config, hass = this._hass;
    const run = (fn) => {
      if (!fn) return null;
      try { return fn(...scope(this, hass, { ids: new Set(), time: false, all: false })); }
      catch (err) { console.warn(`home-style-picture: ${err.message}`); return null; }
    };
    if (c.entity) {
      const src = hass.states[c.entity]?.attributes?.entity_picture;
      const img = this.$.querySelector("img");
      if (src && img.getAttribute("src") !== src) img.src = src;
    }
    this.$.classList.toggle("dim", !!run(this._dim));
    const badge = this.$.querySelector(".badge");
    if (badge) badge.hidden = this._badge ? !run(this._badge) : false;
  }

  getGridOptions() { return { columns: 12, rows: "auto" }; }
}

customElements.define("home-style-group", HomeStyleGroup);
customElements.define("home-style-volume", HomeStyleVolume);
customElements.define("home-style-heading", HomeStyleHeading);
customElements.define("home-style-pills", HomeStylePills);
customElements.define("home-style-now-playing", HomeStyleNowPlaying);
customElements.define("home-style-text", HomeStyleText);
customElements.define("home-style-picture", HomeStylePicture);

window.customCards = window.customCards || [];
for (const part of ["group", "volume", "heading", "pills", "now-playing", "tile", "text", "picture"]) {
  window.customCards.push({ type: `home-style-${part}`, name: `Home Style ${part.replace("-", " ")}`,
                            description: "Home Style dashboard card" });
}
