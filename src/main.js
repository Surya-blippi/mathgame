import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import './style.css';
import { initAds, resetSessionLimits, canShowAd, showRewardedAd, showInterstitialAd, shouldShowWaveAd, getReviveAdCount, getCurrentReviveProgress } from './adManager.js';

// GLTF Model references
let robotModel = null;
let arenaModel = null;
let robotModelLoaded = false;

// Setup loaders
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
gltfLoader.setDRACOLoader(dracoLoader);

// Model paths (Vite serves public folder at root)
const ARENA_MODEL_PATH = '/models/arena.glb';
const ROBOT_MODEL_PATH = '/models/robot.glb';

// Pre-load robot model for cloning
function preloadRobotModel() {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      ROBOT_MODEL_PATH,
      (gltf) => {
        robotModel = gltf.scene;
        robotModelLoaded = true;
        console.log('✅ Robot model pre-loaded successfully!');
        resolve(gltf);
      },
      (xhr) => {
        if (xhr.total > 0) {
          console.log(`Robot loading: ${Math.round(xhr.loaded / xhr.total * 100)}%`);
        }
      },
      (error) => {
        console.error('❌ Failed to load robot model:', error);
        robotModelLoaded = false;
        reject(error);
      }
    );
  });
}

function loadFootstepSound() {
  // Removed
}

// ==================== GAME STATE ====================
const gameState = {
  score: 0,
  wave: 1,
  health: 100,
  maxHealth: 100,
  combo: 1,
  kills: 0,
  isRunning: false,
  isPaused: false,
  mode: 'math' // 'math' or 'quiz'
};

// ==================== THREE.JS SETUP ====================
let scene, camera, renderer;
let robots = [];
let pickups = [];
let particles = [];
let bullets = [];
let clock;

// Mouse look controls
let yaw = 0;
let pitch = 0;
const mouseSensitivity = 0.002;
let isPointerLocked = false;

// Mobile detection and touch controls
let isMobile = false;
let touchStartX = 0;
let touchStartY = 0;
let lastTouchX = 0;
let lastTouchY = 0;
const touchSensitivity = 0.005;

// Player movement
const moveSpeed = 8;
const sprintMultiplier = 1.5;
const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false
};
let joystickActive = false;
let joystickX = 0;
let joystickY = 0;

// Jump and gravity
let playerY = 2; // Player height
let velocityY = 0;
const gravity = -25;
const jumpForce = 10;
let isGrounded = true;

// Head bobbing for realistic walking
let headBobTime = 0;
const headBobSpeed = 14; // How fast the bob cycles
const headBobAmount = 0.06; // How much vertical bob
const headBobSideAmount = 0.03; // How much side-to-side sway
let isMoving = false;
let currentBobOffset = 0;
let currentSideOffset = 0;

// Gun
let gun;
let gunGroup;
let isGunFiring = false;
let gunRecoil = 0;
let laserBeam;
let muzzleLight;

// ==================== AUDIO SETUP ====================
let audioContext;
let gunSoundBuffer = null;

// Load gun sound
async function loadGunSound() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const response = await fetch('/gun.wav');
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      gunSoundBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('🔫 Gun sound loaded!');
    } else {
      console.log('Gun.wav not found, using synthesized sound');
    }
  } catch (e) {
    console.log('Could not load gun.wav, using synthesized sound');
  }
}

// ==================== INIT ====================
function init() {
  // Detect mobile device
  isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0);

  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);
  scene.fog = new THREE.Fog(0x0a0a1a, 10, 100);

  // Create camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 0);

  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Mobile Performance Optimization: Reduce shadow map resolution
  if (isMobile) {
    renderer.shadowMap.enabled = false; // Disable shadows on mobile for max FPS
  }

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  document.getElementById('app').appendChild(renderer.domElement);

  // Clock
  clock = new THREE.Clock();

  // Create environment
  createEnvironment();

  // Create lighting
  createLighting();

  // Event listeners
  window.addEventListener('resize', onWindowResize);

  // Keyboard controls for movement (both desktop and mobile with keyboard)
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  if (isMobile) {
    // Mobile touch events are handled via UI elements
    console.log('📱 Mobile device detected - Touch controls enabled');
  } else {
    // Desktop mouse events
    renderer.domElement.addEventListener('click', onCanvasClick);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
  }

  // Create gun
  try {
    createGun();
  } catch (e) { console.error('Gun Error: ' + e.message); }

  // Create UI (includes mobile controls)
  createUI();

  // Load gun sound
  loadGunSound();

  // Start render loop
  try {
    animate();
  } catch (e) {
    console.error('Animate Call Fail: ' + e.message);
  }
}

// ==================== ENVIRONMENT ====================
function createEnvironment() {
  // Always create procedural environment first (immediate visibility)
  createProceduralEnvironment();

  // Add fog for atmosphere
  scene.fog = new THREE.FogExp2(0x0a0a12, 0.012);

  // Ambient particles
  createAmbientParticles();

  // Try to load arena GLTF model
  console.log('📦 Attempting to load arena model from:', ARENA_MODEL_PATH);
  gltfLoader.load(
    ARENA_MODEL_PATH,
    (gltf) => {
      arenaModel = gltf.scene;
      arenaModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      // Scale and position (adjust these values for your model!)
      arenaModel.scale.set(0.2, 0.2, 0.2); // Model is 500 units, scaling to 100
      arenaModel.position.set(0, -1, 0); // Lower slightly to avoid z-fighting with grid
      scene.add(arenaModel);
      console.log('✅ Arena GLTF model loaded and added to scene!');
    },
    (xhr) => {
      if (xhr.total > 0) {
        console.log(`Arena loading: ${Math.round(xhr.loaded / xhr.total * 100)}%`);
      }
    },
    (error) => {
      console.error('❌ Failed to load arena model:', error);
    }
  );

  // Pre-load robot model
  preloadRobotModel().catch(e => console.log('Robot preload failed, will use procedural'));
}

// Fallback procedural environment if GLTF fails
function createProceduralEnvironment() {
  // Industrial metal floor with panels - BRIGHTER
  const floorGeometry = new THREE.PlaneGeometry(120, 120, 40, 40);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a5a, // Gray instead of near-black is better for visibility
    roughness: 0.5,
    metalness: 0.7,
    envMapIntensity: 1.5
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Glowing grid lines (orange/warning style) - BRIGHTER
  const gridHelper = new THREE.GridHelper(120, 60, 0xffaa00, 0x443300);
  gridHelper.position.y = 0.02;
  scene.add(gridHelper);

  // Arena boundary walls
  createArenaBoundaries();

  // Industrial backdrop
  createIndustrialBackdrop();
}

function createArenaBoundaries() {
  const barrierMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    metalness: 0.4
  });
  const warningMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3300,
    transparent: true,
    opacity: 0.8
  });

  // Create 4 arena walls
  const wallPositions = [
    { x: 0, z: -50, rotation: 0 },
    { x: 0, z: 50, rotation: Math.PI },
    { x: -50, z: 0, rotation: Math.PI / 2 },
    { x: 50, z: 0, rotation: -Math.PI / 2 }
  ];

  wallPositions.forEach(pos => {
    // Main barrier
    const barrierGeometry = new THREE.BoxGeometry(100, 4, 1);
    const barrier = new THREE.Mesh(barrierGeometry, barrierMaterial);
    barrier.position.set(pos.x, 2, pos.z);
    barrier.rotation.y = pos.rotation;
    barrier.castShadow = true;
    scene.add(barrier);

    // Warning stripe
    const stripeGeometry = new THREE.BoxGeometry(100, 0.3, 0.1);
    const stripe = new THREE.Mesh(stripeGeometry, warningMaterial);
    stripe.position.set(pos.x, 3.5, pos.z + (pos.z === 0 ? (pos.x < 0 ? 0.5 : -0.5) : (pos.z < 0 ? 0.5 : -0.5)));
    stripe.rotation.y = pos.rotation;
    scene.add(stripe);
  });

  // Corner pillars
  const pillarGeometry = new THREE.CylinderGeometry(1.5, 2, 8, 8);
  const pillarMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.6,
    metalness: 0.5
  });
  const pillarPositions = [
    { x: -48, z: -48 },
    { x: 48, z: -48 },
    { x: -48, z: 48 },
    { x: 48, z: 48 }
  ];

  pillarPositions.forEach(pos => {
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(pos.x, 4, pos.z);
    pillar.castShadow = true;
    scene.add(pillar);

    // Warning light on top
    const lightGeometry = new THREE.SphereGeometry(0.5, 8, 8);
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const light = new THREE.Mesh(lightGeometry, lightMaterial);
    light.position.set(pos.x, 8.5, pos.z);
    scene.add(light);
  });
}

function createIndustrialBackdrop() {
  const buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0x151520,
    roughness: 0.9,
    metalness: 0.3
  });

  // Factories and industrial buildings
  for (let i = 0; i < 30; i++) {
    const width = Math.random() * 15 + 8;
    const height = Math.random() * 40 + 15;
    const depth = Math.random() * 15 + 8;

    const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);

    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 40 + 70;

    building.position.set(
      Math.cos(angle) * distance,
      height / 2,
      Math.sin(angle) * distance
    );

    building.castShadow = true;
    scene.add(building);

    // Industrial windows (glowing orange)
    const windowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.4
    });

    for (let row = 0; row < Math.floor(height / 5); row++) {
      const windowGeometry = new THREE.PlaneGeometry(width * 0.6, 1.5);
      const windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
      windowMesh.position.set(
        building.position.x,
        5 + row * 5,
        building.position.z + depth / 2 + 0.1
      );
      windowMesh.lookAt(0, windowMesh.position.y, 0);
      scene.add(windowMesh);
    }

    // Smokestacks on some buildings
    if (Math.random() > 0.6) {
      const stackGeometry = new THREE.CylinderGeometry(1, 1.5, 12, 8);
      const stack = new THREE.Mesh(stackGeometry, buildingMaterial);
      stack.position.set(
        building.position.x + (Math.random() - 0.5) * width * 0.5,
        height + 6,
        building.position.z
      );
      scene.add(stack);
    }
  }
}

// Old cityscape removed - using createIndustrialBackdrop instead

function createAmbientParticles() {
  const particleCount = 1000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 1] = Math.random() * 30;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 100;

    const color = new THREE.Color();
    color.setHSL(Math.random() * 0.2 + 0.5, 0.8, 0.6);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });

  const particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);
}

// ==================== LIGHTING ====================
function createLighting() {
  // Ambient light - Increased intensity and brighter color
  const ambientLight = new THREE.AmbientLight(0x8080a0, 1.5);
  scene.add(ambientLight);

  // Hemisphere light for better global illumination
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  // Main directional light (moonlight) - Increased intensity
  const dirLight = new THREE.DirectionalLight(0xaaccff, 2.0);
  dirLight.position.set(-10, 20, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 100;
  dirLight.shadow.camera.left = -30;
  dirLight.shadow.camera.right = 30;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  // Softer shadows
  dirLight.shadow.radius = 4;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  // Colored point lights for atmosphere - Increased range and intensity
  const pointLight1 = new THREE.PointLight(0x00ffff, 2, 40);
  pointLight1.position.set(-15, 5, -15);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0xff00ff, 2, 40);
  pointLight2.position.set(15, 5, -20);
  scene.add(pointLight2);

  const pointLight3 = new THREE.PointLight(0xffcc00, 1, 30);
  pointLight3.position.set(0, 10, -30);
  scene.add(pointLight3);
}

