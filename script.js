const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const highScoreEl = document.getElementById("high-score");
const levelEl = document.getElementById("level");
const overlayEl = document.getElementById("overlay");
const statusTagEl = document.getElementById("status-tag");
const statusTitleEl = document.getElementById("status-title");
const statusTextEl = document.getElementById("status-text");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");
const soundToggle = document.getElementById("sound-toggle");

const STORAGE_KEY = "space-adventure-high-score";
const TAU = Math.PI * 2;
const pointer = { active: false, x: 0 };
const keys = { left: false, right: false };

let width = 0;
let height = 0;
let pixelRatio = 1;
let lastTime = 0;
let audioEnabled = true;
let audioCtx = null;

function readHighScore() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY) || 0);
  } catch {
    return 0;
  }
}

function persistHighScore(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures in restricted browser modes.
  }
}

const game = {
  started: false,
  running: false,
  gameOver: false,
  score: 0,
  highScore: readHighScore(),
  level: 1,
  elapsed: 0,
  asteroidTimer: 0,
  starTimer: 0,
  cometTimer: 0,
  flash: 0,
  rocket: null,
  asteroids: [],
  stars: [],
  particles: [],
  backgroundStars: [],
  comets: []
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function initializeAudio() {
  if (!audioEnabled || audioCtx) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    audioEnabled = false;
    updateSoundButton();
    return;
  }

  audioCtx = new AudioContextClass();
}

async function ensureAudioReady() {
  if (!audioEnabled) {
    return false;
  }

  initializeAudio();

  if (!audioCtx) {
    return false;
  }

  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch {
      return false;
    }
  }

  return audioCtx.state === "running";
}

function playSound(kind) {
  if (!audioEnabled) {
    return;
  }

  initializeAudio();

  if (!audioCtx || audioCtx.state !== "running") {
    return;
  }

  const time = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);

  if (kind === "collect") {
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(520, time);
    oscillator.frequency.exponentialRampToValueAtTime(860, time + 0.16);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.12, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    oscillator.start(time);
    oscillator.stop(time + 0.2);
    return;
  }

  if (kind === "explode") {
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(180, time);
    oscillator.frequency.exponentialRampToValueAtTime(40, time + 0.45);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.24, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.46);
    oscillator.start(time);
    oscillator.stop(time + 0.48);
    return;
  }

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(250, time);
  oscillator.frequency.exponentialRampToValueAtTime(320, time + 0.06);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(0.04, time + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  oscillator.start(time);
  oscillator.stop(time + 0.11);
}

function updateSoundButton() {
  soundToggle.textContent = audioEnabled ? "Sound On" : "Sound Off";
  soundToggle.setAttribute("aria-pressed", String(audioEnabled));
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = rect.width;
  height = rect.height;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  if (!game.backgroundStars.length) {
    createBackgroundStars();
  }

  if (game.rocket) {
    game.rocket.y = height - 96;
    game.rocket.x = clamp(game.rocket.x, game.rocket.width / 2 + 20, width - game.rocket.width / 2 - 20);
    game.rocket.targetX = clamp(game.rocket.targetX, game.rocket.width / 2 + 20, width - game.rocket.width / 2 - 20);
  }
}

function createBackgroundStars() {
  game.backgroundStars = Array.from({ length: 110 }, () => ({
    x: random(0, width || 1),
    y: random(0, height || 1),
    radius: random(0.6, 2.4),
    speed: random(18, 110),
    alpha: random(0.28, 0.95),
    layer: Math.random() > 0.55 ? 2 : 1
  }));
}

function createRocket() {
  return {
    x: width / 2,
    y: height - 96,
    width: 42,
    height: 76,
    targetX: width / 2,
    bob: 0,
    flamePhase: 0
  };
}

function resetGame() {
  game.started = true;
  game.running = true;
  game.gameOver = false;
  game.score = 0;
  game.level = 1;
  game.elapsed = 0;
  game.asteroidTimer = 0;
  game.starTimer = 0;
  game.cometTimer = random(4, 8);
  game.flash = 0;
  game.rocket = createRocket();
  game.asteroids = [];
  game.stars = [];
  game.particles = [];
  game.comets = [];
  pointer.active = false;
  updateHud();
  hideOverlay();
}

function updateHud() {
  scoreEl.textContent = String(game.score);
  highScoreEl.textContent = String(game.highScore);
  levelEl.textContent = String(game.level);
}

