/* global React, ReactDOM, Stage, Sprite, useTime, useSprite, Easing, interpolate, clamp */
const { useMemo, useRef, useState, useEffect } = React;

// ============================================================
// Helpers
// ============================================================
const lerp = (a, b, t) => a + (b - a) * t;

// Ease & map: returns a value derived from current time clamped within [t0,t1]
function ease(time, t0, t1, from, to, easing = Easing.easeInOutCubic) {
  if (time <= t0) return from;
  if (time >= t1) return to;
  const p = (time - t0) / (t1 - t0);
  return lerp(from, to, easing(p));
}

// Slide chrome: top-right index + bottom-left ticker
function SlideChrome({ index, total, label }) {
  return (
    <>
      <div style={{
        position: "absolute", top: 36, left: 36,
        display: "flex", alignItems: "center", gap: 14,
        zIndex: 5,
      }}>
        <div style={{ width: 26, height: 26, position: "relative" }}>
          <div style={{
            position: "absolute", inset: 0,
            border: "1.5px solid var(--uv)",
            borderRadius: "50%",
          }} />
          <div style={{
            position: "absolute", inset: 7,
            background: "var(--uv)", borderRadius: "50%",
          }} />
        </div>
        <span className="display" style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em" }}>
          dreamspace
        </span>
      </div>
      <div className="mono" style={{
        position: "absolute", top: 36, right: 36,
        fontSize: 11, color: "var(--dim)",
        letterSpacing: "0.18em", textTransform: "uppercase",
        zIndex: 5,
      }}>
        {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")} · {label}
      </div>
      <div className="mono" style={{
        position: "absolute", bottom: 36, left: 36,
        fontSize: 11, color: "var(--dim-2)",
        letterSpacing: "0.18em", textTransform: "uppercase",
        zIndex: 5,
      }}>
        Space and Time · Embargo lifted 04.23.26 · 07:00 PDT
      </div>
      <div className="mono" style={{
        position: "absolute", bottom: 36, right: 36,
        fontSize: 11, color: "var(--dim-2)",
        letterSpacing: "0.18em", textTransform: "uppercase",
        zIndex: 5,
      }}>
        dream.space
      </div>
    </>
  );
}

// ============================================================
// Slide 1 — Cold open
// ============================================================
function S1_ColdOpen() {
  const { localTime, duration } = useSprite();
  const t = localTime;

  // word stagger
  const words = ["Write", "an", "app.", "Render", "onchain."];
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div className="stars" />
      {/* Concentric orbital rings, scale + rotate */}
      <svg viewBox="-500 -500 1000 1000" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {[180, 280, 380, 480].map((r, i) => {
          const dash = 2 * Math.PI * r;
          const reveal = ease(t, 0.2 + i*0.18, 1.6 + i*0.18, 0, 1, Easing.easeOutQuart);
          const rot = ease(t, 0, duration, 0, 25 + i*8, Easing.linear);
          return (
            <g key={i} transform={`rotate(${rot})`}>
              <circle
                cx="0" cy="0" r={r}
                fill="none"
                stroke={i === 1 ? "var(--uv)" : "var(--rule)"}
                strokeWidth={i === 1 ? 1.4 : 0.8}
                strokeDasharray={dash}
                strokeDashoffset={dash * (1 - reveal)}
                opacity={i === 1 ? 0.9 : 0.45}
              />
              {i === 1 && (
                <circle
                  cx={r * Math.cos(t * 0.6 - 1.2)}
                  cy={r * Math.sin(t * 0.6 - 1.2)}
                  r="6"
                  fill="var(--cyan)"
                  opacity={reveal}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Wordmark */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 28,
      }}>
        <div className="mono" style={{
          fontSize: 12, letterSpacing: "0.32em",
          color: "var(--uv)", textTransform: "uppercase",
          opacity: ease(t, 0.2, 0.9, 0, 1),
          transform: `translateY(${ease(t, 0.2, 0.9, 12, 0)}px)`,
        }}>
          a Space and Time creation
        </div>
        <div className="display" style={{
          fontSize: 200, fontWeight: 400, lineHeight: 0.95,
          letterSpacing: "-0.04em",
          background: "linear-gradient(180deg, var(--paper) 0%, var(--paper) 60%, var(--uv) 130%)",
          WebkitBackgroundClip: "text", backgroundClip: "text",
          color: "transparent",
          opacity: ease(t, 0.5, 1.4, 0, 1, Easing.easeOutQuart),
          transform: `translateY(${ease(t, 0.5, 1.4, 30, 0, Easing.easeOutQuart)}px)`,
        }}>
          dreamspace
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          {words.map((w, i) => {
            const start = 1.4 + i * 0.12;
            return (
              <span key={i} className="display" style={{
                fontSize: 30, fontWeight: 400, color: "var(--paper)",
                letterSpacing: "-0.01em",
                opacity: ease(t, start, start + 0.5, 0, 1),
                transform: `translateY(${ease(t, start, start + 0.5, 14, 0, Easing.easeOutCubic)}px)`,
              }}>{w}</span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Slide 2 — The pitch (prompt → app)
// ============================================================
function S2_Prompt() {
  const { localTime } = useSprite();
  const t = localTime;
  const fullPrompt = "build me a tipping app where my fans can pay me in stablecoins and i keep 100% of it.";
  const charsShown = Math.floor(ease(t, 0.3, 2.6, 0, fullPrompt.length, Easing.linear));
  const visible = fullPrompt.slice(0, charsShown);

  // Phone reveal at t=2.8
  const phoneIn = ease(t, 2.8, 3.6, 0, 1, Easing.easeOutCubic);
  const beam = ease(t, 2.6, 3.4, 0, 1, Easing.easeInOutCubic);

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", padding: "0 120px" }}>
      {/* Left: prompt panel */}
      <div style={{ paddingRight: 80 }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--uv)", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 24 }}>
          ▸ describe what to build
        </div>
        <div style={{
          padding: 28,
          border: "1px solid var(--rule)",
          background: "rgba(20, 20, 38, 0.6)",
          backdropFilter: "blur(8px)",
          borderRadius: 6,
          minHeight: 180,
        }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--dim-2)", letterSpacing: "0.15em", marginBottom: 14 }}>
            user@dream.space ~ $
          </div>
          <div style={{
            fontSize: 28, lineHeight: 1.35,
            color: "var(--paper)",
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            letterSpacing: "-0.01em",
          }}>
            {visible}
            <span style={{
              display: "inline-block",
              width: 14, height: 28,
              background: "var(--uv)",
              marginLeft: 4,
              verticalAlign: "-4px",
              opacity: charsShown < fullPrompt.length || Math.floor(t * 2) % 2 === 0 ? 1 : 0,
            }} />
          </div>
        </div>
        <div className="mono" style={{
          fontSize: 11, color: "var(--dim-2)", letterSpacing: "0.18em",
          marginTop: 18, textTransform: "uppercase",
          opacity: ease(t, 2.6, 3.2, 0, 1),
        }}>
          ↳ generating smart contracts · auditable · onchain
        </div>
      </div>

      {/* Right: phone with generated app */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
        {/* Energy beam from left */}
        <svg style={{ position: "absolute", left: -200, top: "50%", width: 240, height: 4, transform: "translateY(-50%)", overflow: "visible" }}>
          <line x1="0" y1="2" x2="240" y2="2"
            stroke="var(--uv)" strokeWidth="2"
            strokeDasharray="240"
            strokeDashoffset={240 * (1 - beam)}
            style={{ filter: "drop-shadow(0 0 8px var(--uv))" }}
          />
        </svg>

        <div style={{
          width: 280, height: 560,
          borderRadius: 36,
          border: "2px solid var(--rule)",
          background: "linear-gradient(180deg, oklch(0.20 0.03 280), oklch(0.13 0.02 270))",
          padding: 18,
          opacity: phoneIn,
          transform: `translateY(${(1 - phoneIn) * 30}px) scale(${0.94 + phoneIn * 0.06})`,
          boxShadow: `0 0 80px oklch(0.55 0.20 290 / ${phoneIn * 0.4})`,
        }}>
          {/* notch */}
          <div style={{ width: 100, height: 22, background: "#000", borderRadius: 12, margin: "0 auto 14px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="mono" style={{ fontSize: 9, color: "var(--dim)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
              tip jar · live
            </div>
            <div className="display" style={{ fontSize: 38, fontWeight: 500, color: "var(--paper)" }}>
              $1,247
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--cyan)" }}>
              ▲ +$28 from anonymous · 2s ago
            </div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[28, 50, 100].map((amt, i) => (
                <div key={i} style={{
                  padding: "10px 14px",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  fontSize: 13,
                  display: "flex", justifyContent: "space-between",
                  background: i === 0 ? "var(--uv-deep)" : "transparent",
                  color: i === 0 ? "white" : "var(--paper)",
                  opacity: ease(t, 3.2 + i * 0.15, 3.7 + i * 0.15, 0, 1),
                  transform: `translateY(${ease(t, 3.2 + i * 0.15, 3.7 + i * 0.15, 8, 0)}px)`,
                }}>
                  <span>Tip ${amt}</span>
                  <span className="mono" style={{ fontSize: 10, opacity: 0.7 }}>USDC</span>
                </div>
              ))}
            </div>
            <div className="mono" style={{
              fontSize: 9, color: "var(--dim-2)", marginTop: 14,
              letterSpacing: "0.1em",
              opacity: ease(t, 3.7, 4.2, 0, 1),
            }}>
              0xab12…f9c0 · base · &lt;1¢ fee
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Slide 3 — By the numbers (counters)
// ============================================================
function S3_Numbers() {
  const { localTime } = useSprite();
  const t = localTime;

  const stats = [
    { num: 34000, prefix: "", suffix: "", display: (v) => v.toLocaleString(), label: "apps built in beta", sub: "before public launch" },
    { num: 20, prefix: "$", suffix: "M", display: (v) => `$${v}M`, label: "from M12, Microsoft's Venture Fund", sub: "led 2022 Series" },
    { num: 140000, prefix: "", suffix: "", display: (v) => v.toLocaleString(), label: "students reached in Indonesia", sub: "AI labs + curriculum" },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, padding: "120px 120px 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div className="mono" style={{
        fontSize: 12, color: "var(--uv)", letterSpacing: "0.28em",
        textTransform: "uppercase", marginBottom: 28,
        opacity: ease(t, 0.2, 0.7, 0, 1),
      }}>
        ▸ by the numbers
      </div>
      <h2 className="display" style={{
        fontSize: 76, fontWeight: 400, lineHeight: 1.05,
        margin: 0, maxWidth: "20ch",
        opacity: ease(t, 0.4, 1.0, 0, 1),
        transform: `translateY(${ease(t, 0.4, 1.0, 16, 0)}px)`,
      }}>
        Beta proved the demand. Now it opens to everyone.
      </h2>

      <div style={{
        marginTop: 80,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 56,
        borderTop: "1px solid var(--rule)",
        paddingTop: 36,
      }}>
        {stats.map((s, i) => {
          const delay = 1.2 + i * 0.35;
          const counterStart = delay;
          const counterEnd = delay + 1.4;
          const v = Math.floor(ease(t, counterStart, counterEnd, 0, s.num, Easing.easeOutQuart));
          const visible = ease(t, delay - 0.1, delay + 0.4, 0, 1);
          return (
            <div key={i} style={{
              opacity: visible,
              transform: `translateY(${(1 - visible) * 16}px)`,
            }}>
              <div className="mono" style={{
                fontSize: 11, letterSpacing: "0.2em",
                color: "var(--dim)", textTransform: "uppercase",
                marginBottom: 14,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ width: 8, height: 8, background: i === 0 ? "var(--uv)" : i === 1 ? "var(--cyan)" : "var(--amber)" }} />
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="display" style={{
                fontSize: 88, fontWeight: 500,
                lineHeight: 1, letterSpacing: "-0.03em",
                color: i === 0 ? "var(--uv)" : i === 1 ? "var(--cyan)" : "var(--amber)",
              }}>
                {s.display(v)}
              </div>
              <div style={{ fontSize: 18, marginTop: 16, color: "var(--paper)", lineHeight: 1.35, maxWidth: "20ch" }}>
                {s.label}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--dim-2)", marginTop: 8, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {s.sub}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Slide 4 — The stack
// ============================================================
function S4_Stack() {
  const { localTime } = useSprite();
  const t = localTime;

  const layers = [
    { name: "Creator", desc: "describes the app in plain language", color: "var(--paper)", role: "input" },
    { name: "Dreamspace", desc: "AI app builder · no-code · auditable smart contracts", color: "var(--uv)", role: "platform" },
    { name: "Azure AI Foundry", desc: "model orchestration · Azure OpenAI", color: "var(--cyan)", role: "ai" },
    { name: "Base", desc: "EVM L2 · sub-cent fees · sub-second blocks", color: "var(--amber)", role: "chain" },
    { name: "Space and Time", desc: "verifiable data layer for onchain finance", color: "var(--paper)", role: "data" },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, padding: "120px 120px 80px" }}>
      <div className="mono" style={{
        fontSize: 12, color: "var(--uv)", letterSpacing: "0.28em",
        textTransform: "uppercase", marginBottom: 28,
        opacity: ease(t, 0.2, 0.7, 0, 1),
      }}>
        ▸ the stack
      </div>
      <h2 className="display" style={{
        fontSize: 64, fontWeight: 400, lineHeight: 1.05,
        margin: 0, maxWidth: "22ch",
        opacity: ease(t, 0.4, 1.0, 0, 1),
        transform: `translateY(${ease(t, 0.4, 1.0, 16, 0)}px)`,
      }}>
        One prompt. Five layers do the work.
      </h2>

      <div style={{ marginTop: 64, display: "flex", flexDirection: "column", gap: 14 }}>
        {layers.map((L, i) => {
          const delay = 1.0 + i * 0.22;
          const visible = ease(t, delay, delay + 0.5, 0, 1, Easing.easeOutCubic);
          const slide = ease(t, delay, delay + 0.5, -40, 0, Easing.easeOutCubic);
          return (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr 120px",
              alignItems: "center",
              padding: "20px 28px",
              border: "1px solid var(--rule)",
              background: i === 1 ? "rgba(167, 139, 250, 0.08)" : "rgba(20, 20, 38, 0.5)",
              borderColor: i === 1 ? "var(--uv)" : "var(--rule)",
              opacity: visible,
              transform: `translateX(${slide}px)`,
              gap: 24,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 10, height: 10, background: L.color, borderRadius: "50%" }} />
                <span className="display" style={{ fontSize: 22, fontWeight: 500, color: L.color }}>
                  {L.name}
                </span>
              </div>
              <div style={{ fontSize: 15, color: "var(--paper)", opacity: 0.85 }}>
                {L.desc}
              </div>
              <div className="mono" style={{ fontSize: 10, color: "var(--dim-2)", letterSpacing: "0.18em", textTransform: "uppercase", textAlign: "right" }}>
                {L.role}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Slide 5 — Why it matters (manifesto)
// ============================================================
function S5_Manifesto() {
  const { localTime } = useSprite();
  const t = localTime;

  const beats = [
    { k: "No code", v: "Anyone with an idea can ship.", tag: "creator" },
    { k: "Fully auditable", v: "Every smart contract is transparent onchain.", tag: "trust" },
    { k: "Sub-cent fees", v: "Real businesses, day one, on Base.", tag: "economics" },
    { k: "Verifiable data", v: "The same infrastructure that secures DeFi.", tag: "infra" },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, padding: "120px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div className="mono" style={{
        fontSize: 12, color: "var(--uv)", letterSpacing: "0.28em",
        textTransform: "uppercase", marginBottom: 28,
        opacity: ease(t, 0.2, 0.7, 0, 1),
      }}>
        ▸ what changes
      </div>
      <h2 className="display" style={{
        fontSize: 84, fontWeight: 400, lineHeight: 1.0,
        margin: 0, maxWidth: "16ch",
        letterSpacing: "-0.025em",
        opacity: ease(t, 0.4, 1.0, 0, 1),
        transform: `translateY(${ease(t, 0.4, 1.0, 20, 0)}px)`,
      }}>
        When the data layer <span style={{ color: "var(--uv)", fontStyle: "italic", fontWeight: 300 }}>handles itself</span>,
      </h2>
      <h2 className="display" style={{
        fontSize: 84, fontWeight: 400, lineHeight: 1.0,
        margin: "8px 0 0", maxWidth: "20ch",
        letterSpacing: "-0.025em",
        opacity: ease(t, 0.7, 1.3, 0, 1),
        transform: `translateY(${ease(t, 0.7, 1.3, 20, 0)}px)`,
      }}>
        the only thing left is <span style={{ color: "var(--cyan)" }}>what to make.</span>
      </h2>

      <div style={{
        marginTop: 64,
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 28,
        borderTop: "1px solid var(--rule)",
        paddingTop: 28,
      }}>
        {beats.map((b, i) => {
          const delay = 1.6 + i * 0.18;
          const visible = ease(t, delay, delay + 0.5, 0, 1);
          return (
            <div key={i} style={{
              opacity: visible,
              transform: `translateY(${(1 - visible) * 14}px)`,
            }}>
              <div className="mono" style={{
                fontSize: 10, color: "var(--dim-2)",
                letterSpacing: "0.2em", textTransform: "uppercase",
                marginBottom: 12,
              }}>
                {String(i + 1).padStart(2, "0")} / {b.tag}
              </div>
              <div className="display" style={{ fontSize: 28, fontWeight: 500, marginBottom: 8, letterSpacing: "-0.015em" }}>
                {b.k}
              </div>
              <div style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.45 }}>
                {b.v}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Slide 6 — Launch card
// ============================================================
function S6_Launch() {
  const { localTime } = useSprite();
  const t = localTime;

  // Big radial reveal
  const reveal = ease(t, 0, 1.2, 0, 1, Easing.easeOutQuart);
  const url = "dream.space";
  const charsShown = Math.floor(ease(t, 1.6, 2.4, 0, url.length, Easing.linear));

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="stars" />
      {/* Expanding ring */}
      <div style={{
        position: "absolute",
        width: `${reveal * 1800}px`, height: `${reveal * 1800}px`,
        border: "1px solid var(--uv)",
        borderRadius: "50%",
        opacity: reveal * (1 - reveal * 0.4),
      }} />
      <div style={{
        position: "absolute",
        width: `${reveal * 1200}px`, height: `${reveal * 1200}px`,
        border: "1px solid var(--cyan)",
        borderRadius: "50%",
        opacity: reveal * 0.4,
      }} />

      <div style={{ textAlign: "center", position: "relative", zIndex: 2 }}>
        <div className="mono" style={{
          fontSize: 12, color: "var(--uv)", letterSpacing: "0.32em",
          textTransform: "uppercase", marginBottom: 28,
          opacity: ease(t, 0.4, 1.0, 0, 1),
        }}>
          live · April 23, 2026
        </div>
        <div className="display" style={{
          fontSize: 96, fontWeight: 400, lineHeight: 1.0,
          letterSpacing: "-0.03em",
          marginBottom: 20,
          opacity: ease(t, 0.6, 1.4, 0, 1, Easing.easeOutQuart),
          transform: `translateY(${ease(t, 0.6, 1.4, 24, 0, Easing.easeOutQuart)}px)`,
        }}>
          Start building.
        </div>
        <div className="display" style={{
          fontSize: 140, fontWeight: 500,
          letterSpacing: "-0.04em",
          background: "linear-gradient(180deg, var(--paper) 0%, var(--uv) 100%)",
          WebkitBackgroundClip: "text", backgroundClip: "text",
          color: "transparent",
          opacity: ease(t, 1.4, 2.0, 0, 1),
        }}>
          {url.slice(0, charsShown)}
          <span style={{
            display: "inline-block",
            width: 12, height: 100,
            background: "var(--uv)",
            verticalAlign: "-12px",
            marginLeft: 8,
            opacity: charsShown < url.length || Math.floor(t * 2) % 2 === 0 ? 1 : 0,
          }} />
        </div>
        <div className="mono" style={{
          fontSize: 13, color: "var(--dim)",
          letterSpacing: "0.22em", textTransform: "uppercase",
          marginTop: 32,
          opacity: ease(t, 2.6, 3.2, 0, 1),
        }}>
          Space and Time × M12 · Microsoft's Venture Fund · Base
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Slide compositor
// ============================================================
const SLIDES = [
  { dur: 5.0, label: "Cold open", Component: S1_ColdOpen },
  { dur: 5.5, label: "The pitch", Component: S2_Prompt },
  { dur: 5.5, label: "By the numbers", Component: S3_Numbers },
  { dur: 5.5, label: "The stack", Component: S4_Stack },
  { dur: 5.0, label: "What changes", Component: S5_Manifesto },
  { dur: 4.0, label: "Launch", Component: S6_Launch },
];

const TOTAL_DURATION = SLIDES.reduce((a, s) => a + s.dur, 0);

function Slides() {
  let cursor = 0;
  return (
    <>
      {SLIDES.map((s, i) => {
        const start = cursor;
        const end = cursor + s.dur;
        cursor = end;
        const Comp = s.Component;
        // crossfade window between slides
        const FADE = 0.4;
        return (
          <Sprite key={i} start={Math.max(0, start - FADE)} end={end + FADE} keepMounted={false}>
            <SlideWrap start={start} end={end} fade={FADE}>
              <SlideChrome index={i + 1} total={SLIDES.length} label={s.label} />
              <Comp />
            </SlideWrap>
          </Sprite>
        );
      })}
    </>
  );
}

function SlideWrap({ start, end, fade, children }) {
  const time = useTime();
  // Re-base local time so each slide's component sees t=0 at slide start
  const slideLocal = time - start;
  const opacity = (() => {
    if (time < start) return ease(time, start - fade, start, 0, 1);
    if (time > end) return ease(time, end, end + fade, 1, 0);
    return 1;
  })();
  // Provide a sprite-like context override so child useSprite() sees slide-local time
  const ctx = useMemo(() => ({ localTime: slideLocal, progress: slideLocal / (end - start), duration: end - start }), [slideLocal, end, start]);
  return (
    <window.SpriteContext.Provider value={ctx}>
      <div style={{
        position: "absolute", inset: 0,
        opacity,
        pointerEvents: opacity > 0.1 ? "auto" : "none",
      }}>
        {children}
      </div>
    </window.SpriteContext.Provider>
  );
}

// ============================================================
// App
// ============================================================
function App() {
  return (
    <Stage
      width={1920}
      height={1080}
      duration={TOTAL_DURATION}
      background="#0a0a14"
      autoplay={true}
      loop={true}
    >
      <div className="grain" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }} />
      <Slides />
    </Stage>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
