import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// --- Configuration ---
const CONFIG = {
  particleCount: 200000, 
  starCount: 15000,
  baseColor: new THREE.Color(0x39ff14), // Neon Green
  accentColor: new THREE.Color(0x00ff00), // Pure Green
  particleSize: 0.006, 
  rotationSpeed: 0.1,
};

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 12;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

// --- Post-Processing ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.6, // Balanced bloom for clarity
  0.4, 
  0.8  
);
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Background ---
function createStarfield() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(CONFIG.starCount * 3);
  for (let i = 0; i < CONFIG.starCount; i++) {
    const r = 40 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.3 }));
}
scene.add(createStarfield());

// --- Dragon Implementation ---
let particles;
let loadingOverlay = document.createElement('div');
loadingOverlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:cyan;font-family:sans-serif;font-size:14px;letter-spacing:5px;';
loadingOverlay.innerText = 'RESTORED DRAGON PARTICLES...';
document.body.appendChild(loadingOverlay);

async function init() {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync('./demon_dragon.glb');
    
    const geometries = [];
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        const geo = child.geometry.clone();
        child.updateMatrixWorld();
        geo.applyMatrix4(child.matrixWorld);
        geometries.push(geo);
      }
    });
    
    let mergedGeo = BufferGeometryUtils.mergeGeometries(geometries);
    mergedGeo.center();
    mergedGeo.computeBoundingSphere();
    const radius = mergedGeo.boundingSphere.radius;
    const scaleFactor = 8.0 / radius; 
    mergedGeo.scale(scaleFactor, scaleFactor, scaleFactor);
    
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(mergedGeo)).build();
    const positions = new Float32Array(CONFIG.particleCount * 3);
    const colors = new Float32Array(CONFIG.particleCount * 3);
    const sizes = new Float32Array(CONFIG.particleCount);
    const randomness = new Float32Array(CONFIG.particleCount);
    
    const tempPos = new THREE.Vector3();
    for (let i = 0; i < CONFIG.particleCount; i++) {
      sampler.sample(tempPos);
      positions[i * 3] = tempPos.x;
      positions[i * 3 + 1] = tempPos.y;
      positions[i * 3 + 2] = tempPos.z;
      
      const mixed = CONFIG.baseColor.clone().lerp(CONFIG.accentColor, Math.random() * 0.5);
      colors[i * 3] = mixed.r;
      colors[i * 3 + 1] = mixed.g;
      colors[i * 3 + 2] = mixed.b;
      
      sizes[i] = Math.random() * 0.7 + 0.3;
      randomness[i] = Math.random();
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('randomness', new THREE.BufferAttribute(randomness, 1));
    
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: CONFIG.particleSize }, uPixelRatio: { value: renderer.getPixelRatio() } },
      vertexShader: `
        uniform float uTime, uSize, uPixelRatio;
        attribute float size, randomness;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vec3 p = position;
          // Micro-vibration
          p.x += sin(uTime * 2.0 + randomness * 100.0) * 0.01;
          p.y += cos(uTime * 2.0 + randomness * 100.0) * 0.01;
          
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * size * uPixelRatio * (800.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
          vAlpha = smoothstep(-20.0, 0.0, mvPos.z);
        }
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = distance(gl_PointCoord, vec2(0.5));
          if (d > 0.5) discard;
          float strength = pow(1.0 - (d * 2.0), 2.5);
          gl_FragColor = vec4(vColor, strength * vAlpha * 0.7);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true
    });
    
    particles = new THREE.Points(geometry, material);
    scene.add(particles);
    loadingOverlay.remove();
    
  } catch (err) {
    console.error('Dragon Load Error:', err);
    loadingOverlay.innerText = 'LOAD ERROR';
  }
}

const clock = new THREE.Clock();
function animate() {
  const et = clock.getElapsedTime();
  if (particles) {
    particles.material.uniforms.uTime.value = et;
    particles.rotation.y = et * CONFIG.rotationSpeed;
  }
  composer.render();
  requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();