function showOverlay(mode) {
  overlayEl.classList.remove("hidden");
  restartButton.style.display = mode === "start" ? "none" : "inline-flex";
  startButton.style.display = mode === "start" ? "inline-flex" : "none";

  if (mode === "start") {
    statusTagEl.textContent = "Mission Ready";
    statusTitleEl.textContent = "Launch into the starfield";
    statusTextEl.textContent =
      "Guide your rocket with the arrow keys or your mouse. Grab stars, dodge asteroids, and push for a new high score.";
    return;
  }

  statusTagEl.textContent = "Mission Failed";
  statusTitleEl.textContent = "Asteroid impact detected";
  statusTextEl.textContent = `Final score: ${game.score}. Highest run: ${game.highScore}. Hit restart and try for a cleaner route.`;
}

function hideOverlay() {
  overlayEl.classList.add("hidden");
}

function createAsteroid() {
  const baseSize = random(28, 58);
  const drift = random(-60, 60);
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = (TAU / 8) * index;
    const radius = baseSize * random(0.72, 1.08);
    return { angle, radius };
  });

  game.asteroids.push({
    x: random(40, width - 40),
    y: -baseSize * 1.6,
    radius: baseSize / 2,
    width: baseSize,
    height: baseSize,
    speed: random(160, 240) + game.level * 22,
    drift,
    rotation: random(0, TAU),
    spin: random(-1.5, 1.5),
    points
  });
}

function createCollectibleStar() {
  game.stars.push({
    x: random(30, width - 30),
    y: -30,
    radius: random(12, 18),
    speed: random(170, 220) + game.level * 12,
    pulse: random(0, TAU)
  });
}

function createComet() {
  const startX = random(width * 0.15, width * 0.85);
  game.comets.push({
    x: startX,
    y: -20,
    vx: random(-180, -90),
    vy: random(260, 360),
    life: 0,
    maxLife: random(1.2, 1.8)
  });
}

function burstParticles(x, y, options = {}) {
  const count = options.count || 16;
  const palette = options.palette || ["#ffd166", "#ff8c42", "#ff5d73", "#fff1b8"];
  const speed = options.speed || [80, 260];

  for (let i = 0; i < count; i += 1) {
    const angle = random(0, TAU);
    const magnitude = random(speed[0], speed[1]);
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * magnitude,
      vy: Math.sin(angle) * magnitude,
      radius: random(1.5, 4.8),
      life: random(0.35, 0.9),
      maxLife: random(0.35, 0.9),
      color: palette[Math.floor(random(0, palette.length))]
    });
  }
}

function increaseScore(points) {
  game.score += points;
  const storedHigh = game.highScore;
  game.highScore = Math.max(game.highScore, game.score);

  if (game.highScore !== storedHigh) {
    persistHighScore(game.highScore);
  }

  updateHud();
}

function collisionRect(a, b) {
  return (
    a.x - a.width / 2 < b.x + b.width / 2 &&
    a.x + a.width / 2 > b.x - b.width / 2 &&
    a.y - a.height / 2 < b.y + b.height / 2 &&
    a.y + a.height / 2 > b.y - b.height / 2
  );
}

function rocketHitbox() {
  return {
    x: game.rocket.x,
    y: game.rocket.y + 4,
    width: game.rocket.width * 0.6,
    height: game.rocket.height * 0.76
  };
}

function loseGame() {
  game.running = false;
  game.gameOver = true;
  game.flash = 0.85;
  burstParticles(game.rocket.x, game.rocket.y, {
    count: 34,
    palette: ["#fff1b8", "#ffb347", "#ff6b6b", "#ff8c42"],
    speed: [120, 360]
  });
  playSound("explode");
  updateHud();
  showOverlay("gameover");
}

function updateRocket(dt) {
  const rocket = game.rocket;
  const padding = rocket.width / 2 + 20;

  if (pointer.active) {
    rocket.targetX = clamp(pointer.x, padding, width - padding);
  } else {
    const direction = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    rocket.targetX = clamp(rocket.targetX + direction * 420 * dt, padding, width - padding);
  }

  const delta = rocket.targetX - rocket.x;
  rocket.x += delta * Math.min(1, dt * 10);
  rocket.y = height - 96 + Math.sin(game.elapsed * 4.5) * 3;
  rocket.bob += dt * 3;
  rocket.flamePhase += dt * 14;

}

function updateBackground(dt) {
  for (const star of game.backgroundStars) {
    star.y += star.speed * dt * (star.layer === 2 ? 1.2 : 0.7);

    if (star.y > height + 8) {
      star.y = -8;
      star.x = random(0, width);
    }
  }

  game.cometTimer -= dt;

  if (game.cometTimer <= 0) {
    createComet();
    game.cometTimer = random(5.5, 9.5);
  }

  game.comets = game.comets.filter((comet) => {
    comet.life += dt;
    comet.x += comet.vx * dt;
    comet.y += comet.vy * dt;
    return comet.life < comet.maxLife;
  });
}

