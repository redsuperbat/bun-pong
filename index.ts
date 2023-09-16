import { ServerWebSocket } from "bun";
import { randomUUID } from "crypto";
import path from "path";
import utils from "node:util";

const port = 4545;
const SCALING_FACTOR = 1000;
const PLAYER_WIDTH = 1 * SCALING_FACTOR;
const PLAYER_HEIGHT = 8 * SCALING_FACTOR;

interface GameState {
  ballPosition: Position;
  playersPosition: Player[];
}

class Position {
  constructor(public x: number, public y: number) {}
  toString() {
    return `${this.x},${this.y}`;
  }
  flip() {
    return new Position(this.y, this.x);
  }
}

class Player {
  constructor(
    public readonly id: string,
    private readonly ws: ServerWebSocket<unknown>
  ) {}
  readonly height = PLAYER_HEIGHT;
  readonly width = PLAYER_WIDTH;
  #y1 = 0;
  #x1 = 0;
  get y2() {
    return this.#y1 + this.height;
  }
  get x2() {
    return this.width + this.#x1;
  }
  get x1() {
    return this.#x1;
  }
  get y1() {
    return this.#y1;
  }

  setPosition(x: number, y: number) {
    this.#y1 = y;
    this.#x1 = x;
  }

  sendGameState(state: GameState) {
    const data = {
      players: state.playersPosition.map((it) => ({
        y: it.y1,
        id: it.id,
      })),
      ballPosition: state.ballPosition,
    };
    this.ws.send(`game-state:${JSON.stringify(data)}`);
  }

  notifyWinner(winner: Player) {
    this.ws.send(`game-end:${JSON.stringify({ winner: winner.id })}`);
  }

