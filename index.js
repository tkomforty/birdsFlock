import {
  Scene,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  DirectionalLight,
  HemisphereLight,
  Clock,
  AnimationMixer,
  Group,
  Quaternion,
  Euler,
  Fog,
  PlaneGeometry,
  ShaderMaterial,
  Mesh,
  BackSide,
  CanvasTexture,
} from "three";
import { MathUtils, Vector3, Matrix4 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let container;
let camera;
let renderer;
let scene;
let controls;

const mixers = [];
const clock = new Clock();

// Cloud shader time
let cloudTime = 0;

// Bird flocks
const flocks = [];

// Cloud rendering
let cloudMaterial;
let cloudMesh;

// Performance Optimization Constants
const NUM_FLOCKS = 5;        // Reduced from 25
const BIRDS_PER_FLOCK = 2;   // Reduced from 4

// Simplified flocking parameters to reduce calculations
const SEPARATION_DISTANCE = 3;  // Smaller distance
const COHESION_DISTANCE = 7;    // Reduced distance
const ALIGNMENT_DISTANCE = 15;  // Reduced distance
const SEPARATION_FORCE = 0.3;   // Reduced force
const COHESION_FORCE = 0.005;   // Reduced force
const ALIGNMENT_FORCE = 0.05;   // Reduced force
const MAX_SPEED = 0.5;          // Slower max speed
const WORLD_SIZE = 30;          // Smaller world size
const TURN_FACTOR = 0.05;       // Reduced turn sensitivity

// Direction the model faces in its original state
// 1 means model faces +Z, -1 means model faces -Z
const MODEL_DIRECTION = -1;

// Fixed model URLs - changed from GitHub repository links to direct raw content URLs
const MODELS = [
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Stork.glb",
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Stork.glb",
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Stork.glb",
];

class Bird {
  constructor(model, flock) {
    this.model = model;
    this.flock = flock;

    // Simplified initial velocity
    this.velocity = new Vector3(
      MathUtils.randFloatSpread(0.1),
      MathUtils.randFloatSpread(0.1),
      MathUtils.randFloatSpread(0.1)
    );

    this.acceleration = new Vector3(0, 0, 0);

    // Initialize by pointing the bird in the direction it will move
    this.updateOrientation();
  }

  update() {
    // Apply flocking behaviors
    this.applyFlockingBehavior(this.flock.birds);

    // Update velocity
    this.velocity.add(this.acceleration);

    // Limit speed
    if (this.velocity.length() > MAX_SPEED) {
      this.velocity.normalize().multiplyScalar(MAX_SPEED);
    }

    // Update position
    this.model.position.add(this.velocity);

    // Reset acceleration
    this.acceleration.set(0, 0, 0);

    // Update orientation to match velocity direction
    this.updateOrientation();

    // Boundary behavior: bounce at world edges
    this.checkBoundaries();
  }

  updateOrientation() {
    if (this.velocity.length() > 0.01) {
      // We're using direct quaternion manipulation for the most precise control

      // Get direction of travel
      const direction = this.velocity.clone().normalize();

      // If MODEL_DIRECTION is -1, we need to invert the direction
      // This is the key fix for backward flying birds
      if (MODEL_DIRECTION === -1) {
        direction.negate();
      }

      // Create a target position in the direction of travel
      const targetPosition = new Vector3().addVectors(
        this.model.position,
        direction
      );

      // Store original position and rotation
      const originalPosition = this.model.position.clone();
      const originalRotation = this.model.rotation.clone();

      // Reset rotation before applying new orientation
      this.model.rotation.set(0, 0, 0);

      // Make the model look at the target position
      this.model.lookAt(targetPosition);

      // Add any additional fixed rotation needed for the specific model
      // Different models may need different corrections
      this.model.rotateY(Math.PI); // Most common correction
    }
  }

  applyForce(force) {
    this.acceleration.add(force);
  }

  applyFlockingBehavior(birds) {
    const separation = this.separate(birds);
    const alignment = this.align(birds);
    const cohesion = this.cohesion(birds);

    // Apply weights to the forces
    separation.multiplyScalar(SEPARATION_FORCE);
    alignment.multiplyScalar(ALIGNMENT_FORCE);
    cohesion.multiplyScalar(COHESION_FORCE);

    // Add the forces to acceleration
    this.applyForce(separation);
    this.applyForce(alignment);
    this.applyForce(cohesion);
  }

  separate(birds) {
    const steeringForce = new Vector3();
    let count = 0;

    for (const other of birds) {
      if (other !== this) {
        const distance = this.model.position.distanceTo(other.model.position);

        if (distance > 0 && distance < SEPARATION_DISTANCE) {
          // Calculate vector pointing away from neighbor
          const diff = new Vector3().subVectors(
            this.model.position,
            other.model.position
          );
          diff.normalize();
          diff.divideScalar(distance); // Weight by distance
          steeringForce.add(diff);
          count++;
        }
      }
    }

    if (count > 0) {
      steeringForce.divideScalar(count);
    }

    return steeringForce;
  }

  align(birds) {
    const steeringForce = new Vector3();
    let count = 0;

    for (const other of birds) {
      if (other !== this) {
        const distance = this.model.position.distanceTo(other.model.position);

        if (distance > 0 && distance < ALIGNMENT_DISTANCE) {
          steeringForce.add(other.velocity);
          count++;
        }
      }
    }

    if (count > 0) {
      steeringForce.divideScalar(count);
      steeringForce.normalize();
      steeringForce.multiplyScalar(MAX_SPEED);
      steeringForce.sub(this.velocity);
    }

    return steeringForce;
  }
  
  cohesion(birds) {
    const steeringForce = new Vector3();
    let count = 0;

    for (const other of birds) {
      if (other !== this) {
        const distance = this.model.position.distanceTo(other.model.position);

        if (distance > 0 && distance < COHESION_DISTANCE) {
          steeringForce.add(other.model.position);
          count++;
        }
      }
    }

    if (count > 0) {
      steeringForce.divideScalar(count);
      // Seek
      return this.seek(steeringForce);
    }

    return steeringForce;
  }

  seek(target) {
    const desired = new Vector3().subVectors(target, this.model.position);
    desired.normalize();
    desired.multiplyScalar(MAX_SPEED);

    const steer = new Vector3().subVectors(desired, this.velocity);
    return steer;
  }

  checkBoundaries() {
    const position = this.model.position;
    const velocity = this.velocity;
    const turnForce = new Vector3();

    // Check if approaching boundaries and steer back
    if (position.x > WORLD_SIZE) {
      turnForce.x = -TURN_FACTOR;
    } else if (position.x < -WORLD_SIZE) {
      turnForce.x = TURN_FACTOR;
    }

    if (position.y > WORLD_SIZE) {
      turnForce.y = -TURN_FACTOR;
    } else if (position.y < -WORLD_SIZE) {
      turnForce.y = TURN_FACTOR;
    }

    if (position.z > WORLD_SIZE) {
      turnForce.z = -TURN_FACTOR;
    } else if (position.z < -WORLD_SIZE) {
      turnForce.z = TURN_FACTOR;
    }

    this.applyForce(turnForce);
  }
}

class Flock {
  constructor(id, modelPath, initialPosition) {
    this.id = id;
    this.modelPath = modelPath;
    this.initialPosition = initialPosition;
    this.birds = [];
    this.group = new Group();
    scene.add(this.group);
  }

  addBird(bird) {
    this.birds.push(bird);
  }

  update() {
    for (const bird of this.birds) {
      bird.update();
    }
  }
}

function init() {
  container = document.querySelector("#scene-container");

  // Creating the scene
  scene = new Scene();

  // Add denser fog with purple tint to match the gradient
  scene.fog = new Fog(0x1a237e, 10, 10000);

  createCamera();
  createLights();
  createClouds();
  createFlocks();
  createRenderer(); 
  createControls(); 

  renderer.setAnimationLoop(() => {
    update();
    render();
  });
}

function createCamera() {
  const fov = 60;
  const aspect = container.clientWidth / container.clientHeight;
  const near = 0.1;
  const far = 10000;
  camera = new PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0,50,120);
}

