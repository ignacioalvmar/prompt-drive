/** Low amber fog lights and an independent status mesh on the instrument panel. */
(function () {
  if (typeof CabinFeedback === 'undefined') return;
  let group = null, pairs = [], indicator = null, frame = null;
  let target = 0, level = 0, fromLevel = 0, transitionAt = 0, initial = true;

  function releaseLights() {
    group?.parent?.remove(group);
    for (const pair of pairs) pair.light.dispose?.();
    group = null; pairs = [];
  }

  function ensureLights(h) {
    const container = h.ego?.lightsContainer, source = h.ego?.lights;
    if (!container || !source?.left?.light || !source?.right?.light || !source.left.target) return false;
    if (group?.parent && group.parent !== container) releaseLights();
    if (group) { if (!group.parent) container.add(group); return true; }
    // These native constructors remain available even when THREE export names
    // are removed by the upstream engine's build.
    const SpotLight = source.left.light.constructor, Group = source.left.target.constructor;
    group = new Group(); group.name = 'fog_lights';
    for (const side of ['left', 'right']) {
      const light = new SpotLight(0xffce48, 0, 40, 0.22, 0.8, 1.2), aim = new Group();
      light.name = 'fog_light_' + side; aim.name = 'fog_light_target_' + side;
      light.castShadow = false; light.target = aim;
      group.add(light, aim); pairs.push({ side, light, aim });
    }
    container.add(group); return true;
  }

  function releaseIndicator() {
    if (!indicator) return;
    indicator.mesh.parent?.remove(indicator.mesh);
    indicator.mesh.geometry.dispose(); indicator.mesh.material.dispose(); indicator.texture.dispose();
    indicator = null;
  }

  function drawIndicator(on) {
    const g = indicator.canvas.getContext('2d');
    g.clearRect(0,0,240,46); g.beginPath(); g.roundRect(0,0,240,46,9);
    g.fillStyle = on ? '#534528' : '#282d32'; g.fill();
    const color = on ? '#ffda76' : '#7d8791', ix = 31, iy = 23;
    g.strokeStyle = color; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ix+4,iy-14); g.lineTo(ix+4,iy+14);
    g.bezierCurveTo(ix+29,iy+13,ix+29,iy-13,ix+4,iy-14); g.stroke();
    for (let i=-1;i<=1;i++) { g.beginPath(); g.moveTo(ix-27,iy+i*9+4); g.lineTo(ix-3,iy+i*9); g.stroke(); }
    g.beginPath(); g.moveTo(ix-16,iy-18); g.bezierCurveTo(ix-26,iy-5,ix-7,iy+3,ix-17,iy+18); g.stroke();
    g.font='26px ShareTech, Arial, sans-serif'; g.fillStyle=color; g.textAlign='left'; g.textBaseline='middle';
    g.fillText(on ? 'EXPL. ON' : 'EXPL. OFF',75,24);
    indicator.canvas.dataset.on = String(on); indicator.on = on; indicator.texture.needsUpdate = true;
  }

  function updateIndicator(h) {
    const cluster = h.controller?.instrumentCluster, overlay = cluster?.overlayMesh;
    if (!overlay?.parent) { releaseIndicator(); return; }
    if (indicator && indicator.mesh.parent !== overlay) releaseIndicator();
    if (!indicator) {
      const canvas = document.createElement('canvas'); canvas.width=240; canvas.height=46;
      canvas.dataset.feature='fog_lights';
      const texture = new cluster.texture.constructor(canvas);
      texture.generateMipmaps=false;
      texture.minFilter=cluster.texture.minFilter; texture.magFilter=cluster.texture.magFilter;
      const material = cluster.material.clone(); material.map=texture;
      material.transparent=true; material.depthWrite=false;
      const size = overlay.geometry.parameters;
      const mesh = new overlay.constructor(new overlay.geometry.constructor(size.width*240/1292,size.height*46/400),material);
      mesh.name='fog_lights_indicator'; mesh.position.set(-size.width*.275,-size.height*.34,.0003);
      mesh.renderOrder=3; mesh.frustumCulled=false; overlay.add(mesh);
      indicator={mesh,texture,canvas,on:null};
    }
    const on = target === 1;
    if (indicator.on !== on) drawIndicator(on);
    indicator.mesh.visible = CabinFeedback._enabled;
  }

  CabinFeedback.register({
    id: 'fog_lights', title: 'Exploradoras', fields: ['fog_lights'],
    init(ctx) {
      const tick = now => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const elapsed = Math.max(0,now-transitionAt)/1000;
        level = reduced ? target : target+(fromLevel-target)*Math.exp(-elapsed*10);
        if (Math.abs(target-level)<.001) level=target;
        const h=ctx.handles();
        if (h) {
          updateIndicator(h);
          if ((group || target) && ensureLights(h)) for (const pair of pairs) {
            pair.light.position.copy(h.ego.lights[pair.side].light.position);
            pair.light.position.y=Math.max(.22,pair.light.position.y-.35);
            pair.aim.position.copy(pair.light.position); pair.aim.position.z+=14; pair.aim.position.y-=1.7;
            pair.light.intensity=CabinFeedback._enabled ? level*7 : 0;
          }
        }
        frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
    },
    onChange(changed,snapshot) {
      fromLevel=level; transitionAt=performance.now();
      target=snapshot.fog_lights ? 1 : 0;
      if (initial) { level=fromLevel=target; initial=false; }
    },
    dispose() {
      if (frame!==null) cancelAnimationFrame(frame);
      releaseLights(); releaseIndicator(); frame=null; target=level=fromLevel=transitionAt=0; initial=true;
    },
  });
})();
