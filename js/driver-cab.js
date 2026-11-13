/* Detailed operator station, spring-return joysticks and independent CCTV cameras. */
(function (w) {
  'use strict';
  var C = {}, group, sticks = [], wiper, light, screen, screenTexture, targets = [];
  var pads = [], station, monitors, monitorRenderer, cameras = [], modes = ['grab', 'head', 'truck'];
  var lastMonitor = 0, lastScreen = 0, wipe = false, lit = true, shown = true, clickStart = null;
  var goal = new THREE.Vector3(), ray = new THREE.Raycaster();
  var $ = function (id) { return document.getElementById(id); };
  function material(color, metal) { var m = new THREE.MeshStandardMaterial({ color: color, roughness: metal ? .4 : .8, metalness: metal ? .55 : .05 }); m.color.convertSRGBToLinear(); return m; }
  C.build = function () {
    group = new THREE.Group(); group.name = '司机室精细操作台';
    var navy = material(0x304355, true), dark = material(0x151e27), gray = material(0x6b7780), rubber = material(0x24292d);
    function box(parent, size, pos, mat) { var m = new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),mat); m.position.set(pos[0],pos[1],pos[2]); parent.add(m); return m; }
    function cylinder(parent, r1, r2, h, pos, mat) { var m = new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,20),mat); m.position.set(pos[0],pos[1],pos[2]); parent.add(m); return m; }
    function label(text, width, height, pos, rotation) {
      var cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      var ctx = cv.getContext('2d'); ctx.fillStyle = '#17232d'; ctx.fillRect(0,0,512,128);
      ctx.fillStyle = '#d8e7ef'; ctx.font = 'bold 35px Microsoft YaHei, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text,256,78);
      var texture = new THREE.CanvasTexture(cv); texture.encoding = THREE.sRGBEncoding;
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
      mesh.position.set(pos[0],pos[1],pos[2]); mesh.rotation.set(rotation[0],rotation[1],rotation[2]); group.add(mesh); return mesh;
    }
    // Open lower front window preserves a view down to the load; rear floor and seat remain solid.
    box(group,[2.0,.09,1.94],[-1.15,-1.4,0],dark);
    box(group,[2.9,.08,1.94],[-.7,.79,0],navy);
    [-.95,.95].forEach(function(z){
      box(group,[.055,2.2,.055],[.72,-.3,z],navy);
      box(group,[2.9,.055,.045],[-.7,-1.33,z],navy);
      box(group,[2.9,.06,.045],[-.7,.2,z],navy);
      box(group,[.10,2.2,.06],[-2.1,-.3,z],navy);
      // Console pedestal, sloping armrest, ventilator, fixing screws, keypad and lever boot.
      box(group,[1.20,.40,.33],[.15,-.85,z*.55],navy);
      box(group,[1.24,.055,.35],[.15,-.62,z*.55],dark);
      box(group,[.30,.10,.27],[-.25,-.54,z*.55],rubber);
      for(var j=0;j<6;j++) box(group,[.10,.008,.013],[.10,-.588,z*.55+(j-2.5)*.027],gray);
      [-.12,.12].forEach(function(d){ cylinder(group,.012,.012,.008,[z<0?0:.65,-.586,z*.55+d],gray); });
      var stick = new THREE.Group(); stick.position.set(.48,-.59,z*.55); group.add(stick); sticks.push(stick);
      for(var k=0;k<5;k++) cylinder(group,.065-k*.006,.072-k*.006,.025,[.48,-.60+k*.021,z*.55],rubber);
      cylinder(stick,.018,.023,.23,[0,.18,0],gray);
      var grip = new THREE.Group(); grip.position.y=.30; grip.rotation.z=-.14; stick.add(grip);
      cylinder(grip,.035,.029,.10,[0,0,0],rubber);
      [-.05,.05].forEach(function(y){var cap=new THREE.Mesh(new THREE.SphereGeometry(.035,16,10),rubber);cap.scale.y=.55;cap.position.y=y;grip.add(cap);});
      for(var rib=0;rib<4;rib++){var ring=new THREE.Mesh(new THREE.TorusGeometry(.031,.003,6,16),dark);ring.rotation.x=Math.PI/2;ring.position.y=-.035+rib*.021;grip.add(ring);}
      cylinder(grip,.014,.014,.009,[0,.072,0],material(0xba2724));
      box(grip,[.018,.035,.012],[-.029,-.013,0],material(0x60859a));
      label(z<0?'回转 / 变幅':'起升 / 抓斗',.31,.075,[z<0?.29:.65,-.582,z*.55],[-Math.PI/2,0,-Math.PI/2]);
      for(var n=0;n<3;n++) {
        var colors = [0x40ad74,0xe4b842,0xcd3c30];
        cylinder(group,.027,.03,.023,[-.15+n*.10,-.58,z*.55+.10],material(colors[n]));
      }
    });
    // Suspension seat, backrest, headrest, floor pedals and side door handle.
    cylinder(group,.16,.21,.45,[-.65,-1.12,0],navy);
    box(group,[.55,.16,.61],[-.61,-.82,0],rubber);
    var back=box(group,[.16,.72,.59],[-.92,-.48,0],rubber); back.rotation.z=.10;
    box(group,[.16,.20,.37],[-.98,.01,0],rubber);
    [-.2,.2].forEach(function(z){var pedal=box(group,[.22,.035,.14],[.02,-1.31,z],gray);pedal.rotation.z=.25;});
    box(group,[.04,.25,.035],[-1.45,-.25,-.88],gray);
    // Forward HMI at knee height, plus physical buttons which also respond to clicks.
    var display = new THREE.Group(); display.position.set(.64,-.72,.27); display.rotation.z=.30; group.add(display);
    box(display,[.055,.25,.40],[0,0,0],dark);
    screen=document.createElement('canvas');screen.width=512;screen.height=320;
    screenTexture=new THREE.CanvasTexture(screen);screenTexture.encoding=THREE.sRGBEncoding;
    var face=new THREE.Mesh(new THREE.PlaneGeometry(.37,.225),new THREE.MeshBasicMaterial({map:screenTexture}));
    face.rotation.y=-Math.PI/2;face.position.x=-.031;display.add(face);
    // The panel rests on the desk (top y=-.5925); each cap sits above its bezel.
    // Keep the complete row inside the left desk and clear of the joystick boot.
    var buttonPanel=box(group,[.19,.025,.32],[.66,-.58,-.5225],navy);buttonPanel.name='cab-button-panel';
    function actionButton(z,color,action,text) {
      cylinder(group,.043,.043,.018,[.68,-.5585,z],gray);
      var b=cylinder(group,.037,.039,.025,[.68,-.537,z],material(color)); b.name='cab-button-'+action; b.userData.cabAction=action;targets.push(b);
      label(text,.084,.04,[.59,-.566,z],[-Math.PI/2,0,-Math.PI/2]);return b;
    }
    actionButton(-.415,0xd62720,'stop','急停');actionButton(-.5225,0x45b882,'light','照明');actionButton(-.63,0x3d91bc,'wiper','雨刷');
    // Front sill and wiper; slim members keep the load in view.
    box(group,[.06,.055,1.94],[.73,-1.35,0],navy);
    box(group,[.06,.055,1.94],[.73,.75,0],navy);
    wiper=new THREE.Group();wiper.position.set(.735,-1.27,0);group.add(wiper);
    box(wiper,[.022,.82,.022],[0,.41,0],dark);box(wiper,[.025,.30,.035],[-.015,.83,0],rubber);
    light=new THREE.PointLight(0xb7dbe9,.65,3,2);light.position.set(-.3,.48,0);group.add(light);
    C.group=group; return group;
  };
  function act(name) {
    if(name==='stop') $('driver-stop').click();
    if(name==='light') {lit=!lit;light.visible=lit;$('cab-light').setAttribute('aria-pressed',String(lit));}
    if(name==='wiper') {wipe=!wipe;$('cab-wiper').setAttribute('aria-pressed',String(wipe));}
  }
  C.init = function () {
    station=document.createElement('div'); station.id='cab-controls';
    station.innerHTML='<div class="cab-stick-block"><span>回转 / 变幅</span><div class="cab-pad" data-stick="0" role="group" aria-label="回转变幅摇杆：可拖动，或使用 A D W S"><i></i><b>↑ 伸臂</b><small>← 左转 · 右转 →</small></div></div>'+
      '<div class="cab-switches"><button id="cab-forward">正视操作台</button><button id="cab-light" aria-pressed="true">操作灯</button><button id="cab-wiper" aria-pressed="false">雨刷</button><button id="cab-monitors" aria-pressed="true">监控小窗</button><button id="cab-weather-settings">气象设置</button><span>按住拖动摇杆 · 松手回中<br>A/D 回转 · W/S 变幅 · ↑/↓ 起升 · J/K 抓斗 · Z/X 大车</span><div class="cab-travel"><button data-drive="travel:-1">Z · 大车后退</button><button data-drive="travel:1">X · 大车前进</button></div></div>'+
      '<div class="cab-stick-block"><span>抓斗 / 起升</span><div class="cab-pad" data-stick="1" role="group" aria-label="起升抓斗摇杆：可拖动，或使用方向键及 J K"><i></i><b>↑ 提升</b><small>← 闭斗 · 开斗 →</small></div></div>';
    // Driver binds its original data-drive buttons before this runs: retain them for travel.
    var travel=$('driver-panel').querySelector('.driver-controls>div:last-child');
    station.querySelector('.cab-travel').replaceChildren(travel.children[1],travel.children[2]);
    $('driver-panel').appendChild(station);
    var toggle=document.createElement('button');toggle.id='cab-controls-toggle';toggle.textContent='展开操纵台';toggle.setAttribute('aria-expanded','false');
    $('driver-panel').querySelector('.driver-actions').insertBefore(toggle,$('driver-exit'));
    toggle.addEventListener('click',function(){var on=$('driver-panel').classList.toggle('cab-expanded');toggle.textContent=on?'收起操纵台':'展开操纵台';toggle.setAttribute('aria-expanded',String(on));});
    var weather=document.createElement('div');weather.id='driver-weather';weather.textContent='仿真气象';$('driver-panel').appendChild(weather);
    $('cab-forward').onclick=function(){w.DRIVER.forward();};
    $('cab-light').onclick=function(){act('light');};$('cab-wiper').onclick=function(){act('wiper');};
    $('cab-weather-settings').onclick=function(){w.SETTINGS.open('basic');$('weather-sky').scrollIntoView({block:'center'});};
    $('cab-monitors').onclick=function(){shown=!shown;monitors.classList.toggle('hidden',!shown);this.setAttribute('aria-pressed',String(shown));};
    station.querySelectorAll('.cab-pad').forEach(function(el){
      var p={el:el,x:0,y:0,id:null};pads.push(p);
      function move(e){if(p.id!==e.pointerId)return;var r=el.getBoundingClientRect();var x=(e.clientX-r.left-r.width/2)/(r.width*.37),y=(e.clientY-r.top-r.height/2)/(r.height*.37);var l=Math.max(1,Math.hypot(x,y));p.x=x/l;p.y=y/l;}
      el.addEventListener('pointerdown',function(e){if(e.button!==0||w.DRIVER.emergency||p.id!==null)return;e.preventDefault();w.SCENE.renderer.domElement.focus({preventScroll:true});el.setPointerCapture(e.pointerId);p.id=e.pointerId;move(e);});
      el.addEventListener('pointermove',move);
      ['pointerup','pointercancel','lostpointercapture'].forEach(function(type){el.addEventListener(type,function(e){if(p.id===e.pointerId){p.id=null;p.x=p.y=0;}});});
    });
    var canvas=w.SCENE.renderer.domElement;
    canvas.addEventListener('pointerdown',function(e){if(w.DRIVER.active)clickStart={x:e.clientX,y:e.clientY};});
    canvas.addEventListener('pointerup',function(e){
      if(!w.DRIVER.active||!clickStart)return;
      if(Math.hypot(e.clientX-clickStart.x,e.clientY-clickStart.y)<5){var r=canvas.getBoundingClientRect();ray.setFromCamera({x:(e.clientX-r.left)/r.width*2-1,y:1-(e.clientY-r.top)/r.height*2},w.SCENE.camera);var hit=ray.intersectObjects(targets);if(hit.length)act(hit[0].object.userData.cabAction);}
      clickStart=null;
    });
    makeMonitors();
  };
  C.release=function(){pads.forEach(function(p){p.id=null;p.x=p.y=0;p.el.querySelector('i').style.transform='translate(-50%,-50%)';});};
  C.input=function(input,speed){
    if(!pads.length)return;
    function dead(v){return Math.abs(v)<.12?0:Math.sign(v)*(Math.abs(v)-.12)/.88;}
    var a=pads[0],b=pads[1];
    input.slew=(input.slew||0)-dead(a.x)*speed;input.alpha=(input.alpha||0)+dead(a.y)*speed;
    input.hoist=(input.hoist||0)-dead(b.y)*speed;input.grab=(input.grab||0)+dead(b.x)*speed;
    Object.keys(input).forEach(function(k){input[k]=U.clamp(input[k],-1,1);});
  };
  C.update=function(input){
    if(!group)return;
    sticks[0].rotation.z=(input.alpha||0)*.32;sticks[0].rotation.x=(input.slew||0)*.32;
    sticks[1].rotation.z=-(input.hoist||0)*.32;sticks[1].rotation.x=(input.grab||0)*.32;
    pads.forEach(function(p){p.el.querySelector('i').style.transform='translate(calc(-50% + '+p.x*27+'px),calc(-50% + '+p.y*27+'px))';});
    wiper.rotation.x=wipe?Math.sin(performance.now()*.003)*.65: -.65;
    if(performance.now()-lastScreen<200)return;lastScreen=performance.now();
    var st=w.KT.ST,ctx=screen.getContext('2d');ctx.fillStyle='#102630';ctx.fillRect(0,0,512,320);
    ctx.fillStyle='#68e1cf';ctx.font='bold 32px monospace';ctx.fillText('PORT CRANE / HMI',20,44);
    ctx.font='26px monospace';ctx.fillStyle='#d7edf7';
    ['R '+st.radius.toFixed(1)+' m    H '+st.height.toFixed(1)+' m','SLEW '+U.deg(st.slew).toFixed(1)+' deg','GRAB '+Math.round(st.grabOpen*100)+'%  LOAD '+Math.round(st.load*100)+'%', 'WIND '+w.WEATHER.state.wind.toFixed(1)+' m/s',w.DRIVER.emergency?'EMERGENCY STOP':'MANUAL / READY'].forEach(function(t,i){ctx.fillText(t,20,94+i*43);});
    screenTexture.needsUpdate=true;if($('driver-weather'))$('driver-weather').textContent=w.WEATHER.summary();
  };
  function makeMonitors(){
    monitors=document.createElement('aside');monitors.id='driver-monitors';monitors.className='hidden';monitors.setAttribute('aria-label','三路实时监控');
    var title=document.createElement('div');title.className='monitor-title';title.textContent='辅助监控 · LIVE';monitors.appendChild(title);
    modes.forEach(function(mode,i){
      var card=document.createElement('div');card.className='monitor-card';
      var select=document.createElement('select');select.setAttribute('aria-label','监控机位 '+(i+1));
      [['grab','抓斗 / 夹爪'],['head','象鼻梁俯视'],['truck','卸料区'],['overview','门机全景']].forEach(function(item){var op=document.createElement('option');op.value=item[0];op.textContent=item[1];select.appendChild(op);});select.value=mode;
      select.onchange=function(){modes[i]=select.value;lastMonitor=0;};card.appendChild(select);
      var cv=document.createElement('canvas');cv.width=360;cv.height=202;cv.setAttribute('aria-label','实时'+select.selectedOptions[0].textContent+'画面');card.appendChild(cv);monitors.appendChild(card);
      cameras.push(new THREE.PerspectiveCamera(60,360/202,.12,1000));
    });document.body.appendChild(monitors);
  }
  C.setActive=function(on){if(!monitors)return;monitors.classList.toggle('hidden',!on||!shown);lastMonitor=0;C.release();};
  C.renderMonitors=function(){
    if(!w.DRIVER.active||!shown||document.hidden||performance.now()-lastMonitor<160)return;
    lastMonitor=performance.now();
    if(!monitorRenderer){
      monitorRenderer=new THREE.WebGLRenderer({antialias:false,alpha:false});monitorRenderer.setPixelRatio(1);monitorRenderer.setSize(360,202,false);
      monitorRenderer.outputEncoding=THREE.sRGBEncoding;monitorRenderer.toneMapping=THREE.ACESFilmicToneMapping;
    }
    var S=w.SCENE,st=w.KT.ST,shell=S.scene.getObjectByName('CAD_司机室外壳')||w.CRANE.cab;
    var interiorVisible=group.visible,shellVisible=shell&&shell.visible;group.visible=false;if(shell)shell.visible=true;
    monitorRenderer.toneMappingExposure=S.renderer.toneMappingExposure;
    try{
      monitors.querySelectorAll('.monitor-card canvas').forEach(function(cv,i){
        var cam=cameras[i],mode=modes[i];cam.up.set(0,1,0);
        if(mode==='grab'){cam.position.copy(st.grabPos).add(new THREE.Vector3(3,2.2,3));goal.copy(st.grabPos);goal.y-=1.2;}
        if(mode==='head'){
          // Stabilized downward camera beside the head-tip pulley. Follow the
          // crane mount, never the swinging load. A horizontal up vector avoids
          // the lookAt singularity of a vertical view with world-Y as up.
          var cs=Math.cos(st.slew),sn=Math.sin(st.slew);
          cam.position.copy(st.Cworld);cam.position.x+=.8*cs+1.2*sn;cam.position.y-=.8;cam.position.z+=-.8*sn+1.2*cs;
          cam.up.set(cs,0,-sn);goal.copy(cam.position);goal.y-=20;
        }
        if(mode==='truck'){w.SCENE.truck.getWorldPosition(goal);cam.position.copy(goal).add(new THREE.Vector3(12,12,12));goal.y+=1.5;}
        if(mode==='overview'){cam.position.set(st.travel+56,37,48);goal.set(st.travel,17,0);}
        cam.lookAt(goal);monitorRenderer.render(S.scene,cam);cv.getContext('2d').drawImage(monitorRenderer.domElement,0,0);
      });
    }finally{group.visible=interiorVisible;if(shell)shell.visible=shellVisible;}
  };
  w.DRIVER_CAB=C;
})(window);