// Add gradient background function
function createGradientBackground() {
  // Create a canvas for the gradient
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;

  const context = canvas.getContext("2d");

  // Create a gradient from top to bottom
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#0c0a2a"); // Deep purple at top
  gradient.addColorStop(1, "#1a237e"); // Deep blue at bottom

  // Fill the canvas with the gradient
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Set the scene background color to the gradient
  const texture = new CanvasTexture(canvas);
  scene.background = texture;
}

function createLights() {
  // Main light with reduced intensity
  const mainLight = new DirectionalLight(0xffffff, 0.3);
  mainLight.position.set(10, 10, 10);

  // More dramatic hemisphere lighting with stronger purple/blue tints
  const hemisphereLight = new HemisphereLight(0xaaccff, 0x4a148c, 0.2);

  // Add a subtle backlight to highlight bird silhouettes
  const backLight = new DirectionalLight(0xd0e0ff, 0.6);
  backLight.position.set(-5, 3, -10);

  // Add a subtle fill light from below for more dramatic effect
  const fillLight = new DirectionalLight(0x7e57c2, 0.2); // Purple tint
  fillLight.position.set(0, -5, 5);

  scene.add(mainLight, hemisphereLight, backLight, fillLight);
}

function createClouds() {
  // Create a large dome for the clouds
  const cloudGeometry = new PlaneGeometry(300, 300, 1, 1);

  // Simplified cloud shader with less complex noise
  const simplifiedCloudShader = {
    uniforms: {
      time: { value: 0.0 },
      skyColor: { value: new Color(0x1a237e) },
      cloudColor: { value: new Color(0xffffff) },
      cloudOpacity: { value: 0.4 }, // Reduced opacity
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 skyColor;
      uniform vec3 cloudColor;
      uniform float cloudOpacity;
      varying vec2 vUv;
      
      // Simplified noise function
      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }
      
      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        
        // Simplified cloud generation
        float n1 = noise(uv + time * 0.1);
        float n2 = noise(uv * 2.0 - time * 0.05);
        
        float clouds = smoothstep(0.5, 0.7, (n1 + n2) * 0.5);
        
        // Vertical gradient for cloud density
        float verticalGradient = smoothstep(0.0, 0.8, (vUv.y * 1.2)); 
        clouds *= verticalGradient;
        
        // Mix cloud color with sky color
        vec3 finalColor = mix(skyColor, cloudColor, clouds * cloudOpacity);
        
        gl_FragColor = vec4(finalColor, clouds * cloudOpacity);
      }
    `
  };

  // Reduce number of cloud layers
  cloudMaterial = new ShaderMaterial({
    uniforms: simplifiedCloudShader.uniforms,
    vertexShader: simplifiedCloudShader.vertexShader,
    fragmentShader: simplifiedCloudShader.fragmentShader,
    side: BackSide,
    transparent: true,
    depthWrite: false,
  });

  // Only one cloud layer instead of multiple
  cloudMesh = new Mesh(cloudGeometry, cloudMaterial);
  cloudMesh.position.z = -100;
  cloudMesh.rotation.z = 90;
  cloudMesh.rotation.y = 180;
  scene.add(cloudMesh);
}

function createFlocks() {
  // Create multiple flocks in different areas
  for (let i = 0; i < NUM_FLOCKS; i++) {
    const flockCenter = new Vector3(
      MathUtils.randFloatSpread(WORLD_SIZE * 1.5), // Wider spread on x-axis
      MathUtils.randFloatSpread(WORLD_SIZE * 0.8), // Less height variation
      MathUtils.randFloatSpread(WORLD_SIZE * 2)    // Deeper z-spread for depth
    );

    const modelPath = MODELS[i % MODELS.length];
    const flock = new Flock(i, modelPath, flockCenter);
    flocks.push(flock);

    // Load birds for this flock
    loadBirdsForFlock(flock);
  }
}

function loadBirdsForFlock(flock) {
  const loader = new GLTFLoader();

  const onLoad = (result, position) => {
    const model = result.scene.children[0];
    model.position.copy(position);
    model.scale.set(0.05, 0.05, 0.05);

    // Apply a default rotation to the model to help with correct orientation
    // This won't affect the later dynamic orientation
    model.rotation.y = Math.PI;

    const mixer = new AnimationMixer(model);
    mixers.push(mixer);

    const animation = result.animations[0];
    const action = mixer.clipAction(animation);
    action.play();

    flock.group.add(model);

    // Create a bird with flocking behavior
    const bird = new Bird(model, flock);
    flock.addBird(bird);
  };

  const onProgress = (progress) => {};

  // Create birds with slight variations in starting positions
  for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
    const position = new Vector3()
      .copy(flock.initialPosition)
      .add(
        new Vector3(
          MathUtils.randFloatSpread(5),
          MathUtils.randFloatSpread(5),
          MathUtils.randFloatSpread(5)
        )
      );

    loader.load(
      flock.modelPath,
      (gltf) => onLoad(gltf, position),
      onProgress,
      (error) => console.error('Error loading GLTF model:', error)
    );
  }
}

function createRenderer() {
  renderer = new WebGLRenderer({ 
    antialias: false,  // Disable antialiasing for performance
    powerPreference: "low-power"  // Hint for mobile devices
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // Cap pixel ratio
  renderer.gammaFactor = 2.2;
  renderer.outputColorSpace = 'srgb';

  container.appendChild(renderer.domElement);

  // Create gradient background after renderer is initialized
  createGradientBackground();
}

function createControls() {
  // Fixed the missing "new" keyword and assignment to global controls variable
  controls = new OrbitControls(camera, renderer.domElement);
  
  // Optional: configure controls
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = false;
  controls.minDistance = 20;
  controls.maxDistance = 100;
  controls.maxPolarAngle = Math.PI / 2;
}

function update() {
  const delta = clock.getDelta();

  // Update controls if damping is enabled
  if (controls && controls.enableDamping) {
    controls.update();
  }

  // Update animation mixers and custom animator functions
  mixers.forEach((mixer) => {
    if (typeof mixer.update === "function") {
      mixer.update(delta);
    }
  });

  // Update bird flocks
  flocks.forEach((flock) => flock.update());

  // Update cloud shader time
  cloudTime += delta;
  if (cloudMaterial) {
    cloudMaterial.uniforms.time.value = cloudTime;
  }
}

function render() {
  renderer.render(scene, camera);
}

init();

function onWindowResize() {
  camera.aspect = container.clientWidth / container.clientHeight;

  // Update camera frustum
  camera.updateProjectionMatrix();

  renderer.setSize(container.clientWidth, container.clientHeight);
}
window.addEventListener("resize", onWindowResize, false);

// Optional: Performance monitoring function
function monitorPerformance() {
  // Requires including Stats.js library
  const stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);
  
  function animate() {
    stats.begin();
    update();
    render();
    stats.end();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