// ==================== SCI-FI GUN ====================
function createGun() {
  gunGroup = new THREE.Group();

  // Materials
  const gunBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a3a,
    roughness: 0.2,
    metalness: 0.9
  });

  const gunAccentMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    roughness: 0.1,
    metalness: 1,
    emissive: 0x00ffff,
    emissiveIntensity: 0.5
  });

  const plasmaCoreMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.8
  });

  // Main gun body
  const bodyGeometry = new THREE.BoxGeometry(0.15, 0.12, 0.6);
  const gunBody = new THREE.Mesh(bodyGeometry, gunBodyMaterial);
  gunGroup.add(gunBody);

  // Barrel - front cylinder
  const barrelGeometry = new THREE.CylinderGeometry(0.03, 0.04, 0.4, 16);
  const barrel = new THREE.Mesh(barrelGeometry, gunBodyMaterial);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.45);
  gunGroup.add(barrel);

  // Barrel outer ring
  const barrelRingGeometry = new THREE.TorusGeometry(0.05, 0.015, 8, 16);
  const barrelRing1 = new THREE.Mesh(barrelRingGeometry, gunAccentMaterial);
  barrelRing1.position.set(0, 0.02, -0.55);
  gunGroup.add(barrelRing1);

  const barrelRing2 = new THREE.Mesh(barrelRingGeometry, gunAccentMaterial);
  barrelRing2.position.set(0, 0.02, -0.65);
  gunGroup.add(barrelRing2);

  // Muzzle tip
  const muzzleGeometry = new THREE.ConeGeometry(0.04, 0.1, 16);
  const muzzle = new THREE.Mesh(muzzleGeometry, gunAccentMaterial);
  muzzle.rotation.x = -Math.PI / 2;
  muzzle.position.set(0, 0.02, -0.7);
  gunGroup.add(muzzle);

  // Plasma core (glowing center)
  const coreGeometry = new THREE.SphereGeometry(0.04, 16, 16);
  const plasmaCore = new THREE.Mesh(coreGeometry, plasmaCoreMaterial);
  plasmaCore.position.set(0, 0.02, -0.2);
  gunGroup.add(plasmaCore);

  // Energy coils around body
  for (let i = 0; i < 3; i++) {
    const coilGeometry = new THREE.TorusGeometry(0.08, 0.01, 8, 16);
    const coil = new THREE.Mesh(coilGeometry, gunAccentMaterial);
    coil.position.set(0, 0, -0.1 + i * 0.1);
    coil.rotation.y = Math.PI / 2;
    gunGroup.add(coil);
  }

  // Handle/grip
  const gripGeometry = new THREE.BoxGeometry(0.08, 0.2, 0.12);
  const grip = new THREE.Mesh(gripGeometry, gunBodyMaterial);
  grip.position.set(0, -0.12, 0.15);
  grip.rotation.x = 0.3;
  gunGroup.add(grip);

  // Trigger guard
  const triggerGuardGeometry = new THREE.TorusGeometry(0.04, 0.008, 8, 16, Math.PI);
  const triggerGuard = new THREE.Mesh(triggerGuardGeometry, gunBodyMaterial);
  triggerGuard.position.set(0, -0.06, 0.08);
  triggerGuard.rotation.x = Math.PI / 2;
  triggerGuard.rotation.z = Math.PI;
  gunGroup.add(triggerGuard);

  // Side panels with glow
  const sidePanelGeometry = new THREE.BoxGeometry(0.16, 0.04, 0.25);
  const sidePanelMaterial = new THREE.MeshBasicMaterial({
    color: 0x004444,
    transparent: true,
    opacity: 0.6
  });
  const sidePanel = new THREE.Mesh(sidePanelGeometry, sidePanelMaterial);
  sidePanel.position.set(0, 0.05, -0.05);
  gunGroup.add(sidePanel);

  // Muzzle light (for firing effect)
  muzzleLight = new THREE.PointLight(0x00ff88, 0, 5);
  muzzleLight.position.set(0, 0.02, -0.8);
  gunGroup.add(muzzleLight);

  // Create laser beam (hidden initially)
  const laserGeometry = new THREE.CylinderGeometry(0.02, 0.01, 50, 8);
  const laserMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0
  });
  laserBeam = new THREE.Mesh(laserGeometry, laserMaterial);
  laserBeam.rotation.x = Math.PI / 2;
  laserBeam.position.set(0, 0.02, -25.8);
  gunGroup.add(laserBeam);

  // Position gun in view
  gunGroup.position.set(0.3, -0.25, -0.5);
  gunGroup.rotation.y = -0.1;

  // Add gun to camera so it follows view
  camera.add(gunGroup);
  scene.add(camera);

  gun = gunGroup;
}

// Gun fire animation
function fireGunAnimation() {
  if (isGunFiring) return;
  isGunFiring = true;
  gunRecoil = 0.15;

  // Muzzle flash light
  muzzleLight.intensity = 3;

  // Show laser beam
  laserBeam.material.opacity = 0.9;

  // Create muzzle particles
  createMuzzleParticles();

  // Play enhanced laser sound
  playLaserSound();

  // Animate recoil and effects
  setTimeout(() => {
    muzzleLight.intensity = 1.5;
    laserBeam.material.opacity = 0.5;
  }, 30);

  setTimeout(() => {
    muzzleLight.intensity = 0.5;
    laserBeam.material.opacity = 0.2;
  }, 60);

  setTimeout(() => {
    muzzleLight.intensity = 0;
    laserBeam.material.opacity = 0;
    isGunFiring = false;
  }, 100);
}

// Muzzle particles
function createMuzzleParticles() {
  if (!gun) return;

  // Get muzzle position in world space
  const muzzlePos = new THREE.Vector3(0, 0.02, -0.8);
  gun.localToWorld(muzzlePos);

  // Create energy particles
  for (let i = 0; i < 15; i++) {
    const particleGeometry = new THREE.SphereGeometry(0.02 + Math.random() * 0.02, 8, 8);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.5 ? 0x00ff88 : 0x00ffff,
      transparent: true,
      opacity: 1
    });

    const particle = new THREE.Mesh(particleGeometry, particleMaterial);
    particle.position.copy(muzzlePos);

    // Random velocity forward
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      -Math.random() * 5 - 10
    );

    // Transform velocity to camera direction
    velocity.applyQuaternion(camera.quaternion);

    scene.add(particle);

    // Animate particle
    const startTime = Date.now();
    const animateParticle = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 0.3) {
        scene.remove(particle);
        return;
      }

      particle.position.add(velocity.clone().multiplyScalar(0.016));
      particle.material.opacity = 1 - elapsed / 0.3;
      particle.scale.setScalar(1 - elapsed / 0.3);

      requestAnimationFrame(animateParticle);
    };
    animateParticle();
  }
}

// Enhanced laser sound
function playLaserSound() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Resume audio context if suspended (mobile browser requirement)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  // If gun.wav is loaded, use it
  if (gunSoundBuffer) {
    const source = audioContext.createBufferSource();
    source.buffer = gunSoundBuffer;
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.5;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0);
    return;
  }

  // Fallback: Create synthesized laser sound
  const now = audioContext.currentTime;

  // Main laser "pew" sound
  const osc1 = audioContext.createOscillator();
  const gain1 = audioContext.createGain();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(800, now);
  osc1.frequency.exponentialRampToValueAtTime(200, now + 0.15);
  gain1.gain.setValueAtTime(0.3, now);
  gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
  osc1.connect(gain1);
  gain1.connect(audioContext.destination);
  osc1.start(now);
  osc1.stop(now + 0.2);

  // High frequency zap
  const osc2 = audioContext.createOscillator();
  const gain2 = audioContext.createGain();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(2000, now);
  osc2.frequency.exponentialRampToValueAtTime(500, now + 0.08);
  gain2.gain.setValueAtTime(0.1, now);
  gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
  osc2.connect(gain2);
  gain2.connect(audioContext.destination);
  osc2.start(now);
  osc2.stop(now + 0.1);

  // Bass punch
  const osc3 = audioContext.createOscillator();
  const gain3 = audioContext.createGain();
  osc3.type = 'sine';
  osc3.frequency.setValueAtTime(150, now);
  osc3.frequency.exponentialRampToValueAtTime(50, now + 0.1);
  gain3.gain.setValueAtTime(0.4, now);
  gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
  osc3.connect(gain3);
  gain3.connect(audioContext.destination);
  osc3.start(now);
  osc3.stop(now + 0.15);
}

// ==================== QUESTION GENERATORS ====================
class MathGenerator {
  generate(robot) {
    // Progressive Difficulty based on Wave
    let operations = ['+']; // Default for Wave 1
    let maxNum = 10;

    if (gameState.wave >= 2) {
      operations = ['+', '-'];
      maxNum = 20;
    }
    if (gameState.wave >= 3) {
      operations = ['+', '-', '×'];
      maxNum = 30;
    }
    if (gameState.wave >= 6) {
      operations = ['+', '-', '×', '÷'];
      maxNum = 50;
    }
    if (gameState.wave >= 10) {
      operations = ['+', '-', '×', '÷', '²'];
      maxNum = 100;
    }

    const operation = operations[Math.floor(Math.random() * operations.length)];
    let a, b, answer;

    switch (operation) {
      case '+':
        a = Math.floor(Math.random() * maxNum) + 1;
        b = Math.floor(Math.random() * maxNum) + 1;
        answer = a + b;
        break;
      case '-':
        a = Math.floor(Math.random() * maxNum) + 10;
        b = Math.floor(Math.random() * a);
        answer = a - b;
        break;
      case '×':
        // Reduce range for multiplication to keep it reasonable
        const multMax = Math.min(15, Math.ceil(maxNum / 2));
        a = Math.floor(Math.random() * multMax) + 2;
        b = Math.floor(Math.random() * 10) + 2;
        answer = a * b;
        break;
      case '÷':
        b = Math.floor(Math.random() * 12) + 2;
        answer = Math.floor(Math.random() * 12) + 2;
        a = b * answer; // Ensure integer result
        break;
      case '²':
        a = Math.floor(Math.random() * 15) + 2;
        b = 2; // unused in display but consistent structure
        answer = a * a;
        break;
    }



    // Generate wrong answers
    const wrongAnswers = [];
    while (wrongAnswers.length < 2) {
      const offset = Math.floor(Math.random() * 10) - 5;
      const wrong = answer + (offset === 0 ? (Math.random() > 0.5 ? 1 : -1) : offset);
      if (wrong !== answer && wrong > 0 && !wrongAnswers.includes(wrong)) {
        wrongAnswers.push(wrong);
      }
    }

    if (operation === '²') {
      robot.question = `${a}² = ?`;
    } else {
      robot.question = `${a} ${operation} ${operation === '÷' || operation === '-' || operation === '+' || operation === '×' ? b : ''} = ?`;
      // Clean up check above is slightly redundant but safe
      if (operation !== '²') robot.question = `${a} ${operation} ${b} = ?`;
    }
    robot.correctAnswer = answer;

    return { answer, wrongAnswers };
  }
}

class QuizGenerator {
  constructor() {
    this.easy = [
      { q: "Capital of France?", a: "Paris", w: ["London", "Berlin"] },
      { q: "H2O is?", a: "Water", w: ["Iron", "Gold"] },
      { q: "Red Planet?", a: "Mars", w: ["Venus", "Jupiter"] },
      { q: "Largest Ocean?", a: "Pacific", w: ["Atlantic", "Indian"] },
      { q: "Fastest Animal?", a: "Cheetah", w: ["Lion", "Horse"] },
      { q: "Is the sun a star?", a: "Yes", w: ["No", "Maybe"] },
      { q: "King of Jungle?", a: "Lion", w: ["Tiger", "Bear"] },
      { q: "Color of Emerald?", a: "Green", w: ["Red", "Blue"] },
      { q: "Opposite of Cold?", a: "Hot", w: ["Warm", "Cool"] },
      { q: "Freezing point of water?", a: "0°C", w: ["-10°C", "10°C"] },
      { q: "Color of banana?", a: "Yellow", w: ["Green", "Red"] },
      { q: "Bat is a bird?", a: "No", w: ["Yes", "Maybe"] },
      { q: "A shape with 3 sides?", a: "Triangle", w: ["Square", "Circle"] },
      { q: "Ice is?", a: "Frozen Water", w: ["Gas", "Steam"] },
      { q: "Number of fingers?", a: "5", w: ["4", "6"] },
    ];

    this.medium = [
      { q: "Capital of Japan?", a: "Tokyo", w: ["Kyoto", "Osaka"] },
      { q: "Hardest material?", a: "Diamond", w: ["Steel", "Iron"] },
      { q: "3.14 is?", a: "Pi", w: ["Phi", "E"] },
      { q: "Smallest planet?", a: "Mercury", w: ["Mars", "Pluto"] },
      { q: "Number of continents?", a: "7", w: ["5", "6"] },
      { q: "Identify: Verb", a: "Run", w: ["Blue", "Sky"] },
      { q: "Capital of USA?", a: "Washington D.C.", w: ["New York", "Chicago"] },
      { q: "Currency of UK?", a: "Pound", w: ["Euro", "Dollar"] },
      { q: "Symbol for Gold?", a: "Au", w: ["Ag", "Fe"] },
      { q: "Programming language?", a: "JavaScript", w: ["HTML", "CSS"] },
      { q: "Planet with rings?", a: "Saturn", w: ["Mars", "Venus"] },
      { q: "Largest desert?", a: "Antarctica", w: ["Sahara", "Gobi"] },
      { q: "Closest star?", a: "Sun", w: ["Proxima", "Sirius"] },
      { q: "Spider legs count?", a: "8", w: ["6", "10"] },
      { q: "Capital of Spain?", a: "Madrid", w: ["Barcelona", "Seville"] },
    ];

    this.hard = [
      { q: "CPU stands for?", a: "Central Processing Unit", w: ["Computer Personal Unit", "Central Power Unit"] },
      { q: "Boiling point of water?", a: "100°C", w: ["90°C", "120°C"] },
      { q: "Speed of light used in?", a: "Optics", w: ["Acoustics", "Mechanics"] },
      { q: "Who painted Mona Lisa?", a: "Da Vinci", w: ["Picasso", "Van Gogh"] },
      { q: "Force that pulls down?", a: "Gravity", w: ["Magnetism", "Friction"] },
      { q: "Largest mammal?", a: "Blue Whale", w: ["Elephant", "Giraffe"] },
      { q: "Square root of 64?", a: "8", w: ["6", "12"] },
      { q: "Author of Harry Potter?", a: "J.K. Rowling", w: ["Tolkien", "Martin"] },
      { q: "Which gas do we breath?", a: "Oxygen", w: ["Helium", "Nitrogen"] },
      { q: "Fastest bird?", a: "Peregrine Falcon", w: ["Eagle", "Hawk"] },
      { q: "Tallest mountain?", a: "Everest", w: ["K2", "Kilimanjaro"] },
      { q: "Capital of Italy?", a: "Rome", w: ["Milan", "Venice"] },
      { q: "Number of bones in ear?", a: "3", w: ["2", "4"] },
      { q: "Where are pyramids?", a: "Egypt", w: ["Mexico", "Peru"] },
      { q: "Symbol for Iron?", a: "Fe", w: ["Ir", "In"] },
      { q: "Primary colors?", a: "R, G, B", w: ["O, P, G", "B, W, G"] },
      { q: "Start of WWI?", a: "1914", w: ["1918", "1939"] },
      { q: "Inventor of Phone?", a: "Bell", w: ["Edison", "Tesla"] },
      { q: "Most spoken language?", a: "English", w: ["Spanish", "Mandarin"] },
      { q: "Frozen water is?", a: "Ice", w: ["Steam", "Liquid"] },
      { q: "Value of a dozen?", a: "12", w: ["10", "6"] },
      { q: "Humans breathe out?", a: "CO2", w: ["Oxygen", "Nitrogen"] },
      { q: "Capital of China?", a: "Beijing", w: ["Shanghai", "Hong Kong"] }
    ];
  }

