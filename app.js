import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎" }
};
const NAMES = {
  w: { k: "witte koning", q: "witte dame", r: "witte toren", b: "witte loper", n: "wit paard", p: "witte pion" },
  b: { k: "zwarte koning", q: "zwarte dame", r: "zwarte toren", b: "zwarte loper", n: "zwart paard", p: "zwarte pion" }
};
const PROMOTIONS = ["q", "r", "b", "n"];
const STORAGE_KEY = "masters-of-chess-local-v1";
const $ = (id) => document.getElementById(id);
const opposite = (color) => color === "w" ? "b" : "w";
const colorName = (color) => color === "w" ? "Wit" : "Zwart";

const COMPUTER_LEVELS = {
  beginner: { skill: 0, depth: 2, time: 180 },
  easy: { skill: 3, depth: 5, time: 300 },
  medium: { skill: 10, depth: 10, time: 700 },
  hard: { skill: 18, depth: 16, time: 1500 }
};

/**
 * Runs Stockfish as a same-origin classic Web Worker. The build is installed
 * as a static asset during deployment (no cross-origin isolation required).
 * Only the currently outstanding position may receive a bestmove response.
 */
class StockfishOpponent {
  constructor(onMove, onFailure) {
    this.onMove = onMove;
    this.onFailure = onFailure;
    this.worker = null;
    this.ready = false;
    this.job = null;
    this.bootTimer = null;
  }

  ask(fen, level) {
    this.job = { fen, level };
    if (this.ready) {
      this.search();
      return;
    }
    if (this.worker) return;
    this.worker = new Worker("./engine/stockfish-19-lite-single.js");
    this.worker.onmessage = (event) => {
      for (const line of String(event.data ?? "").split(/\r?\n/)) {
        const message = line.trim();
        if (message === "readyok") {
          this.ready = true;
          window.clearTimeout(this.bootTimer);
          if (this.job) this.search();
        } else if (message.startsWith("bestmove ")) {
          const job = this.job;
          this.job = null;
          if (!job) continue;
          const uci = message.split(/\s+/)[1];
          if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || "")) {
            this.fail();
            return;
          }
          this.onMove({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            ...(uci.length === 5 ? { promotion: uci[4] } : {})
          }, job.fen);
        }
      }
    };
    this.worker.onerror = (event) => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      this.fail();
    };
    this.worker.postMessage("uci");
    this.worker.postMessage("isready");
    this.bootTimer = window.setTimeout(() => this.fail(), 20000);
  }

  search() {
    if (!this.worker || !this.job) return;
    const setting = COMPUTER_LEVELS[this.job.level] || COMPUTER_LEVELS.medium;
    this.worker.postMessage("setoption name Skill Level value " + setting.skill);
    this.worker.postMessage("position fen " + this.job.fen);
    this.worker.postMessage("go depth " + setting.depth + " movetime " + setting.time);
  }

  fail() {
    const job = this.job;
    this.dispose();
    if (job) this.onFailure(job.fen);
  }

  dispose() {
    window.clearTimeout(this.bootTimer);
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = false;
    this.job = null;
  }
}


let game = new Chess();
let selected = null;
let pendingPromotion = null;
let flipped = false;
let control = $("time-control").value;
let initialMs = 0;
let incrementMs = 0;
let remaining = { w: 0, b: 0 };
let running = false;
let hasStarted = false;
let anchor = Date.now();
let result = null;
let moveClocks = [];
let positionKeys = [];
let toastTimer = 0;
let gameMode = $("game-mode").value;
let playerColor = $("player-color").value;
let computerLevel = $("computer-level").value;
let computer = null;
let computerThinking = false;
let computerToken = 0;
let engineUnavailable = false;

function isComputerTurn() {
  return gameMode === "computer" && game.turn() !== playerColor && !result;
}

function cancelComputer() {
  computerToken++;
  computerThinking = false;
  if (computer) computer.dispose();
  computer = null;
}

