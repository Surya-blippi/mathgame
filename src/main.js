import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import './style.css';

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

// ==================== GAME STATE ====================
const gameState = {
  score: 0,
  wave: 1,
  health: 150,
  maxHealth: 150,
  combo: 1,
  kills: 0,
  isRunning: false,
  isPaused: false
};

// ==================== THREE.JS SETUP ====================
let scene, camera, renderer;
let robots = [];
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

// Audio
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
  debugLog('Scene created');

  // Create camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 0);

  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    debugLog('Mobile mode ACTIVE');
  } else {
    // Desktop mouse events
    renderer.domElement.addEventListener('click', onCanvasClick);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
  }

  // Create gun
  createGun();

  // Create UI (includes mobile controls)
  createUI();

  // Load gun sound (async, will use fallback if not available)
  loadGunSound();

  // Start render loop (even before game starts, for background)
  animate();
}

// ==================== ENVIRONMENT ====================
function createEnvironment() {
  debugLog('Creating environment...');
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
  debugLog('Procedural Env Start');
  try {
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

  // ==================== ROBOT CLASS ====================
  class Robot {
    constructor(type = null) {
      this.group = new THREE.Group();

      // Robot type (variety)
      const types = ['normal', 'fast', 'heavy'];
      this.type = type || types[Math.floor(Math.random() * types.length)];

      // Stats based on type
      switch (this.type) {
        case 'fast':
          this.baseSpeed = 4;
          this.damage = 10;
          this.scale = 0.85;
          this.color = 0xff4444; // Red tint
          break;
        case 'heavy':
          this.baseSpeed = 1.5;
          this.damage = 25;
          this.scale = 1.3;
          this.color = 0x44ff44; // Green tint
          break;
        default: // normal
          this.baseSpeed = 2.5;
          this.damage = 12;
          this.scale = 1.0;
          this.color = 0x2a2a4a; // Default
      }

      // Position - spawn around player's CURRENT position
      const playerX = camera ? camera.position.x : 0;
      const playerZ = camera ? camera.position.z : 0;
      const angle = Math.random() * Math.PI * 2; // Full 360° around player
      const distance = 35 + Math.random() * 15; // Spawn distance
      this.group.position.set(
        playerX + Math.sin(angle) * distance,
        0,
        playerZ - Math.cos(angle) * distance
      );

      // Keep within arena bounds
      const boundaryLimit = 45;
      this.group.position.x = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.x));
      this.group.position.z = Math.max(-boundaryLimit, Math.min(boundaryLimit, this.group.position.z));

      this.speed = this.baseSpeed + gameState.wave * 0.2;
      this.alive = true;
      this.dying = false;
      this.dyingTimer = 0;
      this.walkTime = Math.random() * Math.PI * 2;
      this.attackCooldown = 0; // Prevent attack spam

      // Math question
      this.generateMathQuestion();

      // Build robot
      this.build();

      // Apply scale for different robot types
      this.group.scale.setScalar(this.scale);

      // Add to scene
      scene.add(this.group);
    }

    generateMathQuestion() {
      const operations = ['+', '-', '×'];
      const operation = operations[Math.floor(Math.random() * operations.length)];
      let a, b, answer;

      switch (operation) {
        case '+':
          a = Math.floor(Math.random() * 20) + 1;
          b = Math.floor(Math.random() * 20) + 1;
          answer = a + b;
          break;
        case '-':
          a = Math.floor(Math.random() * 30) + 10;
          b = Math.floor(Math.random() * a);
          answer = a - b;
          break;
        case '×':
          a = Math.floor(Math.random() * 12) + 1;
          b = Math.floor(Math.random() * 12) + 1;
          answer = a * b;
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

      this.question = `${a} ${operation} ${b} = ?`;
      this.correctAnswer = answer;

      // Shuffle answers for body parts
      const allAnswers = [answer, ...wrongAnswers];
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

      // HEAD hitbox (top section)
      const headHitbox = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        hitboxMaterial
      );
      headHitbox.position.y = 3.5;
      headHitbox.userData.part = 'head';
      this.head = headHitbox;
      this.group.add(headHitbox);

      // CHEST hitbox (middle section)
      const chestHitbox = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.2, 0.8),
        hitboxMaterial
      );
      chestHitbox.position.y = 2.3;
      chestHitbox.userData.part = 'chest';
      this.body = chestHitbox;
      this.group.add(chestHitbox);

      // KNEE/LEGS hitbox (lower section)
      const legHitbox = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.5, 0.6),
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
      canvas.width = 256;
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

      // Main number
      context.font = `900 ${fontSize}px Arial, sans-serif`; // Extra bold
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
        depthTest: false,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(material);

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
      this.headAnswerSprite.scale.set(1.4, 1.1, 1);
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
      this.chestAnswerSprite.scale.set(1.6, 1.2, 1);
      this.chestAnswerSprite.position.set(0, 2.5, 0.8);
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
      this.kneeAnswerSprite.scale.set(1.2, 0.9, 1);
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
          scene.remove(this.group);
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

      if (this.life <= 0) {
        scene.remove(this.mesh);
        return false;
      }
      return true;
    }
  }

  function createExplosion(position, color, count = 30) {
    for (let i = 0; i < count; i++) {
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
        scene.remove(this.line);
        return false;
      }
      return true;
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
      <h1 class="game-title">MATH BLASTER 3D</h1>
      <p class="subtitle">NEURAL LINK ESTABLISHED</p>
      <button class="start-btn" id="start-btn">INITIATE MISSION</button>
      <div class="instructions">
        <div class="instruction-item"><p><span>🤖</span> Robots Incoming</p></div>
        <div class="instruction-item"><p><span>🔢</span> Solve Equations</p></div>
        <div class="instruction-item"><p><span>🎯</span> Shoot Correct Part</p></div>
        <div class="instruction-item"><p><span>⚠️</span> Don't Miss</p></div>
      </div>
    </div>
  `;
    app.appendChild(startScreen);

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

    // Game Over Screen
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
      <button class="start-btn" id="restart-btn">REBOOT SYSTEM</button>
    </div>
  `;
    app.appendChild(gameoverScreen);

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

    // Mobile hint
    const mobileHint = document.createElement('div');
    mobileHint.id = 'mobile-hint';
    mobileHint.innerHTML = '<span>🕹️ Use LEFT stick to Move</span><span>👆 Drag RIGHT side to Look</span><span>💥 Tap RIGHT side to Shoot</span>';
    app.appendChild(mobileHint);

    // Event listeners
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');

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
      // Touch look controls (Right side of screen)
      lookArea.addEventListener('touchstart', onTouchStart, { passive: false });
      lookArea.addEventListener('touchmove', onTouchMove, { passive: false });
      lookArea.addEventListener('touchend', onTouchEnd, { passive: false });

      // Joystick controls (Left side of screen)
      joystickContainer.addEventListener('touchstart', onJoystickStart, { passive: false });
      joystickContainer.addEventListener('touchmove', onJoystickMove, { passive: false });
      joystickContainer.addEventListener('touchend', onJoystickEnd, { passive: false });
    }
  }

  // Debug logger
  function debugLog(msg) {
    let debug = document.getElementById('debug-log');
    if (!debug) {
      debug = document.createElement('div');
      debug.id = 'debug-log';
      debug.style.position = 'fixed';
      debug.style.top = '10px';
      debug.style.left = '10px';
      debug.style.color = '#0f0';
      debug.style.zIndex = '9999';
      debug.style.pointerEvents = 'none';
      debug.style.fontSize = '12px';
      debug.style.fontFamily = 'monospace';
      debug.style.background = 'rgba(0,0,0,0.5)';
      document.body.appendChild(debug);
    }
    debug.innerHTML += `<div>${msg}</div>`;
    // Keep last 10 lines
    const lines = debug.children;
    if (lines.length > 10) debug.removeChild(lines[0]);
    console.log(msg);
  }

  // ==================== MOBILE TOUCH HANDLERS ====================
  let lookTouchId = null;
  let touchStartTime = 0;
  // touchStartX/Y are already defined above
  let lastTapTime = 0;
  const TAP_THRESHOLD = 200; // ms to consider a tap vs hold/drag
  const TAP_MOVE_THRESHOLD = 10; // pixels movement allowed for a tap

  function onTouchStart(event) {
    event.preventDefault();
    if (!gameState.isRunning) {
      debugLog('Game not running');
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

        debugLog('Look/Fire touch started');
      }
    }
  }

  function onTouchMove(event) {
    event.preventDefault();
    if (!gameState.isRunning) return;

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
          debugLog('Tap detected - FIRE!');
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
    if (!gameState.isRunning) return;

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
        debugLog('Joystick started: ' + touch.identifier);

        // Initial move if they tapped off-center
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  function onJoystickMove(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!gameState.isRunning || !joystickActive) return;

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
  }

  // Jump button handlers
  function onJumpButtonPress(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!gameState.isRunning) return;

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

    // 2. Fallback to closest robot
    let closest = null;
    let minDist = Infinity;
    for (const robot of robots) {
      if (!robot.dying) {
        // Use distance from camera (player), NOT origin
        const dist = robot.group.position.distanceTo(camera.position);
        if (dist < minDist) {
          minDist = dist;
          closest = robot;
        }
      }
    }

    if (closest) {
      display.textContent = closest.question;
      display.style.color = 'var(--accent)'; // Default color
      display.style.textShadow = '0 0 20px var(--accent)';
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
    }

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  }

  // ==================== SHOOTING ====================
  function onShoot(event) {
    if (!gameState.isRunning) return;

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

          // Check for wave advancement (every 5 kills)
          if (gameState.kills % 5 === 0) {
            gameState.wave++;
            document.getElementById('wave').textContent = gameState.wave;
            // Speed up spawns
            spawnInterval = Math.max(0.8, spawnInterval - 0.2);
            showWaveAnnouncement(gameState.wave);
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

  function startGame() {
    debugLog('startGame called');
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

    // Clear existing robots
    for (const robot of robots) {
      scene.remove(robot.group);
    }
    robots = [];
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

    showWaveAnnouncement(1);

    console.log('🎮 Game Started!' + (isMobile ? ' (Mobile Mode)' : ' (Desktop Mode)'));
  }

  function endGame() {
    gameState.isRunning = false;

    document.getElementById('hud').classList.add('hidden');
    document.getElementById('crosshair').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('show');

    // Hide mobile controls
    if (isMobile) {
      document.getElementById('mobile-controls').classList.remove('show');
      document.getElementById('mobile-aim').classList.remove('show');
    }

    document.getElementById('final-score').textContent = gameState.score;
    document.getElementById('final-waves').textContent = gameState.wave;
    document.getElementById('final-kills').textContent = gameState.kills;
  }

  function spawnRobot() {
    robots.push(new Robot());
  }

  // ==================== ANIMATION LOOP ====================
  let hasLoggedAnimate = false;
  function animate() {
    requestAnimationFrame(animate);

    if (!hasLoggedAnimate) {
      debugLog('Animate loop started');
      hasLoggedAnimate = true;
    }

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

      // Update question display
      updateQuestionDisplay();
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
    if (!gameState.isRunning) return;

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
    if (!isPointerLocked || !gameState.isRunning) return;

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

    if (!gameState.isRunning) return;

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
    } else {
      // Smoothly return to neutral when stopped
      currentBobOffset *= 0.9;
      currentSideOffset *= 0.9;
      if (Math.abs(currentBobOffset) < 0.001) currentBobOffset = 0;
      if (Math.abs(currentSideOffset) < 0.001) currentSideOffset = 0;
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
