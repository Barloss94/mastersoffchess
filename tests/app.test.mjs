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

function setup(saved = null, WorkerClass = null) {
  const dom = new JSDOM(html, {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.__Chess = Chess;
  if (WorkerClass) window.Worker = WorkerClass;
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
