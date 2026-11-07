import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { Chess } from "chess.js";

const html = readFileSync("index.html", "utf8");
const app = readFileSync("app.js", "utf8").replace(
  /^import \{ Chess \} from "https:\/\/cdn\.jsdelivr\.net\/npm\/chess\.js@1\.4\.0\/\+esm";/,
  "const Chess = window.__Chess;"
);

function makeWorker() {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    emit(data) {
      this.onmessage?.({ data });
    }
  }
  return { Worker: FakeWorker, workers };
}

function setup(saved = null, WorkerClass = null, timers = null) {
  const dom = new JSDOM(html, {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.__Chess = Chess;
  if (WorkerClass) window.Worker = WorkerClass;
  if (timers) {
    window.setTimeout = timers.setTimeout;
    window.clearTimeout = timers.clearTimeout;
  }
  window.confirm = () => true;
  window.setInterval = () => 1; // avoid real clocks in deterministic UI tests
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (saved) window.localStorage.setItem("masters-of-chess-local-v1", saved);
  window.eval(app);
  const { document } = window;
  const click = (square) => {
    const node = [...document.querySelectorAll(".square")].find((element) =>
      element.getAttribute("aria-label").startsWith(square + ",")
    );
    assert.ok(node, "Expected square " + square);
    node.click();
  };
  const move = (from, to) => { click(from); click(to); };
  return { window, document, move, click };
}

test("64 squares, white starts at the bottom, and side to move is white", () => {
  const { document, window } = setup();
  const squares = [...document.querySelectorAll(".square")];
  assert.equal(squares.length, 64);
  assert.ok(squares[0].getAttribute("aria-label").startsWith("a8,"));
  assert.ok(squares[63].getAttribute("aria-label").startsWith("h1,"));
  assert.match(document.getElementById("status-title").textContent, /Wit aan zet/);
  assert.match(document.getElementById("clock-w").textContent, /10:00/);
  window.close();
});

test("legal moves are recorded, illegal moves are refused, and clocks can be undone", () => {
  const { document, window, move } = setup();
  move("e2", "e4");
  assert.equal(document.querySelectorAll(".move-row").length, 1);
  assert.match(document.getElementById("status-title").textContent, /Zwart aan zet/);
  assert.equal(document.getElementById("clock-w").textContent, "10:05");

  move("a7", "a4"); // illegal three-square pawn move
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");

  document.getElementById("undo-button").click();
  assert.match(document.getElementById("status-title").textContent, /Wit aan zet/);
  assert.equal(document.getElementById("clock-w").textContent, "10:00");
  assert.equal(document.getElementById("total-moves").textContent, "0 zetten");
  assert.match(document.getElementById("clock-button").textContent, /Start klok/);
  window.close();
});

test("checkmate stops the game and sets the correct winner", () => {
  const { document, window, move } = setup();
  for (const [from, to] of [
    ["e2", "e4"], ["e7", "e5"], ["d1", "h5"],
    ["b8", "c6"], ["f1", "c4"], ["g8", "f6"], ["h5", "f7"]
  ]) move(from, to);
  assert.match(document.getElementById("status-title").textContent, /Wit wint door schaakmat/);
  assert.equal(document.getElementById("resign-button").disabled, true);
  const count = document.getElementById("total-moves").textContent;
  move("e8", "e7");
  assert.equal(document.getElementById("total-moves").textContent, count);
  window.close();
});

test("castling uses the official move generator", () => {
  const { document, window, move } = setup();
  for (const [from, to] of [
    ["e2", "e4"], ["e7", "e5"], ["g1", "f3"],
    ["b8", "c6"], ["f1", "c4"], ["g8", "f6"], ["e1", "g1"]
  ]) move(from, to);
  assert.match(document.getElementById("move-list").textContent, /O-O/);
  assert.ok([...document.querySelectorAll(".square")].some((element) =>
    element.getAttribute("aria-label") === "f1, witte toren"
  ));
  window.close();
});

test("a saved game reopens paused, with history preserved", () => {
  const first = setup();
  first.move("d2", "d4");
  const saved = first.window.localStorage.getItem("masters-of-chess-local-v1");
  first.window.close();
  assert.ok(saved);

  const second = setup(saved);
  assert.match(second.document.getElementById("status-title").textContent, /Zwart aan zet/);
  assert.equal(second.document.getElementById("total-moves").textContent, "1 zet");
  assert.match(second.document.getElementById("clock-button").textContent, /Hervat klok/);
  second.window.close();
});

test("chess.js supports the required promotion and en-passant special moves", () => {
  const promotion = new Chess("8/P7/6k1/8/8/8/8/7K w - - 0 1");
  const upgrades = promotion.moves({ square: "a7", verbose: true }).filter((move) => move.to === "a8");
  assert.deepEqual(upgrades.map((move) => move.promotion).sort(), ["b", "n", "q", "r"]);
  const ep = new Chess();
  for (const move of ["e4", "a6", "e5", "d5"]) ep.move(move);
  assert.ok(ep.moves().includes("exd6"));
});


test("playing black starts Stockfish as white and one undo reverts a whole turn", () => {
  const mock = makeWorker();
  const { document, window, move } = setup(null, mock.Worker);
  const change = (id, value) => {
    const select = document.getElementById(id);
    select.value = value;
    select.dispatchEvent(new window.Event("change"));
  };

  change("player-color", "b");
  change("computer-level", "medium");
  change("game-mode", "computer");
  assert.equal(document.getElementById("computer-settings").hidden, false);
  assert.equal(mock.workers.length, 1);
  const engine = mock.workers[0];
  assert.match(engine.url, /stockfish-19-lite-single\.js$/);
  assert.ok(engine.messages.includes("uci"));
  engine.emit("uciok");
  engine.emit("readyok");
  assert.ok(engine.messages.some((message) => message.startsWith("position fen ")));
  assert.ok(engine.messages.includes("go depth 10 movetime 700"));
  assert.match(document.getElementById("status-title").textContent, /Computer denkt na/);

  // The visitor cannot play for the engine when it is white's turn.
  const initialSquares = document.getElementById("total-moves").textContent;
  move("e2", "e4");
  assert.equal(document.getElementById("total-moves").textContent, initialSquares);

  engine.emit("bestmove e2e4 ponder e7e5");
  assert.match(document.getElementById("status-title").textContent, /Jij bent aan zet/);
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");

  move("e7", "e5");
  assert.equal(document.getElementById("total-moves").textContent, "2 zetten");
  assert.ok(engine.messages.includes("go depth 10 movetime 700"));
  engine.emit("bestmove g1f3");
  assert.equal(document.getElementById("total-moves").textContent, "3 zetten");

  document.getElementById("undo-button").click();
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");
  assert.match(document.getElementById("status-title").textContent, /Jij bent aan zet/);
  assert.equal(engine.terminated, true);
  assert.match(document.getElementById("clock-button").textContent, /Hervat klok/);
  window.close();
});

test("switching mode and resetting cancel an obsolete engine search", () => {
  const mock = makeWorker();
  const { document, window, move } = setup(null, mock.Worker);
  const mode = document.getElementById("game-mode");
  const level = document.getElementById("computer-level");
  level.value = "medium";
  level.dispatchEvent(new window.Event("change"));
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));
  move("e2", "e4");
  assert.equal(mock.workers.length, 1);
  const first = mock.workers[0];
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");

  document.getElementById("new-game-button").click();
  assert.equal(first.terminated, true);
  first.emit("bestmove e7e5");
  assert.equal(document.getElementById("total-moves").textContent, "0 zetten");

  move("e2", "e4");
  const second = mock.workers[1];
  mode.value = "local";
  mode.dispatchEvent(new window.Event("change"));
  assert.equal(second.terminated, true);
  assert.equal(document.getElementById("computer-settings").hidden, true);
  assert.match(document.getElementById("status-title").textContent, /Wit aan zet/);
  window.close();
});

