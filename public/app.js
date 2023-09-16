const ws = new WebSocket("ws://localhost:4545");
/**
 * @type {HTMLDivElement}
 */
const ball = document.querySelector(".ball");
/**
 * @type {HTMLDivElement}
 */
const player1 = document.querySelector(".player-1");
/**
 * @type {HTMLDivElement}
 */
const player2 = document.querySelector(".player-2");
/**
 * @type {HTMLDivElement}
 */
const winner = document.querySelector(".winner");

/**
 * @type {HTMLDivElement}
 */
const runningGames = document.querySelector(".running-games");
/**
 * @type {HTMLDivElement}
 */
const countdownEl = document.querySelector(".countdown");

function addGame(gameId) {
  console.log("adding game...");
  const button = document.createElement("button");
  button.onclick = () => {
    document
      .querySelector(".player-title-2")
      .classList.add("player-title-active");
    ws.send(`join:${gameId}`);
  };
  button.innerText = `join game: ${gameId}`;
  runningGames.appendChild(button);
}

function startGame(timeToWait) {
  let countdown = Math.round(timeToWait / 1000);
  countdownEl.innerText = countdown;
  let interval = setInterval(() => {
    countdown -= 1;

    if (countdown === 0) {
      countdownEl.innerText = "START!!!!";
      clearInterval(interval);
      setTimeout(() => (countdownEl.hidden = true), 400);
    } else {
      countdownEl.innerText = countdown;
    }
  }, 1000);
}

fetch("/api/state")
  .then((it) => it.json())
  .then(({ games }) => games.forEach(addGame));

function createNewGame() {
  const gameId = Math.random().toString().slice(2, 8).toString();
  window.history.replaceState(undefined, "", gameId);
  ws.send(`start:${gameId}`);
  document
    .querySelector(".player-title-1")
    .classList.add("player-title-active");
}

ws.addEventListener("message", (msg) => {
  const data = msg.data;
  const msgType = data.substring(0, data.indexOf(":")).trim();
  const msgData = data.substring(data.indexOf(":") + 1).trim();
  console.log({ msgType, msgData });
  if (msgType === "game-state") {
    const state = JSON.parse(msgData);
    const left = state.ballPosition.x;
    const top = state.ballPosition.y;
    ball.style.top = `${top / 100}%`;
    ball.style.left = `${left / 100}%`;
    const player1Location = state.players.find((it) => it.id === "player-1");
    const player2Location = state.players.find((it) => it.id === "player-2");
    player1.style.top = `${player1Location.y}%`;
    player2.style.top = `${player2Location.y}%`;
  }
  if (msgType === "game-end") {
    winner.innerText = `WINNER IS: ${JSON.parse(msgData).winner}`;
  }
  if (msgType === "game-created") {
    addGame(JSON.parse(msgData).gameId);
  }
  if (msgType === "game-started") {
    startGame(JSON.parse(msgData).countdown);
  }
});

window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowUp") {
    ws.send("move-up:");
  }
  if (e.code === "ArrowDown") {
    ws.send("move-down:");
  }
});