  generate(robot) {
    let pool = this.easy;
    if (gameState.wave >= 4) pool = [...pool, ...this.medium];
    if (gameState.wave >= 8) pool = [...pool, ...this.hard]; // Cumulative difficulty

    // Bias towards harder questions in later waves by filtering or just random chance on larger pool
    // For now, simple random from the unlocked pool is sufficient progressive difficulty

    const qData = pool[Math.floor(Math.random() * pool.length)];

    robot.question = qData.q;
    robot.correctAnswer = qData.a;

    // Create copies to avoid modifying original data
    return { answer: qData.a, wrongAnswers: [...qData.w] };
  }
}

class EnglishGenerator {
  constructor() {
    this.easy = [
      { q: "Opposite of HOT?", a: "Cold", w: ["Warm", "Soft"] },
      { q: "Synonym of HAPPY?", a: "Joyful", w: ["Sad", "Angry"] },
      { q: "Past tense of RUN?", a: "Ran", w: ["Runned", "Running"] },
      { q: "Opposite of BIG?", a: "Small", w: ["Huge", "Tall"] },
      { q: "Synonym of FAST?", a: "Quick", w: ["Slow", "Lazy"] },
      { q: "Rhymes with CAT?", a: "Hat", w: ["Dog", "Fish"] },
      { q: "Which is a noun?", a: "Apple", w: ["Eat", "Red"] },
      { q: "Opposite of DAY?", a: "Night", w: ["Sun", "Moon"] },
      { q: "Homophone of SEA?", a: "See", w: ["Say", "Saw"] },
      { q: "Past tense of EAT?", a: "Ate", w: ["Eated", "Eating"] },
      { q: "Plural of MAN?", a: "Men", w: ["Mans", "Mens"] },
      { q: "Color of Sky?", a: "Blue", w: ["Green", "Red"] },
      { q: "Antonym of UP?", a: "Down", w: ["Left", "Right"] },
    ];

    this.medium = [
      { q: "Plural of CHILD?", a: "Children", w: ["Childs", "Childrens"] },
      { q: "Which is a verb?", a: "Jump", w: ["Blue", "Table"] },
      { q: "Plural of MOUSE?", a: "Mice", w: ["Mouses", "Mees"] },
      { q: "Which is an adjective?", a: "Fast", w: ["Car", "Drive"] },
      { q: "Opposite of TRUE?", a: "False", w: ["Right", "Correct"] },
      { q: "Antonym of RICH?", a: "Poor", w: ["Wealthy", "Gold"] },
      { q: "Past tense of GO?", a: "Went", w: ["Goed", "Going"] },
      { q: "Plural of TOOTH?", a: "Teeth", w: ["Tooths", "Teethes"] },
      { q: "Rhymes with MOON?", a: "Spoon", w: ["Sun", "Star"] },
      { q: "Which is a Pronoun?", a: "He", w: ["Run", "Boy"] },
      { q: "Past tense of SEE?", a: "Saw", w: ["Seen", "Seed"] },
      { q: "Plural of FOOT?", a: "Feet", w: ["Foots", "Feets"] },
      { q: "Homophone of TWO?", a: "Too", w: ["To", "Tow"] },
    ];

    this.hard = [
      { q: "Synonym of SMART?", a: "Clever", w: ["Dumb", "Slow"] },
      { q: "Synonym of ANGRY?", a: "Mad", w: ["Calm", "Happy"] },
      { q: "Antonym of NEAR?", a: "Far", w: ["Close", "Here"] },
      { q: "Synonym of BEGIN?", a: "Start", w: ["End", "Finish"] },
      { q: "Antonym of HARD?", a: "Soft", w: ["Easy", "Solid"] },
      { q: "Past tense of DO?", a: "Did", w: ["Done", "Doed"] },
      { q: "Rhymes with SKY?", a: "Fly", w: ["Blue", "Bird"] },
      { q: "Which is an Adverb?", a: "Slowly", w: ["Fast", "Run"] },
      { q: "Synonym of BIG?", a: "Large", w: ["Tiny", "Small"] },
      { q: "Antonym of LOVE?", a: "Hate", w: ["Like", "Friend"] },
      { q: "Past tense of BUY?", a: "Bought", w: ["Buyed", "Bring"] },
      { q: "Plural of GOOSE?", a: "Geese", w: ["Gooses", "Geeses"] },
      { q: "Homophone of PAIR?", a: "Pear", w: ["Pare", "Peel"] },
      { q: "Synonym of SCARED?", a: "Afraid", w: ["Brave", "Bold"] },
      { q: "Past tense of COME?", a: "Came", w: ["Comed", "Coming"] },
      { q: "Plural of WOMAN?", a: "Women", w: ["Womans", "Womens"] },
      { q: "Rhymes with LIGHT?", a: "Bright", w: ["Dark", "Sun"] },
      { q: "Which is a Preposition?", a: "Under", w: ["Cat", "Jump"] },
      { q: "Synonym of TIRED?", a: "Sleepy", w: ["Awake", "Walk"] },
      { q: "Antonym of RIGHT?", a: "Wrong", w: ["Left", "Correct"] }
    ];
  }

  generate(robot) {
    let pool = this.easy;
    if (gameState.wave >= 4) pool = [...pool, ...this.medium];
    if (gameState.wave >= 8) pool = [...pool, ...this.hard]; // Cumulative pooling

    const qData = pool[Math.floor(Math.random() * pool.length)];

    robot.question = qData.q;
    robot.correctAnswer = qData.a;

    return { answer: qData.a, wrongAnswers: [...qData.w] };
  }
}

