const canvas = document.querySelector('#game');

canvas.width = canvas.parentElement.clientWidth;
canvas.height = canvas.parentElement.clientHeight;


const ctx = canvas.getContext('2d');

const theme = getComputedStyle(document.documentElement).getPropertyValue('--theme');
const dark = getComputedStyle(document.documentElement).getPropertyValue('--game-dark');
const light = getComputedStyle(document.documentElement).getPropertyValue('--game-light');


function drawPlayer(entity) {
  ctx.save();
  ctx.translate(entity.x, entity.y);
  ctx.rotate(entity.vision.direction || 0);

  // Draw body circle
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fillStyle = theme;
  ctx.fill();
  ctx.strokeStyle = theme;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw eye on the right side of the circle
  ctx.beginPath();
  ctx.arc(5, -3, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();

  // Draw pupil
  ctx.beginPath();
  ctx.arc(5, -2, 1, 0, Math.PI * 2);
  ctx.fillStyle = 'black';
  ctx.fill();

  ctx.restore();
}


function qd(color) {
    ctx.fillStyle = color || 'purple';
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillRect(12, 0, 4, 4);
    ctx.fillRect(24, 0, 4, 4);
    ctx.fillRect(36, 0, 4, 4);
    ctx.fillRect(48, 0, 4, 4);
}


/** entities */
const everything = [];

function gameLoop() {
  requestAnimationFrame(gameLoop);

  updateMovement();

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--game-dark');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const entity of everything) {
    switch (entity.type) {

      case 'player':

        drawPlayer(entity);

        // Draw cone of vision
        ctx.save();
        const { x: vx, y: vy, direction, distance, angle } = entity.vision;
        ctx.translate(entity.x, entity.y);
        ctx.rotate(direction || 0);
        ctx.beginPath();
        ctx.translate(12, 0);
        ctx.arc(vx, vy, distance, angle, -angle);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fillStyle = light;
        ctx.fill();
        ctx.restore();

        break;


    }
  }

}

/** initialize the player */
everything.push({
  type: 'player',
  label: 'local1',
  x: canvas.width / 2,
  y: canvas.height / 2,
  vision: {
    direction: Math.PI / 4,
    distance: 80,
    angle: Math.PI + Math.PI / 4,
    x: 64,
    y: 0,
  }
});



/** Handle input controls */
const controls = document.querySelector('fieldset#controls');
controls.addEventListener('input', (e) => {

  switch (e.target.name) {
    case 'visionDistance':
      for (const entity of everything) {
        if (entity.type === 'player') {
          entity.vision.distance = parseFloat(e.target.value);
        }
      }
      break;
    case 'visionAngle':
      for (const entity of everything) {
        if (entity.type === 'player') {
          entity.vision.angle = parseFloat(e.target.value);
        }
      }
      break;
    case 'visionX':
      for (const entity of everything) {
        if (entity.type === 'player') {
          entity.vision.x = parseFloat(e.target.value);
        }
      }
      break;
    case 'visionY':
      for (const entity of everything) {
        if (entity.type === 'player') {
          entity.vision.y = parseFloat(e.target.value);
        }
      }
      break;
  }
});

// the local player
const local1 = everything.find(entity => entity.type === 'player' && entity.label === 'local1');

/** Track mouse position */
let mouseX = 0;
let mouseY = 0;

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;

  if (local1) {
    const dx = mouseX - local1.x;
    const dy = mouseY - local1.y;
    local1.vision.direction = Math.atan2(dy, dx);
  }
});


// Handle WASD movement for local1 player
const keys = {};

window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// Movement loop
function updateMovement() {
  if (local1) {
    const speed = 3;

    if (keys['w']) {
      local1.y -= speed;
    }
    if (keys['s']) {
      local1.y += speed;
    }
    if (keys['a']) {
      local1.x -= speed;
    }
    if (keys['d']) {
      local1.x += speed;
    }
  }

}

gameLoop();
