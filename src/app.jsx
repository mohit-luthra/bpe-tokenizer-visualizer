/* global React, ReactDOM, BPE */
const { useState, useRef, useLayoutEffect, useCallback } = React;

const PRESETS = ["tokenization", "antidisestablishmentarianism", "GPT-4 is amazing!"];
const BASE_DUR = 460; // ms per merge at 1x

function App() {
  const [cells, setCells] = useState([]);       // {id,text,group,spaceBefore}
  const [phase, setPhase] = useState("intro");   // intro | chars | merging | done
  const [text, setText] = useState("");
  const [price, setPrice] = useState(0.03);      // $ per 1K tokens
  const [speed, setSpeed] = useState(1);
  const [charCount, setCharCount] = useState(0);

  const stageRef = useRef(null);
  const cellEls = useRef({});                    // id -> DOM node
  const prevRects = useRef({});                  // id -> rect (stage-relative)
  const lastMerge = useRef(null);                // {survivorId, absorbedId, absorbedText}
  const isFresh = useRef(false);                 // entrance stagger flag
  const runId = useRef(0);
  const timers = useRef([]);
  const rafs = useRef([]);
  const speedRef = useRef(1);
  speedRef.current = speed;

  const setCellEl = (id) => (el) => {
    if (el) cellEls.current[id] = el; else delete cellEls.current[id];
  };

  const clearTimers = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    rafs.current.forEach(cancelAnimationFrame); rafs.current = [];
  };
  const removeGhosts = () => {
    if (stageRef.current) stageRef.current.querySelectorAll(".ghost").forEach((g) => g.remove());
  };
  // Wait that races a setTimeout against an rAF wall-clock. setTimeout gives
  // smooth playback in a normal foreground tab; the rAF clock catches up using
  // real elapsed time if the tab is ever frozen/backgrounded (timers paused).
  const wait = (ms) => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    timers.current.push(setTimeout(finish, ms));
    const start = performance.now();
    const tick = () => {
      if (done) return;
      if (performance.now() - start >= ms) { finish(); return; }
      rafs.current.push(requestAnimationFrame(tick));
    };
    rafs.current.push(requestAnimationFrame(tick));
  });

  // ---- Run the whole animation for a given text ----
  const run = useCallback(async (input) => {
    const value = (input || "").trim();
    if (!value) return;
    clearTimers();
    removeGhosts();
    const myRun = ++runId.current;
    setText(value);

    const { initialCells, steps } = BPE.plan(value);
    setCharCount(initialCells.length);

    // 1) explode into characters with entrance stagger
    prevRects.current = {};
    lastMerge.current = null;
    isFresh.current = true;
    setPhase("chars");
    setCells(initialCells);

    await wait(Math.min(initialCells.length * 32, 900) + 520);
    if (myRun !== runId.current) return;

    // 2) merge one pair at a time
    setPhase("merging");
    for (let i = 0; i < steps.length; i++) {
      const { leftId, rightId } = steps[i];
      lastMerge.current = { survivorId: leftId, absorbedId: rightId };
      setCells((prev) => {
        const out = [];
        for (let k = 0; k < prev.length; k++) {
          if (prev[k].id === rightId) continue;
          if (prev[k].id === leftId) {
            const right = prev.find((c) => c.id === rightId);
            lastMerge.current.absorbedText = right ? right.text : "";
            out.push({ ...prev[k], text: prev[k].text + (right ? right.text : "") });
          } else out.push(prev[k]);
        }
        return out;
      });
      const dur = BASE_DUR / speedRef.current;
      await wait(dur + dur * 0.5);
      if (myRun !== runId.current) return;
    }

    // 3) bloom into colored pills with ids
    await wait(260);
    if (myRun !== runId.current) return;
    setPhase("done");
  }, []);

  // ---- FLIP + pop + ghost on every cells change ----
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sRect = stage.getBoundingClientRect();
    const dur = BASE_DUR / speedRef.current;
    const ease = "cubic-bezier(.22,.9,.24,1)";

    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - sRect.left, top: r.top - sRect.top, w: r.width, h: r.height };
    };

    const newRects = {};
    for (const id in cellEls.current) {
      const el = cellEls.current[id];
      if (el && el.isConnected) newRects[id] = rectOf(el);
    }

    if (isFresh.current) {
      // entrance: stagger pop-in
      let i = 0;
      for (const id in newRects) {
        const el = cellEls.current[id];
        el.animate(
          [
            { opacity: 0, transform: "translateY(10px) scale(.6)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 280, delay: i * 30, easing: "cubic-bezier(.2,.9,.3,1.3)", fill: "backwards" }
        );
        i++;
      }
      isFresh.current = false;
      prevRects.current = newRects;
      return;
    }

    const lm = lastMerge.current;

    // FLIP move for cells that shifted (skip the survivor — it pops instead)
    for (const id in newRects) {
      if (lm && id === lm.survivorId) continue;
      const prev = prevRects.current[id];
      const cur = newRects[id];
      if (!prev) continue;
      const dx = prev.left - cur.left;
      const dy = prev.top - cur.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        cellEls.current[id].animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0,0)" }],
          { duration: dur, easing: ease }
        );
      }
    }

    // survivor pop + accent glow; flying ghost for the absorbed piece
    if (lm && newRects[lm.survivorId]) {
      const sEl = cellEls.current[lm.survivorId];
      const box = sEl ? sEl.querySelector(".box") : null;
      if (box) {
        box.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.16)" }, { transform: "scale(1)" }],
          { duration: dur * 0.95, easing: "cubic-bezier(.3,1.4,.5,1)" }
        );
        box.animate(
          [
            { boxShadow: "0 0 0 0 rgba(124,255,178,0)" },
            { boxShadow: "0 0 0 5px rgba(124,255,178,.34)" },
            { boxShadow: "0 0 0 0 rgba(124,255,178,0)" },
          ],
          { duration: dur, easing: "ease-out" }
        );
        box.animate(
          [{ borderColor: "var(--accent)" }, { borderColor: "var(--line-2)" }],
          { duration: dur * 1.2, easing: "ease-out" }
        );
      }

      const from = prevRects.current[lm.absorbedId];
      const to = newRects[lm.survivorId];
      if (from && to && lm.absorbedText) {
        const ghost = document.createElement("div");
        ghost.className = "ghost";
        ghost.textContent = lm.absorbedText;
        ghost.style.left = from.left + "px";
        ghost.style.top = from.top + "px";
        stage.appendChild(ghost);
        const gx = (to.left + to.w / 2) - (from.left + from.w / 2);
        const gy = (to.top + to.h / 2) - (from.top + from.h / 2);
        const anim = ghost.animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: `translate(${gx}px, ${gy}px) scale(.55)`, opacity: 0 },
          ],
          { duration: dur, easing: ease }
        );
        const kill = () => ghost.remove();
        anim.onfinish = kill;
        anim.oncancel = kill;
        timers.current.push(setTimeout(kill, dur + 250)); // backup cleanup
      }
    }

    prevRects.current = newRects;
  }, [cells]);

  const onKey = (e) => { if (e.key === "Enter") run(e.currentTarget.value); };

  const tokenCount = cells.length;
  const cost = (tokenCount / 1000) * price;
  const costStr = "$" + (cost < 0.01 ? cost.toFixed(5) : cost.toFixed(4));
  const busy = phase === "chars" || phase === "merging";

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="dot" />
          <span className="label">Byte-Pair Encoding</span>
        </div>
        <h1 className="title">
          Watch a word become <span className="accent">tokens</span>.
        </h1>
        <p className="subtitle">
          Type anything. Watch characters merge into subword tokens, one pair at a time —
          exactly how a language model reads text.
        </p>
      </header>

      <div className="inputWrap">
        <span className="chev">›</span>
        <input
          type="text"
          placeholder="type a word or phrase…"
          defaultValue={text}
          onKeyDown={onKey}
          spellCheck="false"
          autoComplete="off"
        />
        <button className="runBtn" onClick={(e) => run(e.currentTarget.parentNode.querySelector("input").value)}>
          Tokenize
        </button>
      </div>

      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p} className="preset" onClick={() => {
            const inp = document.querySelector(".inputWrap input");
            if (inp) inp.value = p;
            run(p);
          }}>{p}</button>
        ))}
      </div>

      <div className="stage" ref={stageRef}>
        {phase === "intro" ? (
          <div className="hint">↑ pick an example or type your own</div>
        ) : (
          <div className={"cells" + (phase === "done" ? " final" : "")}>
            {cells.map((c, i) => {
              const color = phase === "done" ? BPE.tokenColor(c.text) : "var(--line-2)";
              return (
                <div
                  key={c.id}
                  className="cell"
                  ref={setCellEl(c.id)}
                  data-space={c.spaceBefore || 0}
                  style={{ "--c": color }}
                >
                  <div className="box">{c.text}</div>
                  <div className="meta">
                    <span className="id">{BPE.tokenId(c.text)}</span>
                    <span className="idx">#{i + 1}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="stats">
          <div className="stat">
            <span className="k">Tokens</span>
            <span className="v accent">{phase === "intro" ? "—" : tokenCount}</span>
          </div>
          <div className="stat">
            <span className="k">Characters</span>
            <span className="v">{phase === "intro" ? "—" : charCount}</span>
          </div>
          <div className="stat">
            <span className="k">Est. cost</span>
            <span className="v">{phase === "intro" ? "—" : <span>{costStr}</span>}</span>
          </div>
        </div>

        <div className="controls">
          <div className="ctl">
            <label>Price /1K</label>
            <div className="priceField">
              <span>$</span>
              <input
                type="number"
                step="0.001"
                min="0"
                value={price}
                onChange={(e) => setPrice(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
          </div>
          <div className="ctl">
            <label>Speed</label>
            <input
              type="range"
              min="0.25"
              max="2"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
            />
            <span className="speedVal">{speed.toFixed(2)}×</span>
          </div>
          <button
            className="replay"
            disabled={!text || busy}
            onClick={() => run(text)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v4h4" />
            </svg>
            Replay
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