// ==================== ROBOT CLASS ====================
class Robot {
  constructor(type = null) {
    this.group = new THREE.Group();

    // Robot type (variety) - Smart Spawning based on Wave
    let typePool = ['normal']; // Wave 1-2 default

    if (gameState.wave >= 3 && gameState.wave <= 5) {
      // Wave 3-5: 70% Normal, 30% Fast
      typePool = ['normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'fast', 'fast', 'fast'];
    } else if (gameState.wave >= 6 && gameState.wave <= 9) {
      // Wave 6-9: 50% Normal, 30% Fast, 20% Heavy
      typePool = ['normal', 'normal', 'normal', 'normal', 'normal', 'fast', 'fast', 'fast', 'heavy', 'heavy'];
    } else if (gameState.wave >= 10) {
      // Wave 10+: 40% Normal, 40% Fast, 20% Heavy
      typePool = ['normal', 'normal', 'normal', 'normal', 'fast', 'fast', 'fast', 'fast', 'heavy', 'heavy'];
    }

    this.type = type || typePool[Math.floor(Math.random() * typePool.length)];

    // Stats based on type
    switch (this.type) {
      case 'fast':
        this.baseSpeed = 3.0;
        this.damage = 10;
        this.scale = 0.85;
        this.color = 0xff4444; // Red tint
        break;
      case 'heavy':
        this.baseSpeed = 1.0;
        this.damage = 25;
        this.scale = 1.3;
        this.color = 0x44ff44; // Green tint
        break;
      default: // normal
        this.baseSpeed = 1.8;
        this.damage = 12;
        this.scale = 1.0;
        this.color = 0x2a2a4a; // Default
    }

    // Position - spawn mostly in front of player (270 degree arc)
    // Avoid spawning directly behind
    const distance = 35 + Math.random() * 15; // Spawn distance

    // Get camera direction (forward)
    const spawnDir = new THREE.Vector3(0, 0, -1);
    if (camera) {
      spawnDir.applyQuaternion(camera.quaternion);
    }
    spawnDir.y = 0;
    spawnDir.normalize();

    // Rotate by random angle between -135 and +135 degrees (leaving 90 deg gap behind)
    const angleOffset = (Math.random() - 0.5) * (Math.PI * 1.5);
    spawnDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);

    // Set position
    const playerX = camera ? camera.position.x : 0;
    const playerZ = camera ? camera.position.z : 0;

    this.group.position.set(
      playerX + spawnDir.x * distance,
      0,
      playerZ + spawnDir.z * distance
    );

    // Keep within arena bounds
    const boundaryLimit = 45;
    this.group.position.x = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.x));
    this.group.position.z = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.z));

    this.speed = this.baseSpeed + gameState.wave * 0.1;
    this.alive = true;
    this.dying = false;
    this.dyingTimer = 0;
    this.walkTime = Math.random() * Math.PI * 2;
    this.attackCooldown = 0; // Prevent attack spam

    // Generate question based on mode
    this.generateQuestion();

    // Build robot
    this.build();

    // Apply scale for different robot types
    this.group.scale.setScalar(this.scale);

    // Add to scene
    scene.add(this.group);
  }

  generateQuestion() {
    let result;

    if (gameState.mode === 'quiz') {
      result = new QuizGenerator().generate(this);
    } else if (gameState.mode === 'english') {
      result = new EnglishGenerator().generate(this);
    } else {
      // Default to math
      result = new MathGenerator().generate(this);
    }

    // Shuffle answers for body parts
    const allAnswers = [result.answer, ...result.wrongAnswers];
    for (let i = allAnswers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allAnswers[i], allAnswers[j]] = [allAnswers[j], allAnswers[i]];
    }

    this.answers = {
      head: allAnswers[0],
      chest: allAnswers[1],
      knee: allAnswers[2]
    };
  }

  build() {
    // Create hitboxes for shooting detection
    this.createHitboxes();

    // Create procedural robot first (immediate visibility)
    this.buildProceduralFallback();

    // Create answer sprites
    this.createAnswerSprites();
    this.createQuestionSprite();

    // If GLTF model is preloaded, clone and use it
    if (robotModelLoaded && robotModel) {
      // Type-based color tint
      let tintColor;
      switch (this.type) {
        case 'fast':
          tintColor = new THREE.Color(0xff4444);
          break;
        case 'heavy':
          tintColor = new THREE.Color(0x44ff44);
          break;
        default:
          tintColor = new THREE.Color(0x4444ff);
      }

      // Clone the preloaded model
      this.model = robotModel.clone();

      // Apply color tint and emissive glow
      this.model.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material = child.material.clone();
          if (child.material.color) {
            child.material.color.lerp(tintColor, 0.3);
            // Add emissive glow matching the tint
            child.material.emissive = child.material.color;
            child.material.emissiveIntensity = 0.2;
          }
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Hide procedural visual parts (but KEEP hitboxes active!)
      this.group.children.forEach(child => {
        // Hitboxes have material.visible = false. We skip them (keep them active).
        // Visual parts have material.visible = true. We hide them.
        if (child.isMesh && child.material && child.material.visible !== false) {
          child.visible = false;
        }
      });

      // Scale and position (adjust for your model!)
      this.model.scale.set(6, 6, 6); // Model is 0.7 units, scaling to ~4.2
      this.model.position.y = 0;
      this.group.add(this.model);
    }
  }

  createHitboxes() {
    // Invisible material for hitboxes
    const hitboxMaterial = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0
    });

    // HEAD hitbox (top section) - Larger for easier headshots
    const headHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.5, 1.5), // Increased from 1.2
      hitboxMaterial
    );
    headHitbox.position.y = 3.5;
    headHitbox.userData.part = 'head';
    this.head = headHitbox;
    this.group.add(headHitbox);

    // CHEST hitbox (middle section) - Reduced height to prevent overlap
    const chestHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.2, 1.0), // Reduced height from 1.6 to 1.2
      hitboxMaterial
    );
    chestHitbox.position.y = 2.0; // Lowered from 2.3
    chestHitbox.userData.part = 'chest';
    this.body = chestHitbox;
    this.group.add(chestHitbox);

    // KNEE/LEGS hitbox (lower section) - Larger leg area
    const legHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.0, 1.0),
      hitboxMaterial
    );
    legHitbox.position.y = 0.9;
    legHitbox.userData.part = 'knee';
    this.leftLeg = legHitbox;
    this.rightLeg = legHitbox;
    this.group.add(legHitbox);
  }

  buildProceduralFallback() {
    // Fallback procedural robot if GLTF fails
    const color = this.type === 'fast' ? 0xff4444 :
      this.type === 'heavy' ? 0x44ff44 : 0x4444ff;

    const material = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.4,
      metalness: 0.8,
      emissive: color,
      emissiveIntensity: 0.2
    });

    // Simple body
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 1, 8, 16),
      material
    );
    body.position.y = 2.3;
    this.group.add(body);

    // Simple head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 16),
      material
    );
    head.position.y = 3.5;
    this.group.add(head);

    // Simple legs
    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa, // Brighter gray
      roughness: 0.6,
      metalness: 0.5
    });
    const leftLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8),
      legMaterial
    );
    leftLeg.position.set(-0.3, 0.75, 0);
    this.group.add(leftLeg);

    const rightLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8),
      legMaterial
    );
    rightLeg.position.set(0.3, 0.75, 0);
    this.group.add(rightLeg);
  }

  createTextSprite(text, label, fontSize = 80, bgColor = '#001122', textColor = '#00ff88', borderColor = '#00ffcc') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    // Dynamic width based on text length
    const strText = String(text);
    const isLongText = strText.length > 5;
    const canvasWidth = isLongText ? 512 : 256;

    canvas.width = canvasWidth;
    canvas.height = 160;

    // Background with gradient
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, bgColor);
    gradient.addColorStop(1, '#000000');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Glowing border
    context.strokeStyle = borderColor;
    context.lineWidth = 6;
    context.shadowColor = borderColor;
    context.shadowBlur = 15;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    // Label at top
    context.shadowBlur = 0;
    context.font = 'bold 24px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = '#88aacc';
    context.fillText(label, canvas.width / 2, 18);

    // Main number/text adjustments
    // Reduce font size for very long text
    let actualFontSize = fontSize;
    if (strText.length > 10) actualFontSize = fontSize * 0.6;
    else if (strText.length > 5) actualFontSize = fontSize * 0.8;

    context.font = `900 ${actualFontSize}px Arial, sans-serif`; // Extra bold
    context.textBaseline = 'middle';

    // 1. Stroke (Outline) for sharpness
    context.strokeStyle = '#000000';
    context.lineWidth = 4;
    context.shadowBlur = 0; // No glow on stroke
    context.strokeText(text, canvas.width / 2, canvas.height / 2 + 15);

    // 2. Fill (Solid color)
    context.fillStyle = textColor;
    context.shadowColor = 'transparent'; // Remove haze/glow from text
    context.shadowBlur = 0;
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 15);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Ensure label is always visible on top of robot
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);

    // Adjust scale based on aspect ratio
    const scaleX = isLongText ? 2.5 : 1.5;
    sprite.scale.set(scaleX, 1, 1);

    return sprite;
  }


  createAnswerSprites() {
    // Head answer - RED/ORANGE theme
    this.headAnswerSprite = this.createTextSprite(
      this.answers.head.toString(),
      '',
      90,
      '#220000',
      '#ff6644',
      '#ff4422'
    );
    this.headAnswerSprite.scale.set(1.8, 1.4, 1); // Increased from 1.4, 1.1
    this.headAnswerSprite.position.set(0, 3.8, 0.8);
    this.headAnswerSprite.userData.part = 'head';
    this.headAnswerSprite.renderOrder = 999;
    this.group.add(this.headAnswerSprite);

    // Chest answer - GREEN theme
    this.chestAnswerSprite = this.createTextSprite(
      this.answers.chest.toString(),
      '',
      90,
      '#002200',
      '#44ff66',
      '#22ff44'
    );
    this.chestAnswerSprite.scale.set(2.0, 1.5, 1); // Increased from 1.6, 1.2
    this.chestAnswerSprite.position.set(0, 2.2, 0.8); // Lowered slightly to match bbox
    this.chestAnswerSprite.userData.part = 'chest';
    this.chestAnswerSprite.renderOrder = 999;
    this.group.add(this.chestAnswerSprite);

    // Knee answer - BLUE theme
    this.kneeAnswerSprite = this.createTextSprite(
      this.answers.knee.toString(),
      '',
      80,
      '#000022',
      '#44aaff',
      '#2288ff'
    );
    this.kneeAnswerSprite.scale.set(1.5, 1.2, 1); // Increased from 1.2, 0.9
    this.kneeAnswerSprite.position.set(0, 1.0, 0.8);
    this.kneeAnswerSprite.userData.part = 'knee';
    this.kneeAnswerSprite.renderOrder = 999;
    this.group.add(this.kneeAnswerSprite);
  }

  createQuestionSprite() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;

    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.9)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    context.strokeStyle = '#ffcc00';
    context.lineWidth = 4;
    context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

    // Text
    context.font = 'bold 56px Orbitron, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffcc00';
    context.shadowColor = '#ffcc00';
    context.shadowBlur = 20;
    context.fillText(this.question, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3, 0.75, 1);
    sprite.position.set(0, 5, 0);
    this.questionSprite = sprite;
    this.group.add(sprite);
  }

  update(deltaTime) {
    if (this.dying) {
      this.dyingTimer += deltaTime;

      // Explosion effect - parts fly apart
      this.group.children.forEach(child => {
        if (child.isMesh) {
          child.position.y += (Math.random() - 0.5) * deltaTime * 5;
          child.rotation.x += deltaTime * 3;
          child.rotation.z += deltaTime * 2;
        }
      });

      // Fade out
      this.group.traverse(obj => {
        if (obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = Math.max(0, 1 - this.dyingTimer);
        }
      });

      if (this.dyingTimer > 1) {
        this.alive = false;
        // Clean up memory
        if (this.group) {
          this.group.traverse((child) => {
            if (child.isMesh) {
              if (child.geometry) child.geometry.dispose();
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach(m => m.dispose());
                } else {
                  child.material.dispose();
                }
              }
            }
          });
          scene.remove(this.group);
        }
      }
      return;
    }

    // Reduce attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
    }

    // Get player's actual position (on ground plane)
    const playerPos = new THREE.Vector3(camera.position.x, 0, camera.position.z);

    // Move towards player's ACTUAL position
    const direction = playerPos.clone().sub(this.group.position);
    direction.y = 0;
    const distanceToPlayer = direction.length();
    direction.normalize();

    // Move robot (speed varies by type)
    this.group.position.add(direction.multiplyScalar(this.speed * deltaTime));

    // Keep robot within arena bounds
    const boundaryLimit = 45;
    this.group.position.x = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.x));
    this.group.position.z = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.z));

    // Look at player's actual position
    this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);

    // Walking animation (faster for fast type)
    const walkSpeedMultiplier = this.type === 'fast' ? 1.5 : (this.type === 'heavy' ? 0.7 : 1.0);
    this.walkTime += deltaTime * 8 * walkSpeedMultiplier;
    const walkOffset = Math.sin(this.walkTime) * 0.15;
    this.leftLeg.rotation.x = walkOffset;
    this.rightLeg.rotation.x = -walkOffset;
    this.group.position.y = Math.abs(Math.sin(this.walkTime * 2)) * 0.1;

    // Question sprite always faces camera
    if (this.questionSprite) {
      this.questionSprite.lookAt(camera.position);
    }

    // Attack when close to PLAYER (not origin)
    const attackRange = this.type === 'heavy' ? 4 : 3;
    if (distanceToPlayer < attackRange && this.attackCooldown <= 0) {
      this.attackPlayer();
    }
  }

  attackPlayer() {
    if (!gameState.isRunning) return;

    // Set cooldown to prevent attack spam
    this.attackCooldown = 1.5;

    // Damage based on robot type
    gameState.health -= this.damage;
    updateHealthBar();

    // Damage effect - INCREASED INTENSITY
    const overlay = document.getElementById('damage-overlay');
    overlay.style.opacity = '0.85'; // Intense red opacity
    setTimeout(() => overlay.style.opacity = '0', 300); // Shorter fade for impact

    // Screen shake - USING NEW ANIMATION
    const app = document.getElementById('app');
    app.classList.remove('shake'); // Reset just in case
    void app.offsetWidth; // Trigger reflow
    app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 400); // Match CSS animation duration

    // Check if player should be offered extra life (low health)
    checkExtraLifeOffer();

    if (gameState.health <= 0) {
      endGame();
      return;
    }

    // Respawn robot around player's CURRENT position
    const playerX = camera.position.x;
    const playerZ = camera.position.z;
    const angle = Math.random() * Math.PI * 2;
    const distance = 35 + Math.random() * 15;
    this.group.position.set(
      playerX + Math.sin(angle) * distance,
      0,
      playerZ - Math.cos(angle) * distance
    );

    // Keep within arena bounds
    const boundaryLimit = 45;
    this.group.position.x = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.x));
    this.group.position.z = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.z));
  }

  checkHit(raycaster) {
    const intersects = raycaster.intersectObjects(this.group.children, true);

    if (intersects.length > 0) {
      // Find which part was hit
      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj && !obj.userData.part) {
          obj = obj.parent;
        }
        if (obj && obj.userData.part) {
          return {
            part: obj.userData.part,
            answer: this.answers[obj.userData.part],
            point: intersect.point
          };
        }
      }
      // Default to chest if can't determine
      return {
        part: 'chest',
        answer: this.answers.chest,
        point: intersects[0].point
      };
    }

    return null;
  }
}

// ==================== PARTICLE EFFECTS ====================
class ExplosionParticle {
  constructor(position, color) {
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 1
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);

    this.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      Math.random() * 8 + 2,
      (Math.random() - 0.5) * 10
    );

    this.life = 1;
    this.decay = 1.5 + Math.random();

    scene.add(this.mesh);
  }

  update(deltaTime) {
    this.mesh.position.add(this.velocity.clone().multiplyScalar(deltaTime));
    this.velocity.y -= 15 * deltaTime; // Gravity
    this.life -= this.decay * deltaTime;
    this.mesh.material.opacity = this.life;
    this.mesh.scale.setScalar(this.life);

    scene.add(this.mesh);
  }

  update(deltaTime) {
    this.mesh.position.add(this.velocity.clone().multiplyScalar(deltaTime));
    this.velocity.y -= 15 * deltaTime; // Gravity
    this.life -= this.decay * deltaTime;
    this.mesh.material.opacity = this.life;
    this.mesh.scale.setScalar(this.life);

    if (this.life <= 0) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    if (this.mesh) {
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) this.mesh.material.dispose();
      scene.remove(this.mesh);
    }
  }
}

function createExplosion(position, color, count = 30) {
  // Reduce particle count on mobile for performance
  const actualCount = isMobile ? Math.floor(count / 2) : count;

  for (let i = 0; i < actualCount; i++) {
    particles.push(new ExplosionParticle(position, color));
  }
}

// ==================== BULLET TRAIL ====================
class BulletTrail {
  constructor(start, end) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      start.x, start.y, start.z,
      end.x, end.y, end.z
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 1
    });

    this.line = new THREE.Line(geometry, material);
    this.life = 0.2;
    scene.add(this.line);
  }

  update(deltaTime) {
    this.life -= deltaTime;
    this.line.material.opacity = this.life / 0.2;

    if (this.life <= 0) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    if (this.line) {
      if (this.line.geometry) this.line.geometry.dispose();
      if (this.line.material) this.line.material.dispose();
      scene.remove(this.line);
    }
  }
}

