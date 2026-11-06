// Home Style cards: a dashboard's repeated patterns as small cards that carry their own CSS, so the first
// frame is already right (UIX styles land 100 ms+ later per nested element and showed HA's plain cards
// first). They compose HA's own pieces (hui-card, ha-control-slider, ha-icon) and read the theme's
// variables; one-off styling stays in UIX.
//
// Install through the Home Assistant Marketplace (custom repository, type Dashboard); see README.md.
// The cards read the Home Style theme's variables and fall back to Home Assistant's defaults without it.
//
// HA internals used (not public API; check after HA upgrades): hui-card (card wrapper with visibility),
// ha-control-slider (value-changed event, `pressed`), ha-icon, ha-state-icon, the hass-more-info and
// location-changed events.
//
// Cards: home-style-group, home-style-volume, home-style-heading, home-style-pills, home-style-now-playing.

const VERSION = "0.1.0";
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
//   member_of: media_player.x        (only while grouped with that player),
//   coordinator_only: true           (hidden while the speaker follows another group),
//   rename: { when: {entity, state}, then: "Other name" } }
class HomeStyleVolume extends HomeStyleBase {
  static css = `
    :host { display: block; }
    :host([hidden]) { display: none !important; }
    .root { position: relative; display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 16px;
            font-size: 13px; color: var(--secondary-text-color); }
    .root.divider::before { content: ""; position: absolute; top: 0; left: 16px; right: 16px;
            border-top: 0.5px solid var(--home-style-separator, rgba(60, 60, 67, 0.18)); }
    .name { flex: 0 0 auto; }
    ha-control-slider { flex: 1 1 auto; height: 8px; --control-slider-thickness: 8px; --control-slider-border-radius: 4px;
      --control-slider-color: var(--state-media_player-active-color, #8e8e93);
      --control-slider-background: var(--state-media_player-active-color, #8e8e93);
      --control-slider-background-opacity: 0.2; }
    .pct { flex: 0 0 auto; min-width: 32px; text-align: right; }
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
    this.$.classList.toggle("divider", !!c.divider);
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

// Labelled capsule buttons (actions, favourites, choices): bold, grey fill; a selected
// pill fills blue with a white icon and white label.
// { type: custom:home-style-pills,
//   pills: [{ label, icon, tap_action, active: <when>, rename: { when, then } }],
//   layout: "row" (one stretched row) | "pairs" (two per row; the last pill takes a full row, a lone
//           pill before it sits centred at half width), gap_before_last: 12 (extra px above the last row),
//   size: 36 | 44, font_size: "10.8px", padding: "0 12px 12px", icon_color: "var(--secondary-text-color)" }
class HomeStylePills extends HomeStyleBase {
  static css = `
    :host { display: block; }
    .root { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; box-sizing: border-box; }
    .pill { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; box-sizing: border-box;
            height: var(--pill-h); border-radius: calc(var(--pill-h) / 2); padding: 0 var(--pill-pad);
            background: var(--home-style-fill, rgba(120, 120, 128, 0.12)); color: var(--primary-text-color);
            font-size: var(--pill-font); font-weight: 600; cursor: pointer; user-select: none;
            -webkit-tap-highlight-color: transparent; }
    .pill span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill ha-icon { --mdc-icon-size: 20px; color: var(--pill-icon); flex: 0 0 auto; }
    .pill.on { background: var(--primary-color); color: #fff; }
    .pill.on ha-icon { color: #fff; }
    .pill:active { opacity: 0.6; }
    .row .pill { flex: 1 1 0; }
    .pairs .pill { flex: 0 0 calc((100% - 8px) / 2); }
    .pairs .pill:last-child { flex: 0 0 100%; margin-top: var(--last-gap); }
  `;
  _configured() {
    const c = this._config;
    const h = c.size ?? 36;
    const s = this.$.style;
    s.setProperty("--pill-h", `${h}px`);
    s.setProperty("--pill-pad", h >= 44 ? "16px" : "8px");
    s.setProperty("--pill-font", c.font_size ?? (h >= 44 ? "15px" : "10.8px"));
    s.setProperty("--pill-icon", c.icon_color ?? "var(--primary-text-color)");
    s.setProperty("--last-gap", `${c.gap_before_last ?? 0}px`);
    s.padding = c.padding ?? "0 12px 12px";
    this.$.className = `root ${c.layout === "pairs" ? "pairs" : "row"}`;
    this.$.replaceChildren(...(c.pills || []).map((p) => {
      const el = document.createElement("div");
      el.className = "pill";
      el.innerHTML = `${p.icon ? `<ha-icon icon="${esc(p.icon)}"></ha-icon>` : ""}<span></span>`;
      el.onclick = () => runAction(this, this._hass, p.tap_action);
      return el;
    }));
  }
  _render() {
    const pills = this._config.pills || [];
    [...this.$.children].forEach((el, i) => {
      const p = pills[i];
      el.classList.toggle("on", holds(this._hass, p.active));
      el.querySelector("span").textContent = pickName(this._hass, p.label, p.rename);
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
    this.$.onclick = () => runAction(this, this._hass, c.tap_action ?? { action: "more-info" }, c.entity);
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

customElements.define("home-style-group", HomeStyleGroup);
customElements.define("home-style-volume", HomeStyleVolume);
customElements.define("home-style-heading", HomeStyleHeading);
customElements.define("home-style-pills", HomeStylePills);
customElements.define("home-style-now-playing", HomeStyleNowPlaying);

window.customCards = window.customCards || [];
for (const part of ["group", "volume", "heading", "pills", "now-playing"]) {
  window.customCards.push({ type: `home-style-${part}`, name: `Home Style ${part.replace("-", " ")}`,
                            description: "Home Style dashboard card" });
}
