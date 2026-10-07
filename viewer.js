import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { buildDepthReference,depthFraction } from './depth-colors.mjs';
import { createPointMaterial } from './point-lighting.js';
const $=id=>document.getElementById(id);
const viewport=$('data-viewer'),canvas=$('point-canvas'),status=$('viewer-status');
const state={pose:'pred',split:50,overlay:true,colorMode:'fixed',depthReference:null,colorCache:null,scene:null,points:null,loadToken:0};
// The photo is a display plane, not a reconstruction of the scene depth.
const imageDistance=20;
const pointSize=4.5;
let renderer,imageScene,cloudScene,camera,controls,cloud,frustum,imagePlane,material,manifest;
let pendingRender=false,sceneEntrance=null;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const palette=['#6545ee','#129aff','#12cfd0','#56d976','#e7d95a','#f77a69'].map(x=>new THREE.Color(x));
function render(){
 if(!renderer||!state.scene)return;
 const w=viewport.clientWidth,h=viewport.clientHeight,split=Math.round(w*state.split/100);
 renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.clear();
 // Share the full viewport and camera; only the scissor varies across halves.
 renderer.setScissorTest(true);
 if(split>0){renderer.setScissor(0,0,split,h);renderer.render(imageScene,camera)}
 if(split<w){
  renderer.setScissor(split,0,w-split,h);
  if(state.overlay){renderer.render(imageScene,camera);renderer.clearDepth()}
  renderer.render(cloudScene,camera);
 }
 renderer.setScissorTest(false);
}
function requestRender(){if(!pendingRender){pendingRender=true;requestAnimationFrame(()=>{pendingRender=false;render()})}}
function depthColor(z,target){const colors=palette;const t=depthFraction(z,state.colorMode,state.depthReference)*(colors.length-1);const i=Math.min(Math.floor(t),colors.length-2);return target.copy(colors[i]).lerp(colors[i+1],t-i)}
function prepareColors(){
 const colors=new Float32Array(state.points.length),c=new THREE.Color();
 for(let j=0;j<state.depthReference.depths.length;j++){depthColor(state.depthReference.depths[j],c);colors[3*j]=c.r;colors[3*j+1]=c.g;colors[3*j+2]=c.b}
 state.colorCache=colors;

}
function updateSplit(value){
 state.split=Math.max(0,Math.min(100,value));viewport.style.setProperty('--split',state.split+'%');
 viewport.classList.toggle('image-hidden',state.split===0);viewport.classList.toggle('cloud-hidden',state.split===100);
 $('split-handle').setAttribute('aria-valuenow',String(Math.round(state.split)));
 $('split-handle').setAttribute('aria-valuetext',`${Math.round(state.split)} percent image, ${100-Math.round(state.split)} percent point cloud`);requestRender();
}
function statusMessage(message,error=false){status.hidden=false;status.textContent=message;status.classList.toggle('error',error)}
function calibratedProjection(){
 const s=state.scene,K=s.K,W=viewport.clientWidth,H=viewport.clientHeight,n=.1,f=2000;
 const scale=Math.max(W/s.width,H/s.height),fx=K[0][0]*scale,fy=K[1][1]*scale,skew=K[0][1]*scale,cx=K[0][2]*scale+(W-s.width*scale)/2,cy=K[1][2]*scale+(H-s.height*scale)/2;
 camera.near=n;camera.far=f;camera.aspect=W/H;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(H/(2*fy)));
 // CV (x,y,z) becomes Three (x,-y,-z). Intrinsics stay fixed during orbit.
 camera.projectionMatrix.set(2*fx/W,-2*skew/W,1-2*cx/W,0,0,2*fy/H,2*cy/H-1,0,0,0,-(f+n)/(f-n),-2*f*n/(f-n),0,0,-1,0);
 camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