// ==================== HEALTH PICKUP ====================
class HealthPickup {
  constructor(position) {
    this.mesh = new THREE.Group();

    // Create cross shape
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x004400,
      roughness: 0.2,
      metalness: 0.8
    });

    const vBarGeo = new THREE.BoxGeometry(0.6, 2, 0.6);
    const hBarGeo = new THREE.BoxGeometry(2, 0.6, 0.6);

    const vBar = new THREE.Mesh(vBarGeo, material);
    const hBar = new THREE.Mesh(hBarGeo, material);

    this.mesh.add(vBar);
    this.mesh.add(hBar);

    // Inner glow
    const glowGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x88ff88, transparent: true, opacity: 0.5 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    this.mesh.add(glow);

    this.mesh.position.copy(position);
    this.mesh.position.y = 1.5; // Float height

    // Add point light
    this.light = new THREE.PointLight(0x00ff00, 1, 5);
    this.light.position.set(0, 0, 0);
    this.mesh.add(this.light);

    scene.add(this.mesh);

    this.scale = 0;
    this.targetScale = 0.4;
    this.mesh.scale.set(0, 0, 0);

    this.rotationSpeed = 2;
    this.bobSpeed = 3;
    this.time = Math.random() * 100;
  }

  update(deltaTime) {
    // Rotation
    this.mesh.rotation.y += this.rotationSpeed * deltaTime;
    this.mesh.rotation.x = Math.sin(this.time) * 0.2;
    this.mesh.rotation.z = Math.cos(this.time) * 0.2;

    // Bobbing
    this.time += deltaTime * this.bobSpeed;
    this.mesh.position.y = 1.5 + Math.sin(this.time) * 0.3;

    // Scale animation
    if (this.scale < this.targetScale) {
      this.scale += deltaTime * 2;
      if (this.scale > this.targetScale) this.scale = this.targetScale;
      this.mesh.scale.set(this.scale, this.scale, this.scale);
    }
  }

  remove() {
    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        }
      });
      scene.remove(this.mesh);
    }
  }
}

// ==================== UI ====================
function createUI() {
  const app = document.getElementById('app');

  // Start Screen
  const startScreen = document.createElement('div');
  startScreen.id = 'start-screen';
  startScreen.innerHTML = `
    <div class="start-content">
      <div class="title-container">
        <h1 class="game-title">LEARN<span class="highlight">FIRE</span></h1>
        <div class="title-underline"></div>
      </div>
      
      <p class="mode-label">SELECT YOUR CHALLENGE</p>
      
      <div class="mode-select">
        <!-- MATH CARD -->
        <div class="mode-card selected" id="mode-math" data-mode="math">
          <div class="check-mark">✓</div>
          <div class="mode-icon">🔢</div>
          <div class="mode-info">
            <span class="mode-title">MATH</span>
            <span class="mode-desc">Quick calculations</span>
          </div>
        </div>

        <!-- QUIZ CARD -->
        <div class="mode-card" id="mode-quiz" data-mode="quiz">
          <div class="check-mark">✓</div>
          <div class="mode-icon">❓</div>
          <div class="mode-info">
            <span class="mode-title">QUIZ</span>
            <span class="mode-desc">Knowledge test</span>
          </div>
        </div>

        <!-- ENGLISH CARD -->
        <div class="mode-card" id="mode-english" data-mode="english">
          <div class="check-mark">✓</div>
          <div class="mode-icon">📝</div>
          <div class="mode-info">
            <span class="mode-title">ENGLISH</span>
            <span class="mode-desc">Language skills</span>
          </div>
        </div>
      </div>

      <button class="start-btn" id="start-btn">START MISSION</button>
      
      <div class="start-footer">
        <a href="/about.html" class="footer-link">About Mission</a>
        <a href="/privacy.html" class="footer-link">Privacy Protocol</a>
        <a href="/contact.html" class="footer-link">Comms Channel</a>
      </div>
    </div>
  `;
  app.appendChild(startScreen);

  // Mobile Hint
  const mobileHint = document.createElement('div');
  mobileHint.id = 'mobile-hint';
  mobileHint.innerHTML =
    '<span>🕹️ Move with joystick</span>' +
    '<span>💥 Tap to shoot the right answer</span>' +
    '<span>⚡ Be quick and correct!</span>';
  app.appendChild(mobileHint);

  // Orientation Warning
  const orientationWarning = document.createElement('div');
  orientationWarning.id = 'orientation-warning';
  orientationWarning.innerHTML = `
    <div class="warning-content">
      <div class="rotate-icon">📱 ➡️ 🔄</div>
      <h2>LANDSCAPE REQUIRED</h2>
      <p>Rotate device to initiate neural link</p>
    </div>
  `;
  app.appendChild(orientationWarning);

  // HUD Container
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.className = 'hidden';

  // HUD: Top Left (Stats)
  const hudTopLeft = document.createElement('div');
  hudTopLeft.className = 'hud-top-left';
  hudTopLeft.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">SCORE</span>
      <span class="stat-value" id="score">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">WAVE</span>
      <span class="stat-value" id="wave">1</span>
    </div>
  `;
  hud.appendChild(hudTopLeft);

  // HUD: Top Center (Question)
  const hudTopCenter = document.createElement('div');
  hudTopCenter.className = 'hud-top-center';
  hudTopCenter.innerHTML = `
    <div class="question-display">
      <div class="question-text" id="current-question">READY</div>
    </div>
  `;
  hud.appendChild(hudTopCenter);

  // HUD: Top Right (Combo)
  const hudTopRight = document.createElement('div');
  hudTopRight.className = 'hud-top-right';
  hudTopRight.innerHTML = `
    <div class="combo-display">
      <span class="combo-value" id="combo">x1</span>
      <span class="combo-label">COMBO CHAIN</span>
    </div>
  `;
  hud.appendChild(hudTopRight);

  // HUD: Bottom Left (Health)
  const hudBottomLeft = document.createElement('div');
  hudBottomLeft.className = 'hud-bottom-left';
  hudBottomLeft.innerHTML = `
    <div class="health-container">
      <span class="health-icon">✚</span>
      <div class="health-bar-frame">
        <div class="health-fill" id="health-fill"></div>
      </div>
      <span class="health-value" id="health-val">100%</span>
    </div>
  `;
  hud.appendChild(hudBottomLeft);

  app.appendChild(hud);

  // Crosshair
  const crosshair = document.createElement('div');
  crosshair.id = 'crosshair';
  crosshair.className = 'hidden';
  crosshair.innerHTML = `
    <div class="reticle-circle"></div>
    <div class="reticle-center"></div>
  `;
  app.appendChild(crosshair);

  // Hit marker
  const hitMarker = document.createElement('div');
  hitMarker.id = 'hit-marker';
  hitMarker.innerHTML = '<div class="hit-x"></div>';
  app.appendChild(hitMarker);

  // Threat Indicator (Directional)
  const threatIndicator = document.createElement('div');
  threatIndicator.id = 'threat-indicator';
  threatIndicator.innerHTML = '<div class="threat-arrow"></div>';
  app.appendChild(threatIndicator);

  // Damage overlay
  const damageOverlay = document.createElement('div');
  damageOverlay.id = 'damage-overlay';
  app.appendChild(damageOverlay);

  // Muzzle flash
  const muzzleFlash = document.createElement('div');
  muzzleFlash.id = 'muzzle-flash';
  app.appendChild(muzzleFlash);

  // Wave announcement
  const waveAnnounce = document.createElement('div');
  waveAnnounce.id = 'wave-announcement';
  app.appendChild(waveAnnounce);

  // Pause Menu
  const pauseMenu = document.createElement('div');
  pauseMenu.id = 'pause-menu';
  pauseMenu.className = 'hidden';
  pauseMenu.innerHTML = `
    <div class="pause-box">
      <h2 class="pause-title">MISSION PAUSED</h2>
      <div class="pause-buttons">
        <button class="menu-btn" id="resume-btn">RESUME</button>
        <button class="menu-btn" id="quit-btn">ABORT MISSION</button>
      </div>
    </div>
  `;
  app.appendChild(pauseMenu);

  // Game Over Screen (existing)
  const gameoverScreen = document.createElement('div');
  gameoverScreen.id = 'gameover-screen';
  gameoverScreen.innerHTML = `
    <div class="gameover-box">
      <h1 class="gameover-title">SYSTEM FAILURE</h1>
      <div class="stat-grid">
        <div class="final-stat-box">
          <span class="final-label">SCORE</span>
          <span class="final-value" id="final-score">0</span>
        </div>
        <div class="final-stat-box">
          <span class="final-label">WAVE</span>
          <span class="final-value" id="final-waves">0</span>
        </div>
        <div class="final-stat-box">
          <span class="final-label">KILLS</span>
          <span class="final-value" id="final-kills">0</span>
        </div>
      </div>
      
      <div class="share-section">
        <p class="share-label">SHARE YOUR SCORE</p>
        <div class="share-buttons">
        <div class="share-buttons">
          <button class="share-btn share-whatsapp" id="share-whatsapp" title="Share on WhatsApp">
            <span class="share-icon">📱</span>
          </button>
          <button class="share-btn share-instagram" id="share-instagram" title="Share on Instagram">
            <span class="share-icon">📸</span>
          </button>
          <button class="share-btn share-twitter" id="share-twitter" title="Share on X/Twitter">
            <span class="share-icon">𝕏</span>
          </button>
          <button class="share-btn share-native" id="share-native" title="More Options">
            <span class="share-icon">📤</span>
          </button>
        </div>
      </div>
      
      <button class="start-btn" id="restart-btn">REBOOT SYSTEM</button>
    </div>
  `;
  app.appendChild(gameoverScreen);

  // Custom Share Card (hidden, used for screenshot)
  const shareCard = document.createElement('div');
  shareCard.id = 'share-card';
  shareCard.innerHTML = `
    <div class="share-card-inner">
      <div class="share-card-header">
        <span class="share-card-logo">🔥</span>
        <h1 class="share-card-title">LEARN<span>FIRE</span></h1>
      </div>
      <div class="share-card-score">
        <span class="share-score-label">MY SCORE</span>
        <span class="share-score-value" id="share-score">0</span>
      </div>
      <div class="share-card-stats">
        <div class="share-stat">
          <span class="share-stat-value" id="share-wave">0</span>
          <span class="share-stat-label">WAVES</span>
        </div>
        <div class="share-stat">
          <span class="share-stat-value" id="share-kills">0</span>
          <span class="share-stat-label">KILLS</span>
        </div>
      </div>
      <div class="share-card-cta">
        <span class="share-cta-text">🎮 CAN YOU BEAT MY SCORE?</span>
      </div>
      <div class="share-card-footer">
        <span class="share-website">▶ PLAY NOW AT</span>
        <span class="share-url">LEARNFIRE.LIVE</span>
      </div>
    </div>
  `;
  app.appendChild(shareCard);

  // Mobile Controls
  const mobileControls = document.createElement('div');
  mobileControls.id = 'mobile-controls';
  mobileControls.innerHTML = `
    <div id="joystick-container">
      <div id="joystick-knob"></div>
    </div>
    <div id="look-area"></div>
  `;
  app.appendChild(mobileControls);

  // Revive Modal (shows before game over with ad option)
  const reviveModal = document.createElement('div');
  reviveModal.id = 'revive-modal';
  reviveModal.innerHTML = `
    <div class="revive-content">
      <div class="revive-skull">💀</div>
      <h1 class="revive-title">YOU DIED</h1>
      <p class="revive-subtitle">Watch 2 short videos to continue your mission</p>
      <div class="revive-reward">
        <p>🎁 Continue with 50% HP</p>
      </div>
      <div class="revive-buttons">
        <button id="revive-btn">▶ REVIVE (Watch 2 Ads)</button>
        <button id="give-up-btn">Give Up</button>
      </div>
    </div>
  `;
  app.appendChild(reviveModal);

  // Extra Life Button (appears when health is low)
  const extraLifeBtn = document.createElement('button');
  extraLifeBtn.id = 'extra-life-btn';
  extraLifeBtn.className = 'hidden';
  extraLifeBtn.textContent = '▶ +50 HP';
  app.appendChild(extraLifeBtn);

  // Wave Ad Overlay (for interstitial ads between waves)
  const waveAdOverlay = document.createElement('div');
  waveAdOverlay.id = 'wave-ad-overlay';
  waveAdOverlay.innerHTML = `<p class="wave-transition-text">WAVE COMPLETE</p>`;
  app.appendChild(waveAdOverlay);

  // Banner Ad Container (on start screen)
  const bannerAdContainer = document.createElement('div');
  bannerAdContainer.id = 'banner-ad-container';
  document.getElementById('start-screen').appendChild(bannerAdContainer);



  // Event listeners
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');

  // Share functionality
  const GAME_URL = 'https://www.learnfire.live';

  function getShareText() {
    const score = document.getElementById('final-score').textContent;
    const wave = document.getElementById('final-waves').textContent;
    const kills = document.getElementById('final-kills').textContent;
    return `🔥 I scored ${score} points, reached wave ${wave}, and got ${kills} kills in Learn Fire! Can you beat my score? 🎮\n${GAME_URL}`;
  }

  // Capture screenshot of custom share card
  async function captureScreenshot() {
    const shareCard = document.getElementById('share-card');
    if (!shareCard || typeof html2canvas === 'undefined') {
      console.error('Cannot capture screenshot');
      return null;
    }

    // Populate share card with current scores
    document.getElementById('share-score').textContent = document.getElementById('final-score').textContent;
    document.getElementById('share-wave').textContent = document.getElementById('final-waves').textContent;
    document.getElementById('share-kills').textContent = document.getElementById('final-kills').textContent;

    // Make it visible temporarily for capture
    shareCard.style.position = 'fixed';
    shareCard.style.left = '-9999px';
    shareCard.style.top = '0';
    shareCard.style.display = 'block';

    try {
      const canvas = await html2canvas(shareCard.querySelector('.share-card-inner'), {
        backgroundColor: '#0a0a1a',
        scale: 2, // Higher quality
        logging: false,
        width: 400,
        height: 500
      });
      shareCard.style.display = 'none';
      return canvas;
    } catch (err) {
      console.error('Screenshot failed:', err);
      shareCard.style.display = 'none';
      return null;
    }
  }

  // Shared blob cache
  let cachedShareBlob = null;
  let isGeneratingScreenshot = false;

  // Pre-generate screenshot when game over screen appears
  async function preGenerateScreenshot() {
    if (cachedShareBlob || isGeneratingScreenshot) return;
    isGeneratingScreenshot = true;

    // Update DOM elements for the screenshot
    document.getElementById('share-score').textContent = gameState.score;
    document.getElementById('share-wave').textContent = gameState.wave;
    document.getElementById('share-kills').textContent = gameState.kills;

    try {
      const canvas = await captureScreenshot(true); // true = hidden capture
      if (canvas) {
        cachedShareBlob = await canvasToBlob(canvas);
      }
    } catch (e) {
      console.warn('Pre-generation failed', e);
    } finally {
      isGeneratingScreenshot = false;
    }
  }

  // Modified capture to use cache if available or generate new
  async function getShareBlob() {
    if (cachedShareBlob) return cachedShareBlob;

    // If currently generating, wait a bit
    if (isGeneratingScreenshot) {
      while (isGeneratingScreenshot) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (cachedShareBlob) return cachedShareBlob;
    }

    // Generate fresh
    const canvas = await captureScreenshot();
    if (canvas) {
      return await canvasToBlob(canvas);
    }
    return null;
  }

  // Helper: Set button loading state
  function setButtonLoading(btn, isLoading) {
    if (isLoading) {
      btn.dataset.originalHtml = btn.innerHTML;
      btn.innerHTML = '<span class="share-icon spinner">⏳</span>'; // Simple spinner
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
      btn.disabled = false;
    }
  }

  // Download screenshot
  function downloadScreenshot(blob, filename = 'learnfire-score.png') {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  // WhatsApp Share
  document.getElementById('share-whatsapp').addEventListener('click', async function () {
    const btn = this;
    setButtonLoading(btn, true);

    try {
      const text = getShareText();

      // Try native share with image first (modern mobile browsers)
      const blob = await getShareBlob();
      if (blob) {
        const file = new File([blob], 'learnfire-score.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file], text })) {
          await navigator.share({
            files: [file],
            text: text,
            title: 'My Score'
          });
          setButtonLoading(btn, false);
          return;
        }
      }

      // Fallback to text intent
      setTimeout(() => {
        if (isMobile) {
          window.location.href = `whatsapp://send?text=${encodeURIComponent(text)}`;
        } else {
          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
        }
        setButtonLoading(btn, false);
      }, 300);

    } catch (e) {
      console.error(e);
      setButtonLoading(btn, false);
    }
  });

  // Instagram Share
  document.getElementById('share-instagram').addEventListener('click', async function () {
    const btn = this;
    setButtonLoading(btn, true);

    try {
      const blob = await getShareBlob();
      if (!blob) throw new Error('Failed to generate image');

      const file = new File([blob], 'learnfire-score.png', { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Learn Fire Score',
        });
      } else {
        // Fallback
        downloadScreenshot(blob);
        alert('Image saved! open Instagram to share.');
      }
    } catch (e) {
      console.error(e);
      alert('Could not share image.');
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Twitter Share (Text only, most reliable)
  document.getElementById('share-twitter').addEventListener('click', async function () {
    const text = encodeURIComponent('🔥 Check out my score in Learn Fire! Can you beat it? 🎮');
    const url = encodeURIComponent(GAME_URL);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  });

  // Native Share (Generic)
  document.getElementById('share-native').addEventListener('click', async function () {
    const btn = this;
    setButtonLoading(btn, true);

    try {
      const blob = await getShareBlob();
      const shareData = {
        title: 'Learn Fire',
        text: getShareText(),
        url: GAME_URL
      };

      if (blob) {
        const file = new File([blob], 'learnfire-score.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }
      }

      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Copy to clipboard as fallback
        await navigator.clipboard.writeText(getShareText());
        alert('Score copied to clipboard!');
      }
    } catch (e) {
      console.warn('Share failed', e);
    } finally {
      setButtonLoading(btn, false);
    }
  });



  // Select all mode cards
  const modeCards = document.querySelectorAll('.mode-card');

  function setGameMode(mode) {
    gameState.mode = mode;

    modeCards.forEach(card => {
      if (card.dataset.mode === mode) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  }

  // Attach listeners to cards
  modeCards.forEach(card => {
    card.addEventListener('click', () => setGameMode(card.dataset.mode));

    // Touch support
    card.addEventListener('touchstart', (e) => {
      e.preventDefault();
      setGameMode(card.dataset.mode);
    }, { passive: false });
  });

  const resumeBtn = document.getElementById('resume-btn');
  const quitBtn = document.getElementById('quit-btn');

  function togglePause() {
    if (!gameState.isRunning) return;

    gameState.isPaused = !gameState.isPaused;

    const pauseMenu = document.getElementById('pause-menu');

    if (gameState.isPaused) {
      pauseMenu.classList.remove('hidden');
      clock.stop();
      document.exitPointerLock();
    } else {
      pauseMenu.classList.add('hidden');
      clock.start();
      document.body.requestPointerLock();
    }
  }

  // Keyboard Pause
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      togglePause();
    }
  });

  resumeBtn.addEventListener('click', togglePause);

  quitBtn.addEventListener('click', () => {
    location.reload(); // Simple restart for now
  });

  // Touch support for pause menu
  resumeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); togglePause(); }, { passive: false });
  quitBtn.addEventListener('touchstart', (e) => { e.preventDefault(); location.reload(); }, { passive: false });

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);

  // Ensure touch also triggers start (sometimes click is delayed/blocked)
  startBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startGame();
  }, { passive: false });

  restartBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startGame();
  }, { passive: false });

  // Mobile touch event listeners
  if (isMobile) {
    const lookArea = document.getElementById('look-area');
    const joystickContainer = document.getElementById('joystick-container');

    // Touch look controls (Right side of screen)
    lookArea.addEventListener('touchstart', onTouchStart, { passive: false });
    lookArea.addEventListener('touchmove', onTouchMove, { passive: false });
    lookArea.addEventListener('touchend', onTouchEnd, { passive: false });

    // Joystick controls (Left side of screen)
    joystickContainer.addEventListener('touchstart', onJoystickStart, { passive: false });
    joystickContainer.addEventListener('touchmove', onJoystickMove, { passive: false });
    joystickContainer.addEventListener('touchend', onJoystickEnd, { passive: false });
    joystickContainer.addEventListener('touchcancel', onJoystickEnd, { passive: false });
  }

  // ==================== AD SYSTEM EVENT LISTENERS ====================
  const reviveBtn = document.getElementById('revive-btn');
  const giveUpBtn = document.getElementById('give-up-btn');
  const extraLifeButton = document.getElementById('extra-life-btn');

  // Revive button - watch 2 ads to continue
  reviveBtn.addEventListener('click', attemptRevive);
  reviveBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    attemptRevive();
  }, { passive: false });

  // Give up button - proceed to game over
  giveUpBtn.addEventListener('click', showFinalGameOver);
  giveUpBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    showFinalGameOver();
  }, { passive: false });

  // Extra life button - watch 1 ad for +50 HP
  extraLifeButton.addEventListener('click', claimExtraLife);
  extraLifeButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    claimExtraLife();
  }, { passive: false });

  // Initialize ad system
  initAds();
}