  moveUp() {
    if (this.#y1 === 0) return;
    this.#y1 -= 2 * SCALING_FACTOR;
  }
  moveDown() {
    if (this.#y1 === 100 * SCALING_FACTOR - this.height) return;
    this.#y1 += 2 * SCALING_FACTOR;
  }

  [utils.inspect.custom]() {
    return `Player { x1: ${this.x1}, x2: ${this.x2}, y1: ${this.y1}, y2: ${this.y2} }`;
  }
}

class Ball {
  readonly position: Position = new Position(
    50 * SCALING_FACTOR,
    50 * SCALING_FACTOR
  );
  #speedX: number =
    (Math.round(Math.random()) + 1) *
    Math.sign(Math.random() - 0.5) *
    SCALING_FACTOR;
  #speedY: number =
    (Math.round(Math.random()) + 1) *
    Math.sign(Math.random() - 0.5) *
    SCALING_FACTOR;
  readonly width = 2 * SCALING_FACTOR;
  readonly height = 2 * SCALING_FACTOR;
  #gameHeight: number;
  #gameWidth: number;

  constructor(gameHeight: number, gameWidth: number) {
    this.#gameHeight = gameHeight;
    this.#gameWidth = gameWidth;
  }

  increaseSpeed() {
    if (this.#speedX === 150 || this.#speedX === -150) return;
    if (this.#speedY === 150 || this.#speedY === -150) return;
    if (this.#speedX < 0) {
      this.#speedX -= SCALING_FACTOR * 0.2;
    } else {
      this.#speedX += SCALING_FACTOR * 0.2;
    }
    if (this.#speedY < 0) {
      this.#speedY -= SCALING_FACTOR * 0.2;
    } else {
      this.#speedY += SCALING_FACTOR * 0.2;
    }
  }

  reverseX() {
    this.#speedX = -this.#speedX;
  }
  reverseY() {
    this.#speedY = -this.#speedY;
  }

  tick() {
    this.position.x += this.#speedX;
    this.position.y += this.#speedY;

    if (
      this.position.x <= 0 ||
      this.position.x >= this.#gameWidth - this.width
    ) {
      this.reverseX();
    }

    if (
      this.position.y <= 0 ||
      this.position.y >= this.#gameHeight - this.height
    ) {
      this.reverseY();
    }
  }

  [utils.inspect.custom]() {
    return `Ball { x: ${this.position.x}, y: ${this.position.y} }`;
  }
}

class Game {
  readonly gameId = randomUUID();

  #clientHeight = 100 * SCALING_FACTOR;
  #clientWidth = 100 * SCALING_FACTOR;
  #winner?: Player;
  #ball = new Ball(this.#clientHeight, this.#clientWidth);
  #players: [Player?, Player?] = [];
  #isRunning = false;
  #onGameEnd: () => void;

  constructor(id: string, player1: Player, onGameEnd: () => void) {
    this.gameId = id;
    this.#players = [player1];
    this.#onGameEnd = onGameEnd;
  }
  addPlayer(player: Player) {
    this.#players[1] = player;
  }

  tick() {
    this.#ball.tick();
    this.#players.forEach((it) => it?.sendGameState(this.state));
    // At the left most of the screen touching the player
    if (this.#ball.position.x === PLAYER_WIDTH) {
      const playerOne = this.players[0]!;
      if (
        this.#ball.position.y <= playerOne.y2 &&
        this.#ball.position.y >= playerOne.y1
      ) {
        this.#ball.reverseX();
        this.#ball.increaseSpeed();
      }
    }
    if (
      this.#ball.position.x ===
      this.#clientWidth - (this.#ball.width + PLAYER_WIDTH)
    ) {
      const playerTwo = this.players[1]!;
      if (
        this.#ball.position.y <= playerTwo.y2 &&
        this.#ball.position.y >= playerTwo.y1
      ) {
        this.#ball.reverseX();
        this.#ball.increaseSpeed();
      }
    }

    if (this.#ball.position.x <= 0) {
      this.#winner = this.players[1];
    }

    if (this.#ball.position.x >= this.#clientWidth - this.#ball.width) {
      this.#winner = this.players[0];
    }
    const winner = this.#winner;
    if (winner) {
      console.log("we have a winner!", {
        winner: winner.id,
      });
      this.players.forEach((it) => it?.notifyWinner(winner));
      this.end();
    }
  }

  get players() {
    return this.#players;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.find((it) => it?.id === id);
  }

  get state(): GameState {
    return {
      ballPosition: this.#ball.position,
      playersPosition: this.#players.filter((it): it is Player => !!it),
    };
  }

  async start() {
    if (this.#isRunning) return;
    this.#isRunning = true;
    while (this.#isRunning) {
      await new Promise((res) => setTimeout(res, 100));
      this.tick();
    }
  }
  get isFull() {
    return this.players.length === 2;
  }

  get isEmpty() {
    return this.players.length === 0;
  }

  stop() {
    if (!this.#isRunning) return;
    console.log("stopping game", this.gameId);
    this.#isRunning = false;
  }

  end() {
    this.#onGameEnd();
    this.stop();
  }

  removePlayer(id: string) {
    this.#players = this.#players.filter((it) => it?.id !== id) as [
      Player?,
      Player?
    ];
    console.log(
      "removed a player from game",
      this.gameId,
      "players:",
      this.players.length
    );
  }
}

const games = new Map<string, Game>();

const server = Bun.serve<{ gameId?: string; playerId?: string }>({
  async fetch(req) {
    const succeeded: boolean = server.upgrade(req);

    if (succeeded) {
      return;
    }

    const url = new URL(req.url);
    if (url.pathname.includes("public") && !url.pathname.endsWith("public")) {
      return new Response(Bun.file(path.join(".", url.pathname)));
    }

    if (url.pathname.endsWith("api/state")) {
      const data = {
        games: [...games.values()].map((it) => it.gameId),
      };
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(Bun.file("./public/index.html"));
  },
  websocket: {
    message(ws, message) {
      const messageType = message
        .toString()
        .slice(0, message.toString().indexOf(":"));
      const messageData = message
        .toString()
        .slice(message.indexOf(":") + 1)
        .trim();

      if (messageType === "start") {
        const gameId = messageData;
        if (!gameId) return;

        const game = games.get(gameId);

        if (!game) {
          const onEnd = () => {
            games.delete(gameId);
          };
          const playerId = "player-1";
          const player1 = new Player(playerId, ws);
          const game = new Game(gameId, player1, onEnd);
          console.log("player created a new game", game.players.length);
          ws.data.gameId = gameId;
          ws.data.playerId = playerId;
          games.set(gameId, game);
          const subId = `game-started-${gameId}`;
          console.log({ subId });
          ws.subscribe(subId);
          ws.publish(
            "game-created",
            `game-created:${JSON.stringify({ gameId })}`
          );
          return;
        }
      }

      if (messageType === "join") {
        const playerId = "player-2";
        const gameId = messageData;
        const game = games.get(gameId);
        if (!game) return;
        if (game.isEmpty) return;
        if (game.isFull) return;
        console.log("second player joined, starting game", game.gameId);
        const player2 = new Player(playerId, ws);
        game.addPlayer(player2);
        ws.data.gameId = game.gameId;
        ws.data.playerId = playerId;
        const countdown = 5000;
        const data = `game-started:${JSON.stringify({ countdown })}`;
        const subId = `game-started-${gameId}`;
        console.log({ subId, data });
        ws.publish(subId, data);
        ws.send(data);
        setTimeout(() => {
          game.start();
        }, countdown);
      }
      if (messageType === "move-up") {
        const game = games.get(ws.data.gameId ?? "");
        const player = game?.getPlayer(ws.data.playerId ?? "");
        if (!player) return;
        player.moveUp();
      }
      if (messageType === "move-down") {
        const game = games.get(ws.data.gameId ?? "");
        const player = game?.getPlayer(ws.data.playerId ?? "");
        if (!player) return;
        player.moveDown();
      }
    },
    open(ws) {
      ws.data = {};
      console.log("client connected!");
      ws.subscribe("game-created");
    },
    close(ws) {
      const gameId = ws.data.gameId ?? "";
      const game = games.get(gameId);
      if (!game) return;
      game.stop();
      game.removePlayer(ws.data.playerId ?? "");
      if (game.isEmpty) {
        games.delete(gameId);
      }
    },
  },
  port,
});

console.log("server started on port", port);