test("resigning while Stockfish thinks awards the game to the computer", () => {
  const mock = makeWorker();
  const { document, window, move } = setup(null, mock.Worker);
  const mode = document.getElementById("game-mode");
  const level = document.getElementById("computer-level");
  level.value = "medium";
  level.dispatchEvent(new window.Event("change"));
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));
  move("e2", "e4");
  const engine = mock.workers[0];
  document.getElementById("resign-button").click();
  assert.match(document.getElementById("status-title").textContent, /Zwart wint: Wit geeft op/);
  assert.equal(engine.terminated, true);
  engine.emit("bestmove e7e5");
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");
  window.close();
});

test("computer difficulty and game mode survive reload with a pending bot turn", () => {
  const mock1 = makeWorker();
  const first = setup(null, mock1.Worker);
  const { document, window } = first;
  const mode = document.getElementById("game-mode");
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));
  const level = document.getElementById("computer-level");
  level.value = "hard";
  level.dispatchEvent(new window.Event("change"));
  first.move("e2", "e4");
  const saved = window.localStorage.getItem("masters-of-chess-local-v1");
  window.close();

  const mock2 = makeWorker();
  const second = setup(saved, mock2.Worker);
  assert.equal(second.document.getElementById("game-mode").value, "computer");
  assert.equal(second.document.getElementById("computer-level").value, "hard");
  assert.match(second.document.getElementById("status-title").textContent, /Computer denkt na/);
  assert.equal(mock2.workers.length, 1);
  mock2.workers[0].emit("readyok");
  assert.ok(mock2.workers[0].messages.includes("go depth 16 movetime 1500"));
  second.window.close();
});