// ==================== AD SYSTEM FUNCTIONS ====================

// Track if extra life offer is currently shown
let extraLifeOfferShown = false;

function attemptRevive() {
  const reviveBtn = document.getElementById('revive-btn');
  reviveBtn.disabled = true;
  reviveBtn.textContent = 'Loading...';

  // Mute game audio during ads
  setGameAudioMuted(true);

  showRewardedAd('revive', (result) => {
    if (result && result.partial) {
      // Need to watch more ads
      reviveBtn.disabled = false;
      reviveBtn.textContent = `▶ REVIVE (Ad ${result.current}/${result.total} done)`;
      // Automatically trigger next ad
      setTimeout(() => attemptRevive(), 500);
    } else {
      // All ads watched - revive the player!
      executeRevive();
    }
  }, () => {
    // Ad cancelled/failed
    reviveBtn.disabled = false;
    reviveBtn.textContent = '▶ REVIVE (Watch 2 Ads)';
  });
}

function executeRevive() {
  // Hide revive modal
  document.getElementById('revive-modal').classList.remove('show');

  // Restore player with 50% health
  gameState.health = Math.floor(gameState.maxHealth * 0.5);
  updateHealthBar();

  // Resume game
  gameState.isRunning = true;

  // Show HUD again
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('crosshair').classList.remove('hidden');

  // Show mobile controls if on mobile
  if (isMobile) {
    document.getElementById('mobile-controls').classList.add('show');
  } else {
    // Re-lock pointer on desktop
    renderer.domElement.requestPointerLock();
  }

  // Resume clock
  clock.start();

  // Unmute and resume music
  setGameAudioMuted(false);
  if (bgMusic && bgMusic.paused) {
    bgMusic.play().catch(() => { });
  }

  // Show revival message
  showDamageNumber({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, 'REVIVED!', true);

  console.log('[Game] Player revived with 50% HP');
}

function showFinalGameOver() {
  // Ensure game is stopped
  gameState.isRunning = false;

  // Hide revive modal
  document.getElementById('revive-modal').classList.remove('show');

  // Show actual game over screen
  document.getElementById('gameover-screen').classList.add('show');
  document.getElementById('final-score').textContent = gameState.score;
  document.getElementById('final-waves').textContent = gameState.wave;
  document.getElementById('final-kills').textContent = gameState.kills;

  // Start pre-generating the screenshot immediately
  preGenerateScreenshot();
}

function showReviveModal() {
  // Check if player can revive
  if (!canShowAd('revive')) {
    // No revives left - go straight to game over
    showFinalGameOver();
    return;
  }

  // Pause game state but keep it "alive" for potential revive
  gameState.isRunning = false;

  // Hide HUD
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('crosshair').classList.add('hidden');

  // Hide mobile controls
  if (isMobile) {
    document.getElementById('mobile-controls').classList.remove('show');
  }

  // Reset revive button state
  const reviveBtn = document.getElementById('revive-btn');
  reviveBtn.disabled = false;
  reviveBtn.textContent = '▶ REVIVE (Watch 2 Ads)';

  // Show revive modal
  document.getElementById('revive-modal').classList.add('show');
}

function claimExtraLife() {
  const extraLifeBtn = document.getElementById('extra-life-btn');
  extraLifeBtn.classList.remove('show');

  showRewardedAd('extraLife', () => {
    // Grant extra health
    const healAmount = 50;
    gameState.health = Math.min(gameState.maxHealth, gameState.health + healAmount);
    updateHealthBar();

    showDamageNumber({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, `+${healAmount} HP!`, true);
    playSound('pickup');

    // Hide the button permanently for this session
    extraLifeBtn.classList.add('hidden');
    extraLifeOfferShown = false;

    console.log('[Game] Extra life claimed, +50 HP');
  }, () => {
    // Ad cancelled - show button again
    extraLifeBtn.classList.add('show');
  });
}

function checkExtraLifeOffer() {
  // Show extra life offer when health drops below 25%
  const healthPercent = (gameState.health / gameState.maxHealth) * 100;

  if (healthPercent < 25 && healthPercent > 0 && !extraLifeOfferShown && canShowAd('extraLife')) {
    const extraLifeBtn = document.getElementById('extra-life-btn');
    extraLifeBtn.classList.remove('hidden');
    extraLifeBtn.classList.add('show');
    extraLifeOfferShown = true;
  }
}

function showWaveTransitionAd(waveNumber, callback) {
  const overlay = document.getElementById('wave-ad-overlay');
  overlay.querySelector('.wave-transition-text').textContent = `WAVE ${waveNumber - 1} COMPLETE`;
  overlay.classList.add('show');

  showInterstitialAd(() => {
    overlay.classList.remove('show');
    if (callback) callback();
  });
}

// Debug logger removed

// ==================== MOBILE TOUCH HANDLERS ====================
let lookTouchId = null;
let touchStartTime = 0;
// touchStartX/Y are already defined above
let lastTapTime = 0;
const TAP_THRESHOLD = 200; // ms to consider a tap vs hold/drag
const TAP_MOVE_THRESHOLD = 10; // pixels movement allowed for a tap

function onTouchStart(event) {
  event.preventDefault();
  if (!gameState.isRunning || gameState.isPaused) {
    return;
  }

  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    // Relaxed check: just ensure lookTouchId is free
    if (lookTouchId === null) {
      lookTouchId = touch.identifier;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;

      // Store time for tap detection
      touchStartTime = Date.now();
    }
  }
}

function onTouchMove(event) {
  event.preventDefault();
  if (!gameState.isRunning || gameState.isPaused) return;

  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    if (touch.identifier === lookTouchId) {
      // Calculate movement delta
      const deltaX = touch.clientX - lastTouchX;
      const deltaY = touch.clientY - lastTouchY;

      // Update yaw and pitch based on touch movement
      yaw -= deltaX * touchSensitivity;
      pitch -= deltaY * touchSensitivity;

      // Clamp pitch
      pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));

      // Apply to camera
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      // Store for next frame
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    }
  }
}