function fallbackMove() {
  const candidates = game.moves({ verbose: true });
  if (!candidates.length) return null;
  if (computerLevel === "beginner") return candidates[Math.floor(Math.random() * candidates.length)];
  const values = { p: 100, n: 315, b: 335, r: 500, q: 900, k: 0 };
  const scored = candidates.map((move) => {
    let value = move.captured ? (values[move.captured] || 0) : 0;
    if (move.promotion) value += values[move.promotion] || 0;
    game.move(move);
    if (game.isCheckmate()) value += 100000;
    else if (game.isCheck()) value += 35;
    // The reserve engine avoids a move if an immediate recapture is possible.
    const replies = game.moves({ verbose: true });
    let biggestRecapture = 0;
    for (const reply of replies) {
      if (reply.to === move.to && reply.captured) {
        biggestRecapture = Math.max(biggestRecapture, values[reply.captured] || 0);
      }
    }
    value -= biggestRecapture * 0.65;
    game.undo();
    value += (Math.random() - 0.5) * (computerLevel === "easy" ? 150 : 35);
    return { move, value };
  });
  scored.sort((a, b) => b.value - a.value);
  if (computerLevel === "easy") return scored[Math.floor(Math.random() * Math.min(3, scored.length))].move;
  return scored[0].move;
}

function startComputerTurn() {
  if (!isComputerTurn() || computerThinking) return;
  computerThinking = true;
  const token = ++computerToken;
  const fen = game.fen();
  renderStatus();
  renderClocks();

  const accept = (move, expectedFen) => {
    if (token !== computerToken || game.fen() !== expectedFen || !isComputerTurn()) return;
    computerThinking = false;
    playMove(move.from, move.to, move.promotion, "computer");
  };
  const useFallback = (expectedFen) => {
    if (token !== computerToken || game.fen() !== expectedFen || !isComputerTurn()) return;
    if (computer) computer.dispose();
    computer = null;
    engineUnavailable = true;
    $("computer-help").textContent = "Stockfish is niet beschikbaar. De eenvoudige reservecomputer speelt verder.";
    $("computer-help").classList.add("is-error");
    window.setTimeout(() => {
      if (token !== computerToken || game.fen() !== fen || !isComputerTurn()) return;
      const move = fallbackMove();
      if (move) accept(move, fen);
    }, 300);
  };
  if (engineUnavailable) {
    useFallback(fen);
    return;
  }
  try {
    if (!computer) computer = new StockfishOpponent(accept, useFallback);
    computer.ask(fen, computerLevel);
  } catch {
    useFallback(fen);
  }
}


function parseControl(value) {
  if (value === "unlimited") return { initial: 0, increment: 0 };
  const [minutes, seconds] = value.split("+").map(Number);
  return { initial: minutes * 60000, increment: seconds * 1000 };
}

function repetitionKey() {
  // Piece placement, side, castling and en-passant target identify the position.
  return game.fen().split(" ").slice(0, 4).join(" ");
}

function repetitions() {
  const key = repetitionKey();
  return positionKeys.filter((value) => value === key).length;
}

function halfmoveCount() {
  return Number(game.fen().split(" ")[4]);
}

function isTimed() {
  return control !== "unlimited";
}

function clockText(milliseconds) {
  if (!isTimed()) return "∞";
  const ms = Math.max(0, milliseconds);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor(ms % 60000 / 1000);
  const base = String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  return ms < 20000 ? base + "." + Math.floor(ms % 1000 / 100) : base;
}

function canEverMate(color) {
  const pieces = game.board().flat().filter(Boolean);
  const attackers = pieces.filter((p) => p.color === color && p.type !== "k");
  const defenders = pieces.filter((p) => p.color !== color && p.type !== "k");
  if (!attackers.length) return false;
  if (attackers.some((p) => "pqr".includes(p.type))) return true;
  if (defenders.length) return true;
  if (attackers.length === 1) return false;
  if (attackers.some((p) => p.type === "n")) return true;

  // Bishops confined to one square color cannot mate a bare king.
  const squareColors = new Set(attackers.map((p) => {
    const file = "abcdefgh".indexOf(p.square[0]);
    return (file + Number(p.square[1])) % 2;
  }));
  return squareColors.size > 1;
}

