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

function setup(saved = null) {
  const dom = new JSDOM(html, {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.__Chess = Chess;
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
