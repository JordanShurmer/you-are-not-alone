const canvas = document.querySelector('#game');

canvas.width = canvas.parentElement.clientWidth;
canvas.height = canvas.parentElement.clientHeight;


const ctx = canvas.getContext('2d');

let theme = getComputedStyle(document.documentElement).getPropertyValue('--theme');
let dark = getComputedStyle(document.documentElement).getPropertyValue('--game-dark');
let light = getComputedStyle(document.documentElement).getPropertyValue('--game-light');

function playerVision(entity) {
  // Get or create vision element for this specific entity
  let visionElement = document.getElementById(`vision-${entity.label}`);

  if (!visionElement) {
    // Create the vision element
    visionElement = document.createElement('vision');
    visionElement.id = `vision-${entity.label}`;

    // Create 4 divs with class="vision"
    for (let i = 0; i < 4; i++) {
      const visionDiv = document.createElement('div');
      visionDiv.className = 'vision';
      visionElement.appendChild(visionDiv);
    }

    // Append to body
    document.body.appendChild(visionElement);
  }

  return visionElement;
}


/** entities */
const everything = [];

function drawPlayer(entity) {
  ctx.save();
  ctx.translate(entity.x, entity.y);
  ctx.rotate(entity.direction || 0);

  // Draw image instead of circle
  const wizImg = document.getElementById('wiz');
  const size = 120; // image size (matches previous circle diameter of 20)
  ctx.drawImage(wizImg, -size/2, -size/2, size, size);


  ctx.restore();
}


function drawVision(entity) {
  // Draw cone of vision

  const vEl = playerVision(entity);
  const rect = canvas.getBoundingClientRect();

  vEl.style.setProperty('--visionX', entity.x + rect.left + 'px');
  vEl.style.setProperty('--visionY', entity.y + rect.top + 'px');
  vEl.style.setProperty('--visionAngle', entity.direction + 'rad');




}


function drawAnImage(entity) {
  ctx.save();
  ctx.translate(entity.x, entity.y);

  //get the image from document element id of entity.elID
  const src = document.getElementById(entity.src.id);
  const sWidth = entity.src.width || src.width;
  const sHeight = entity.src.height || src.height;

  const scale = entity.draw.scale || 1;

  const dw = entity.draw.width || sWidth * scale;
  const dh = entity.draw.height || sHeight * scale;

  //0,0 since we translated here already
  ctx.drawImage(src, -dw/2, -dh/2, dw, dh);

  ctx.restore();
}

function drawBoundingBox(entity) {
  ctx.save();
  ctx.translate(entity.x, entity.y);
  if (entity.box) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, entity.box.width, entity.box.height);
  }
  ctx.restore();
}

function gameLoop() {
  requestAnimationFrame(gameLoop);

  theme = getComputedStyle(document.documentElement).getPropertyValue('--theme');
  dark = getComputedStyle(document.documentElement).getPropertyValue('--game-dark');
  light = getComputedStyle(document.documentElement).getPropertyValue('--game-light');



  updateMovement();

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--game-dark');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const entity of everything) {

    if (entity.src.id)  drawAnImage(entity);
    if (entity.box) drawBoundingBox(entity);
    if (entity.vision) drawVision(entity);


  }

}

function right(y = 0) {
  return canvas.width - y;
}

function bottom(x = 0) {
  return canvas.height - x;
}

/** initialize the player */
everything.push({
  type: 'player',
  label: 'local1',
  forward: 0, //speed
  maxSpeed: 0.3,
  acceleration: 0.01,
  deceleration: 0.12,
  x: canvas.width / 2,
  y: canvas.height / 2,
  direction: Math.PI / 4,
  always: true,

  vision: {
    distance: 80,
    angle: Math.PI + Math.PI / 4,
    x: 64,
    y: 0,
  },

  box: {
    width: 12,
    height: 24,
  },

  draw: {
    scale: 0.1,
  },

  src: {
    id: 'wiz',
    sx: 0,
    sy: 0,
    sWidth: null,
    sHeight: null,
  },

});

everything.push({
  label: 'bush1',
  x: right(200),
  y: bottom(200),

  draw: {
    scale: 0.2,
  },

  box: {
    width: 5,
    height: 5
  },

  src: {
    id: 'bush1',
    x: 0,
    y: 0,
    width: null,
    height: null,
  },

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
    local1.direction = Math.atan2(dy, dx);
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

    if (keys['w']) {
      local1.forward = Math.min(local1.forward + local1.acceleration, local1.maxSpeed);
    } else if (keys['s']) {
      local1.forward = Math.max(local1.forward - local1.deceleration, -local1.maxSpeed);
    } else {
      // Decelerate when no key is pressed
      if (local1.forward > 0) {
        local1.forward = Math.max(local1.forward - local1.deceleration, 0);
      } else if (local1.forward < 0) {
        local1.forward = Math.min(local1.forward + local1.deceleration, 0);
      }
    }

    // Move based on vision direction and forward speed
    local1.x += Math.cos(local1.direction) * local1.forward;
    local1.y += Math.sin(local1.direction) * local1.forward;


    if (keys['a']) {
      local1.direction -= 0.05;
    }
    if (keys['d']) {
      local1.direction += 0.05;
    }
  }

}

gameLoop();