function finish(text, score) {
  result = { text, score };
  running = false;
  cancelComputer();
  game.header("Result", score);
}

function autoFinish() {
  if (game.isCheckmate()) {
    const winner = opposite(game.turn());
    finish(colorName(winner) + " wint door schaakmat!", winner === "w" ? "1-0" : "0-1");
  } else if (game.isStalemate()) {
    finish("Remise door pat.", "1/2-1/2");
  } else if (game.isInsufficientMaterial()) {
    finish("Remise: onvoldoende materiaal.", "1/2-1/2");
  } else if (repetitions() >= 5) {
    finish("Remise: vijfmaal dezelfde stelling.", "1/2-1/2");
  } else if (halfmoveCount() >= 150) {
    finish("Remise: 75 zetten zonder pionzet of slag.", "1/2-1/2");
  }
}

function chargeClock() {
  if (!running || !isTimed() || result) return;
  const now = Date.now();
  const elapsed = Math.max(0, now - anchor);
  anchor = now;
  const player = game.turn();
  remaining[player] = Math.max(0, remaining[player] - elapsed);
  if (remaining[player] > 0) return;
  const opponent = opposite(player);
  if (canEverMate(opponent)) {
    finish(colorName(opponent) + " wint op tijd!", opponent === "w" ? "1-0" : "0-1");
  } else {
    finish("Remise: tijd verstreken, mat onmogelijk.", "1/2-1/2");
  }
  persist();
  renderAll();
}

function getSquares() {
  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = flipped ? 7 - col : col;
      const rank = flipped ? row + 1 : 8 - row;
      squares.push({
        square: "abcdefgh"[file] + rank,
        file, rank, row, col
      });
    }
  }
  return squares;
}

function renderBoard() {
  const board = $("board");
  board.replaceChildren();
  board.setAttribute("aria-label", flipped ? "Schaakbord, zwart onderaan" : "Schaakbord, wit onderaan");
  const options = selected && !result ? game.moves({ square: selected, verbose: true }) : [];
  const destinations = new Set(options.map((move) => move.to));
  const last = game.history({ verbose: true }).at(-1);
  const attackedKing = game.isCheck()
    ? game.board().flat().find((p) => p && p.color === game.turn() && p.type === "k")?.square
    : null;

  for (const { square, file, rank, row, col } of getSquares()) {
    const piece = game.get(square);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "square " + ((file + rank) % 2 === 0 ? "light" : "dark");
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", square + (piece ? ", " + NAMES[piece.color][piece.type] : ", leeg"));
    button.setAttribute("aria-selected", String(selected === square));
    if (last && (last.from === square || last.to === square)) button.classList.add("last");
    if (attackedKing === square) button.classList.add("in-check");
    if (selected === square) button.classList.add("selected");

    if (destinations.has(square)) {
      const marker = document.createElement("span");
      marker.className = piece ? "capture-ring" : "dot";
      marker.setAttribute("aria-hidden", "true");
      button.append(marker);
    }
    if (piece) {
      const symbol = document.createElement("span");
      symbol.className = "piece " + (piece.color === "w" ? "white-piece" : "black-piece");
      symbol.textContent = PIECES[piece.color][piece.type];
      symbol.setAttribute("aria-hidden", "true");
      button.append(symbol);
    }
    if (col === 0) {
      const coordinate = document.createElement("span");
      coordinate.className = "coord rank";
      coordinate.textContent = String(rank);
      button.append(coordinate);
    }
    if (row === 7) {
      const coordinate = document.createElement("span");
      coordinate.className = "coord file";
      coordinate.textContent = "abcdefgh"[file];
      button.append(coordinate);
    }
    button.addEventListener("click", () => chooseSquare(square));
    board.append(button);
  }
}