function makeManualTimers() {
  let nextId = 0;
  const scheduled = new Map();
  return {
    setTimeout(fn) {
      const id = ++nextId;
      scheduled.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
    flush() {
      const batch = [...scheduled.entries()];
      for (const [id, fn] of batch) {
        if (!scheduled.has(id)) continue;
        scheduled.delete(id);
        fn();
      }
    },
    pending() {
      return scheduled.size;
    }
  };
}

test("practice mode plays legal moves without ever starting Stockfish", () => {
  const workers = makeWorker();
  const timers = makeManualTimers();
  const { document, window, move } = setup(null, workers.Worker, timers);
  const color = document.getElementById("player-color");
  color.value = "b";
  color.dispatchEvent(new window.Event("change"));

  const mode = document.getElementById("game-mode");
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));

  const level = document.getElementById("computer-level");
  level.value = "practice";
  level.dispatchEvent(new window.Event("change"));
  assert.equal(workers.workers.length, 0, "practice mode does not use Stockfish");
  assert.equal(document.getElementById("total-moves").textContent, "0 zetten");
  assert.match(document.getElementById("computer-help").textContent, /willekeurige zetten/);

  timers.flush();
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");
  assert.match(document.getElementById("status-title").textContent, /Jij bent aan zet/);

  move("e7", "e5");
  assert.equal(document.getElementById("total-moves").textContent, "2 zetten");
  timers.flush();
  assert.equal(document.getElementById("total-moves").textContent, "3 zetten");
  assert.equal(workers.workers.length, 0);
  window.close();
});

test("beginner uses the weak computer and cancels its delayed move when resetting", () => {
  const workers = makeWorker();
  const timers = makeManualTimers();
  const { document, window, move } = setup(null, workers.Worker, timers);
  const mode = document.getElementById("game-mode");
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));
  assert.equal(document.getElementById("computer-level").value, "beginner");
  assert.equal(workers.workers.length, 0);

  move("e2", "e4");
  assert.match(document.getElementById("status-title").textContent, /Computer denkt na/);
  assert.equal(workers.workers.length, 0);
  document.getElementById("new-game-button").click();
  timers.flush();
  assert.equal(document.getElementById("total-moves").textContent, "0 zetten");
  move("d2", "d4");
  timers.flush();
  assert.equal(document.getElementById("total-moves").textContent, "2 zetten");
  assert.match(document.getElementById("status-title").textContent, /Jij bent aan zet/);
  window.close();
});

test("switching from practice to stronger level while a move is pending cancels old AI", () => {
  const workers = makeWorker();
  const timers = makeManualTimers();
  const { document, window, move } = setup(null, workers.Worker, timers);
  const mode = document.getElementById("game-mode");
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));
  const level = document.getElementById("computer-level");
  level.value = "practice";
  level.dispatchEvent(new window.Event("change"));
  move("d2", "d4");
  assert.equal(workers.workers.length, 0);

  level.value = "medium";
  level.dispatchEvent(new window.Event("change"));
  assert.equal(workers.workers.length, 1);
  // The one remaining timer belongs to Stockfish's startup watchdog;
  // the previous weak-opponent move timer must have been cancelled.
  assert.equal(timers.pending(), 1);
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");
  workers.workers[0].emit("readyok");
  assert.equal(timers.pending(), 0);
  workers.workers[0].emit("bestmove d7d5");
  assert.equal(document.getElementById("total-moves").textContent, "2 zetten");
  window.close();
});


test("legal moves animate source and destination and captures show a disappearing piece", () => {
  const { document, window, move } = setup();
  assert.equal(document.querySelectorAll("#board [data-square]").length, 64);
  move("e2", "e4");
  assert.ok(document.querySelector('[data-square="e2"]').classList.contains("move-origin-pulse"));
  assert.ok(document.querySelector('[data-square="e4"]').classList.contains("move-destination-pulse"));
  move("d7", "d5");
  move("e4", "d5");
  assert.equal(document.querySelectorAll(".captured-ghost").length, 1);
  assert.ok(document.querySelector(".capture-shockwave"), "Captured piece should trigger a visible impact wave");
  assert.equal(document.getElementById("total-moves").textContent, "3 zetten");
  window.close();
});

