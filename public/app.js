const ws = new WebSocket("ws://localhost:4545");
/**
 * @type {HTMLDivElement}
 */
const ball = document.querySelector(".ball");
/**
 * @type {HTMLDivElement}
 */
const me = document.querySelector(".me");
/**
 * @type {HTMLDivElement}
 */
const opponent = document.querySelector(".opponent");

/**
 * @type {HTMLDivElement}
 */
const runningGames = document.querySelector(".running-games");

fetch("/api/state")
  .then((it) => it.json())
  .then(({ games }) => {
    games.forEach((gameId) => {
      const button = document.createElement("button");
      button.onclick = () => {
        ws.send(`join:${gameId}`);
      };
      button.innerText = `join game: ${gameId}`;
      runningGames.appendChild(button);
    });
  });

function createNewGame() {
  const gameId = Math.random().toString().slice(2, 8).toString();
  window.history.replaceState(undefined, "", gameId);
  ws.send(`start:${gameId}`);
}

ws.addEventListener("message", (msg) => {
  const data = msg.data;
  const msgType = data.substring(0, data.indexOf(":")).trim();
  const msgData = data.substring(data.indexOf(":") + 1).trim();
  if (msgType === "game-state") {
    const state = JSON.parse(msgData);
    const left = state.ballPosition.x;
    const top = state.ballPosition.y;
    ball.style.top = `${top}%`;
    ball.style.left = `${left}%`;
    me.style.top = `${state.meY}%`;
    opponent.style.top = `${state.opponentY}%`;
    console.log(state);
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