function updateAsteroids(dt) {
  const interval = Math.max(0.35, 1.15 - game.level * 0.07);
  game.asteroidTimer += dt;

  if (game.asteroidTimer >= interval) {
    game.asteroidTimer = 0;
    createAsteroid();
  }

  const rocketBox = rocketHitbox();

  game.asteroids = game.asteroids.filter((asteroid) => {
    asteroid.y += asteroid.speed * dt;
    asteroid.x += asteroid.drift * dt;
    asteroid.rotation += asteroid.spin * dt;
    asteroid.drift += Math.sin(asteroid.rotation * 0.5) * dt * 18;

    if (asteroid.x < asteroid.radius || asteroid.x > width - asteroid.radius) {
      asteroid.drift *= -0.8;
      asteroid.x = clamp(asteroid.x, asteroid.radius, width - asteroid.radius);
    }

    const hitbox = {
      x: asteroid.x,
      y: asteroid.y,
      width: asteroid.width * 0.72,
      height: asteroid.height * 0.72
    };

    if (game.running && collisionRect(rocketBox, hitbox)) {
      loseGame();
      return false;
    }

    return asteroid.y < height + asteroid.radius * 2;
  });
}

function updateStars(dt) {
  const interval = Math.max(0.95, 2 - game.level * 0.06);
  game.starTimer += dt;

  if (game.starTimer >= interval) {
    game.starTimer = 0;
    createCollectibleStar();
  }

  const rocketBox = rocketHitbox();

  game.stars = game.stars.filter((star) => {
    star.y += star.speed * dt;
    star.pulse += dt * 5;

    const hitbox = {
      x: star.x,
      y: star.y,
      width: star.radius * 1.5,
      height: star.radius * 1.5
    };

    if (game.running && collisionRect(rocketBox, hitbox)) {
      increaseScore(10);
      burstParticles(star.x, star.y, {
        count: 12,
        palette: ["#ffe28a", "#fff7c2", "#7ef9ff"],
        speed: [40, 150]
      });
      playSound("collect");
      return false;
    }

    return star.y < height + star.radius * 2;
  });
}

function updateParticles(dt) {
  game.particles = game.particles.filter((particle) => {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.99;
    particle.vy *= 0.99;
    particle.vy += 12 * dt;
    return particle.life > 0;
  });
}

function updateGame(dt) {
  updateBackground(dt);

  if (game.running) {
    game.elapsed += dt;
    game.level = Math.max(1, Math.floor(game.elapsed / 14) + 1);
    updateRocket(dt);
    updateAsteroids(dt);
    updateStars(dt);

    if (Math.floor(game.elapsed) !== Math.floor(game.elapsed - dt) && Math.floor(game.elapsed) % 6 === 0) {
      increaseScore(1);
    }
  } else if (game.rocket) {
    game.rocket.bob += dt * 1.2;
    game.rocket.flamePhase += dt * 5;
  }

  updateParticles(dt);
  game.flash = Math.max(0, game.flash - dt * 1.4);
  updateHud();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#091024");
  gradient.addColorStop(0.45, "#090c1d");
  gradient.addColorStop(1, "#02040d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.78, height * 0.18, 10, width * 0.78, height * 0.18, width * 0.55);
  glow.addColorStop(0, "rgba(126, 249, 255, 0.2)");
  glow.addColorStop(1, "rgba(126, 249, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  for (const star of game.backgroundStars) {
    ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, TAU);
    ctx.fill();
  }

  for (const comet of game.comets) {
    const alpha = 1 - comet.life / comet.maxLife;
    const tailLength = 120;
    const gradientTail = ctx.createLinearGradient(comet.x, comet.y, comet.x - tailLength, comet.y - tailLength * 0.2);
    gradientTail.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradientTail.addColorStop(1, "rgba(126,249,255,0)");
    ctx.strokeStyle = gradientTail;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(comet.x, comet.y);
    ctx.lineTo(comet.x - tailLength, comet.y - tailLength * 0.18);
    ctx.stroke();
  }
}