test("castling animates the rook and reduced-motion disables decorative effects", () => {
  const { document, window, move } = setup();
  for (const [from, to] of [
    ["e2", "e4"], ["e7", "e5"], ["g1", "f3"],
    ["b8", "c6"], ["f1", "c4"], ["g8", "f6"], ["e1", "g1"]
  ]) move(from, to);
  assert.ok(document.querySelector('[data-square="h1"]').classList.contains("move-origin-pulse"));
  assert.ok(document.querySelector('[data-square="f1"]').classList.contains("move-destination-pulse"));
  window.close();

  const reduced = setup();
  reduced.window.matchMedia = () => ({ matches: true });
  const setting = reduced.document.getElementById("motion-preset");
  setting.value = "system";
  setting.dispatchEvent(new reduced.window.Event("change"));
  reduced.move("e2", "e4");
  assert.ok(!reduced.document.querySelector(".move-origin-pulse"));
  assert.ok(!reduced.document.querySelector(".capture-burst"));
  assert.equal(reduced.document.getElementById("total-moves").textContent, "1 zet");
  reduced.window.close();
});


function mockActualMotion(window) {
  const animations = [];
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === "motion-layer") {
      return { left: 0, top: 0, right: 640, bottom: 640, width: 640, height: 640 };
    }
    const square = this.dataset?.square;
    if (square) {
      const col = "abcdefgh".indexOf(square[0]);
      const row = 8 - Number(square[1]);
      return { left: col * 80, top: row * 80, right: (col+1)*80, bottom: (row+1)*80, width: 80, height: 80 };
    }
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  window.Element.prototype.animate = function (keyframes, options) {
    let complete;
    const finished = new Promise((resolve) => { complete = resolve; });
    const handle = {
      element: this, keyframes, options, finished,
      finish() { complete(); },
      cancel() { complete(); }
    };
    animations.push(handle);
    return handle;
  };
  return animations;
}

test("pieces visibly travel across board on a separate overlay, rather than teleport", async () => {
  const { window, document, move } = setup();
  const animations = mockActualMotion(window);
  move("e2", "e4");

  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.duration, 650);
  assert.match(animations[0].keyframes.at(-1).transform, /-160px/);
  assert.equal(document.querySelectorAll("#motion-layer .flying-piece-square").length, 1);
  assert.ok(document.querySelector('[data-square="e4"] .piece').classList.contains("piece-in-transit"));

  // No second move can be made while the first piece is crossing the board.
  move("d7", "d5");
  assert.equal(document.getElementById("total-moves").textContent, "1 zet");
  animations[0].finish();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(document.querySelectorAll("#motion-layer .flying-piece-square").length, 0);
  assert.ok(!document.querySelector('[data-square="e4"] .piece').classList.contains("piece-in-transit"));
  move("d7", "d5");
  assert.equal(document.getElementById("total-moves").textContent, "2 zetten");
  window.close();
});

test("a computer reply only starts after the human piece finishes its flight", async () => {
  const mock = makeWorker();
  const { window, document, move } = setup(null, mock.Worker);
  const animations = mockActualMotion(window);
  const mode = document.getElementById("game-mode");
  document.getElementById("computer-level").value = "medium";
  document.getElementById("computer-level").dispatchEvent(new window.Event("change"));
  mode.value = "computer";
  mode.dispatchEvent(new window.Event("change"));
  move("e2", "e4");
  assert.equal(mock.workers.length, 0);
  animations[0].finish();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(mock.workers.length, 1);
  window.close();
});

test("animation speed setting works, is persisted, and interrupted moves clean up", () => {
  const { window, document, move } = setup();
  const animations = mockActualMotion(window);
  const preset = document.getElementById("motion-preset");
  preset.value = "slow";
  preset.dispatchEvent(new window.Event("change"));
  move("e2", "e4");
  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.duration, 1100);
  assert.equal(document.querySelectorAll(".flying-piece-square").length, 1);

  document.getElementById("undo-button").click();
  assert.equal(document.querySelectorAll(".flying-piece-square").length, 0);
  assert.equal(document.getElementById("total-moves").textContent, "0 zetten");
  assert.equal(JSON.parse(window.localStorage.getItem("masters-of-chess-local-v1")).motionPreset, "slow");

  preset.value = "off";
  preset.dispatchEvent(new window.Event("change"));
  move("d2", "d4");
  assert.equal(document.querySelectorAll(".flying-piece-square").length, 0);
  assert.equal(animations.length, 1);
  window.close();
});