function chooseSquare(square) {
  if (result || pendingPromotion || isComputerTurn()) return;
  const piece = game.get(square);

  if (selected === square) {
    selected = null;
    renderBoard();
    return;
  }
  if (piece && piece.color === game.turn()) {
    selected = square;
    renderBoard();
    return;
  }
  if (!selected) return;

  const options = game.moves({ square: selected, verbose: true }).filter((move) => move.to === square);
  if (!options.length) {
    selected = null;
    renderBoard();
    return;
  }
  if (options.some((move) => move.promotion)) {
    openPromotion(selected, square);
    return;
  }
  playMove(selected, square);
}

function openPromotion(from, to) {
  pendingPromotion = { from, to };
  const container = $("promotion-choices");
  container.replaceChildren();
  for (const piece of PROMOTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-choice";
    button.textContent = PIECES[game.turn()][piece];
    button.setAttribute("aria-label", NAMES[game.turn()][piece]);
    button.addEventListener("click", () => {
      const choice = pendingPromotion;
      pendingPromotion = null;
      $("promotion-dialog").close();
      if (choice) playMove(choice.from, choice.to, piece);
    });
    container.append(button);
  }
  $("promotion-dialog").showModal();
}

function playMove(from, to, promotion, source = "human") {
  if (result) return;
  if (gameMode === "computer" && ((source === "computer") !== (game.turn() !== playerColor))) return;
  const legal = game.moves({ square: from, verbose: true }).some(
    (move) => move.to === to && (move.promotion || undefined) === promotion
  );
  if (!legal) {
    notify("Deze zet is niet toegestaan.");
    return;
  }

  chargeClock();
  if (result) return;
  const player = game.turn();
  moveClocks.push({ w: remaining.w, b: remaining.b, hasStarted });
  game.move({ from, to, ...(promotion ? { promotion } : {}) });
  positionKeys.push(repetitionKey());
  if (isTimed()) {
    remaining[player] += incrementMs;
    if (!hasStarted) {
      hasStarted = true;
      running = true;
    }
    if (running) anchor = Date.now();
  }
  selected = null;
  autoFinish();
  persist();
  renderAll();
  if (!result) startComputerTurn();
}

