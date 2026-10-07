import * as THREE from 'three';

// Analytic sphere-marker shading keeps the real point centers and depth colors.
// This is a display cue, not reconstructed scene normals or cast scene shadows.
export function createPointMaterial(size){
 const material=new THREE.PointsMaterial({size,sizeAttenuation:false,vertexColors:true,alphaToCoverage:true});
 const lighting={value:1};
 material.userData.lighting=lighting;
 material.onBeforeCompile=shader=>{
  shader.uniforms.uPointLighting=lighting;
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uPointLighting;');
  shader.fragmentShader=shader.fragmentShader.replace('outgoingLight = diffuseColor.rgb;',`
   // Reconstruct a front-facing hemisphere inside each rasterized point.
   vec2 marker = 2.0 * gl_PointCoord - 1.0;
   float radiusSquared = dot(marker, marker);
   if (radiusSquared >= 1.0) discard;
   vec3 markerNormal = vec3(marker.x, -marker.y, sqrt(1.0 - radiusSquared));
   vec3 keyLight = normalize(vec3(-0.55, 0.7, 1.0));
   vec3 halfLight = normalize(keyLight + vec3(0.0, 0.0, 1.0));
   float diffuseLight = max(dot(markerNormal, keyLight), 0.0);
   float edgeShade = mix(0.72, 1.0, markerNormal.z);
   float softLight = (0.42 + 0.76 * diffuseLight) * edgeShade;
   float highlight = 0.2 * pow(max(dot(markerNormal, halfLight), 0.0), 22.0);
   vec3 shadedColor = diffuseColor.rgb * softLight + vec3(highlight);
   outgoingLight = mix(diffuseColor.rgb, shadedColor, uPointLighting);
   // Coverage keeps circular edges smooth while retaining opaque depth tests.
   diffuseColor.a *= 1.0 - smoothstep(0.72, 1.0, radiusSquared);
  `);
 };
 material.customProgramCacheKey=()=> 'pi2-sphere-markers-v1';
 return material;
}