function resize(){
 if(!renderer||!state.scene)return;
 renderer.setSize(viewport.clientWidth,viewport.clientHeight,false);
 // Fixed screen-space size, including narrow displays.
 material.size=pointSize;
 calibratedProjection();requestRender();
}
function resetView(){
 if(!state.scene)return;
 camera.position.set(0,0,0);camera.up.set(0,1,0);controls.target.set(0,0,-imageDistance);
 controls.update();camera.updateMatrixWorld(true);calibratedProjection();requestRender();
}
function makeImagePlane(image){
 if(imagePlane){imageScene.remove(imagePlane);imagePlane.geometry.dispose();imagePlane.material.map.dispose();imagePlane.material.dispose()}
 if(frustum){cloudScene.remove(frustum);frustum.geometry.dispose();frustum.material.dispose()}
 const s=state.scene,K=s.K;
 const corners=[[0,0],[s.width,0],[s.width,s.height],[0,s.height]].map(([u,v])=>{
  const y=(v-K[1][2])/K[1][1]*imageDistance;
  return [(u-K[0][2]-K[0][1]*y/imageDistance)/K[0][0]*imageDistance,-y,-imageDistance];
 });
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(corners.flat(),3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));geometry.setIndex([0,2,1,0,3,2]);
 const texture=new THREE.Texture(image);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
 imagePlane=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false}));imageScene.add(imagePlane);
 const lines=[];for(let i=0;i<4;i++)lines.push(0,0,0,...corners[i],...corners[i],...corners[(i+1)%4]);
 const frame=new THREE.BufferGeometry();frame.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
 frustum=new THREE.LineSegments(frame,new THREE.LineBasicMaterial({color:0x61788c,transparent:true,opacity:.32}));cloudScene.add(frustum);
}
function renderPointData(){
 const T=state.pose==='pred'?state.scene.T_pred:state.scene.T_gt;
 const pos=new Float32Array(state.points.length);
 for(let i=0;i<state.points.length;i+=3){const x=state.points[i],y=state.points[i+1],z=state.points[i+2];const px=T[0][0]*x+T[0][1]*y+T[0][2]*z+T[0][3],py=T[1][0]*x+T[1][1]*y+T[1][2]*z+T[1][3],pz=T[2][0]*x+T[2][1]*y+T[2][2]*z+T[2][3];pos[i]=px;pos[i+1]=-py;pos[i+2]=-pz;}
 if(cloud){cloudScene.remove(cloud);cloud.geometry.dispose()}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));geometry.setAttribute('color',new THREE.BufferAttribute(state.colorCache,3));geometry.computeBoundingSphere();geometry.computeBoundingBox();cloud=new THREE.Points(geometry,material);cloudScene.add(cloud);
 requestRender();
}
function enterScene(){
 sceneEntrance?.cancel();
 if(reducedMotion.matches)return;
 // Animate both halves together; the calibrated camera and point centers stay fixed.
 sceneEntrance=viewport.animate([{transform:'scale(.975)',opacity:.35},{transform:'scale(1)',opacity:1}],{duration:460,easing:'cubic-bezier(.2,.7,.2,1)'});
}
async function selectScene(index){
 const s=manifest.scenes[index];
 if(state.requestedId===s.id&&status.hidden)return;
 state.requestedId=s.id;
 const token=++state.loadToken;sceneEntrance?.cancel();
 const loadingTimer=setTimeout(()=>{if(token===state.loadToken)statusMessage('Loading…')},160);
 try{
  const [response,image]=await Promise.all([fetch(`assets/demo/${s.points}`),new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('The scene image could not be loaded.'));im.src=`assets/demo/${s.image}`})]);
  if(!response.ok)throw Error('The point cloud could not be loaded.');const buffer=await response.arrayBuffer();if(token!==state.loadToken)return;
  if(buffer.byteLength!==s.point_count*12)throw Error('Point-cloud file size does not match the scene.');
  state.scene=s;state.points=new Float32Array(buffer);viewport.style.setProperty('--image-ratio',s.width/s.height);
  state.depthReference=buildDepthReference(state.points,s);prepareColors();
  document.querySelectorAll('[data-scene]').forEach(b=>{const active=Number(b.dataset.scene)===index;b.setAttribute('aria-pressed',active);b.classList.toggle('active',active)});
  renderPointData();makeImagePlane(image);resize();resetView();status.hidden=true;render();enterScene();
 }catch(e){if(token===state.loadToken){state.requestedId=null;statusMessage(e.message,true)}}finally{clearTimeout(loadingTimer)}
}
function zoom(factor){
 if(!state.scene)return;
 const offset=camera.position.clone().sub(controls.target),distance=THREE.MathUtils.clamp(offset.length()/factor,controls.minDistance,controls.maxDistance);
 camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();requestRender();
}
function bindEvents(){
 viewport.addEventListener('pointerdown',()=>sceneEntrance?.cancel());
 reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)sceneEntrance?.cancel()});
 $('pose-select').addEventListener('change',e=>{state.pose=e.target.value;if(state.points)renderPointData()});
 $('zoom-in').addEventListener('click',()=>zoom(1.25));$('zoom-out').addEventListener('click',()=>zoom(.8));$('reset-view').addEventListener('click',resetView);
 const handle=$('split-handle');let splitting=false;
 const splitAt=e=>{const rect=viewport.getBoundingClientRect();updateSplit((e.clientX-rect.left)/rect.width*100)};
 handle.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();splitting=true;handle.setPointerCapture(e.pointerId);splitAt(e)});
 handle.addEventListener('pointermove',e=>{if(splitting)splitAt(e)});handle.addEventListener('pointerup',()=>splitting=false);handle.addEventListener('pointercancel',()=>splitting=false);
 handle.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();updateSplit(e.key==='Home'?0:e.key==='End'?100:state.split+(e.key==='ArrowRight'?2:-2))}});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();statusMessage('The 3D view was interrupted. Reload the page to restore it.',true)});
}
async function init(){
 try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xffffff,1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.autoClear=false;
  imageScene=new THREE.Scene();cloudScene=new THREE.Scene();camera=new THREE.PerspectiveCamera(55,1,.1,2000);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.rotateSpeed=.55;controls.minDistance=.5;controls.maxDistance=1000;controls.zoomToCursor=false;controls.addEventListener('change',requestRender);
  material=createPointMaterial(pointSize);
  material.userData.lighting.value=0;
  const response=await fetch('assets/demo/manifest.json');if(!response.ok)throw Error('Scene list could not be loaded.');manifest=await response.json();
  const sceneOrder=['kitti-2800','kitti-0800','kitti-0000'];manifest.scenes.sort((a,b)=>sceneOrder.indexOf(a.id)-sceneOrder.indexOf(b.id));
  manifest.scenes.forEach((s,i)=>{const b=document.createElement('button');b.className='scene';b.dataset.scene=i;b.setAttribute('aria-pressed','false');const im=document.createElement('img');im.src=`assets/demo/${s.image}`;im.alt='';const label=document.createElement('span');label.textContent='Scene '+String(i+1).padStart(2,'0');b.setAttribute('aria-label',label.textContent+' · '+s.label);b.title=s.label;b.append(im,label);b.addEventListener('click',()=>selectScene(i));$('scene-list').append(b)});
  bindEvents();new ResizeObserver(resize).observe(viewport);await selectScene(0);
  window.demoDiagnostics=()=>({ready:status.hidden&&!!state.scene,view:'shared-3d',pose:state.pose,overlay:state.overlay,id:state.scene?.id,pointCount:state.points?.length/3,split:state.split,width:viewport.clientWidth,height:viewport.clientHeight,projection:camera.projectionMatrix.elements.slice(),cameraPosition:camera.position.toArray(),cameraQuaternion:camera.quaternion.toArray(),target:controls.target.toArray(),imageCorners:imagePlane?Array.from(imagePlane.geometry.attributes.position.array):[],imageDistance,cloudBounds:cloud?.geometry.boundingBox?[cloud.geometry.boundingBox.min.toArray(),cloud.geometry.boundingBox.max.toArray()]:null});
 }catch(e){console.error(e);statusMessage('Unable to open the 3D viewer. '+e.message,true)}
}
init();