function renderMoves() {
  const list = $("move-list");
  const history = game.history({ verbose: true });
  list.replaceChildren();

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-moves";
    empty.textContent = "De eerste zet verschijnt hier.";
    list.append(empty);
  } else {
    for (let index = 0; index < history.length; index += 2) {
      const row = document.createElement("div");
      row.className = "move-row";
      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = String(index / 2 + 1) + ".";
      row.append(number);
      for (const offset of [0, 1]) {
        const san = document.createElement("span");
        san.className = "move-san" + (index + offset === history.length - 1 ? " current" : "");
        san.textContent = history[index + offset]?.san || "—";
        row.append(san);
      }
      list.append(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  $("total-moves").textContent = history.length + (history.length === 1 ? " zet" : " zetten");
  $("undo-button").disabled = history.length === 0 ||
    (gameMode === "computer" && !history.some((move) => move.color === playerColor));
  $("pgn-button").disabled = history.length === 0;
  $("move-count").textContent = "ZET " + (Math.floor(history.length / 2) + 1);
}

function renderStatus() {
  $("computer-settings").hidden = gameMode !== "computer";
  $("game-mode").value = gameMode;
  $("player-color").value = playerColor;
  $("computer-level").value = computerLevel;
  $("header-pill").lastChild.textContent = gameMode === "computer"
    ? " Tegen Stockfish · 1 speler" : " Lokale partij · 2 spelers";
  $("board-tip").textContent = gameMode === "computer"
    ? "Kies een stuk wanneer jij aan zet bent" : "Tik eerst op een stuk en daarna op het doelveld";
  $("end-helper").textContent = gameMode === "computer"
    ? "Tegen de computer kun je opgeven of remise claimen volgens de schaakregels."
    : "Je kunt onderling remise afspreken. Online partijen volgen later.";
  $("white-player").classList.toggle("is-computer", gameMode === "computer" && playerColor === "b");
  $("black-player").classList.toggle("is-computer", gameMode === "computer" && playerColor === "w");
  $("white-player").querySelector(".player-name").textContent =
    gameMode === "computer" ? (playerColor === "w" ? "Jij · Wit" : "Computer · Wit") : "Wit";
  $("black-player").querySelector(".player-name").textContent =
    gameMode === "computer" ? (playerColor === "b" ? "Jij · Zwart" : "Computer · Zwart") : "Zwart";

  const title = $("status-title");
  const description = $("status-description");
  const color = game.turn();
  $("status-icon").textContent = result ? "♛" : PIECES[color].p;
  if (result) {
    title.textContent = result.text;
    description.textContent = "De partij is beëindigd. Start een nieuw spel of sla de PGN op.";
  } else if (isComputerTurn()) {
    title.textContent = computerThinking ? "Computer denkt na…" : "Computer aan zet";
    description.textContent = engineUnavailable
      ? "De reservecomputer zoekt een geldige zet."
      : computerThinking ? "Stockfish berekent zijn volgende zet." : "Stockfish wordt gestart.";
  } else {
    title.textContent = (gameMode === "computer"
      ? "Jij bent aan zet · " + colorName(color)
      : colorName(color) + " aan zet") + (game.isCheck() ? " · schaak!" : "");
    description.textContent = game.isCheck()
      ? "Je koning staat schaak. Speel een geldige verdedigende zet."
      : (running ? "De schaakklok loopt." : "Selecteer een stuk en een doelveld.");
  }

  const claimable = !result && (!isComputerTurn()) && (repetitions() >= 3 || halfmoveCount() >= 100);
  $("claim-container").hidden = !claimable;
  $("claim-button").textContent = repetitions() >= 3
    ? "Claim remise · driemaal herhaling" : "Claim remise · 50-zettenregel";
  $("draw-button").disabled = Boolean(result) || gameMode === "computer";
  $("resign-button").disabled = Boolean(result);
  $("clock-button").disabled = Boolean(result) || !isTimed();
  $("clock-button").textContent = running ? "Ⅱ Pauzeer klok" : "▶ " + (hasStarted ? "Hervat klok" : "Start klok");
  $("clock-help").textContent = !isTimed()
    ? "Deze partij wordt zonder bedenktijd gespeeld."
    : !hasStarted
      ? "Start de klok voor de eerste zet. Zonder start loopt hij automatisch na de eerste zet."
      : running
        ? "De actieve speler verbruikt nu bedenktijd."
        : result ? "De partij is afgerond." : "De klok staat stil.";
}

function renderClocks() {
  for (const color of ["w", "b"]) {
    const node = $("clock-" + color);
    const active = game.turn() === color && !result;
    node.textContent = clockText(remaining[color]);
    node.classList.toggle("is-running", Boolean(active && running));
    node.classList.toggle("is-low", isTimed() && remaining[color] < 30000);
    $("black-player".replace("black", color === "w" ? "white" : "black")).classList.toggle("is-active", active);
    $(color === "w" ? "white-subtitle" : "black-subtitle").textContent = result
      ? "Partij beëindigd"
      : active && isComputerTurn() ? "Denkt na…"
        : active ? running ? "Klok loopt" : "Aan zet"
        : "Wacht op tegenstander";
  }
}

function renderAll() {
  renderBoard();
  renderMoves();
  renderStatus();
  renderClocks();
}

function resetGame() {
  cancelComputer();
  gameMode = $("game-mode").value;
  playerColor = $("player-color").value;
  computerLevel = $("computer-level").value;
  engineUnavailable = false;
  $("computer-help").textContent = "Je speelt tegen Stockfish. De computer reageert automatisch op je zet.";
  $("computer-help").classList.remove("is-error");
  if (gameMode === "computer") flipped = playerColor === "b";
  else flipped = false;
  game = new Chess();
  selected = null;
  pendingPromotion = null;
  if ($("promotion-dialog").open) $("promotion-dialog").close();
  control = $("time-control").value;
  const preset = parseControl(control);
  initialMs = preset.initial;
  incrementMs = preset.increment;
  remaining = { w: initialMs, b: initialMs };
  running = false;
  hasStarted = false;
  anchor = Date.now();
  result = null;
  moveClocks = [];
  positionKeys = [repetitionKey()];
  persist();
  renderAll();
  startComputerTurn();
}

function confirmNewGame() {
  if (game.history().length && !window.confirm("Huidige partij beëindigen en opnieuw beginnen?")) return false;
  resetGame();
  return true;
}

function undoMove() {
  const history = game.history({ verbose: true });
  if (!history.length) return;
  if (gameMode === "computer" && !history.some((move) => move.color === playerColor)) return;
  chargeClock();
  cancelComputer();
  const last = history.at(-1);
  const steps = gameMode === "computer" && last.color !== playerColor ? 2 : 1;
  for (let count = 0; count < steps; count++) {
    game.undo();
    const snapshot = moveClocks.pop();
    remaining = { w: snapshot?.w ?? initialMs, b: snapshot?.b ?? initialMs };
    hasStarted = snapshot?.hasStarted ?? false;
    positionKeys.pop();
  }
  running = false;
  anchor = Date.now();
  result = null;
  selected = null;
  if (typeof game.removeHeader === "function") game.removeHeader("Result");
  persist();
  renderAll();
  notify(steps === 2 ? "Jouw zet en die van de computer teruggenomen." : "Zet teruggenomen. De klok is gepauzeerd.");
  startComputerTurn();
}

function claimDraw() {
  if (result || (repetitions() < 3 && halfmoveCount() < 100)) return;
  const reason = repetitions() >= 3 ? "driemaal dezelfde stelling" : "50-zettenregel";
  finish("Remise geclaimd: " + reason + ".", "1/2-1/2");
  persist();
  renderAll();
}

function toastMessage(text) {
  const node = $("toast");
  node.textContent = text;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("visible"), 2600);
}
const notify = toastMessage;

function persist() {
  try {
    const moves = game.history({ verbose: true }).map((move) => ({
      from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {})
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      moves, control, remaining, hasStarted, moveClocks, positionKeys, result, flipped,
      gameMode, playerColor, computerLevel
    }));
  } catch {
    // The game remains playable if browser storage is unavailable.
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.moves) || !Array.isArray(saved.moveClocks) || !Array.isArray(saved.positionKeys)) return false;
    if (![...$("time-control").options].some((option) => option.value === saved.control)) return false;
    const loaded = new Chess();
    for (const move of saved.moves) loaded.move(move);
    if (saved.positionKeys.length !== saved.moves.length + 1 || saved.moveClocks.length !== saved.moves.length) return false;

    cancelComputer();
    gameMode = saved.gameMode === "computer" ? "computer" : "local";
    playerColor = saved.playerColor === "b" ? "b" : "w";
    computerLevel = Object.hasOwn(COMPUTER_LEVELS, saved.computerLevel)
      ? saved.computerLevel : "medium";
    $("game-mode").value = gameMode;
    $("player-color").value = playerColor;
    $("computer-level").value = computerLevel;
    engineUnavailable = false;
    $("computer-help").textContent = "Je speelt tegen Stockfish. De computer reageert automatisch op je zet.";
    $("computer-help").classList.remove("is-error");
    game = loaded;
    control = saved.control;
    $("time-control").value = control;
    const preset = parseControl(control);
    initialMs = preset.initial;
    incrementMs = preset.increment;
    remaining = {
      w: Math.max(0, Math.min(initialMs + 100000000, Number(saved.remaining?.w) || 0)),
      b: Math.max(0, Math.min(initialMs + 100000000, Number(saved.remaining?.b) || 0))
    };
    hasStarted = Boolean(saved.hasStarted);
    running = false; // Never charge time while the page is closed.
    anchor = Date.now();
    moveClocks = saved.moveClocks;
    positionKeys = saved.positionKeys;
    result = saved.result && typeof saved.result.text === "string" ? saved.result : null;
    flipped = Boolean(saved.flipped);
    if (!result) autoFinish();
    return true;
  } catch {
    return false;
  }
}

