// All GLSL for AlgoWorld. Five level shaders (planet, landscape, grove,
// surface, cell) plus three small simulations (slime-mould rivers,
// reaction-diffusion slime, excitable medium).
(function () {
  const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;
  const COMMON = HEAD + `
uniform vec2 uRes, uCenter;
uniform float uScale, uTime, uSeed, uAlpha, uPulse, uClock, uHue;
uniform vec4 uP;            // numbers handed down: moisture, stress, handedness, rhythm
uniform int uProbe;         // 1 = output the numbers this place hands down
out vec4 o;
float h11(float n){ return fract(sin(n*127.1+uSeed*3.7)*43758.5453); }
float h21(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031+uSeed*.0173); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float pn(vec2 p,float per){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float a=h21(mod(i,per)),b=h21(mod(i+vec2(1,0),per)),c=h21(mod(i+vec2(0,1),per)),d=h21(mod(i+1.,per));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float pfbm(vec2 p,float per,int oct){ float s=0.,a=.5; for(int k=0;k<oct;k++){ s+=a*pn(p*per,per); per*=2.; a*=.5; } return s; }
vec3 hsh(vec3 c,float a){ const vec3 k=vec3(.57735); float ca=cos(a),sa=sin(a); return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.-ca); }
vec2 wpos(){ return uCenter+(gl_FragCoord.xy-.5*uRes)/uRes.y*.5/uScale; }
vec3 fin(vec3 c){ c=max(hsh(c,uHue),0.); c=c/(1.+.35*c); c=pow(c,vec3(.92));
  vec2 q=(gl_FragCoord.xy-.5*uRes)/uRes.y; c*=1.-.28*dot(q,q);
  c+=(h21(gl_FragCoord.xy+fract(uTime)*91.)-.5)*.012; return c; }
`;
  const TERRAIN = `
float terr(vec2 p){ float base=pfbm(p,3.,6); float r=1.-abs(2.*pfbm(p+3.7,4.,5)-1.); return base*.75+r*r*(.12+.5*uP.y); }
`;

  const S = {};
  S.vs = HEAD + `void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0,1); }`;

  // ---------------------------------------------------------------- planet
  // Continents are standing waves on a sphere: a sum of zonal spherical
  // harmonics (Legendre polynomials) about seeded axes, each beating at its own
  // rate against the world clock. Coasts are the nodal lines.
  S.planet = COMMON + `
vec3 ax(float i){ return normalize(vec3(h11(i),h11(i+17.),h11(i+31.))*2.-1.+1e-3); }
float leg(int l,float x){ float p0=1.,p1=x; for(int k=2;k<=l;k++){ float p2=((2.*float(k)-1.)*x*p1-(float(k)-1.)*p0)/float(k); p0=p1; p1=p2; } return p1; }
float h31(vec3 p){ p=fract(p*.1031+uSeed*.0137); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float n3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p,int oct){ float s=0.,a=.5; for(int k=0;k<oct;k++){ s+=a*n3(p); p=p*2.03+7.1; a*=.5; } return s; }
float field(vec3 p,int oct){ float h=0.;
  for(int i=0;i<7;i++){ float fi=float(i); int l=2+i;
    float amp=(.5+h11(fi+90.))/sqrt(float(l));
    h+=amp*leg(l,dot(ax(fi),p))*cos(uClock*(.6+.5*h11(fi+50.))+6.2832*h11(fi+70.)); }
  h+=(fbm3(p*4.,oct)-.5)*(.5+.9*uP.y);
  return h-(uP.x-.5)*.5-.05*uPulse; }
void main(){
  vec2 q=(gl_FragCoord.xy-.5*uRes)/uRes.y; if(uProbe==1) q=vec2(0);
  float R=.40*uScale; vec2 d=q/R; float r2=dot(d,d);
  float lon=uCenter.x*6.2831853, lat=(uCenter.y-.5)*3.0;
  float cl=cos(lat),sl=sin(lat),co=cos(lon),so=sin(lon);
  vec3 L=normalize(vec3(-.55,.45,.7));
  vec3 col=vec3(0); float disc=0.;
  if(r2<1.){
    vec3 v=vec3(d,sqrt(1.-r2));
    vec3 a=vec3(v.x, v.y*cl+v.z*sl, -v.y*sl+v.z*cl);
    vec3 p=vec3(a.x*co+a.z*so, a.y, -a.x*so+a.z*co);
    int oct=uScale>3.?7:5;
    float h=field(p,oct);
    if(uProbe==1){
      float e=.004; vec3 t1=normalize(cross(p,vec3(0,1,.01)));
      float sl2=abs(field(normalize(p+e*t1),oct)-h)/e;
      o=vec4(clamp(.55-h*.9+.25*(1.-abs(p.y)),0.,1.), clamp(sl2*.25,0.,1.), .5+.5*sin(p.y*1.5708), fract(uClock*.16)); return; }
    float e=.0035/max(1.,uScale*.6);
    vec3 t1=normalize(cross(p,vec3(.13,1,.07))), t2=cross(p,t1);
    float hx=field(normalize(p+e*t1),oct), hy=field(normalize(p+e*t2),oct);
    vec3 nw=normalize(p-(t1*(hx-h)+t2*(hy-h))/e*.06*step(0.,h));
    // back to view space for lighting
    vec3 b=vec3(nw.x*co-nw.z*so, nw.y, nw.x*so+nw.z*co);
    vec3 n=vec3(b.x, b.y*cl-b.z*sl, b.y*sl+b.z*cl);
    float dif=max(dot(n,L),0.), sph=max(dot(v,L),0.);
    float ice=smoothstep(.78,.9,abs(p.y)+.12*(fbm3(p*9.,3)-.5)+h*.08);
    if(h<0.){
      vec3 deep=vec3(.015,.05,.16), shal=vec3(.04,.42,.5);
      col=mix(deep,shal,smoothstep(-.45,0.,h))*(.25+.95*sph);
      vec3 hv=normalize(L+vec3(0,0,1)); col+=vec3(1.,.9,.7)*pow(max(dot(v,hv),0.),90.)*.9;
      col+=vec3(.6,.85,.9)*smoothstep(-.03,0.,h)*.25*(.6+.4*sin(uTime*1.3+h*90.));
    } else {
      float t=clamp(h*1.25,0.,1.);
      vec3 low=mix(vec3(.62,.5,.28),vec3(.12,.36,.14),clamp(uP.x*.7+.5-abs(p.y)*.6+.3*(fbm3(p*6.,3)-.5),0.,1.));
      vec3 c1=mix(low,vec3(.36,.3,.27),smoothstep(.3,.62,t));
      c1=mix(c1,vec3(.92,.94,.98),smoothstep(.72,.9,t));
      col=c1*(.12+1.05*dif*sph/max(sph,.25));
    }
    col=mix(col,vec3(.9,.95,1.)*(.2+.95*sph),ice);
    float cd=fbm3(p*3.2+vec3(uTime*.012*(uP.z-.5)*4.,0,uTime*.008),5);
    float cm=smoothstep(.56,.72,cd);
    col=mix(col,vec3(1.)*(.25+.85*sph),cm*.72);
    col+=vec3(.25,.5,1.)*pow(1.-v.z,2.6)*.9*(.25+.75*sph);
    disc=1.;
  } else {
    if(uProbe==1){ o=vec4(.5); return; }
    float g=exp(-(sqrt(r2)-1.)*9./max(.35,uScale*.25));
    col=vec3(.2,.45,1.)*g*.55*(.35+.65*max(dot(normalize(vec3(d,0.)),L),0.)+.25);
    float st=h21(floor(gl_FragCoord.xy/1.6)); col+=vec3(.9,.95,1.)*smoothstep(.9965,1.,st)*(.5+.5*sin(uTime*2.+st*90.));
    col+=vec3(.05,.02,.09)*pfbm(q*.4+.3,3.,4);
    disc=clamp(g*1.5,0.,1.);
  }
  o=vec4(fin(col), uAlpha*mix(uAlpha*uAlpha,1.,disc));
}`;

  // ------------------------------------------------------------- landscape
  // Terrain is periodic fractal noise; rivers are the trail map of a
  // slime-mould (Physarum) agent simulation that senses its own trail and the
  // lowness of the terrain. Vegetation follows the water.
  S.landscape = COMMON + TERRAIN + `
uniform sampler2D uTrail;
float tr(vec2 p){ return texture(uTrail,p).r; }
float hgt(vec2 p){ return terr(p)-.05*smoothstep(1.,2.4,tr(p)); }
void main(){
  vec2 p=wpos();
  float T=tr(p), Tb=textureLod(uTrail,p,3.5).r, H=terr(p);
  float e=.0016/max(1.,uScale*.5);
  float hx=hgt(p+vec2(e,0)), hy=hgt(p+vec2(0,e)), h0=hgt(p);
  vec2 g=vec2(hx-h0,hy-h0)/e;
  if(uProbe==1){
    vec2 gt=vec2(tr(p+vec2(.004,0))-T, tr(p+vec2(0,.004))-T);
    float curl=gt.x*g.y-gt.y*g.x;
    o=vec4(clamp(Tb*.55+(1.-H)*.35,0.,1.), clamp(length(g)*.22,0.,1.), clamp(uP.z+curl*.2+(pfbm(p+1.3,2.,3)-.5)*1.6,0.,1.), fract(H*3.)); return; }
  vec3 n=normalize(vec3(-g*.16,1.)); vec3 L=normalize(vec3(-.5,.55,.65));
  float dif=max(dot(n,L),0.);
  float wet=clamp(uP.x*.75+.1+smoothstep(.3,1.6,Tb)*.6-.35*H,0.,1.);
  float grain=pfbm(p,48.,4);
  vec3 dry=mix(vec3(.74,.6,.38),vec3(.58,.4,.26),grain);
  vec3 lush=mix(vec3(.10,.34,.13),vec3(.3,.46,.14),grain);
  vec3 col=mix(dry,lush,smoothstep(.25,.7,wet+.25*(grain-.5)));
  float slope=length(g);
  col=mix(col,mix(vec3(.38,.34,.33),vec3(.5,.46,.42),grain),smoothstep(4.5,9.,slope+H*2.));
  col=mix(col,vec3(.93,.95,1.),smoothstep(.78,.92,H+.15*(grain-.5))*(1.-.6*uP.x*step(H,.8)));
  col*=.18+1.25*dif;
  float w=smoothstep(1.5,2.3,T+.5*(pfbm(p,96.,3)-.5));
  vec3 wc=mix(vec3(.07,.42,.5),vec3(.02,.14,.3),smoothstep(2.,4.5,T));
  wc+=vec3(1.,.95,.8)*pow(max(dot(normalize(vec3(-g*.2,1.)),normalize(L+vec3(0,0,1))),0.),60.)*.5;
  wc+=.025*sin(uTime*2.+T*5.+p.x*200.);
  col=mix(col,wc,w);
  col=mix(col,col*vec3(.8,.92,.8)+vec3(.02,.05,.03),smoothstep(.8,1.5,T)*(1.-w)*.5);
  o=vec4(fin(col),uAlpha);
}`;

  // ----------------------------------------------------------------- grove
  // Trees are grown on the CPU as chiral fractals (every branching decision is
  // rotated by a small skew, the "Sapolsky" arrow) and handed over as a texture:
  // R = wood, G = canopy, B = vines. Crystals grow in the clearings.
  S.grove = COMMON + `
uniform sampler2D uTree;
void main(){
  vec2 p=wpos();
  vec2 sw=.0009*vec2(sin(uTime*.7+p.y*40.),cos(uTime*.6+p.x*37.))*(.6+.6*uPulse);
  vec4 t=texture(uTree,p+sw); float can=textureLod(uTree,p+sw,1.5).g, canB=textureLod(uTree,p+vec2(.006,-.006),4.5).g;
  if(uProbe==1){ o=vec4(clamp(textureLod(uTree,p,3.).g*.9+uP.x*.25,0.,1.), clamp(textureLod(uTree,p,2.).r*1.6+uP.y*.2,0.,1.), uP.z, fract(p.x*3.+p.y*5.)); return; }
  float grain=pfbm(p,64.,4), big=pfbm(p,6.,4);
  vec3 soil=mix(vec3(.2,.14,.09),vec3(.33,.25,.15),grain);
  vec3 moss=mix(vec3(.09,.24,.1),vec3(.24,.36,.12),grain);
  vec3 col=mix(soil,moss,smoothstep(.3,.65,uP.x*.6+big*.7));
  col*=1.-.55*smoothstep(.05,.5,canB);
  // crystals in clearings
  vec2 cp=p*26.; vec2 ci=floor(cp); float best=9.; vec2 bid=ci; vec2 bo=vec2(0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 c=ci+vec2(x,y); vec2 mc=mod(c,26.); vec2 pt=c+.5+.35*(vec2(h21(mc),h21(mc+9.3))-.5)*2.; float dd=length(cp-pt); if(dd<best){best=dd;bid=mc;bo=cp-pt;} }
  float isC=step(h21(bid+3.1),.06+.42*uP.y)*step(canB,.16);
  float ang=atan(bo.y,bo.x)+h21(bid)*6.28; float fac=floor(ang/1.0472);
  float rr=.2+.2*h21(bid+5.)-.06*abs(fract(ang/1.0472)-.5);
  float cm=isC*smoothstep(rr,rr-.03,best);
  vec3 cc=mix(vec3(.2,.9,.95),vec3(.85,.3,.95),h21(bid+1.7))*(.45+.5*h21(vec2(fac,bid.x)))*(.9+.9*uPulse);
  cc+=vec3(1.)*pow(max(0.,1.-best/rr),6.)*.6;
  col=mix(col,cc,cm); col+=cc*isC*.25*exp(-best*5.)*(1.-cm);
  // vines, wood, leaves
  float vine=smoothstep(.3,.5,t.b);
  col=mix(col,mix(vec3(.3,.5,.12),vec3(.75,.8,.2),grain)*(.6+.4*uPulse),vine*.9);
  float e=.0012; float cx=textureLod(uTree,p+sw+vec2(e,0),1.5).g, cy=textureLod(uTree,p+sw+vec2(0,e),1.5).g;
  vec3 n=normalize(vec3(-(cx-can),-(cy-can),.05)); vec3 L=normalize(vec3(-.5,.55,.65)); float dif=max(dot(n,L),0.);
  float leaf=smoothstep(.3,.52,can*(.55+.95*pfbm(p,200.,3)))*.92;
  vec3 lc=mix(vec3(.07,.3,.1),vec3(.45,.62,.14),pfbm(p,90.,3));
  lc=mix(lc,vec3(.8,.5,.12),smoothstep(.6,.9,pfbm(p+2.,5.,3))*(1.-uP.x)*.8);
  col=mix(col,lc*(.3+.95*dif)*(.7+.6*pfbm(p,400.,2)),leaf);
  float wood=smoothstep(.34,.5,t.r);
  col=mix(col,mix(vec3(.2,.13,.09),vec3(.46,.34,.24),grain)*(.6+.6*dif),wood*(1.-.4*leaf));
  o=vec4(fin(col),uAlpha);
}`;

  // --------------------------------------------------------------- surface
  // Bark, with slime living on it: a Gray-Scott reaction-diffusion field whose
  // feed is pumped by a travelling wave.
  S.surface = COMMON + `
uniform sampler2D uGS; uniform vec2 uK; uniform float uPh;
void main(){
  vec2 p=wpos();
  vec2 ab=texture(uGS,p).rg; float b=ab.g;
  float e=1.5/512.; float bx=texture(uGS,p+vec2(e,0)).g, by=texture(uGS,p+vec2(0,e)).g;
  float pump=.5+.5*sin(6.2831853*dot(p,uK)-uPh);
  if(uProbe==1){ o=vec4(clamp(b*2.6,0.,1.), clamp(length(vec2(bx-b,by-b))*14.,0.,1.), uP.z, pump); return; }
  vec2 w=p+.03*vec2(pfbm(p,5.,3),pfbm(p+4.,5.,3));
  float fur=pfbm(vec2(w.x,w.y*.22)+.5,14.,5); float rid=1.-abs(2.*fur-1.);
  float grain=pfbm(p,128.,3);
  vec3 bark=mix(vec3(.16,.11,.08),vec3(.42,.33,.25),rid*rid);
  bark=mix(bark,vec3(.5,.52,.44),smoothstep(.62,.8,pfbm(p+9.,9.,4))*.5);
  bark*=.75+.5*grain;
  float crack=smoothstep(.16-.1*uP.y,.0,abs(fur-.5)*2.-.02); bark*=1.-.8*crack*(.3+uP.y);
  float fx=pfbm(vec2(w.x+.004,w.y*.22)+.5,14.,5)-fur;
  vec3 L=normalize(vec3(-.5,.55,.65));
  bark*=.55+.6*max(dot(normalize(vec3(-fx*30.,0.,1.)),L),0.);
  float sl=smoothstep(.10,.24,b+.04*(grain-.5));
  vec3 n=normalize(vec3(-(bx-b)*26.,-(by-b)*26.,1.));
  float dif=max(dot(n,L),0.), sp=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.),40.);
  vec3 sc=mix(vec3(.98,.74,.1),vec3(.95,.4,.1),smoothstep(.25,.42,b));
  sc=mix(sc,vec3(.7,.95,.3),.35*h11(3.));
  sc*=(.45+.7*dif)*(.75+.45*pump*(.6+.6*uPulse));
  sc+=vec3(1.,.97,.85)*sp*.7;
  vec3 col=mix(bark,sc,sl);
  col*=1.-.35*smoothstep(.03,.1,b)*(1.-sl);
  o=vec4(fin(col),uAlpha);
}`;

  // ------------------------------------------------------------------ cell
  // An excitable medium (Barkley model) paced by the world's heartbeat. Zoom
  // in and the tissue resolves into the checkerboard of the ECG loop itself,
  // its square size set by the live coupler signal.
  S.cell = COMMON + `
uniform sampler2D uEx; uniform float uSq;
void main(){
  vec2 p=wpos();
  vec2 uv=texture(uEx,p).rg; float u=uv.r,v=uv.g;
  if(uProbe==1){ o=vec4(clamp(v*1.2,0.,1.),clamp(u,0.,1.),uP.z,fract(uClock*.16+.5)); return; }
  float e=1.5/512.; float ux=texture(uEx,p+vec2(e,0)).r, uy=texture(uEx,p+vec2(0,e)).r;
  vec3 n=normalize(vec3(-(ux-u)*3.,-(uy-u)*3.,1.)); vec3 L=normalize(vec3(-.5,.55,.65));
  float grain=pfbm(p,96.,4);
  vec3 col=mix(vec3(.03,.035,.11),vec3(.07,.05,.2),grain);
  col=mix(col,vec3(.55,.12,.6),smoothstep(.05,.8,v)*.8);
  col=mix(col,vec3(.25,.9,1.),smoothstep(.2,.9,u));
  col+=vec3(1.)*smoothstep(.75,1.,u)*.35;
  col*=.55+.6*max(dot(n,L),0.);
  col+=vec3(.9,.95,1.)*pow(max(dot(n,normalize(L+vec3(0,0,1))),0.),30.)*.25;
  float k=smoothstep(1.6,4.5,uScale);
  float cs=.0006+.0075*uSq; vec2 g=p/cs; vec2 gi=floor(g); float ch=mod(gi.x+gi.y,2.);
  vec2 gf=abs(fract(g)-.5); float edge=smoothstep(.5,.5-.06*min(8.,uScale*.6),max(gf.x,gf.y));
  vec3 cb=mix(col*.35,col*1.5+vec3(.05,.08,.12),ch); cb*=.6+.4*edge;
  col=mix(col,cb,k*.9);
  o=vec4(fin(col),uAlpha);
}`;

  // ------------------------------------------------------- simulations
  S.physAgent = HEAD + `
uniform sampler2D uAg,uTrail; uniform float uSeed,uTime; uniform vec4 uP; out vec4 o;
float h21(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031+uSeed*.0173); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float pn(vec2 p,float per){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float a=h21(mod(i,per)),b=h21(mod(i+vec2(1,0),per)),c=h21(mod(i+vec2(0,1),per)),d=h21(mod(i+1.,per));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float pfbm(vec2 p,float per,int oct){ float s=0.,a=.5; for(int k=0;k<oct;k++){ s+=a*pn(p*per,per); per*=2.; a*=.5; } return s; }
` + TERRAIN + `
float rnd(vec2 s){ return fract(sin(dot(s,vec2(12.9898,78.233))+uTime*7.13)*43758.5453); }
void main(){
  vec4 a=texelFetch(uAg,ivec2(gl_FragCoord.xy),0); vec2 pos=a.xy; float ang=a.z;
  const float SA=.55, SO=10./512., RA=.38, SS=1.15/512.;
  vec2 q0=pos+SO*vec2(cos(ang),sin(ang)), q1=pos+SO*vec2(cos(ang+SA),sin(ang+SA)), q2=pos+SO*vec2(cos(ang-SA),sin(ang-SA));
  float F=textureLod(uTrail,q0,0.).r+1.6*(1.-terr(q0)), Lf=textureLod(uTrail,q1,0.).r+1.6*(1.-terr(q1)), Rt=textureLod(uTrail,q2,0.).r+1.6*(1.-terr(q2));
  float r=rnd(gl_FragCoord.xy);
  if(F>Lf&&F>Rt){} else if(F<Lf&&F<Rt) ang+=(r-.5)*2.*RA; else if(Lf>Rt) ang+=RA; else ang-=RA;
  ang+=(uP.z-.5)*.07+(rnd(gl_FragCoord.yx+3.)-.5)*.12;
  pos=fract(pos+SS*vec2(cos(ang),sin(ang)));
  o=vec4(pos,ang,1.);
}`;
  S.physPointVS = HEAD + `uniform sampler2D uAg; void main(){ ivec2 t=ivec2(gl_VertexID%256,gl_VertexID/256); vec2 p=texelFetch(uAg,t,0).xy; gl_Position=vec4(p*2.-1.,0,1); gl_PointSize=1.; }`;
  S.physPointFS = HEAD + `uniform float uDep; out vec4 o; void main(){ o=vec4(uDep,0,0,1); }`;
  S.physDiffuse = HEAD + `uniform sampler2D uTrail; out vec4 o; void main(){ ivec2 c=ivec2(gl_FragCoord.xy); float s=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) s+=texelFetch(uTrail,(c+ivec2(x,y)+512)%512,0).r;
  o=vec4(min(s/9.*.93,6.),0,0,1); }`;

  S.gs = HEAD + `uniform sampler2D uS; uniform float uF,uKk,uPh; uniform vec2 uK; out vec4 o;
vec2 f(ivec2 c){ return texelFetch(uS,(c+512)%512,0).rg; }
void main(){ ivec2 c=ivec2(gl_FragCoord.xy); vec2 s=f(c);
  vec2 lap=.2*(f(c+ivec2(1,0))+f(c-ivec2(1,0))+f(c+ivec2(0,1))+f(c-ivec2(0,1)))+.05*(f(c+ivec2(1,1))+f(c+ivec2(-1,1))+f(c+ivec2(1,-1))+f(c-ivec2(1,1)))-s;
  float F=uF*(1.+.18*sin(6.2831853*dot(gl_FragCoord.xy/512.,uK)-uPh));
  float r=s.r*s.g*s.g;
  o=vec4(clamp(s.r+lap.r-r+F*(1.-s.r),0.,1.), clamp(s.g+.5*lap.g+r-(uKk+F)*s.g,0.,1.),0,1); }`;

  S.ex = HEAD + `uniform sampler2D uS; uniform float uB,uStim,uSeed; out vec4 o;
vec2 f(ivec2 c){ return texelFetch(uS,(c+512)%512,0).rg; }
float hs(float n){ return fract(sin(n*91.7+uSeed)*43758.5453); }
void main(){ ivec2 c=ivec2(gl_FragCoord.xy); vec2 s=f(c); float u=s.r,v=s.g;
  float lap=f(c+ivec2(1,0)).r+f(c-ivec2(1,0)).r+f(c+ivec2(0,1)).r+f(c-ivec2(0,1)).r-4.*u;
  const float a=.8, eps=.03, dt=.05; float th=(v+uB)/a, k=dt/eps;
  if(u<th) u=u/(1.-k*(1.-u)*(u-th)); else u=(u+k*u*(u-th))/(1.+k*u*(u-th));
  u+=.18*lap; v+=dt*(s.r-v);
  if(uStim>.5){ for(int i=0;i<3;i++){ vec2 q=vec2(hs(float(i)),hs(float(i)+5.))*512.; vec2 d=abs(gl_FragCoord.xy-q); d=min(d,512.-d); if(length(d)<5.) u=1.; } }
  o=vec4(clamp(u,0.,1.),clamp(v,0.,1.),0,1); }`;

  window.SHADERS = S;
})();