test("captures visibly react on contact instead of at the start of piece travel", async () => {
  const { document, window, move } = setup();
  const animations = mockActualMotion(window);
  const settle = async () => {
    animations.at(-1).finish();
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  move("e2", "e4");
  await settle();
  move("d7", "d5");
  await settle();
  move("e4", "d5");
  assert.equal(document.querySelectorAll(".capture-victim").length, 1);
  assert.ok(!document.querySelector(".capture-victim.is-hit"));
  assert.equal(document.querySelectorAll(".capture-shard").length, 0);
  assert.equal(document.querySelectorAll(".capture-impact-word").length, 0);
  assert.equal(document.getElementById("total-moves").textContent, "3 zetten");

  await settle();
  assert.equal(document.querySelectorAll(".capture-victim.is-hit").length, 1);
  assert.equal(document.querySelectorAll(".capture-shard").length, 12);
  assert.equal(document.querySelectorAll(".capture-shockwave").length, 1);
  assert.equal(document.querySelector(".capture-impact-word")?.textContent, "GESLAGEN!");
  assert.ok(document.querySelector('[data-square="d5"]').classList.contains("capture-impact-square"));

  document.getElementById("new-game-button").click();
  assert.equal(document.querySelectorAll(".capture-shard").length, 0);
  assert.equal(document.querySelectorAll(".capture-victim").length, 0);
  window.close();
});

test("a checking move shakes the attacked king and displays SCHAAK", () => {
  const { document, window, move } = setup();
  move("e2", "e4");
  move("f7", "f6");
  move("d1", "h5");
  assert.ok(document.getElementById("status-title").textContent.includes("schaak!"));
  assert.equal(document.querySelector(".check-announcement")?.textContent, "SCHAAK!");
  assert.ok(document.querySelector('[data-square="e8"] .piece')?.classList.contains("king-struck"));
  assert.equal(document.querySelectorAll(".check-shockwave").length, 1);
  assert.ok(document.querySelector(".board-frame").classList.contains("check-shake"));
  assert.equal(document.getElementById("mate-screen").hidden, true);
  window.close();
});

test("checkmate celebration happens only after the final piece has landed", async () => {
  const { document, window, move } = setup();
  const animations = mockActualMotion(window);
  const play = async (from, to) => {
    const count = animations.length;
    move(from, to);
    assert.equal(animations.length, count + 1);
    animations.at(-1).finish();
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  for (const [from, to] of [
    ["e2","e4"],["e7","e5"],["d1","h5"],
    ["b8","c6"],["f1","c4"],["g8","f6"]
  ]) await play(from, to);

  move("h5","f7");
  assert.match(document.getElementById("status-title").textContent, /Wit wint door schaakmat/);
  assert.equal(document.getElementById("mate-screen").hidden, true);
  animations.at(-1).finish();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(document.getElementById("mate-screen").hidden, false);
  assert.equal(document.getElementById("mate-winner").textContent, "Wit wint de partij");
  assert.equal(document.querySelectorAll(".mate-spark").length, 28);
  assert.equal(document.querySelector(".check-announcement")?.textContent, "SCHAAKMAT!");
  assert.ok(document.querySelector('[data-square="e8"] .piece')?.classList.contains("king-struck"));

  document.getElementById("undo-button").click();
  assert.equal(document.getElementById("mate-screen").hidden, true);
  assert.equal(document.querySelectorAll(".mate-spark").length, 0);
  window.close();
});

test("mate overlay remains understandable with animations disabled", () => {
  const { document, window, move } = setup();
  const preset = document.getElementById("motion-preset");
  preset.value = "off";
  preset.dispatchEvent(new window.Event("change"));
  for (const [from,to] of [
    ["e2","e4"],["e7","e5"],["d1","h5"],["b8","c6"],
    ["f1","c4"],["g8","f6"],["h5","f7"]
  ]) move(from,to);
  assert.equal(document.getElementById("mate-screen").hidden, false);
  assert.equal(document.querySelectorAll(".mate-spark").length, 0);
  assert.equal(document.querySelectorAll(".capture-shard").length, 0);
  window.close();
});