$("flip-button").addEventListener("click", () => {
  flipped = !flipped;
  persist();
  renderBoard();
});

$("fen-button").addEventListener("click", async () => {
  const fen = game.fen();
  try {
    await navigator.clipboard.writeText(fen);
    notify("FEN gekopieerd.");
  } catch {
    window.prompt("Kopieer de FEN:", fen);
  }
});

$("clock-button").addEventListener("click", () => {
  if (result || !isTimed()) return;
  if (running) {
    chargeClock();
    running = false;
  } else {
    hasStarted = true;
    running = true;
    anchor = Date.now();
  }
  persist();
  renderStatus();
  renderClocks();
});

$("new-game-button").addEventListener("click", confirmNewGame);

function changedGameSettings(select, previous) {
  if (game.history().length &&
    !window.confirm("Deze instelling start een nieuwe partij. De huidige partij beëindigen?")) {
    select.value = previous;
    return;
  }
  resetGame();
}

$("game-mode").addEventListener("change", (event) =>
  changedGameSettings(event.target, gameMode));
$("player-color").addEventListener("change", (event) =>
  changedGameSettings(event.target, playerColor));
$("computer-level").addEventListener("change", (event) => {
  computerLevel = event.target.value;
  cancelComputer();
  persist();
  renderStatus();
  startComputerTurn();
});

