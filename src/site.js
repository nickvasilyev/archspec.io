// Docs: highlight the section in view in the contents, and close the contents on small screens.
(() => {
  const nav = document.querySelector(".docs-nav");
  if (!nav) return;
  const details = nav.querySelector("details");
  const small = matchMedia("(max-width: 1000px)");
  if (small.matches) details.removeAttribute("open");
  nav.addEventListener("click", (e) => { if (e.target.closest("a") && small.matches) details.removeAttribute("open"); });

  const links = new Map([...nav.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
  const heads = [...document.querySelectorAll(".doc h2[id]")];
  let current = null;
  const mark = (id) => {
    if (id === current) return;
    if (current && links.get(current)) links.get(current).classList.remove("on");
    current = id;
    const a = links.get(id);
    if (!a) return;
    a.classList.add("on");
    if (!small.matches) a.scrollIntoView({ block: "nearest" });
  };
  const update = () => {
    let id = heads[0] && heads[0].id;
    for (const h of heads) if (h.getBoundingClientRect().top < 120) id = h.id;
    mark(id);
  };
  addEventListener("scroll", update, { passive: true });
  update();
})();

// Landing page scenes. Each scene has numbered states: render(i) shows one instantly, and
// animate(from, to, t) plays the change between them. A scene plays while it is on screen,
// stops when clicked, and doesn't start by itself for people who prefer reduced motion.
(() => {
  const scenes = document.querySelectorAll(".scene[data-scene]");
  if (!scenes.length) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CANCEL = Symbol("cancel");

  function run(el, def) {
    const play = el.querySelector(".play");
    let i = 0, playing = !reduce, visible = false, token = 0, looping = false;
    const live = (tok) => { if (tok !== token) throw CANCEL; };
    // Steps that run alongside others aren't awaited, so mark every step as handled: a
    // cancelled one would otherwise be logged as an uncaught rejection.
    const handled = (p) => { p.catch(() => {}); return p; };
    const t = (tok) => ({
      wait: (ms) => handled(new Promise((ok) => setTimeout(ok, ms)).then(() => live(tok))),
      anim: (node, frames, opts) => { const a = node.animate(frames, { fill: "forwards", easing: "cubic-bezier(.4, 0, .2, 1)", ...opts }); return handled(a.finished.then(() => live(tok), () => live(tok))); },
    });
    const paint = () => {
      el.classList.toggle("paused", !playing);
      el.classList.toggle("still", reduce && !playing);
      play.classList.toggle("paused", !playing);
      play.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
    };
    const stop = () => { token++; looping = false; def.render(i); };
    async function loop() {
      if (looping || !playing || !visible || document.hidden) return;
      looping = true;
      const tok = ++token, step = t(tok);
      try {
        for (;;) {
          await step.wait(def.hold(i));
          const next = (i + 1) % def.count;
          await def.animate(i, next, step);
          i = next;
          def.render(i);
        }
      } catch (e) { if (e !== CANCEL) throw e; }
    }
    play.addEventListener("click", () => { playing = !playing; paint(); if (playing) loop(); else stop(); });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i] > button, button[data-i]");
      if (!b) return;
      playing = false; paint(); stop();
      i = Number((b.closest("[data-i]")).dataset.i);
      def.render(i);
    });
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) loop(); else if (looping) stop();
    }, { threshold: .35 }).observe(el);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { if (looping) stop(); } else loop(); });
    paint();
    def.render(0);
  }

  const shown = (root) => [...root.querySelectorAll(".svg")].find((s) => s.getClientRects().length) || root;
  const rectIn = (node, box) => { const r = node.getBoundingClientRect(), b = box.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height }; };

  const defs = {
    // 01: click a box to open it, twice, then go back up
    drill(el) {
      const stage = el.querySelector(".stage"), layers = [...el.querySelectorAll(".layer")];
      const crumbs = [...el.querySelectorAll(".crumbs li")], cursor = el.querySelector(".cursor"), ripple = el.querySelector(".ripple");
      const caption = el.querySelector(".caption");
      const captions = [
        "The business view: who uses which system, in plain words.",
        "Inside Order Processing Engine: its services, queues and databases, with the systems it talks to at the sides.",
        "Inside Order Processing API: its endpoint, the outbox relay and the database it owns.",
      ];
      let pos = null;
      const render = (i) => {
        layers.forEach((l, k) => { l.getAnimations().forEach((a) => a.cancel()); l.classList.toggle("on", k === i); l.classList.remove("out"); });
        el.querySelectorAll(".hit").forEach((n) => n.classList.remove("hit"));
        [cursor, ripple].forEach((n) => n.getAnimations().forEach((a) => a.cancel()));
        crumbs.forEach((c, k) => { c.classList.toggle("on", k === i); c.classList.toggle("past", k < i); });
        caption.textContent = captions[i];
        if (i === 0) pos = null;
      };
      async function animate(from, to, t) {
        const W = stage.clientWidth, H = stage.clientHeight, cur = layers[from], next = layers[to];
        if (to === from + 1) {
          const node = shown(cur).querySelector(`[data-node="${CSS.escape(cur.dataset.open)}"]`);
          const r = rectIn(node, stage), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          const start = pos || { x: W * .82, y: H * .9 };
          await t.anim(cursor, [{ opacity: 0, transform: `translate(${start.x}px, ${start.y}px)` }, { opacity: 1, transform: `translate(${start.x}px, ${start.y}px)`, offset: .15 }, { opacity: 1, transform: `translate(${cx}px, ${cy}px)` }], { duration: 1100 });
          pos = { x: cx, y: cy };
          node.classList.add("hit");
          t.anim(ripple, [{ opacity: 1, transform: `translate(${cx}px, ${cy}px) scale(.3)` }, { opacity: 0, transform: `translate(${cx}px, ${cy}px) scale(1.5)` }], { duration: 550, easing: "ease-out" });
          await t.wait(500);
          caption.textContent = captions[to];
          crumbs[to].classList.add("on"); crumbs[from].classList.replace("on", "past");
          cur.classList.add("out"); next.classList.add("on");
          const kx = W / r.w, ky = H / r.h;
          t.anim(cursor, [{ opacity: 1, transform: `translate(${cx}px, ${cy}px)` }, { opacity: 0, transform: `translate(${cx}px, ${cy}px)` }], { duration: 250 });
          t.anim(cur, [{ transform: "none", opacity: 1 }, { transform: `translate(${-r.x * kx}px, ${-r.y * ky}px) scale(${kx}, ${ky})`, opacity: 0 }], { duration: 750 });
          await t.anim(next, [{ transform: `translate(${r.x}px, ${r.y}px) scale(${r.w / W}, ${r.h / H})`, opacity: 0 }, { opacity: 1, offset: .5 }, { transform: "none", opacity: 1 }], { duration: 750 });
        } else {
          caption.textContent = "Back up to the business view.";
          crumbs.forEach((c, k) => { c.classList.toggle("on", k === to); c.classList.toggle("past", k < to); });
          cur.classList.add("out"); next.classList.add("on");
          t.anim(cur, [{ transform: "none", opacity: 1 }, { transform: `translate(${W * .2}px, ${H * .2}px) scale(.6)`, opacity: 0 }], { duration: 650 });
          await t.anim(next, [{ transform: `translate(${-W * .1}px, ${-H * .1}px) scale(1.2)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 650 });
        }
      }
      return { count: layers.length, render, animate, hold: (i) => [2600, 2600, 3200][i] };
    },

    // 02: type a shortcut into the spec; the findings follow
    check(el) {
      const ins = [...el.querySelectorAll(".ins")], after = [...el.querySelectorAll("[data-shift] .no")];
      const states = [...el.querySelectorAll(".state")], caption = el.querySelector(".caption");
      const captions = ["A clean design: no errors.", "Three errors, each pointing at the line to fix, before anyone writes code."];
      const lines = (on) => {
        ins.forEach((l) => { l.classList.toggle("shown", on); l.classList.remove("typing"); l.querySelector(".txt").textContent = on ? l.dataset.text : ""; });
        after.forEach((n) => { n.textContent = on ? n.dataset.b : n.dataset.a; });
      };
      const state = (i) => states.forEach((s, k) => s.classList.toggle("on", k === i));
      const render = (i) => { lines(i === 1); state(i); caption.textContent = captions[i]; };
      async function animate(from, to, t) {
        if (to === 1) {
          caption.textContent = "A shortcut: the fulfillment worker reads the orders database directly.";
          after.forEach((n) => { n.textContent = n.dataset.b; });
          for (const l of ins) {
            const txt = l.querySelector(".txt"), text = l.dataset.text;
            l.classList.add("shown", "typing");
            for (let k = 1; k <= text.length; k++) {
              txt.textContent = text.slice(0, k);
              await t.wait(text[k - 1] === " " && k < 5 ? 0 : 28 + Math.random() * 40);
            }
            await t.wait(160);
            l.classList.remove("typing");
          }
          await t.wait(500);
          state(1);
          caption.textContent = captions[1];
        } else {
          caption.textContent = "Remove the shortcut, and the errors go with it.";
          for (const l of [...ins].reverse()) { l.classList.remove("shown"); await t.wait(90); }
          lines(false);
          await t.wait(300);
          state(0);
        }
      }
      return { count: 2, render, animate, hold: (i) => [2200, 5200][i] };
    },

    // 03: cycle through the views
    views(el) {
      const tabs = [...el.querySelectorAll(".vtabs button")], panels = [...el.querySelectorAll(".view")];
      const HOLD = 4200;
      el.style.setProperty("--hold", `${HOLD}ms`);
      const render = (i) => {
        tabs.forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
        panels.forEach((p, k) => p.classList.toggle("on", k === i));
        // keep the tab visible in its strip; scrollIntoView would scroll the page too
        const strip = tabs[i].parentElement, a = tabs[i].getBoundingClientRect(), b = strip.getBoundingClientRect();
        if (a.left < b.left || a.right > b.right) strip.scrollTo({ left: strip.scrollLeft + a.left - b.left - 8, behavior: reduce ? "auto" : "smooth" });
      };
      return { count: tabs.length, render, animate: async (from, to) => render(to), hold: () => HOLD };
    },
  };

  scenes.forEach((el) => run(el, defs[el.dataset.scene](el)));
})();
