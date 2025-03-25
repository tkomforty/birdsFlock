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

const NUM_FLOCKS = 4;
const BIRDS_PER_FLOCK = 4;
// Fixed model URLs - changed from GitHub repository links to direct raw content URLs
const MODELS = [
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Stork.glb",
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Stork.glb",
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Stork.glb",
];

// Flocking parameters
const SEPARATION_DISTANCE = 5;
const COHESION_DISTANCE = 10;
const ALIGNMENT_DISTANCE = 25;
const SEPARATION_FORCE = 0.5;
const COHESION_FORCE = 0.01;
const ALIGNMENT_FORCE = 0.1;
const MAX_SPEED = 0.2;
const WORLD_SIZE = 50;
const TURN_FACTOR = 0.1;

// Direction the model faces in its original state
// 1 means model faces +Z, -1 means model faces -Z
const MODEL_DIRECTION = -1;

class Bird {
  constructor(model, flock) {
    this.model = model;
    this.flock = flock;

    // Start with a random velocity - Fixed ThreeMath to MathUtils
    this.velocity = new Vector3(
      MathUtils.randFloatSpread(0.2),
      MathUtils.randFloatSpread(0.2),
      MathUtils.randFloatSpread(0.2)
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
  createRenderer(); // This must come before createControls to have a valid renderer.domElement
  createControls(); // Moved after createRenderer

  renderer.setAnimationLoop(() => {
    update();
    render();
    
    
  });
  
  
  
}

function createCamera() {
  const fov = 60;
  const aspect = container.clientWidth / container.clientHeight;
  const near = 0.1;
  const far = 1000;
  camera = new PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0,50,100);
}

// Add gradient background function
function createGradientBackground() {
  // Instead of trying to create a complex shader-based background,
  // let's use a simpler approach with a gradient texture

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


// Try this revised version of createClouds which ensures proper nesting of all functions and brackets
function createClouds() {
  // Create a large dome for the clouds
  const cloudGeometry = new PlaneGeometry(500, 500, 1, 1);

  // Update the cloud shader with better visibility against dark background
  const cloudShader = {
    uniforms: {
      time: { value: 0.0 },
      skyColor: { value: new Color(0x1a237e) }, // Match our background color
      cloudColor: { value: new Color(0xffffff) }, // White clouds instead of black
      cloudOpacity: { value: 0.5 }, // Increased opacity
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
      
      // Perlin noise functions
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
      
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                            0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                            -0.577350269189626,  // -1.0 + 2.0 * C.x
                            0.024390243902439); // 1.0 / 41.0
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
              + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      
      float fbm(vec2 p) {
        float f = 0.0;
        float w = 0.75;
        for (int i = 0; i < 5; i++) {
          f += w * snoise(p);
          p *= 2.0;
          w *= 0.5;
        }
        return f;
      }
      
      void main() {
        // Adjust UVs for better cloud coverage
        vec2 uv = vUv * 2.0 - 1.0;
        
        // Create base clouds with multiple noise layers
        float speed = time * 0.41; // Slower cloud movement
        float scale = 1.5;  // Adjusted scale for larger cloud formations
        
        // Generate multiple layers of cloud noise with more contrast
        float n1 = fbm(vec2(uv.x * scale + speed * 0.5, uv.y * scale));
        float n2 = fbm(vec2(uv.x * scale * 2.0 - speed * 0.2, uv.y * scale * 2.0));
        float n3 = fbm(vec2(uv.x * scale * 0.5 + speed * 0.1, uv.y * scale * 0.5));
        float n4 = fbm(vec2(uv.x * scale * 0.7 - speed * 0.15, uv.y * scale * 0.7));
        
        // Combine noise layers with higher weights for more definition
        float clouds = n1 * 0.4 + n2 * 0.3 + n3 * 0.2 + n4 * 0.1;
        
        // Enhanced cloud density with more pronounced features
        // Lower threshold makes more of the noise visible as clouds
        clouds = smoothstep(0.0, 0.85, clouds); 
        
        // Make clouds more visible with stronger vertical gradient
        float verticalGradient = smoothstep(0.0, 0.8, (vUv.y * 1.2)); 
        clouds *= verticalGradient;
        
        // Add some cloud detail variation
        float detail = fbm(vec2(uv.x * 15.0 + time * 0.03, uv.y * 5.0));
        clouds = mix(clouds, clouds * detail, 0.51);
        
        // Enhance cloud edges for more definition
        float cloudEdge = smoothstep(0.3, 0.7, clouds);
        clouds = mix(clouds, cloudEdge, 0.5);
        
        // Create more volumetric looking clouds by adding "depth"
        float depth = fbm(vec2(uv.x * 3.0 - time * 0.02, uv.y * 3.0));
        float volumetricEffect = mix(clouds, clouds * depth, 0.13);
        
        // Mix cloud color with sky color, making clouds brighter and more visible
        // We're using cloudColor (white) instead of black for better visibility
        vec3 finalColor = mix(skyColor, cloudColor, volumetricEffect * cloudOpacity);
        
        // Add some purple tint to cloud edges for atmospheric effect
        vec3 edgeColor = vec3(0.7, 0.6, 0.9); // Light purple
        finalColor = mix(finalColor, edgeColor, volumetricEffect * 0.53);
        
        gl_FragColor = vec4(finalColor, volumetricEffect * cloudOpacity);
      }
    `
  };

  // Create cloud material with enhanced settings
  cloudMaterial = new ShaderMaterial({
    uniforms: cloudShader.uniforms,
    vertexShader: cloudShader.vertexShader,
    fragmentShader: cloudShader.fragmentShader,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: 1, // NormalBlending for better visibility
  });

  // Create multiple cloud layers for a more volumetric effect
  // Main background cloud layer
  cloudMesh = new Mesh(cloudGeometry, cloudMaterial);
  cloudMesh.position.z = -500;
  cloudMesh.rotation.z = 0;
  cloudMesh.rotation.y = 180;
  cloudMesh.rotation.z = 90;

  scene.add(cloudMesh);

  // Additional cloud layers at different depths for volumetric effect
  const cloudMesh2 = new Mesh(cloudGeometry, cloudMaterial.clone());
  cloudMesh2.position.z = -500;
  cloudMesh2.position.x = 190;
  cloudMesh2.rotation.y = 180;
  cloudMesh.rotation.x = 0;
  cloudMesh.rotation.z = 90;

  cloudMesh2.scale.set(2.8, 2.8, 2);
  scene.add(cloudMesh2);

  const cloudMesh3 = new Mesh(cloudGeometry, cloudMaterial.clone());
  cloudMesh3.position.z = -100;

  cloudMesh3.position.x = 30;
  cloudMesh3.position.y = 10;
  cloudMesh3.rotation.z = 90;
  cloudMesh2.rotation.y = 180;
  cloudMesh.rotation.z = 90;

  cloudMesh3.scale.set(2.6, 2.6, 2);
  scene.add(cloudMesh3);

  // Add closer cloud layer for better foreground presence
  const cloudMesh4 = new Mesh(cloudGeometry, cloudMaterial.clone());
  cloudMesh4.position.z = 250;
  cloudMesh4.position.x = 10;
  cloudMesh4.position.y = 5;
  cloudMesh4.rotation.y = 180;
  cloudMesh.rotation.z = 90;
  cloudMesh.rotation.x = 90;
  cloudMesh4.scale.set(0.4, 0.4, 1);
  scene.add(cloudMesh4);

  // Create a "volumetric" fog plane closer to the camera
  const fogGeometry = new PlaneGeometry(500, 500, 1, 1);
  const fogMaterial = new ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      fogColor: { value: new Color(0x1a237e) } // Match our background color
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
      uniform vec3 fogColor;
      varying vec2 vUv;
      
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
      
      float snoise(vec2 v) {
        // Simplex noise implementation (same as in cloud shader)
        const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      
      float fbm(vec2 p) {
        float f = 0.0;
        float w = 0.5;
        for (int i = 0; i < 4; i++) {
          float n = snoise(p);
          f += w * n;
          p *= 2.0;
          w *= 0.5;
        }
        return f;
      }
      
      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        float t = time * 0.01;
        
        // Create swirling, volumetric-looking fog
        float noise1 = fbm(vec2(uv.x * 3.0 + t, uv.y * 3.0));
        float noise2 = fbm(vec2(uv.x * 1.5 - t * 0.5, uv.y * 1.5));
        
        // Blend noises for depth effect
        float fogDensity = mix(noise1, noise2, 0.5);
        
        // Create depth effect by having fog thinner in the center
        float radialGradient = length(uv) * 0.5;
        fogDensity = mix(fogDensity, fogDensity * radialGradient, 0.3);
        
        // Adjust opacity for a subtle fog effect
        float opacity = smoothstep(0.1, 0.6, fogDensity) * 0.3;
        
        gl_FragColor = vec4(fogColor, opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: 2 // AdditiveBlending for volumetric effect
  });

  const fogMesh = new Mesh(fogGeometry, fogMaterial);
  fogMesh.position.z = -1;
  scene.add(fogMesh);

  // Add this to the mix of materials to update
  mixers.push({
    update: (delta) => {
      fogMaterial.uniforms.time.value += delta;
    }
  });
} // End of createClouds function - THIS IS THE CLOSING BRACE

function createFlocks() {
  // Create multiple flocks in different areas
  for (let i = 0; i < NUM_FLOCKS; i++) {
    const flockCenter = new Vector3(
      MathUtils.randFloatSpread(WORLD_SIZE),
      MathUtils.randFloatSpread(WORLD_SIZE / 2),
      MathUtils.randFloatSpread(WORLD_SIZE)
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
  renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
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
