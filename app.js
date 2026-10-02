// IceGuard core: loader, scroll+mouse reactive hero WebGL, GSAP motion. Exposes window.IG.
(function(){
const $=id=>document.getElementById(id),rm=matchMedia('(prefers-reduced-motion:reduce)').matches;
let done=0,shown=false;
const IG=window.IG={rm,step(t,p){$('ltxt').textContent=t;$('lbar').style.width=p+'%';},done(t){done++;IG.step(t,Math.min(100,done/2*100));if(done>=2)hide();}};
function hide(){if(shown)return;shown=true;setTimeout(()=>{$('loader').classList.add('done');document.body.classList.add('ready');intro();},400);}
setTimeout(hide,7000);
function intro(){
 if(!window.gsap||rm)return;gsap.registerPlugin(ScrollTrigger);
 gsap.timeline({defaults:{ease:'power4.out'}}).from('.nav',{y:-80,opacity:0,duration:.9}).from('.hero .eyebrow',{y:20,opacity:0,duration:.7},'-=.4').from('.hero .ln',{y:60,opacity:0,duration:1,stagger:.14},'-=.4').from('.scroll',{opacity:0,duration:.8},'-=.3');
 gsap.utils.toArray('.rv').forEach(el=>gsap.from(el,{y:50,opacity:0,duration:1,ease:'power3.out',scrollTrigger:{trigger:el,start:'top 88%'}}));
}
document.querySelectorAll('.stats article').forEach(c=>{c.addEventListener('pointermove',e=>{if(rm)return;const b=c.getBoundingClientRect(),x=(e.clientX-b.left)/b.width-.5,y=(e.clientY-b.top)/b.height-.5;c.style.transform=`perspective(700px) rotateY(${x*6}deg) rotateX(${-y*6}deg)`;c.style.setProperty('--gx',(x+.5)*100+'%');c.style.setProperty('--gy',(y+.5)*100+'%');});c.addEventListener('pointerleave',()=>{c.style.transform='';});});
const bar=$('progress'),links=[...document.querySelectorAll('.nav nav a')];
addEventListener('scroll',()=>{if(bar)bar.style.transform=`scaleX(${scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight)})`;},{passive:true});
addEventListener('pointermove',e=>{if(rm)return;document.body.style.setProperty('--mx',e.clientX+'px');document.body.style.setProperty('--my',e.clientY+'px');});
if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)links.forEach(a=>a.toggleAttribute('data-active',a.getAttribute('href')==='#'+e.target.id));}),{rootMargin:'-45% 0px -45% 0px'});['map','dash','science'].forEach(i=>{const el=$(i);if(el)io.observe(el);});}
if(!window.THREE)return;
const cv=$('bg'),R=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});R.setPixelRatio(Math.min(devicePixelRatio,2));
const S=new THREE.Scene(),C=new THREE.PerspectiveCamera(45,1,.1,100);C.position.z=6;
const tgt=new THREE.Color('#4cc9f0'),mat=new THREE.MeshPhysicalMaterial({color:0x4cc9f0,emissive:0x4cc9f0,emissiveIntensity:.3,metalness:.75,roughness:.18,flatShading:true,clearcoat:1});
const core=new THREE.Mesh(new THREE.IcosahedronGeometry(1.3,1),mat),shell=new THREE.Mesh(new THREE.IcosahedronGeometry(1.9,1),new THREE.MeshBasicMaterial({color:0x4cc9f0,wireframe:true,transparent:true,opacity:.15}));
const crystal=new THREE.Group();crystal.add(core,shell);S.add(crystal);
const au=new THREE.Mesh(new THREE.PlaneGeometry(40,24),new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{t:{value:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float t;float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}void main(){float w=n(vec2(v.x*3.+t*.1,t*.05))*.35;float y=v.y-.62-w+.1*sin(v.x*6.+t*.3);float b=exp(-y*y*40.);float r=n(vec2(v.x*40.,t*.2));vec3 c=mix(vec3(.1,.9,.8),vec3(.4,.3,.9),v.y);gl_FragColor=vec4(c*b*(.35+.65*r)*.55,b*.5);}'}));au.position.z=-12;S.add(au);
S.add(new THREE.AmbientLight(0x88aacc,.6));const l1=new THREE.PointLight(0x4cc9f0,2,25),l2=new THREE.PointLight(0xffffff,1,25);l1.position.set(4,3,5);l2.position.set(-5,-2,4);S.add(l1,l2);
function size(){R.setSize(innerWidth,innerHeight,false);C.aspect=innerWidth/innerHeight;C.updateProjectionMatrix();}addEventListener('resize',size);size();
let mx=0,my=0,sp=0;addEventListener('pointermove',e=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5;});

(function loop(t){requestAnimationFrame(loop);const T=rm?0:t,p=scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight);sp+=(p-sp)*.06;
 const narrow=innerWidth<800;crystal.position.x+=((narrow?0:1.9-sp*3.8)-crystal.position.x)*.06;crystal.position.y+=((narrow?1.2:0)-sp*1.5-crystal.position.y)*.06;
 crystal.rotation.y=T/4000+sp*6+mx*1.2;crystal.rotation.x=my*.8+sp*2;crystal.scale.setScalar(1+.04*Math.sin(T/700));shell.rotation.y=-T/3000;au.material.uniforms.t.value=T/1000;
 C.position.x+=(mx*.6-C.position.x)*.05;C.position.y+=(-my*.4-C.position.y)*.05;C.position.z=6+sp*3;C.lookAt(0,0,0);
 [mat.color,mat.emissive,shell.material.color,l1.color].forEach(c=>c.lerp(tgt,.05));cv.style.opacity=Math.max(.05,1-sp*1.6);R.render(S,C);})(0);
})();