function onTouchEnd(event) {
  event.preventDefault();
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    if (touch.identifier === lookTouchId) {
      // Check tap logic
      // We need variables tracking start time/pos for the CURRENT lookTouchId
      // I will add these variables in the global scope near lookTouchId in a separate chunk or rely on the previous chunk having added them (which it didn't fully).
      // Actually, I'll add them here.

      const timeDiff = Date.now() - touchStartTime;
      const distDiff = Math.sqrt(Math.pow(touch.clientX - touchStartX, 2) + Math.pow(touch.clientY - touchStartY, 2));

      if (timeDiff < TAP_THRESHOLD && distDiff < TAP_MOVE_THRESHOLD) {
        onShoot();
      }

      lookTouchId = null;
    }
  }
}

function onFireButtonPress(event) {
  event.preventDefault(); // Stop default behavior
  event.stopPropagation(); // Don't bubble up to look area
  if (!gameState.isRunning) return;

  // Trigger shooting
  onShoot();
}

function onFireButtonRelease(event) {
  event.preventDefault();
  event.stopPropagation();
}

// Joystick touch handlers
let joystickTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;
const joystickMaxDistance = 45; // Larger for bigger joystick

function onJoystickStart(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!gameState.isRunning || gameState.isPaused) return;

  const container = document.getElementById('joystick-container');
  const rect = container.getBoundingClientRect();
  joystickCenterX = rect.left + rect.width / 2;
  joystickCenterY = rect.top + rect.height / 2;

  // Find the touch that started on the joystick
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    // Verify specific target tracking if needed, but container listener is usually enough
    if (joystickTouchId === null) {
      joystickTouchId = touch.identifier;
      joystickActive = true;

      // Initial move if they tapped off-center
      updateJoystick(touch.clientX, touch.clientY);
      break;
    }
  }
}

function onJoystickMove(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!gameState.isRunning || gameState.isPaused || !joystickActive) return;

  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    if (touch.identifier === joystickTouchId) {
      updateJoystick(touch.clientX, touch.clientY);
      break;
    }
  }
}

function updateJoystick(clientX, clientY) {
  // Calculate offset from center
  let deltaX = clientX - joystickCenterX;
  let deltaY = clientY - joystickCenterY;

  // Clamp to max distance
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (distance > joystickMaxDistance) {
    deltaX = (deltaX / distance) * joystickMaxDistance;
    deltaY = (deltaY / distance) * joystickMaxDistance;
  }

  // Update joystick knob position
  const knob = document.getElementById('joystick-knob');
  knob.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

  // Update joystick values (normalized -1 to 1)
  joystickX = deltaX / joystickMaxDistance;
  joystickY = deltaY / joystickMaxDistance;
}

function onJoystickEnd(event) {
  event.preventDefault();
  event.stopPropagation();

  for (let i = 0; i < event.changedTouches.length; i++) {
    if (event.changedTouches[i].identifier === joystickTouchId) {
      joystickTouchId = null;
      joystickActive = false;
      joystickX = 0;
      joystickY = 0;

      // Reset knob position
      const knob = document.getElementById('joystick-knob');
      knob.style.transform = 'translate(0px, 0px)';
      break;
    }
  }

  // Failsafe: if no touches left, reset joystick
  if (event.touches.length === 0) {
    joystickTouchId = null;
    joystickActive = false;
    joystickX = 0;
    joystickY = 0;
    const knob = document.getElementById('joystick-knob');
    if (knob) knob.style.transform = 'translate(0px, 0px)';
  }
}

// Jump button handlers
function onJumpButtonPress(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!gameState.isRunning || gameState.isPaused) return;

  // Trigger jump if grounded
  if (isGrounded) {
    velocityY = jumpForce;
    isGrounded = false;
  }
}

function onJumpButtonRelease(event) {
  event.preventDefault();
  event.stopPropagation();
}

function updateHealthBar() {
  const percentage = Math.max(0, Math.min(100, Math.ceil((gameState.health / gameState.maxHealth) * 100)));

  const healthFill = document.getElementById('health-fill');
  healthFill.style.width = percentage + '%';

  const healthVal = document.getElementById('health-val');
  if (healthVal) {
    healthVal.textContent = percentage + '%';
  }

  // Visual feedback on low health
  const healthContainer = document.querySelector('.health-container');
  if (percentage < 30) {
    healthContainer.style.animation = 'pulse-red 1s infinite';
  } else {
    healthContainer.style.animation = 'none';
  }
}

function showHitMarker(correct) {
  const hitMarker = document.getElementById('hit-marker');
  hitMarker.className = correct ? 'show correct' : 'show wrong';
  setTimeout(() => hitMarker.className = '', 150);
}

function showDamageNumber(screenPos, text, correct) {
  const element = document.createElement('div');
  element.className = `damage-number ${correct ? 'correct' : 'wrong'}`;
  element.textContent = text;
  element.style.left = screenPos.x + 'px';
  element.style.top = screenPos.y + 'px';
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 1000);
}

function showMuzzleFlash() {
  const flash = document.getElementById('muzzle-flash');
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 80);
}

function showWaveAnnouncement(waveNum) {
  const announce = document.getElementById('wave-announcement');
  announce.textContent = `WAVE ${waveNum}`;
  announce.classList.add('show');
  setTimeout(() => announce.classList.remove('show'), 2000);
}

function updateQuestionDisplay() {
  const display = document.getElementById('current-question');

  if (robots.length === 0) {
    display.textContent = 'INCOMING...';
    display.style.color = 'var(--accent)';
    return;
  }

  // 1. Check if aiming at a robot
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Collect all robot meshes for intersection
  let aimedRobot = null;

  for (const robot of robots) {
    if (robot.dying) continue;

    // Check intersection with this robot's group children (hitboxes)
    const intersects = raycaster.intersectObjects(robot.group.children, true);
    if (intersects.length > 0) {
      aimedRobot = robot;
      break; // Found the one we're aiming at
    }
  }

  if (aimedRobot) {
    display.textContent = aimedRobot.question;
    display.style.color = 'var(--accent)'; // Highlight when locked on
    display.style.textShadow = '0 0 20px var(--accent)';
    return;
  }

  // No robot aimed at
  display.textContent = 'AIM TO SCAN';
  display.style.color = 'rgba(255, 255, 255, 0.5)';
  display.style.textShadow = 'none';
}

// Throttling Threat Indicator (optimuzation)
let threatUpdateFrame = 0;

function updateThreatIndicator() {
  threatUpdateFrame++;
  if (threatUpdateFrame % 10 !== 0) return; // Only run every 10 frames

  const indicator = document.getElementById('threat-indicator');
  const arrow = indicator.querySelector('.threat-arrow');

  if (!gameState.isRunning || robots.length === 0) {
    indicator.style.opacity = '0';
    return;
  }

  // Find closest robot
  let closestRobot = null;
  let minDistance = Infinity;
  const playerPos = new THREE.Vector3(camera.position.x, 0, camera.position.z);

  for (const robot of robots) {
    if (robot.dying) continue;
    const dist = playerPos.distanceTo(new THREE.Vector3(robot.group.position.x, 0, robot.group.position.z));
    if (dist < minDistance) {
      minDistance = dist;
      closestRobot = robot;
    }
  }

  // Thresholds
  const MAX_DETECT_RANGE = 25;
  const HIGH_DANGER_RANGE = 8;

  if (closestRobot && minDistance < MAX_DETECT_RANGE) {
    indicator.style.opacity = Math.min(1, 1 - (minDistance - HIGH_DANGER_RANGE) / (MAX_DETECT_RANGE - HIGH_DANGER_RANGE)).toString();

    // Calculate angle relative to camera view
    // Transform robot position into camera's local space
    const robotPos = closestRobot.group.position.clone();
    robotPos.y = camera.position.y; // Ignore height difference

    // We need the relative position of robot to camera, considering camera rotation
    // Clone camera to not mess with actual camera, calculate local position
    const relPos = robotPos.clone().sub(camera.position);

    // Rotate this vector by the inverse of camera's yaw (rotation around Y)
    // We only care about Y rotation (yaw) for the compass
    const angle = Math.atan2(relPos.x, relPos.z);

    // Camera's current rotation
    const camAngle = Math.atan2(camera.getWorldDirection(new THREE.Vector3()).x, camera.getWorldDirection(new THREE.Vector3()).z);

    // Difference
    let bearing = camAngle - angle; // In radians

    // Rotate the arrow
    // Math.PI offset might be needed depending on initial arrow direction
    arrow.style.transform = `rotate(${-bearing}rad)`;

  } else {
    indicator.style.opacity = '0';
  }
}

// ==================== AUDIO ====================
function playSound(type) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  switch (type) {
    case 'shoot':
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.08);
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.08);
      break;
    case 'hit':
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      break;
    case 'kill':
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(500, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.3);
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      break;
    case 'wrong':
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      break;
    case 'pickup':
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
      oscillator.frequency.linearRampToValueAtTime(800, audioContext.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      break;
  }

  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.3);
}

function setGameAudioMuted(muted) {
  if (bgMusic) bgMusic.muted = muted;
  if (walkSound) walkSound.muted = muted;

  if (audioContext) {
    if (muted) {
      audioContext.suspend();
    } else {
      audioContext.resume();
    }
  }
}