$("time-control").addEventListener("change", (event) => {
  const next = event.target.value;
  if (game.history().length && !window.confirm("Een andere bedenktijd start een nieuwe partij. Doorgaan?")) {
    event.target.value = control;
    return;
  }
  $("time-control").value = next;
  resetGame();
});

$("undo-button").addEventListener("click", undoMove);
$("claim-button").addEventListener("click", claimDraw);

$("draw-button").addEventListener("click", () => {
  if (result || !window.confirm("Zijn beide spelers akkoord met remise?")) return;
  if (gameMode === "computer") return;
  finish("Remise in onderling overleg.", "1/2-1/2");
  persist();
  renderAll();
});

$("resign-button").addEventListener("click", () => {
  const quitter = gameMode === "computer" ? playerColor : game.turn();
  if (result || !window.confirm(colorName(quitter) + " geeft op. Klopt dat?")) return;
  const winner = opposite(quitter);
  finish(colorName(winner) + " wint: " + colorName(quitter) + " geeft op.", winner === "w" ? "1-0" : "0-1");
  persist();
  renderAll();
});

$("pgn-button").addEventListener("click", () => {
  if (!game.history().length) return;
  const blob = new Blob([game.pgn() + "\n"], { type: "application/x-chess-pgn;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchorEl = document.createElement("a");
  anchorEl.href = url;
  anchorEl.download = "masters-of-chess-" + new Date().toISOString().slice(0, 10) + ".pgn";
  document.body.append(anchorEl);
  anchorEl.click();
  anchorEl.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("Partijbestand opgeslagen.");
});

function cancelPromotion() {
  pendingPromotion = null;
  if ($("promotion-dialog").open) $("promotion-dialog").close();
}
$("promotion-cancel").addEventListener("click", cancelPromotion);
$("promotion-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelPromotion();
});

if (!restore()) resetGame();
renderAll();
startComputerTurn();
window.setInterval(() => {
  if (running) {
    chargeClock();
    renderClocks();
  }
}, 100);
