import { ServerWebSocket } from "bun";
import { randomUUID } from "crypto";
import path from "path";

const port = 4545;

interface GameState {
  ballPosition: Position;
  score: number;
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

class Area {
  constructor(
    public readonly position: Position,
    public readonly height: number,
    public readonly width: number
  ) {}

  intersects(area: Area) {
    // Calculate the right and bottom edges of each area
    const area1Right = this.position.x + this.width;
    const area1Bottom = this.position.y + this.height;
    const area2Right = area.position.x + area.width;
    const area2Bottom = area.position.y + area.height;

    // Check for intersection by comparing the edges
    return (
      this.position.x < area2Right &&
      area1Right > area.position.x &&
      this.position.y < area2Bottom &&
      area1Bottom > area.position.y
    );
  }
}

class Player {
  constructor(
    public readonly id: string,
    private readonly ws: ServerWebSocket<unknown>
  ) {}
  #position: Position = new Position(0, 0);
  #area: Area = new Area(this.#position, 8, 1);

  setPosition(x: number, y: number) {
    this.#position = new Position(x, y);
  }

  get position(): Position {
    return this.#position;
  }

  get area() {
    return this.#area;
  }

  sendGameState(state: GameState) {
    const data = {
      players: state.playersPosition.map((it) => ({
        y: it.#position.y,
        id: it.id,
      })),
      score: state.score,
      ballPosition: state.ballPosition,
    };
    this.ws.send(`game-state:${JSON.stringify(data)}`);
  }

  moveUp() {
    if (this.position.y === 0) return;
    this.position.y -= 2;
  }
  moveDown() {
    if (this.position.y === 100) return;
    this.position.y += 2;
  }
}

class Ball {
  readonly position: Position = new Position(50, 50);
  #area: Area = new Area(this.position, 2, 2);
  #speedX: number = 1;
  #speedY: number = 2;
  #width = 2;
  #height = 2;
  #gameHeight: number;
  #gameWidth: number;

  constructor(gameHeight: number, gameWidth: number) {
    this.#gameHeight = gameHeight;
    this.#gameWidth = gameWidth;
  }

  increaseSpeed() {
    this.#speedX += 1;
    this.#speedY += 1;
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
      this.position.x >= this.#gameWidth - this.#width
    ) {
      this.reverseX();
    }

    if (
      this.position.y <= 0 ||
      this.position.y >= this.#gameHeight - this.#height
    ) {
      this.reverseY();
    }
    return this.#area;
  }
}

class Game {
  readonly gameId = randomUUID();

  #clientHeight = 100;
  #clientWidth = 100;
  #score = 0;
  #ball = new Ball(this.#clientHeight, this.#clientWidth);
  #players: [Player?, Player?] = [];
  #isRunning = false;

  constructor(id: string, player1: Player) {
    this.gameId = id;
    this.#players = [player1];
  }
  addPlayer(player: Player) {
    this.#players[1] = player;
  }

  tick() {
    const ballArea = this.#ball.tick();
    this.players.forEach((it) => {
      const isIntersecting = it?.area.intersects(ballArea);
      if (isIntersecting) {
        console.log("reversing ball", this.#ball.position);
        this.#ball.reverseX();
        console.log("reversing ball", this.#ball.position);
      }
    });
    this.#players.forEach((it) => it?.sendGameState(this.state));
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
      score: this.#score,
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
          const playerId = "player-1";
          const player1 = new Player(playerId, ws);
          const game = new Game(gameId, player1);
          console.log("player created a new game", game.players.length);
          ws.data.gameId = gameId;
          ws.data.playerId = playerId;
          games.set(gameId, game);
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
        game.start();
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
      console.log("client connected!");
      ws.data = {};
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