// ==================== SHOOTING ====================
function onShoot(event) {
  if (!gameState.isRunning || gameState.isPaused) return;

  // Fire the gun with animation
  fireGunAnimation();
  showMuzzleFlash();

  // Raycaster from center of screen
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Check all robots
  for (const robot of robots) {
    if (robot.dying) continue;

    const hit = robot.checkHit(raycaster);
    if (hit) {
      const isCorrect = hit.answer === robot.correctAnswer;

      // Get screen position for effects
      const screenPos = hit.point.clone().project(camera);
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (screenPos.y * -0.5 + 0.5) * window.innerHeight;

      // Create bullet trail
      const start = camera.position.clone();
      bullets.push(new BulletTrail(start, hit.point));

      if (isCorrect) {
        // Correct answer - destroy robot!
        robot.dying = true;

        const points = 100 * gameState.combo;
        gameState.score += points;
        gameState.kills++;
        gameState.combo = Math.min(gameState.combo + 1, 10);

        playSound('kill');
        showHitMarker(true);
        showDamageNumber({ x, y }, `+${points}`, true);
        createExplosion(hit.point, 0x00ff88, 40);

        document.getElementById('score').textContent = gameState.score;
        document.getElementById('combo').textContent = `x${gameState.combo}`;

        // Chance to drop health pickup (30%)
        if (Math.random() < 0.3) {
          pickups.push(new HealthPickup(robot.group.position.clone()));
        }

        // Check for wave advancement (every 5 kills)
        if (gameState.kills % 5 === 0) {
          gameState.wave++;
          document.getElementById('wave').textContent = gameState.wave;

          // Wave Completion Bonus
          const healAmount = 20;
          const oldHealth = gameState.health;
          gameState.health = Math.min(gameState.maxHealth, gameState.health + healAmount);
          if (gameState.health > oldHealth) {
            updateHealthBar();
            showDamageNumber({ x: window.innerWidth / 2, y: window.innerHeight / 2 - 50 }, `WAVE COMPLETE! +${healAmount} HP`, true);
          } else {
            showDamageNumber({ x: window.innerWidth / 2, y: window.innerHeight / 2 - 50 }, `WAVE COMPLETE!`, true);
          }

          // Play level up sound (simulated by high pitch pickup)
          playSound('pickup');

          // Play Encouragement Voice
          if (wellDone1 && wellDone2) {
            const sound = Math.random() > 0.5 ? wellDone1 : wellDone2;
            sound.currentTime = 0;
            sound.play().catch(() => { });
          }

          // Speed up spawns (cap at 0.6s)
          spawnInterval = Math.max(0.6, spawnInterval - 0.2);
          showWaveAnnouncement(gameState.wave);

          // Show interstitial ad every 3 waves (wave 4, 7, 10...)
          if (shouldShowWaveAd(gameState.wave)) {
            // Pause game and audio for wave transition ad
            gameState.isPaused = true;
            setGameAudioMuted(true);

            showWaveTransitionAd(gameState.wave, () => {
              gameState.isPaused = false;
              setGameAudioMuted(false);
            });
          }
        }

      } else {
        // Wrong answer
        gameState.combo = 1;

        playSound('wrong');
        showHitMarker(false);
        showDamageNumber({ x, y }, 'WRONG!', false);
        createExplosion(hit.point, 0xff3366, 15);

        document.getElementById('combo').textContent = 'x1';
      }

      return;
    }
  }
}

// ==================== GAME LOGIC ====================
let spawnTimer = 0;
let spawnInterval = 2;
let bgMusic = null; // Background Music variable
let walkSound = null; // Walking Sound variable
let wellDone1 = null;
let wellDone2 = null;

function startGame() {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.remove('show');
  document.getElementById('hud').classList.remove('hidden');

  // Show appropriate controls based on device
  if (isMobile) {
    document.getElementById('mobile-controls').classList.add('show');
    // document.getElementById('mobile-aim').classList.add('show'); // Removed
    document.getElementById('crosshair').classList.remove('hidden'); // Show crosshair on mobile too

    // Show hint briefly
    const hint = document.getElementById('mobile-hint');
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 4000);
  } else {
    document.getElementById('crosshair').classList.remove('hidden');
    // Request pointer lock for mouse look (desktop only)
    renderer.domElement.requestPointerLock();
  }

  // Reset camera rotation and position
  yaw = 0;
  pitch = 0;
  camera.rotation.set(0, 0, 0);
  camera.position.set(0, 2, 0); // Reset player position to center

  // Reset physics state
  playerY = 2;
  velocityY = 0;
  isGrounded = true;
  headBobTime = 0;
  currentBobOffset = 0;
  currentSideOffset = 0;

  // Reset game state
  gameState.score = 0;
  gameState.wave = 1;
  gameState.health = gameState.maxHealth;
  gameState.combo = 1;
  gameState.kills = 0;
  gameState.isRunning = true;

  // Clear existing robots and pickups
  for (const robot of robots) {
    scene.remove(robot.group);
  }
  for (const pickup of pickups) {
    scene.remove(pickup.mesh);
  }
  robots = [];
  pickups = [];
  particles = [];
  bullets = [];

  spawnTimer = 0;
  spawnInterval = 2;

  // Update HUD
  document.getElementById('score').textContent = '0';
  document.getElementById('wave').textContent = '1';
  document.getElementById('combo').textContent = 'x1';
  updateHealthBar();

  // Spawn first robot
  robots.push(new Robot());

  // Reset ad session limits for new game
  resetSessionLimits();
  extraLifeOfferShown = false;

  // Hide extra life button from previous game
  const extraLifeBtn = document.getElementById('extra-life-btn');
  if (extraLifeBtn) {
    extraLifeBtn.classList.add('hidden');
    extraLifeBtn.classList.remove('show');
  }

  // Also hide revive modal in case it's open
  document.getElementById('revive-modal').classList.remove('show');

  showWaveAnnouncement(1);

  // Start Background Music
  if (!bgMusic) {
    bgMusic = new Audio('/roombg.mp3');
    bgMusic.loop = true;
    bgMusic.volume = 0.4; // Slightly lower to not overpower SFX
  }
  bgMusic.play().catch(e => console.log("Audio play failed (interaction required):", e));

  // Initialize Walking Sound
  if (!walkSound) {
    walkSound = new Audio('/walk.mp3');
    walkSound.loop = true;
    walkSound.volume = 0.5;
  }

  // Initialize Well Done Sounds
  if (!wellDone1) wellDone1 = new Audio('/welldone1.mp3');
  if (!wellDone2) wellDone2 = new Audio('/welldone2.mp3');

  console.log('🎮 Game Started!' + (isMobile ? ' (Mobile Mode)' : ' (Desktop Mode)'));
}

function endGame() {
  if (!gameState.isRunning) return;
  gameState.isRunning = false;

  // Stop background music
  if (bgMusic) {
    bgMusic.pause();
  }
  if (walkSound) {
    walkSound.pause();
  }

  // Show revive modal instead of immediate game over
  // This gives player a chance to watch ads and continue
  showReviveModal();
}

function spawnRobot() {
  robots.push(new Robot());
}

// ==================== ANIMATION LOOP ====================
function animate() {
  requestAnimationFrame(animate);

  if (gameState.isPaused) return;

  const deltaTime = clock.getDelta();

  // Animate gun (always, even when not running for idle animation)
  if (gun) {
    // Gun recoil recovery
    if (gunRecoil > 0) {
      gunRecoil *= 0.85;
      if (gunRecoil < 0.001) gunRecoil = 0;
    }

    // Apply recoil to gun position
    gun.position.z = -0.5 + gunRecoil;
    gun.rotation.x = -gunRecoil * 0.5;

    // Subtle idle bobbing when game is running
    if (gameState.isRunning) {
      const time = Date.now() * 0.001;
      gun.position.y = -0.25 + Math.sin(time * 2) * 0.005;
      gun.position.x = 0.3 + Math.cos(time * 1.5) * 0.003;
    }
  }

  if (gameState.isRunning) {
    // Update player movement
    updatePlayerMovement(deltaTime);

    // Spawn timer
    spawnTimer += deltaTime;
    if (spawnTimer >= spawnInterval) {
      spawnRobot();
      spawnTimer = 0;
    }

    // Update robots
    for (const robot of robots) {
      robot.update(deltaTime);
    }
    robots = robots.filter(r => r.alive);

    // Update particles
    particles = particles.filter(p => p.update(deltaTime));

    // Update bullet trails
    bullets = bullets.filter(b => b.update(deltaTime));

    // Update pickups
    for (const pickup of pickups) {
      pickup.update(deltaTime);

      // Check collision with player
      const dist = camera.position.distanceTo(pickup.mesh.position);
      if (dist < 3) { // Collection radius
        // Heal player
        const oldHealth = gameState.health;
        gameState.health = Math.min(gameState.maxHealth, gameState.health + 20);

        if (gameState.health > oldHealth) {
          updateHealthBar();
          playSound('pickup');
          showDamageNumber({ x: window.innerWidth / 2, y: window.innerHeight / 2 + 50 }, '+20 HP', true);
        }

        pickup.remove();
        pickup.collected = true;
      }
    }
    pickups = pickups.filter(p => !p.collected);

    // Update question display
    updateQuestionDisplay();

    // Update threat indicator
    updateThreatIndicator();
  }

  renderer.render(scene, camera);
}

// ==================== WINDOW RESIZE ====================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== MOUSE CONTROLS ====================
function onCanvasClick(event) {
  if (!gameState.isRunning || gameState.isPaused) return;

  // If not locked, try to lock
  if (!isPointerLocked) {
    renderer.domElement.requestPointerLock();
    return;
  }

  // Otherwise shoot
  onShoot(event);
}

function onPointerLockChange() {
  isPointerLocked = document.pointerLockElement === renderer.domElement;

  if (!isPointerLocked && gameState.isRunning) {
    // Show a message to click to continue
    console.log('Click to re-lock mouse');
  }
}

function onMouseMove(event) {
  if (!isPointerLocked || !gameState.isRunning || gameState.isPaused) return;

  // Get mouse movement
  const movementX = event.movementX || 0;
  const movementY = event.movementY || 0;

  // Update yaw and pitch
  yaw -= movementX * mouseSensitivity;
  pitch -= movementY * mouseSensitivity;

  // Clamp pitch to prevent flipping
  pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));

  // Apply rotation to camera
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

// ==================== KEYBOARD CONTROLS ====================
function onKeyDown(event) {
  // Prevent spacebar and arrows from scrolling/triggering buttons
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
    event.preventDefault();
  }

  if (!gameState.isRunning || gameState.isPaused) return;

  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.backward = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.right = true;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.sprint = true;
      break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.forward = false;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.backward = false;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.left = false;
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.right = false;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.sprint = false;
      break;
  }
}

// ==================== PLAYER MOVEMENT WITH PHYSICS ====================
function updatePlayerMovement(deltaTime) {
  // Calculate movement direction based on camera orientation
  const moveX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + joystickX;
  const moveZ = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0) - joystickY;

  // Check if player is actually moving
  isMoving = (moveX !== 0 || moveZ !== 0) && isGrounded;

  // Apply gravity
  velocityY += gravity * deltaTime;
  playerY += velocityY * deltaTime;

  // Ground check
  const groundLevel = 2;
  if (playerY <= groundLevel) {
    playerY = groundLevel;
    velocityY = 0;
    isGrounded = true;
  }

  // Calculate speed (with sprint)
  let currentSpeed = moveSpeed;
  if (keys.sprint) {
    currentSpeed *= sprintMultiplier;
  }

  // Head bobbing while moving on ground
  if (isMoving) {
    // Increase bob speed when sprinting
    const bobSpeedMultiplier = keys.sprint ? 1.4 : 1.0;
    headBobTime += deltaTime * headBobSpeed * bobSpeedMultiplier;

    // Vertical bob (up and down like walking)
    const targetBobOffset = Math.sin(headBobTime) * headBobAmount;
    currentBobOffset += (targetBobOffset - currentBobOffset) * 0.3;

    // Side-to-side sway (natural walking motion)
    const targetSideOffset = Math.cos(headBobTime * 0.5) * headBobSideAmount;
    currentSideOffset += (targetSideOffset - currentSideOffset) * 0.3;

    // Play walk sound
    if (walkSound && walkSound.paused) {
      walkSound.play().catch(() => { });
    }
  } else {
    // Smoothly return to neutral when stopped
    currentBobOffset *= 0.9;
    currentSideOffset *= 0.9;
    if (Math.abs(currentBobOffset) < 0.001) currentBobOffset = 0;
    if (Math.abs(currentSideOffset) < 0.001) currentSideOffset = 0;

    // Pause walk sound
    if (walkSound && !walkSound.paused) {
      walkSound.pause();
      walkSound.currentTime = 0; // Reset slightly for punchier step start
    }
  }

  // Apply horizontal movement
  if (moveX !== 0 || moveZ !== 0) {
    // Get forward and right vectors from camera
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
    right.normalize();

    // Calculate movement vector
    const movement = new THREE.Vector3();
    movement.addScaledVector(forward, moveZ);
    movement.addScaledVector(right, moveX);
    movement.normalize();
    movement.multiplyScalar(currentSpeed * deltaTime);

    // Apply movement to camera (horizontal only)
    camera.position.x += movement.x;
    camera.position.z += movement.z;
  }

  // Keep player within bounds (arena limits)
  const boundaryLimit = 35;
  camera.position.x = Math.max(-boundaryLimit, Math.min(boundaryLimit, camera.position.x));
  camera.position.z = Math.max(-boundaryLimit, Math.min(boundaryLimit, camera.position.z));

  // Apply vertical position (jump + head bob)
  camera.position.y = playerY + currentBobOffset;

  // Apply side sway to the gun for extra realism
  if (gun) {
    gun.position.x = 0.3 + currentSideOffset;
    gun.position.y = -0.25 + currentBobOffset * 0.5;
  }
}

// ==================== INITIALIZE ====================
init();

console.log('🤖 Math Blaster 3D loaded! Click START MISSION to begin.');
