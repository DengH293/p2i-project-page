// Build a scene-fixed display scale from predicted camera depths only.
// No image RGB, ground-truth transform, or moving observer enters this mapping.
const clamp=v=>Math.min(1,Math.max(0,v));
function quantile(sorted,q){const i=q*(sorted.length-1),lo=Math.floor(i);return sorted[lo]+(sorted[Math.ceil(i)]-sorted[lo])*(i-lo)}
function upperBound(sorted,value){let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>>1;if(sorted[mid]<=value)lo=mid+1;else hi=mid}return lo}
function makeScale(visible){
 const sorted=Float64Array.from(visible).sort();
 if(sorted.length<2||sorted[sorted.length-1]-sorted[0]<1e-6)return {map:z=>clamp((z-2)/38),ticks:[2,21,40],visibleCount:sorted.length,fallback:true};
 const near=quantile(sorted,.02),far=quantile(sorted,.98),span=far-near;
 if(span<1e-6)return {map:z=>clamp((z-2)/38),ticks:[2,21,40],visibleCount:sorted.length,fallback:true};
 // A continuous quantile lookup avoids color steps at individual scan samples.
 const knots=Float64Array.from({length:257},(_,i)=>quantile(sorted,.02+.96*i/256));
 const map=z=>{
  if(z<=near)return 0;if(z>=far)return 1;
  const high=Math.min(256,Math.max(1,upperBound(knots,z))),low=high-1;
  const part=(z-knots[low])/Math.max(1e-12,knots[high]-knots[low]);
  const cdf=(low+part)/256;
  const inverse=clamp((1/near-1/z)/(1/near-1/far));
  return clamp(.7*cdf+.3*inverse);
 };
 let low=near,high=far;for(let i=0;i<40;i++){const mid=(low+high)/2;if(map(mid)<.5)low=mid;else high=mid}
 return {map,ticks:[near,(low+high)/2,far],visibleCount:sorted.length,fallback:false};
}
export function buildDepthReference(points,s){
 const T=s.T_pred,K=s.K,depths=new Float32Array(points.length/3),visible=[];
 for(let i=0,j=0;i<points.length;i+=3,j++){
  const x=points[i],y=points[i+1],z=points[i+2];
  const px=T[0][0]*x+T[0][1]*y+T[0][2]*z+T[0][3],py=T[1][0]*x+T[1][1]*y+T[1][2]*z+T[1][3],pz=T[2][0]*x+T[2][1]*y+T[2][2]*z+T[2][3];
  depths[j]=pz;
  if(pz<=.1)continue;
  const u=(K[0][0]*px+K[0][1]*py)/pz+K[0][2],v=K[1][1]*py/pz+K[1][2];
  if(u>=0&&u<s.width&&v>=0&&v<s.height)visible.push(pz);
 }
 return {depths,...makeScale(visible)};
}
export function depthFraction(z,mode,reference){return mode==='image'?reference.map(z):clamp((z-2)/38)}