function drawRocket() {
  const rocket = game.rocket;

  if (!rocket) {
    return;
  }

  ctx.save();
  ctx.translate(rocket.x, rocket.y);
  ctx.rotate((rocket.x - rocket.targetX) * -0.0025);

  const flameSize = 10 + Math.sin(rocket.flamePhase) * 3 + (game.running ? 3 : 0);
  ctx.fillStyle = "rgba(255, 149, 66, 0.95)";
  ctx.beginPath();
  ctx.moveTo(-10, 24);
  ctx.quadraticCurveTo(0, 24 + flameSize, 10, 24);
  ctx.quadraticCurveTo(0, 16 + flameSize * 0.35, -10, 24);
  ctx.fill();

  ctx.fillStyle = "#ffec9a";
  ctx.beginPath();
  ctx.moveTo(-6, 24);
  ctx.quadraticCurveTo(0, 20 + flameSize * 0.75, 6, 24);
  ctx.quadraticCurveTo(0, 17 + flameSize * 0.35, -6, 24);
  ctx.fill();

  ctx.fillStyle = "#e9edf5";
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.lineTo(18, 10);
  ctx.lineTo(12, 28);
  ctx.lineTo(-12, 28);
  ctx.lineTo(-18, 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ff5d73";
  ctx.beginPath();
  ctx.moveTo(-18, 8);
  ctx.lineTo(-28, 22);
  ctx.lineTo(-14, 20);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(18, 8);
  ctx.lineTo(28, 22);
  ctx.lineTo(14, 20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#7ef9ff";
  ctx.beginPath();
  ctx.ellipse(0, -6, 9, 12, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "rgba(12, 18, 40, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.lineTo(0, 22);
  ctx.stroke();
  ctx.restore();
}

function drawAsteroids() {
  for (const asteroid of game.asteroids) {
    ctx.save();
    ctx.translate(asteroid.x, asteroid.y);
    ctx.rotate(asteroid.rotation);
    ctx.fillStyle = "#675d68";
    ctx.strokeStyle = "#8c8190";
    ctx.lineWidth = 2;
    ctx.beginPath();
    asteroid.points.forEach((point, index) => {
      const px = Math.cos(point.angle) * point.radius * 0.5;
      const py = Math.sin(point.angle) * point.radius * 0.5;

      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(-asteroid.radius * 0.12, -asteroid.radius * 0.1, asteroid.radius * 0.18, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawStarShape(x, y, radius, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();

  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (Math.PI / 5) * i;
    const currentRadius = i % 2 === 0 ? radius : radius * 0.45;
    const px = Math.cos(angle) * currentRadius;
    const py = Math.sin(angle) * currentRadius;

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function drawCollectibleStars() {
  for (const star of game.stars) {
    const pulse = 1 + Math.sin(star.pulse) * 0.12;
    drawStarShape(star.x, star.y, star.radius * pulse, "#ffd866");

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(star.x - 2, star.y - 2, star.radius * 0.18, 0, TAU);
    ctx.fill();
  }
}

function drawParticles() {
  for (const particle of game.particles) {
    const alpha = particle.life / particle.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawFlash() {
  if (game.flash <= 0) {
    return;
  }

  ctx.fillStyle = `rgba(255, 120, 90, ${game.flash * 0.32})`;
  ctx.fillRect(0, 0, width, height);
}

function render() {
  drawBackground();
  drawCollectibleStars();
  drawAsteroids();
  drawRocket();
  drawParticles();
  drawFlash();
}

function loop(timestamp) {
  if (!lastTime) {
    lastTime = timestamp;
  }

  const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
  lastTime = timestamp;
  updateGame(dt);
  render();
  requestAnimationFrame(loop);
}

function updatePointerPosition(clientX) {
  const rect = canvas.getBoundingClientRect();
  pointer.active = true;
  pointer.x = clientX - rect.left;
}

function unlockAudioFromGesture() {
  void ensureAudioReady();
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointerdown", unlockAudioFromGesture, { passive: true });
window.addEventListener("touchstart", unlockAudioFromGesture, { passive: true });

window.addEventListener("keydown", (event) => {
  unlockAudioFromGesture();

  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
    keys.left = true;
    event.preventDefault();
  }

  if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
    keys.right = true;
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
    keys.left = false;
  }

  if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
    keys.right = false;
  }
});

canvas.addEventListener("mousemove", (event) => {
  updatePointerPosition(event.clientX);
});

canvas.addEventListener("mouseleave", () => {
  pointer.active = false;
});

canvas.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    updatePointerPosition(touch.clientX);
  },
  { passive: true }
);

canvas.addEventListener(
  "touchmove",
  (event) => {
    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    updatePointerPosition(touch.clientX);
  },
  { passive: true }
);

canvas.addEventListener("touchend", () => {
  pointer.active = false;
});

function startGame() {
  void ensureAudioReady();
  resetGame();
}

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);

soundToggle.addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  updateSoundButton();

  if (audioEnabled) {
    void ensureAudioReady().then((ready) => {
      if (ready) {
        playSound("toggle");
      }
    });
  }
});

resizeCanvas();
game.rocket = createRocket();
updateHud();
updateSoundButton();
showOverlay("start");
requestAnimationFrame(loop);
