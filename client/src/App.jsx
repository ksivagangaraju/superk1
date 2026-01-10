import React, { useEffect, useState } from "react";
import io from "socket.io-client";

function computeMapping(rows, cols, blocked) {
  const blockedSet = new Set(blocked || []);
  const coordToNumber = {};
  let count = 1;
  for (let c = 0; c < cols; c++) {
    if (c % 2 === 0) {
      for (let r = rows - 1; r >= 0; r--) {
        const cid = `${r}-${c}`;
        if (!blockedSet.has(cid)) {
          coordToNumber[cid] = count;
          count++;
        }
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const cid = `${r}-${c}`;
        if (!blockedSet.has(cid)) {
          coordToNumber[cid] = count;
          count++;
        }
      }
    }
  }
  return coordToNumber;
}

export default function App() {
  const [state, setState] = useState({
    rows: 3,
    cols: 3,
    blocked: [],
    names: {},
  });

  useEffect(() => {
    const BACKEND =
      (import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
      "http://localhost:3000";
    console.log("App connecting to backend at", BACKEND);
    fetch(`${BACKEND}`)
      .then((r) => r.json())
      .then((s) => {
        setState(s);
        console.log("initial state", s);
      })
      .catch(console.error);
    // connect to backend socket.io (explicit origin)
    const socket = io(BACKEND, { transports: ["websocket", "polling"] });
    socket.on("connect", () => console.log("socket connected", socket.id));
    socket.on("connect_error", (err) =>
      console.error("socket connect_error", err)
    );
    socket.on("state", (s) => {
      console.log("socket state", s);
      setState(s);
    });
    socket.on("stateUpdated", (s) => {
      console.log("socket stateUpdated", s);
      setState(s);
    });
    return () => socket.disconnect();
  }, []);

  const mapping = computeMapping(state.rows, state.cols, state.blocked);

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="brand">SuperK - Store Places</div>
      </header>
      <main className="main">
        <section className="grid-area">
          <div
            className="grid-container"
            style={{ gridTemplateColumns: `repeat(${state.cols},1fr)` }}
          >
            {Array.from({ length: state.rows }).map((_, r) =>
              Array.from({ length: state.cols }).map((__, c) => {
                const cid = `${r}-${c}`;
                if (state.blocked.includes(cid))
                  return <div key={cid} className="grid-box invisible" />;
                const num = mapping[cid];
                const name =
                  state.names && state.names[num] ? state.names[num] : "";
                return (
                  <div
                    key={cid}
                    className={`grid-box ${name ? "has-name" : ""}`}
                  >
                    <div className="number-text">{num}</div>
                    <div className="subtitle-text">{name}</div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
